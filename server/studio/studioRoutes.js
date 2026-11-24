/**
 * Smart Studio routes — Phase 1 (+ Smart Presets subsystem).
 *
 * Wiring in server.ts:
 *   import { studioRoutes } from './studio/studioRoutes.js';
 *   app.use('/api/studio', studioRoutes(platformDb, workspaceAuth.requireWorkspaceAuth));
 *
 * No SQL here — all data access goes through studioService / presetStore (DAL rule).
 */
import { Router } from 'express';
import fs from 'node:fs';
import { classifyIntent } from './intentRouter.js';
import { listRegistry, getRegistryPreset, resolvePresetId } from './presetRegistry.js';
import { labelsFor } from './i18n/labels.js';
import { studioImageProviderStatus } from './imageProviders.js';
import {
  generateStudioAsset, getAsset, listAssets, resolveAssetPath, resolveAssetWebpPath, studioQuota,
} from './studioService.js';
import { generateCandidates } from './imageModeService.js';
import { saveReference, listReferences } from './referenceStore.js';
import { subscribe, getHistory } from './pipelineEvents.js';
import {
  saveCustomPresetFromAsset, listCustomPresets, deleteCustomPreset,
  setBrandLock, getBrandLock, clearBrandLock,
} from './presetStore.js';
import { routeRequest } from './smartRouter.js';
import { markOverride, listRouting, getRouting } from './routerTelemetry.js';
import { enhancePrompt } from './enhancer/promptEnhancerEngine.js';
import { listEnhancements } from './enhancer/enhancerStore.js';
import { evaluateClarifiers, resolveClarifier, skipClarifier } from './clarifier/quickClarifiersEngine.js';
import { defaultRouterLlm } from './routerLlm.js';
import { StudioError } from './studioErrors.js';
import crypto from 'node:crypto';
import {
  buildUi, getBuild, listBuilds, resolveBuildHtmlPath,
  applyPropPatch, applySurgicalPatch, applyImageSwap, analyzeUiImage,
} from './uiBuilderService.js';
import { readReferenceBytes } from './referenceStore.js';
import { injectBridge } from './previewBridge.js';

export function studioRoutes(db, requireAuth) {
  const r = Router();
  r.use(requireAuth);

  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // Provider honesty for the UI — BLOCKED is shown, never hidden.
  r.get('/providers', (req, res) => {
    res.json({ image: studioImageProviderStatus() });
  });

  /* ------------------------------ Presets ------------------------------ */

  // Full preset gallery: labels resolved per ?lang=, modifiers included,
  // thumbnail_url for the visual cards.
  r.get('/presets', (req, res) => {
    const lang = req.query.lang === 'en' ? 'en' : 'ar';
    const L = labelsFor(lang);
    res.json({
      presets: listRegistry().map((p) => ({
        id: p.id,
        label: L.presets[p.id] || p.id,
        category: p.category,
        default_aspect: p.default_aspect,
        alt_aspects: p.alt_aspects,
        ocr_gate: p.ocr_gate,
        palette: p.palette,
        thumbnail_url: `/api/studio/presets/${p.id}/thumbnail`,
        modifiers: p.modifiers.map((m) => ({
          id: m.id,
          label: L.modifiers[m.id] || m.id,
          options: m.options.map((o) => ({ id: o.id, label: L.modifiers[o.id] || o.id })),
        })),
      })),
      intensity_levels: ['subtle', 'balanced', 'strong'].map((id) => ({ id, label: L.intensity[id] || id })),
      badge: { auto_detected: L.badge_auto_detected, change: L.badge_change },
    });
  });

  // Deterministic SVG palette card — a real visual preview of the preset's
  // palette/mood at zero generation cost. AI sample thumbnails can be cached
  // on top later without changing this contract.
  r.get('/presets/:id/thumbnail', (req, res) => {
    const p = getRegistryPreset(req.params.id);
    if (!p) throw new StudioError(404, 'STUDIO_PRESET_NOT_FOUND', 'Unknown preset.');
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(presetThumbnailSvg(p));
  });

  /* --------------------------- Custom presets --------------------------- */

  r.post('/presets/custom', (req, res) => {
    const { asset_id: assetId, name } = req.body || {};
    const cp = saveCustomPresetFromAsset(db, { ownerId: req.user.id, assetId, name });
    res.status(201).json(publicCustomPreset(cp));
  });

  r.get('/presets/custom', (req, res) => {
    res.json({ custom_presets: listCustomPresets(db, req.user.id, {}).map(publicCustomPreset) });
  });

  r.delete('/presets/custom/:id', (req, res) => {
    res.json(deleteCustomPreset(db, req.user.id, req.params.id));
  });

  /* ----------------------------- Brand lock ----------------------------- */

  r.put('/projects/:projectId/brand-lock', (req, res) => {
    const { preset_id: presetId, custom_preset_id: customPresetId } = req.body || {};
    const lock = setBrandLock(db, {
      ownerId: req.user.id, projectId: req.params.projectId, presetId, customPresetId,
    });
    res.json(publicBrandLock(lock));
  });

  r.get('/projects/:projectId/brand-lock', (req, res) => {
    const lock = getBrandLock(db, req.user.id, req.params.projectId);
    res.json({ locked: !!lock, lock: lock ? publicBrandLock(lock) : null });
  });

  r.delete('/projects/:projectId/brand-lock', (req, res) => {
    res.json(clearBrandLock(db, req.user.id, req.params.projectId));
  });

  /* ------------------------------ Pipeline ------------------------------ */

  r.get('/quota', (req, res) => {
    res.json({ image: studioQuota(db, req.user.id) });
  });

  // Smart Intent Router (7 layers): normalize -> fast-path -> context ->
  // classifier -> confidence gate -> decomposition -> telemetry. Returns the
  // full routing contract; `mode` keeps the legacy Phase-1 mapping.
  r.post('/route', asyncH(async (req, res) => {
    const {
      message, answers, signals, session_id: sessionId, project_id: projectId, lang,
    } = req.body || {};
    const decision = await routeRequest(db, {
      ownerId: req.user.id,
      sessionId: sessionId || null,
      projectId: projectId || null,
      message,
      signals: signals || {},
      answers: answers || {},
      lang: lang === 'en' ? 'en' : 'ar',
    });
    res.json(decision);
  }));

  // 1-Click Override: the client flipped the routed intent — recorded for
  // continuous improvement of the routing rules.
  r.post('/route/override', (req, res) => {
    const { routing_id: routingId, corrected_intent: correctedIntent } = req.body || {};
    if (!routingId || typeof correctedIntent !== 'string') {
      throw new StudioError(400, 'ROUTER_OVERRIDE_INVALID', 'routing_id and corrected_intent are required.');
    }
    const row = markOverride(db, req.user.id, routingId, correctedIntent);
    if (!row) throw new StudioError(404, 'ROUTER_TELEMETRY_NOT_FOUND', 'Routing row not found.');
    res.json({ ok: true, routing: publicRouting(row) });
  });

  // Routing telemetry (owner-isolated) — confidence/latency/provider audit.
  r.get('/route/telemetry', (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json({ routing: listRouting(db, req.user.id, { limit }).map(publicRouting) });
  });

  // Prompt Enhancer Engine (official 6-layer annex): returns the full
  // zod-validated contract. Backward compatible — legacy prompt_en /
  // negative / overlay_texts keys are still present for older clients.
  r.post('/enhance', asyncH(async (req, res) => {
    const {
      message, preset_id: presetId, sector, theme, platform,
      session_id: sessionId, intensity, modifiers, candidates,
      style_seed: styleSeed, protected_brand_text: protectedBrandText,
      override_prompt: overridePrompt, track, provider_dialect: providerDialect,
      reference_note: referenceNote, project_id: projectId,
    } = req.body || {};
    if (!message || typeof message !== 'string') {
      throw new StudioError(400, 'STUDIO_MESSAGE_INVALID', 'الرسالة مطلوبة.');
    }
    if (presetId && !resolvePresetId(presetId)) {
      throw new StudioError(400, 'STUDIO_PRESET_INVALID', `Unknown preset: ${presetId}`);
    }
    const cls = classifyIntent(message, { answers: { sector, theme, platform } });
    // Brand Kit binding (feature 15, Phase-1 scope): locked project palette.
    let brandLockPalette = null;
    if (projectId) {
      const lock = getBrandLock(db, req.user.id, projectId);
      if (lock) {
        try {
          const palette = JSON.parse(lock.palette_json || '[]');
          if (Array.isArray(palette) && palette.length) brandLockPalette = palette;
        } catch { /* malformed lock palette -> ignored honestly */ }
      }
    }
    const contract = await enhancePrompt(db, {
      ownerId: req.user.id,
      sessionId: sessionId || null,
      message,
      track: track === 'ui' || track === 'hybrid' ? track : 'image',
      presetId: resolvePresetId(presetId),
      intensity: typeof intensity === 'string' ? intensity : 'balanced',
      modifiers: modifiers && typeof modifiers === 'object' ? modifiers : {},
      candidates: Number(candidates) || 0,
      styleSeed: styleSeed || null,
      protectedBrandText: protectedBrandText || null,
      providerDialect: providerDialect || null,
      overridePrompt: overridePrompt || null,
      referenceNote: referenceNote || null,
      brandLockPalette,
      sector: cls.sector,
      llm: defaultRouterLlm(),
    });
    res.json({
      ...contract,
      // Legacy keys (older clients kept working):
      prompt_en: contract.enhanced_prompt,
      negative: contract.negative_prompt,
      overlay_texts: contract.protected_brand_text ? [contract.protected_brand_text] : [],
    });
  }));

  // Enhancement telemetry ledger (feature 24, owner-isolated): raw vs
  // enhanced, latency, cache/fallback/override status.
  r.get('/enhance/telemetry', (req, res) => {
    const limit = Number(req.query.limit) || 50;
    res.json({ enhancements: listEnhancements(db, req.user.id, { limit }).map(publicEnhancement) });
  });

  /* ---------------------- Quick Clarifiers (Annex 7) ---------------------- */

  // Layer 1+2 — Confidence-Band Activation + Zero-Spend Pre-Flight Gate:
  // evaluate BEFORE any paid generation call. Deterministic bank answers
  // <15ms at $0; only genuinely non-traditional gaps escalate to the local
  // LLM behind the 800ms circuit-breaker (Layer 9).
  r.post('/clarifiers/evaluate', asyncH(async (req, res) => {
    const {
      message, project_id: projectId, routing_log_id: routingLogId,
      intent, confidence, ambiguous, verbosity_mode: verbosityMode,
    } = req.body || {};
    if (!message || typeof message !== 'string') {
      throw new StudioError(400, 'CLARIFIER_MESSAGE_INVALID', 'الرسالة مطلوبة.');
    }
    const out = await evaluateClarifiers(db, {
      ownerId: req.user.id,
      projectId: projectId || null,
      routingLogId: routingLogId || null,
      message,
      intent: typeof intent === 'string' ? intent : null,
      confidence: typeof confidence === 'number' ? confidence : null,
      ambiguous: typeof ambiguous === 'boolean' ? ambiguous : null,
      verbosityMode: typeof verbosityMode === 'string' ? verbosityMode : 'smart',
      llm: defaultRouterLlm(),
    });
    res.json(out);
  }));

  // Layer 8 — Clicks-to-Structured-JSON Compiler: 0 LLM calls by
  // construction; compiles clicks into enhancer bindings and syncs the
  // ORIGINAL routing telemetry row (corrected_intent), never a duplicate.
  r.post('/clarifiers/:id/resolve', (req, res) => {
    try {
      const out = resolveClarifier(db, {
        ownerId: req.user.id,
        clarifierId: req.params.id,
        answersPayload: req.body || {},
      });
      res.json(out);
    } catch (err) {
      if (err && err.name === 'ZodError') {
        throw new StudioError(400, 'CLARIFIER_ANSWERS_INVALID', 'Invalid clarifier answers payload.');
      }
      throw err;
    }
  });

  // Layer 5 — 1-Click Skip & Build Now: proceeds on the recommended smart
  // defaults, recorded honestly as a skip.
  r.post('/clarifiers/:id/skip', (req, res) => {
    const { message } = req.body || {};
    const out = skipClarifier(db, {
      ownerId: req.user.id,
      clarifierId: req.params.id,
      message: typeof message === 'string' ? message : '',
    });
    res.json(out);
  });

  // Full generation pipeline (presets, modifiers, intensity, brand lock).
  // Image Mode: candidates (1-4), reference_id, style_seed lock and
  // protected_brand_text are part of the request payload; a content-hash
  // cache hit returns the prior asset with cache_hit=1 and zero API spend.
  r.post('/generate', asyncH(async (req, res) => {
    const {
      message, preset_id: presetId, custom_preset_id: customPresetId,
      project_id: projectId, answers, modifiers, intensity, aspect,
      candidates, reference_id: referenceId, style_seed: styleSeed,
      protected_brand_text: protectedBrandText,
    } = req.body || {};
    const shared = {
      ownerId: req.user.id,
      projectId: projectId || null,
      message,
      presetId: presetId || null,
      customPresetId: customPresetId || null,
      modifiers: modifiers || null,
      intensity: intensity || null,
      aspectOverride: aspect || null,
      answers: answers || {},
      referenceId: referenceId || null,
      seedOverride: styleSeed || null,
      protectedBrandText: protectedBrandText || null,
    };
    if (candidates !== undefined && candidates !== null && Number(candidates) > 1) {
      const { group, assets } = await generateCandidates(db, { ...shared, candidates });
      return res.status(201).json({ group, assets: assets.map(publicAsset) });
    }
    const asset = await generateStudioAsset(db, shared);
    res.status(201).json(publicAsset(asset));
  }));

  /* ------------------------- Reference images --------------------------- */

  // Layer 2 — drag&drop product/style reference (base64 JSON body).
  r.post('/references', (req, res) => {
    const { data_b64: dataB64, role } = req.body || {};
    const ref = saveReference(db, req.user.id, { dataB64, role: role || 'style' });
    res.status(201).json(publicReference(ref));
  });

  r.get('/references', (req, res) => {
    res.json({ references: listReferences(db, req.user.id, {}).map(publicReference) });
  });

  /* ------------------------- Live pipeline (SSE) ------------------------ */

  // Layer 5 — stage telemetry: history replay then live stream.
  r.get('/assets/:id/events', (req, res) => {
    getAsset(db, req.user.id, req.params.id); // ownership + existence (404 honest)
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
    for (const evt of getHistory(req.params.id)) send(evt);
    const unsubscribe = subscribe(req.params.id, send);
    req.on('close', unsubscribe);
  });

  r.get('/assets', (req, res) => {
    const limit = Number(req.query.limit) || 30;
    const offset = Number(req.query.offset) || 0;
    res.json(listAssets(db, req.user.id, { limit, offset }).map(publicAsset));
  });

  r.get('/assets/:id', (req, res) => {
    res.json(publicAsset(getAsset(db, req.user.id, req.params.id)));
  });

  // Artifact download: ownership + safe path + proper headers.
  // ?format=webp serves the locally optimized variant (falls back to original if absent).
  r.get('/assets/:id/file', (req, res) => {
    let target;
    if (req.query.format === 'webp') {
      try {
        target = resolveAssetWebpPath(db, req.user.id, req.params.id);
      } catch (err) {
        if (err && err.code === 'STUDIO_WEBP_MISSING') {
          target = resolveAssetPath(db, req.user.id, req.params.id);
        } else {
          throw err;
        }
      }
    } else {
      target = resolveAssetPath(db, req.user.id, req.params.id);
    }
    const { abs, mime } = target;
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(abs).pipe(res);
  });

  /* --------------------- UI Builder Mode (Phase 3) ---------------------- */

  // Full build: router contract (or a fresh route) → blueprint → synthesis
  // → asset injection → quality gates → honest status.
  r.post('/ui/build', asyncH(async (req, res) => {
    const {
      routing_id: routingId, message, session_id: sessionId, project_id: projectId,
      lang, answers,
    } = req.body || {};
    let contract = null;
    let usedRoutingId = routingId || null;
    if (routingId) {
      contract = contractFromRouting(db, req.user.id, routingId);
    } else {
      const routed = await routeRequest(db, {
        ownerId: req.user.id,
        sessionId: sessionId || crypto.randomUUID(),
        projectId: projectId || null,
        message, signals: req.body?.signals || {}, answers: answers || {}, lang: lang || 'ar',
      });
      if (routed.status === 'ambiguous') {
        return res.status(200).json({ status: 'ambiguous', routing: routed });
      }
      contract = routed;
      usedRoutingId = routed.routing_id;
    }
    if (!['ui_generate', 'ui_edit', 'hybrid_ui_with_assets'].includes(contract.intent)) {
      throw new StudioError(400, 'UI_INTENT_UNSUPPORTED', 'ui/build accepts ui_generate, ui_edit or hybrid contracts.');
    }
    const build = await buildUi(db, {
      ownerId: req.user.id,
      projectId: projectId || null,
      sessionId: sessionId || null,
      routingId: usedRoutingId,
      contract,
      message: message || '',
      lang: lang === 'en' ? 'en' : 'ar',
    });
    res.status(201).json(publicUiBuild(build));
  }));

  // Wireframe / screenshot → code (Layer 2). BLOCKED honestly without a key.
  r.post('/ui/from-image', asyncH(async (req, res) => {
    const { reference_id: referenceId, lang } = req.body || {};
    if (!referenceId) throw new StudioError(400, 'UI_REFERENCE_REQUIRED', 'reference_id is required.');
    const { b64, mime } = readReferenceBytes(db, req.user.id, referenceId);
    const analysis = await analyzeUiImage({ b64, mime, lang: lang === 'en' ? 'en' : 'ar' });
    res.json({ analysis });
  }));

  r.get('/ui', (req, res) => {
    const { project_id: projectId, limit } = req.query;
    res.json({ builds: listBuilds(db, req.user.id, { projectId: projectId || null, limit: Number(limit) || 50 }).map(publicUiBuild) });
  });

  r.get('/ui/:id', (req, res) => {
    res.json(publicUiBuild(getBuild(db, req.user.id, req.params.id)));
  });

  // Preview HTML with the runtime bridge injected (sandboxed iframe source).
  r.get('/ui/:id/file', (req, res) => {
    const abs = resolveBuildHtmlPath(db, req.user.id, req.params.id);
    const html = injectBridge(fs.readFileSync(abs, 'utf8'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(html);
  });

  // Build stage telemetry (SSE): plan→synthesize→assets→audit→ready.
  r.get('/ui/:id/events', (req, res) => {
    getBuild(db, req.user.id, req.params.id);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);
    for (const evt of getHistory(req.params.id)) send(evt);
    const unsubscribe = subscribe(req.params.id, send);
    req.on('close', unsubscribe);
  });

  // Layer 5 — Direct Property Panel: deterministic, $0, zero LLM.
  r.post('/ui/:id/prop', (req, res) => {
    const { data_ui_id: dataUiId, prop, value } = req.body || {};
    if (!dataUiId) throw new StudioError(400, 'UI_NODE_REQUIRED', 'data_ui_id is required.');
    const out = applyPropPatch(db, { ownerId: req.user.id, buildId: req.params.id, dataUiId, prop, value });
    res.json(out);
  });

  // Layer 5 — Surgical Component Regeneration (subtree only, local tier).
  r.post('/ui/:id/patch', asyncH(async (req, res) => {
    const { data_ui_id: dataUiId, instruction } = req.body || {};
    if (!dataUiId) throw new StudioError(400, 'UI_NODE_REQUIRED', 'data_ui_id is required.');
    const out = await applySurgicalPatch(db, { ownerId: req.user.id, buildId: req.params.id, dataUiId, instruction });
    res.json(out);
  }));

  // Layer 5 — Quick Asset Modal: deterministic image swap from the vault.
  r.post('/ui/:id/swap-image', (req, res) => {
    const { data_ui_asset: dataUiAsset, asset_id: assetId } = req.body || {};
    if (!dataUiAsset || !assetId) throw new StudioError(400, 'UI_SWAP_INVALID', 'data_ui_asset and asset_id are required.');
    const out = applyImageSwap(db, { ownerId: req.user.id, buildId: req.params.id, dataUiAsset, assetId });
    res.json(out);
  });

  // Unified error handler — no internal leaks.
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err instanceof StudioError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('[studio] unexpected:', err);
    res.status(500).json({ error: { code: 'STUDIO_INTERNAL_ERROR', message: 'خطأ داخلي غير متوقع.' } });
  });

  return r;
}

/* ------------------------------- Views --------------------------------- */

const escXml = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]));

/** Deterministic palette-card SVG — real visual identity, zero generation cost. */
function presetThumbnailSvg(p) {
  const [c1, c2, c3, c4] = p.palette;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="${escXmlColor(c1)}"/><stop offset="0.55" stop-color="${escXmlColor(c2)}"/><stop offset="1" stop-color="${escXmlColor(c3)}"/>
  </linearGradient></defs>
  <rect width="320" height="180" fill="url(#g)"/>
  <circle cx="270" cy="40" r="60" fill="${escXmlColor(c4)}" opacity="0.35"/>
  <rect x="24" y="120" width="272" height="8" rx="4" fill="${escXmlColor(c4)}" opacity="0.8"/>
  <rect x="24" y="136" width="180" height="8" rx="4" fill="${escXmlColor(c4)}" opacity="0.5"/>
  <text x="24" y="52" font-family="Arial, sans-serif" font-size="20" font-weight="bold" fill="${escXmlColor(c4)}">${escXml(p.id)}</text>
  <text x="24" y="74" font-family="Arial, sans-serif" font-size="11" fill="${escXmlColor(c4)}" opacity="0.85">${escXml(p.default_aspect)} · ocr:${escXml(p.ocr_gate)}</text>
</svg>`;
}

function escXmlColor(c) {
  return /^#[0-9a-fA-F]{6}$/.test(String(c)) ? c : '#000000';
}

/** Public view — hides internal fields; artifact URL only when a file exists. */
function publicAsset(a) {
  const autoDetected = !!a.auto_detected;
  return {
    id: a.id,
    kind: a.kind,
    state: a.state,
    preset: a.preset,
    sector: a.sector,
    theme: a.theme,
    platform: a.platform,
    aspect: a.aspect,
    prompt_en: a.prompt_en,
    overlay_texts: JSON.parse(a.overlay_texts_json || '[]'),
    ocr_coverage: a.ocr_coverage,
    ocr_gate_mode: a.ocr_gate_mode,
    attempts: a.attempts,
    provider: a.provider,
    model: a.model,
    palette: JSON.parse(a.palette_json || '[]'),
    style_seed: a.style_seed,
    modifiers: JSON.parse(a.modifiers_json || '{}'),
    intensity: a.intensity,
    auto_detected: autoDetected,
    // Drives the interactive badge: "Auto-detected mode — [Change]".
    badge: autoDetected ? { type: 'auto_detected', preset: a.preset } : null,
    generation_group: a.generation_group || null,
    reference_id: a.reference_id || null,
    cache_hit: !!a.cache_hit,
    error_code: a.error_code,
    error_summary: a.error_summary,
    created_at: a.created_at,
    updated_at: a.updated_at,
    artifact_url: a.artifact_path ? `/api/studio/assets/${a.id}/file` : null,
    webp_url: a.webp_path ? `/api/studio/assets/${a.id}/file?format=webp` : null,
    events_url: `/api/studio/assets/${a.id}/events`,
  };
}

function publicReference(ref) {
  return {
    id: ref.id,
    role: ref.role,
    hash: ref.hash,
    mime: ref.mime,
    bytes: ref.bytes,
    created_at: ref.created_at,
  };
}

function publicEnhancement(row) {
  let contract = null;
  try { contract = JSON.parse(row.contract_json)?.contract || null; } catch { contract = null; }
  return {
    id: row.id,
    session_id: row.session_id,
    track: row.track,
    provider_dialect: row.provider_dialect,
    engine_provider: row.engine_provider,
    raw_message: row.raw_message,
    enhanced_prompt: contract?.enhanced_prompt ?? null,
    fallback_used: !!row.fallback_used,
    override_used: !!row.override_used,
    retry_refinement_applied: !!row.retry_refinement_applied,
    cache_hit: !!row.cache_hit,
    latency_ms: row.latency_ms,
    created_at: row.created_at,
  };
}

function publicRouting(row) {
  return {
    id: row.id,
    session_id: row.session_id,
    intent: row.intent,
    confidence: row.confidence,
    model_tier: row.model_tier,
    provider: row.provider,
    fallback_used: !!row.fallback_used,
    ambiguous: !!row.ambiguous,
    override_clicked: !!row.override_clicked,
    corrected_intent: row.corrected_intent,
    latency_ms: row.latency_ms,
    cost_blocked: !!row.cost_blocked,
    created_at: row.created_at,
  };
}

function publicCustomPreset(cp) {
  return {
    id: cp.id,
    name: cp.name,
    base_preset_id: cp.base_preset_id,
    source_asset_id: cp.source_asset_id,
    aspect: cp.aspect,
    ocr_gate: cp.ocr_gate,
    palette: JSON.parse(cp.palette_json || '[]'),
    style_seed: cp.style_seed,
    modifiers: JSON.parse(cp.modifiers_json || '{}'),
    intensity: cp.intensity,
    created_at: cp.created_at,
  };
}

function publicBrandLock(lock) {
  return {
    project_id: lock.project_id,
    preset_id: lock.preset_id,
    custom_preset_id: lock.custom_preset_id,
    style_seed: lock.style_seed,
    palette: JSON.parse(lock.palette_json || '[]'),
    locked_at: lock.locked_at,
  };
}

/** Replay a stored router contract (tenant-scoped) for /ui/build. */
function contractFromRouting(db, ownerId, routingId) {
  const row = getRouting(db, ownerId, routingId);
  if (!row) throw new StudioError(404, 'UI_ROUTING_NOT_FOUND', 'Routing record not found.');
  try {
    const contract = JSON.parse(row.contract_json || 'null');
    if (!contract || !contract.intent) throw new Error('empty');
    return contract;
  } catch (_) {
    throw new StudioError(422, 'UI_CONTRACT_MISSING', 'Routing record has no replayable contract.');
  }
}

function publicUiBuild(b) {
  const audit = typeof b.audit_json === 'string' ? JSON.parse(b.audit_json || '{}') : (b.audit_json || {});
  return {
    id: b.id,
    domain: b.domain,
    model_tier: b.model_tier,
    provider: b.provider,
    status: b.status,
    version: b.version,
    parent_id: b.parent_id,
    lang: b.lang,
    heal_used: !!b.heal_used,
    gates: {
      summary: audit.summary || null,
      assets: audit.assets || null,
      audit: audit.audit
        ? { ran: audit.audit.ran, status: audit.audit.status, console_errors: audit.audit.consoleErrors, broken_images: audit.audit.brokenImages, overflow: audit.audit.overflow }
        : null,
      wcag: audit.wcag || null,
    },
    preview_url: `/api/studio/ui/${b.id}/file`,
    events_url: `/api/studio/ui/${b.id}/events`,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}
