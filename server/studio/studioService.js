/**
 * Smart Studio — service layer (Phase 1).
 *
 * Constitution rules enforced here:
 * 1) ALL studio SQL lives in this file only (DAL) — routes/frontend never write SQL.
 * 2) owner_id is mandatory on every read/write (app-level tenant isolation).
 * 3) An asset is READY only after the artifact exists on disk AND (when overlay
 *    texts were requested) the OCR gate passed. Any uncertainty is reported
 *    honestly (UNVERIFIED / QUALITY_GATE_FAILED / BLOCKED) — never faked.
 * 4) Quota accounting reuses the media_usage table with type 'image', so studio
 *    generations share the same daily image budget as the media engine.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classifyIntent } from './intentRouter.js';
import { buildProfessionalPrompt } from './promptEnhancer.js';
import { generateStudioImage, studioImageProviderStatus } from './imageProviders.js';
import { verifyImageTexts } from './qualityGate.js';
import { StudioError } from './studioErrors.js';
import { getBrandLock, getCustomPreset } from './presetStore.js';
import { getRegistryPreset, detectPreset, OCR_GATE, INTENSITY } from './presetRegistry.js';
import { emitStage } from './pipelineEvents.js';
import { readReferenceBytes } from './referenceStore.js';
import { toWebpVariant } from './postProcess.js';
import { refineForRetry } from './enhancer/promptEnhancerEngine.js';
import { recordSpend, recordSaved } from './costLedger.js';

export { StudioError };

const STUDIO_ROOT = () =>
  path.join(process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'data', 'media'), 'studio');

const IMAGE_DAILY_QUOTA = 20; // shared with the media engine image quota
const MAX_ATTEMPTS = 2;       // 1 generation + 1 typography-emphasis retry (spec gate)

const now = () => new Date().toISOString();
const utcDay = () => new Date().toISOString().slice(0, 10);

/* --------------------------------- Quota --------------------------------- */
export function studioQuota(db, ownerId) {
  const row = db.prepare('SELECT units FROM media_usage WHERE owner_id = ? AND day = ? AND type = ?')
    .get(ownerId, utcDay(), 'image');
  const used = row ? row.units : 0;
  return { used, daily: IMAGE_DAILY_QUOTA, remaining: Math.max(0, IMAGE_DAILY_QUOTA - used) };
}

function enforceQuota(db, ownerId) {
  const q = studioQuota(db, ownerId);
  if (q.used + 1 > q.daily) {
    throw new StudioError(429, 'STUDIO_QUOTA_EXCEEDED',
      `تجاوزت الحصة اليومية للصور (${q.used}/${q.daily}). تُصفَّر الحصة منتصف الليل UTC.`);
  }
}

function chargeQuota(db, ownerId, units) {
  db.prepare(`INSERT INTO media_usage (owner_id, day, type, units) VALUES (?,?,?,?)
              ON CONFLICT(owner_id, day, type) DO UPDATE SET units = units + excluded.units`)
    .run(ownerId, utcDay(), 'image', units);
}

/* ---------------------------------- DAL ---------------------------------- */
function insertAsset(db, row) {
  db.prepare(`INSERT INTO studio_assets
              (id, owner_id, project_id, kind, state, user_message, prompt_en, negative,
               preset, sector, theme, platform, aspect, overlay_texts_json,
               attempts, provider, model, palette_json, style_seed, modifiers_json,
               intensity, ocr_gate_mode, auto_detected, generation_group, reference_id,
               created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.id, row.owner_id, row.project_id, row.kind, row.state, row.user_message,
         row.prompt_en, row.negative, row.preset, row.sector, row.theme, row.platform,
         row.aspect, row.overlay_texts_json, row.attempts, row.provider, row.model,
         row.palette_json, row.style_seed, row.modifiers_json, row.intensity,
         row.ocr_gate_mode, row.auto_detected, row.generation_group, row.reference_id,
         row.created_at, row.updated_at);
}

function updateAsset(db, id, ownerId, patch) {
  const allowed = ['state', 'prompt_en', 'attempts', 'provider', 'model', 'ocr_coverage',
                   'artifact_path', 'artifact_mime', 'artifact_bytes', 'error_code', 'error_summary',
                   'webp_path'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  db.prepare(`UPDATE studio_assets SET ${sets}, updated_at = ? WHERE id = ? AND owner_id = ?`)
    .run(...keys.map((k) => patch[k]), now(), id, ownerId);
}

export function getAsset(db, ownerId, id) {
  const row = db.prepare('SELECT * FROM studio_assets WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!row) throw new StudioError(404, 'STUDIO_ASSET_NOT_FOUND', 'الأصل غير موجود.');
  return row;
}

export function listAssets(db, ownerId, { limit = 30, offset = 0 } = {}) {
  return db.prepare('SELECT * FROM studio_assets WHERE owner_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(ownerId, Math.min(limit, 100), Math.max(0, offset));
}

/* ------------------------------ Artifact I/O ------------------------------ */
const MAGIC = {
  'image/png': [0x89, 0x50, 0x4e, 0x47],
  'image/jpeg': [0xff, 0xd8, 0xff],
};

function saveArtifact(ownerId, assetId, b64, mime) {
  const buf = Buffer.from(b64, 'base64');
  const sig = MAGIC[mime];
  if (!sig || buf.length < 8 || !sig.every((b, i) => buf[i] === b)) {
    throw new StudioError(502, 'STUDIO_ARTIFACT_INVALID',
      'المزوّد أعاد بيانات ليست صورة صالحة (فشل فحص Magic Bytes).');
  }
  const dir = path.join(STUDIO_ROOT(), ownerId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = mime === 'image/png' ? 'png' : 'jpg';
  const abs = path.join(dir, `${assetId}.${ext}`);
  fs.writeFileSync(abs, buf);
  return { abs, mime, bytes: buf.length };
}

export function resolveAssetPath(db, ownerId, id) {
  const row = getAsset(db, ownerId, id);
  if (!row.artifact_path) throw new StudioError(404, 'STUDIO_ARTIFACT_MISSING', 'لا يوجد ملف لهذا الأصل.');
  const abs = path.resolve(row.artifact_path);
  const root = path.resolve(STUDIO_ROOT());
  if (!abs.startsWith(root + path.sep)) {
    throw new StudioError(403, 'STUDIO_PATH_FORBIDDEN', 'مسار غير مسموح.');
  }
  if (!fs.existsSync(abs)) throw new StudioError(410, 'STUDIO_ARTIFACT_GONE', 'الملف لم يعد موجوداً.');
  return { abs, mime: row.artifact_mime || 'image/png' };
}

/** Web-optimized variant (Layer 4): 404 honestly when no WebP was produced. */
export function resolveAssetWebpPath(db, ownerId, id) {
  const row = getAsset(db, ownerId, id);
  if (!row.webp_path) throw new StudioError(404, 'STUDIO_WEBP_MISSING', 'لا توجد نسخة WebP لهذا الأصل.');
  const abs = path.resolve(row.webp_path);
  const root = path.resolve(STUDIO_ROOT());
  if (!abs.startsWith(root + path.sep)) {
    throw new StudioError(403, 'STUDIO_PATH_FORBIDDEN', 'مسار غير مسموح.');
  }
  if (!fs.existsSync(abs)) throw new StudioError(410, 'STUDIO_ARTIFACT_GONE', 'الملف لم يعد موجوداً.');
  return { abs, mime: 'image/webp' };
}

/* ----------------------------- Orchestration ----------------------------- */
const TYPOGRAPHY_RETRY_SUFFIX =
  'CRITICAL: all text in the image must be perfectly legible, correctly spelled, ' +
  'large high-contrast typography, flat frontal signage, no perspective distortion on letters.';

const newSeed = () => crypto.randomBytes(6).toString('hex');

/** Validate quick modifiers against the preset definition; return prompt fragments. */
function applyModifiers(preset, modifiers = {}) {
  if (!modifiers || typeof modifiers !== 'object') return { fragments: [], applied: {} };
  const fragments = [];
  const applied = {};
  for (const [modId, optId] of Object.entries(modifiers)) {
    const mod = preset?.modifiers?.find((m) => m.id === modId);
    if (!mod) throw new StudioError(400, 'STUDIO_MODIFIER_INVALID', `Unknown modifier for this preset: ${modId}`);
    const opt = mod.options.find((o) => o.id === optId);
    if (!opt) throw new StudioError(400, 'STUDIO_MODIFIER_INVALID', `Unknown option ${optId} for modifier ${modId}`);
    fragments.push(opt.fragment_en);
    applied[modId] = optId;
  }
  return { fragments, applied };
}

/**
 * Preset resolution precedence:
 *   explicit custom > explicit builtin > project brand lock > auto-detect.
 * Brand lock forces preset + palette + style_seed so every image in the
 * project follows the same visual identity until unlocked.
 */
function resolveGenerationPreset(db, ownerId, { projectId, presetId, customPresetId, message, sector }) {
  if (customPresetId) {
    const cp = getCustomPreset(db, ownerId, customPresetId);
    const base = cp.base_preset_id ? getRegistryPreset(cp.base_preset_id) : null;
    return {
      kind: 'custom', preset: base, presetId: cp.base_preset_id, customPreset: cp, base,
      palette: JSON.parse(cp.palette_json || '[]'), styleSeed: cp.style_seed,
      ocrGate: cp.ocr_gate, aspect: cp.aspect, intensity: cp.intensity,
      modifiers: JSON.parse(cp.modifiers_json || '{}'),
      auto_detected: false, brand_locked: false,
    };
  }
  if (presetId) {
    const p = getRegistryPreset(presetId);
    if (!p) throw new StudioError(400, 'STUDIO_PRESET_INVALID', `Unknown preset: ${presetId}`);
    return {
      kind: 'builtin', preset: p, presetId: p.id, customPreset: null, base: p,
      palette: p.palette, styleSeed: newSeed(), ocrGate: p.ocr_gate,
      aspect: p.default_aspect, intensity: 'balanced', modifiers: {},
      auto_detected: false, brand_locked: false,
    };
  }
  if (projectId) {
    const lock = getBrandLock(db, ownerId, projectId);
    if (lock) {
      if (lock.custom_preset_id) {
        const cp = getCustomPreset(db, ownerId, lock.custom_preset_id);
        const base = cp.base_preset_id ? getRegistryPreset(cp.base_preset_id) : null;
        return {
          kind: 'custom', preset: base, presetId: cp.base_preset_id, customPreset: cp, base,
          palette: JSON.parse(lock.palette_json || cp.palette_json || '[]'), styleSeed: lock.style_seed || cp.style_seed,
          ocrGate: cp.ocr_gate, aspect: cp.aspect, intensity: cp.intensity,
          modifiers: JSON.parse(cp.modifiers_json || '{}'),
          auto_detected: false, brand_locked: true,
        };
      }
      const p = getRegistryPreset(lock.preset_id);
      if (p) {
        return {
          kind: 'builtin', preset: p, presetId: p.id, customPreset: null, base: p,
          palette: JSON.parse(lock.palette_json || '[]'), styleSeed: lock.style_seed || newSeed(),
          ocrGate: p.ocr_gate, aspect: p.default_aspect, intensity: 'balanced', modifiers: {},
          auto_detected: false, brand_locked: true,
        };
      }
    }
  }
  const det = detectPreset(message, { sector });
  const p = getRegistryPreset(det.preset_id);
  return {
    kind: 'builtin', preset: p, presetId: p.id, customPreset: null, base: p,
    palette: p.palette, styleSeed: newSeed(), ocrGate: p.ocr_gate,
    aspect: p.default_aspect, intensity: 'balanced', modifiers: {},
    auto_detected: true, brand_locked: false, detect_via: det.via,
  };
}

/**
 * Full pipeline: classify -> resolve preset (explicit/lock/auto-detect) ->
 * bundle parameters (wrapper + modifiers + palette + seed + intensity) ->
 * generate -> magic-byte validate -> conditional OCR gate (one emphasis retry)
 * -> honest final state.
 */
const SEED_PATTERN = /^[a-zA-Z0-9:_-]{1,64}$/;

/** SHA-256 request fingerprint (Layer 5): identical requests never re-bill the API. */
export function generationFingerprint({ promptEn, negative, presetLabel, applied, finalIntensity, styleSeed, aspect, refHash }) {
  return crypto.createHash('sha256').update(JSON.stringify({
    p: promptEn, n: negative, pr: presetLabel, m: applied,
    i: finalIntensity, s: styleSeed, a: aspect, r: refHash || null,
  })).digest('hex');
}

function cacheLookup(db, ownerId, fingerprint) {
  const row = db.prepare(
    'SELECT asset_id FROM studio_generation_cache WHERE owner_id = ? AND fingerprint = ?',
  ).get(ownerId, fingerprint);
  if (!row) return null;
  try {
    const asset = getAsset(db, ownerId, row.asset_id);
    return asset.state === 'READY' ? asset : null; // only proven results are served
  } catch {
    return null;
  }
}

function cacheStore(db, ownerId, fingerprint, assetId) {
  db.prepare(`INSERT OR IGNORE INTO studio_generation_cache (owner_id, fingerprint, asset_id, created_at)
              VALUES (?,?,?,?)`).run(ownerId, fingerprint, assetId, now());
}

/**
 * Full pipeline: classify -> resolve preset (explicit/lock/auto-detect) ->
 * bundle parameters (wrapper + modifiers + palette + seed + intensity) ->
 * [cache check] -> generate -> magic-byte validate -> conditional OCR gate
 * (one emphasis retry) -> local WebP post-process -> honest final state.
 *
 * Image Mode additions: locked style_seed, explicit protected_brand_text,
 * product/style reference (multimodal), candidate groups, pipeline events.
 */
export async function generateStudioAsset(db, {
  ownerId, projectId = null, message, presetId = null, customPresetId = null,
  modifiers = null, intensity = null, aspectOverride = null,
  answers = {}, fetchImpl, verifyImpl = verifyImageTexts,
  seedOverride = null, protectedBrandText = null, referenceId = null,
  generationGroup = null, skipCache = false,
  enhancerContract = null, variationIndex = 0, enhancerSessionId = null,
}) {
  if (!message || typeof message !== 'string' || message.trim().length < 3 || message.length > 4000) {
    throw new StudioError(400, 'STUDIO_MESSAGE_INVALID', 'الوصف مطلوب (3 إلى 4000 حرف).');
  }
  if (seedOverride !== null && seedOverride !== undefined && !SEED_PATTERN.test(String(seedOverride))) {
    throw new StudioError(400, 'STUDIO_SEED_INVALID', 'style_seed must be 1-64 chars of [a-zA-Z0-9:_-].');
  }

  const st = studioImageProviderStatus();
  if (st.status === 'BLOCKED') {
    throw new StudioError(503, 'STUDIO_PROVIDER_BLOCKED',
      `مزوّد الصور غير مهيأ: ${st.reason}. اضبط GEMINI_API_KEY ثم أعد المحاولة.`);
  }

  // Reference image (Layer 2): owner-scoped, magic-byte validated at upload.
  let reference = null;
  let refHash = null;
  if (referenceId) {
    const ref = readReferenceBytes(db, ownerId, referenceId);
    reference = { b64: ref.buf.toString('base64'), mime: ref.mime };
    refHash = ref.hash;
  }

  const cls = classifyIntent(message, { answers });
  const res = resolveGenerationPreset(db, ownerId, { projectId, presetId, customPresetId, message, sector: cls.sector });
  const base = res.base;
  if (!base) throw new StudioError(400, 'STUDIO_PRESET_INVALID', 'Preset has no registry base.');

  const finalIntensity = intensity || res.intensity || 'balanced';
  if (!INTENSITY.includes(finalIntensity)) {
    throw new StudioError(400, 'STUDIO_INTENSITY_INVALID', `Intensity must be one of: ${INTENSITY.join(', ')}`);
  }
  const modSource = modifiers || res.modifiers || {};
  const { fragments, applied } = applyModifiers(base, modSource);

  const aspect = aspectOverride || res.aspect || (cls.platform === 'mobile' ? '9:16' : '1:1');
  const palette = res.palette && res.palette.length ? res.palette : base.palette;
  // Seed Lock (Layer 2): an explicit seed pins composition across minor edits.
  const styleSeed = (seedOverride ? String(seedOverride) : null) || res.styleSeed || newSeed();

  // Positive wrapper with intensity weighting (subtle drops the suffix).
  const adapter = {
    prefix_en: base.wrapper_en.prefix,
    suffix_en: finalIntensity === 'subtle' ? null : base.wrapper_en.suffix,
    negative_en: res.customPreset?.negative_en || base.negative_en,
  };
  const built = buildProfessionalPrompt({
    message, preset: adapter, sector: cls.sector, theme: cls.theme, platform: cls.platform,
  });

  // Protected Brand Text (Layers 1+2 of the router/mode): explicit literal
  // that must reach the image (and the OCR gate) verbatim — never translated.
  const overlayTexts = [...built.overlay_texts];
  const brandText = typeof protectedBrandText === 'string' ? protectedBrandText.trim().slice(0, 80) : '';
  if (brandText && !overlayTexts.includes(brandText)) overlayTexts.push(brandText);

  let prompt_en = built.prompt_en;
  if (fragments.length) prompt_en += `. ${fragments.join('. ')}.`;
  prompt_en += `. Color palette: ${palette.join(', ')}.`;
  prompt_en += ` Style seed: ${styleSeed}.`;
  if (brandText) {
    prompt_en += ` Render this text EXACTLY as written, legible and unaltered: "${brandText}".`;
  }
  if (finalIntensity === 'strong' && base.wrapper_en.strong_boost) {
    prompt_en += ` ${base.wrapper_en.strong_boost}`;
  }

  // Prompt Enhancer Engine contract (official 6-layer engine output): when a
  // zod-validated contract is supplied, its enhanced prompt + negative are
  // authoritative. Candidate i>0 uses variation_prompts[i-1] (feature 20).
  if (enhancerContract && typeof enhancerContract.enhanced_prompt === 'string') {
    const viaVariation = variationIndex > 0
      && Array.isArray(enhancerContract.variation_prompts)
      && enhancerContract.variation_prompts[variationIndex - 1];
    prompt_en = viaVariation || enhancerContract.enhanced_prompt;
    built.negative = enhancerContract.negative_prompt || built.negative;
    if (enhancerContract.protected_brand_text && !overlayTexts.includes(enhancerContract.protected_brand_text)) {
      overlayTexts.push(enhancerContract.protected_brand_text);
    }
    if (!prompt_en.includes(`Style seed: ${styleSeed}`)) prompt_en += ` Style seed: ${styleSeed}.`;
  }

  const presetLabel = res.customPreset ? `custom:${res.customPreset.id}` : res.presetId;

  // Layer 5 — content-hash cache: the same request never re-bills the API.
  const fingerprint = generationFingerprint({
    promptEn: prompt_en, negative: built.negative, presetLabel, applied,
    finalIntensity, styleSeed, aspect, refHash,
  });
  if (!skipCache) {
    const cached = cacheLookup(db, ownerId, fingerprint);
    if (cached) {
      // Phase-1 cost ledger (Zero Duplicate Spend): this cache hit avoided a
      // paid image call — the saving is booked, not just asserted.
      recordSaved(db, {
        ownerId, provider: st.provider === 'mock' ? 'gemini' : (st.provider || 'gemini'),
        operation: 'image_generate', cacheSource: 'generation_cache_hit', refId: cached.id,
      });
      return { ...cached, cache_hit: 1 };
    }
  }

  enforceQuota(db, ownerId);

  const id = crypto.randomUUID();
  insertAsset(db, {
    id, owner_id: ownerId, project_id: projectId, kind: 'image', state: 'RUNNING',
    user_message: message, prompt_en, negative: built.negative,
    preset: presetLabel,
    sector: cls.sector, theme: cls.theme, platform: cls.platform,
    aspect, overlay_texts_json: JSON.stringify(overlayTexts),
    attempts: 0, provider: null, model: null,
    palette_json: JSON.stringify(palette), style_seed: styleSeed,
    modifiers_json: JSON.stringify(applied), intensity: finalIntensity,
    ocr_gate_mode: res.ocrGate, auto_detected: res.auto_detected ? 1 : 0,
    generation_group: generationGroup, reference_id: referenceId || null,
    created_at: now(), updated_at: now(),
  });
  emitStage(id, 'enhance', { prompt_bytes: Buffer.byteLength(prompt_en), reference: !!reference });

  try {
    let gen = null;
    let prompt = prompt_en;
    let attempts = 0;
    let gate = { pass: false, coverage: null, reason: 'not-run' };
    let artifact = null;

    // Conditional OCR gate: 'off' presets never call OCR (zero wasted calls).
    const gateOff = res.ocrGate === OCR_GATE.OFF;
    const textsRequired = overlayTexts.length > 0;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      attempts = attempt;
      emitStage(id, 'generate', { attempt });
      gen = await generateStudioImage({ prompt, aspect, negative: built.negative, reference, fetchImpl });
      if (!gen.ok) {
        if (gen.blocked) {
          updateAsset(db, id, ownerId, { state: 'FAILED', error_code: 'STUDIO_PROVIDER_BLOCKED', error_summary: String(gen.error).slice(0, 300), attempts });
          emitStage(id, 'failed', { code: 'STUDIO_PROVIDER_BLOCKED' });
          throw new StudioError(503, 'STUDIO_PROVIDER_BLOCKED', String(gen.error));
        }
        updateAsset(db, id, ownerId, { state: 'FAILED', error_code: 'STUDIO_GENERATION_FAILED', error_summary: String(gen.error).slice(0, 300), attempts });
        emitStage(id, 'failed', { code: 'STUDIO_GENERATION_FAILED' });
        throw new StudioError(502, 'STUDIO_GENERATION_FAILED', `فشل التوليد: ${gen.error}`);
      }
      chargeQuota(db, ownerId, 1); // one real provider call per attempt — honest accounting
      // Phase-1 cost ledger: book the real paid call (mock runs book nothing
      // — a mock provider is $0 by construction, never a fake spend).
      if (st.provider !== 'mock') {
        recordSpend(db, {
          ownerId, provider: gen.provider || st.provider || 'gemini',
          operation: 'image_generate', refId: id,
        });
      }
      artifact = saveArtifact(ownerId, id, gen.b64, gen.mime);
      updateAsset(db, id, ownerId, {
        attempts, provider: gen.provider || st.provider, model: gen.model || null,
        artifact_path: artifact.abs, artifact_mime: artifact.mime, artifact_bytes: artifact.bytes,
      });

      if (gateOff) { gate = { pass: true, coverage: null, reason: 'gate-off' }; break; }
      if (!textsRequired) { gate = { pass: true, coverage: null, reason: 'no-overlay-texts' }; break; }
      emitStage(id, 'ocr', { attempt });
      gate = await verifyImpl(artifact.abs, overlayTexts);
      if (gate.reason === 'BLOCKED_OCR_UNAVAILABLE') break; // no point retrying what we cannot measure
      if (gate.pass) break;
      if (enhancerContract) {
        // Enhancer Layer 6 (feature 23): retry-aware self-refinement reads
        // the OCR failure and tightens typography constraints for the
        // single allowed retry — recorded in the telemetry ledger.
        const refined = refineForRetry(db, {
          ownerId, sessionId: enhancerSessionId,
          contract: { ...enhancerContract, enhanced_prompt: prompt_en },
          gate: 'ocr',
          reason: gate.reason || 'coverage-below-threshold',
          missing: gate.missing || [],
        });
        prompt = refined.enhanced_prompt;
      } else {
        prompt = `${prompt_en}. ${TYPOGRAPHY_RETRY_SUFFIX}`; // one emphasis retry
      }
    }

    let finalState;
    if (gateOff || !textsRequired || gate.pass) {
      finalState = 'READY';
      updateAsset(db, id, ownerId, { state: 'READY', ocr_coverage: gate.coverage, error_code: null, error_summary: null });
    } else if (gate.reason === 'BLOCKED_OCR_UNAVAILABLE') {
      // Honest: image exists, but typography could not be verified in this environment.
      finalState = 'UNVERIFIED';
      updateAsset(db, id, ownerId, { state: 'UNVERIFIED', error_code: 'OCR_UNAVAILABLE', error_summary: 'تم توليد الصورة لكن تعذّر التحقق من النصوص (Tesseract غير متوفر).' });
    } else {
      finalState = 'QUALITY_GATE_FAILED';
      updateAsset(db, id, ownerId, {
        state: 'QUALITY_GATE_FAILED', ocr_coverage: gate.coverage,
        error_code: 'OCR_COVERAGE_BELOW_THRESHOLD',
        error_summary: `تغطية النصوص ${(gate.coverage * 100).toFixed(1)}% أقل من الحد 95% بعد ${attempts} محاولة.`,
      });
    }

    // Layer 4 — zero-cost local WebP variant (fast UI injection; PNG master kept).
    emitStage(id, 'postprocess', {});
    const webp = artifact ? await toWebpVariant(artifact.abs) : null;
    if (webp) updateAsset(db, id, ownerId, { webp_path: webp.path });

    // Only proven results enter the cache (never a failed/unverified image).
    if (finalState === 'READY') cacheStore(db, ownerId, fingerprint, id);

    emitStage(id, finalState === 'READY' ? 'ready' : finalState === 'UNVERIFIED' ? 'unverified' : 'failed', {
      code: finalState === 'QUALITY_GATE_FAILED' ? 'OCR_COVERAGE_BELOW_THRESHOLD' : undefined,
    });
    return { ...getAsset(db, ownerId, id), cache_hit: 0 };
  } catch (err) {
    if (err instanceof StudioError) {
      // Never leave a row stuck in RUNNING — any escaping StudioError marks it FAILED honestly.
      updateAsset(db, id, ownerId, { state: 'FAILED', error_code: err.code, error_summary: String(err.message).slice(0, 300) });
      emitStage(id, 'failed', { code: err.code });
      throw err;
    }
    updateAsset(db, id, ownerId, { state: 'FAILED', error_code: 'STUDIO_INTERNAL', error_summary: String(err?.message || err).slice(0, 300) });
    emitStage(id, 'failed', { code: 'STUDIO_INTERNAL' });
    throw new StudioError(500, 'STUDIO_INTERNAL', 'خطأ داخلي أثناء التوليد.');
  }
}
