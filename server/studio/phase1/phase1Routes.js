/**
 * phase1Routes.js — Phase-1 Feature Freeze: the frozen /api/v1 vertical
 * slice surface (direct execution order: Phase-1 launch, frozen scope).
 *
 * Frozen routes (nothing beyond these is added in Phase 1):
 *   POST /api/v1/router/dispatch              Smart Intent Router (7 layers)
 *   POST /api/v1/router/:logId/override       1-Click Override -> telemetry
 *   GET  /api/v1/telemetry/routing-and-cost   routing stats + cost ledger
 *   POST /api/v1/clarifiers/evaluate          zero-spend pre-flight card
 *   POST /api/v1/clarifiers/:id/resolve       clicks -> structured JSON
 *   POST /api/v1/clarifiers/:id/skip          1-Click Skip & Build Now
 *   POST /api/v1/prompts/enhance              Prompt Enhancer contract
 *   POST /api/v1/images/generate              generation + WebP pipeline
 *
 * These are thin bindings over the SAME engines that serve /api/studio —
 * no logic is duplicated; the frozen namespace is a stable contract for
 * the Phase-1 client while the legacy surface keeps working.
 */

import { Router } from 'express';
import { z } from 'zod';
import { routeRequest } from '../smartRouter.js';
import { markOverride, listRouting } from '../routerTelemetry.js';
import { INTENTS } from '../routerContract.js';
import { evaluateClarifiers, resolveClarifier, skipClarifier } from '../clarifier/quickClarifiersEngine.js';
import { enhancePrompt } from '../enhancer/promptEnhancerEngine.js';
import { generateStudioAsset } from '../studioService.js';
import { generateCandidates } from '../imageModeService.js';
import { classifyIntent } from '../intentRouter.js';
import { resolvePresetId } from '../presetRegistry.js';
import { getBrandLock } from '../presetStore.js';
import { defaultRouterLlm } from '../routerLlm.js';
import { costSummary } from '../costLedger.js';
import { StudioError } from '../studioErrors.js';

const DISPATCH_INPUT = z.object({
  message: z.string().min(1).max(4000),
  session_id: z.string().max(80).nullish(),
  project_id: z.string().max(80).nullish(),
  signals: z.record(z.any()).optional(),
  answers: z.record(z.any()).optional(),
  lang: z.enum(['ar', 'en']).optional(),
});

const OVERRIDE_INPUT = z.object({
  corrected_intent: z.enum(INTENTS),
});

const EVALUATE_INPUT = z.object({
  message: z.string().min(1).max(4000),
  project_id: z.string().max(80).nullish(),
  routing_log_id: z.string().max(80).nullish(),
  intent: z.string().max(40).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  ambiguous: z.boolean().nullish(),
  verbosity_mode: z.enum(['smart', 'guided', 'turbo']).optional(),
});

const ENHANCE_INPUT = z.object({
  message: z.string().min(1).max(4000),
  preset_id: z.string().max(80).nullish(),
  session_id: z.string().max(80).nullish(),
  project_id: z.string().max(80).nullish(),
  intensity: z.string().max(20).optional(),
  modifiers: z.record(z.any()).optional(),
  candidates: z.number().int().min(0).max(4).optional(),
  style_seed: z.string().max(64).nullish(),
  protected_brand_text: z.string().max(80).nullish(),
  override_prompt: z.string().max(6000).nullish(),
  track: z.enum(['image', 'ui', 'hybrid']).optional(),
  provider_dialect: z.string().max(20).nullish(),
  reference_note: z.string().max(500).nullish(),
  sector: z.string().max(40).nullish(),
  theme: z.string().max(40).nullish(),
  platform: z.string().max(40).nullish(),
});

const GENERATE_INPUT = z.object({
  message: z.string().min(3).max(4000),
  preset_id: z.string().max(80).nullish(),
  custom_preset_id: z.string().max(80).nullish(),
  project_id: z.string().max(80).nullish(),
  answers: z.record(z.any()).optional(),
  modifiers: z.record(z.any()).nullish(),
  intensity: z.string().max(20).nullish(),
  aspect: z.string().regex(/^\d+:\d+$/).nullish(),
  candidates: z.number().int().min(1).max(4).nullish(),
  reference_id: z.string().max(80).nullish(),
  style_seed: z.string().max(64).nullish(),
  protected_brand_text: z.string().max(80).nullish(),
  enhancer_contract: z.record(z.any()).nullish(),
});

function publicAsset(a) {
  return {
    id: a.id, state: a.state, aspect: a.aspect, preset: a.preset,
    provider: a.provider, model: a.model, attempts: a.attempts,
    ocr_gate_mode: a.ocr_gate_mode, ocr_coverage: a.ocr_coverage,
    cache_hit: a.cache_hit === 1 || a.cache_hit === true,
    webp_ready: !!a.webp_path,
    error_code: a.error_code || null,
    created_at: a.created_at,
  };
}

export function phase1Routes(db, requireAuth) {
  const r = Router();
  r.use(requireAuth);
  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  // Async-aware: a ZodError thrown inside an async handler rejects AFTER the
  // wrapper returned, so the guard must await the handler to catch it.
  const zodGuard = (fn) => async (req, res, next) => {
    try { return await fn(req, res, next); }
    catch (err) {
      if (err && err.name === 'ZodError') {
        return next(new StudioError(400, 'PHASE1_INPUT_INVALID', 'Invalid request payload.'));
      }
      return next(err);
    }
  };

  /* ------------------------- Smart Intent Router ------------------------ */

  r.post('/router/dispatch', asyncH(zodGuard(async (req, res) => {
    const input = DISPATCH_INPUT.parse(req.body || {});
    const decision = await routeRequest(db, {
      ownerId: req.user.id,
      sessionId: input.session_id || null,
      projectId: input.project_id || null,
      message: input.message,
      signals: input.signals || {},
      answers: input.answers || {},
      lang: input.lang === 'en' ? 'en' : 'ar',
    });
    res.json(decision);
  })));

  r.post('/router/:logId/override', asyncH(zodGuard((req, res) => {
    const input = OVERRIDE_INPUT.parse(req.body || {});
    const row = markOverride(db, req.user.id, req.params.logId, input.corrected_intent);
    if (!row) throw new StudioError(404, 'ROUTER_TELEMETRY_NOT_FOUND', 'Routing row not found.');
    res.json({ ok: true, routing_id: row.id, corrected_intent: row.corrected_intent });
  })));

  /* ----------------------- Routing & Cost Telemetry --------------------- */

  r.get('/telemetry/routing-and-cost', (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const routing = listRouting(db, req.user.id, { limit });
    const stats = db.prepare(`SELECT
        COUNT(*) AS decisions,
        COALESCE(AVG(confidence), 0) AS avg_confidence,
        COALESCE(AVG(latency_ms), 0) AS avg_latency_ms,
        SUM(CASE WHEN provider = 'fast_path' OR provider = 'deterministic' THEN 1 ELSE 0 END) AS local_decisions,
        SUM(fallback_used) AS fallback_used,
        SUM(ambiguous) AS ambiguous,
        SUM(override_clicked) AS overrides
      FROM studio_routing_telemetry WHERE owner_id = ?`).get(req.user.id);
    res.json({
      routing: {
        decisions: stats.decisions,
        avg_confidence: Math.round(stats.avg_confidence * 1000) / 1000,
        avg_latency_ms: Math.round(stats.avg_latency_ms * 100) / 100,
        local_decisions: stats.local_decisions || 0,
        fallback_used: stats.fallback_used || 0,
        ambiguous: stats.ambiguous || 0,
        overrides: stats.overrides || 0,
        recent: routing,
      },
      cost: costSummary(db, req.user.id),
    });
  });

  /* --------------------------- Quick Clarifiers ------------------------- */

  r.post('/clarifiers/evaluate', asyncH(zodGuard(async (req, res) => {
    const input = EVALUATE_INPUT.parse(req.body || {});
    const out = await evaluateClarifiers(db, {
      ownerId: req.user.id,
      projectId: input.project_id || null,
      routingLogId: input.routing_log_id || null,
      message: input.message,
      intent: input.intent || null,
      confidence: typeof input.confidence === 'number' ? input.confidence : null,
      ambiguous: typeof input.ambiguous === 'boolean' ? input.ambiguous : null,
      verbosityMode: input.verbosity_mode || 'smart',
      llm: defaultRouterLlm(),
    });
    res.json(out);
  })));

  r.post('/clarifiers/:id/resolve', asyncH(zodGuard((req, res) => {
    const out = resolveClarifier(db, {
      ownerId: req.user.id,
      clarifierId: req.params.id,
      answersPayload: req.body || {},
    });
    res.json(out);
  })));

  r.post('/clarifiers/:id/skip', (req, res) => {
    const out = skipClarifier(db, {
      ownerId: req.user.id,
      clarifierId: req.params.id,
      message: typeof (req.body || {}).message === 'string' ? req.body.message : '',
    });
    res.json(out);
  });

  /* --------------------------- Prompt Enhancer -------------------------- */

  r.post('/prompts/enhance', asyncH(zodGuard(async (req, res) => {
    const input = ENHANCE_INPUT.parse(req.body || {});
    if (input.preset_id && !resolvePresetId(input.preset_id)) {
      throw new StudioError(400, 'STUDIO_PRESET_INVALID', `Unknown preset: ${input.preset_id}`);
    }
    const cls = classifyIntent(input.message, {
      answers: { sector: input.sector, theme: input.theme, platform: input.platform },
    });
    let brandLockPalette = null;
    if (input.project_id) {
      const lock = getBrandLock(db, req.user.id, input.project_id);
      if (lock) {
        try {
          const palette = JSON.parse(lock.palette_json || '[]');
          if (Array.isArray(palette) && palette.length) brandLockPalette = palette;
        } catch { /* malformed lock palette -> ignored honestly */ }
      }
    }
    const contract = await enhancePrompt(db, {
      ownerId: req.user.id,
      sessionId: input.session_id || null,
      message: input.message,
      track: input.track || 'image',
      presetId: resolvePresetId(input.preset_id),
      intensity: input.intensity || 'balanced',
      modifiers: input.modifiers || {},
      candidates: input.candidates || 0,
      styleSeed: input.style_seed || null,
      protectedBrandText: input.protected_brand_text || null,
      providerDialect: input.provider_dialect || null,
      overridePrompt: input.override_prompt || null,
      referenceNote: input.reference_note || null,
      brandLockPalette,
      sector: cls.sector,
      llm: defaultRouterLlm(),
    });
    res.json(contract);
  })));

  /* ------------------------- Image Generation --------------------------- */

  r.post('/images/generate', asyncH(zodGuard(async (req, res) => {
    const input = GENERATE_INPUT.parse(req.body || {});
    const shared = {
      ownerId: req.user.id,
      projectId: input.project_id || null,
      message: input.message,
      presetId: input.preset_id || null,
      customPresetId: input.custom_preset_id || null,
      modifiers: input.modifiers || null,
      intensity: input.intensity || null,
      aspectOverride: input.aspect || null,
      answers: input.answers || {},
      referenceId: input.reference_id || null,
      seedOverride: input.style_seed || null,
      protectedBrandText: input.protected_brand_text || null,
      enhancerContract: input.enhancer_contract || null,
    };
    if (input.candidates && input.candidates > 1) {
      const { group, assets } = await generateCandidates(db, { ...shared, candidates: input.candidates });
      return res.status(201).json({ group, assets: assets.map(publicAsset) });
    }
    const asset = await generateStudioAsset(db, shared);
    res.status(201).json(publicAsset(asset));
  })));

  // Unified error handler — no internal leaks.
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err instanceof StudioError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('[phase1-v1] unexpected:', err);
    res.status(500).json({ error: { code: 'PHASE1_INTERNAL_ERROR', message: 'Internal phase-1 error.' } });
  });

  return r;
}
