/**
 * Prompt Enhancer Engine — orchestrator (6 layers / 24 features, Phase-1 scope).
 *
 * Pipeline per enhancement request:
 *   L1 normalize/lock -> L2 context/contradictions -> L3 track engineering ->
 *   L4 preset/brand/negative injection -> L5 dialect/safety/variations ->
 *   L6 zod validation + SHA-256 cache + telemetry (SQLite).
 *
 * Cost discipline (annex controls): everything above is deterministic local
 * code ($0). The ONLY optional LLM hop is Layer-2 gap-filling via the local
 * qwen2.5:7b adapter; a broken/invalid JSON fragment retried ONCE locally
 * then falls back to gemini-flash. cache_hit short-circuits BEFORE any LLM.
 */

import crypto from 'node:crypto';
import { runLayer1 } from './enhancerNormalize.js';
import {
  resolveContradictions,
  mergeConversationalDelta,
  fillGaps,
} from './enhancerContext.js';
import {
  visualTrackSpecs,
  negativeSpaceSpec,
  synthesizeEnglishPrompt,
  uiTrackEnvelope,
} from './enhancerTracks.js';
import {
  mergePresetWrapper,
  intensityWeighting,
  brandBinding,
  synthesizeNegativePrompt,
} from './enhancerPresets.js';
import {
  activeProviderDialect,
  adaptProviderDialect,
  safetyRewrite,
  diversifyVariations,
} from './enhancerDialects.js';
import {
  validateContract,
  validateLlmExpansion,
  tokenHygiene,
} from './enhancerSchema.js';
import {
  enhancementFingerprint,
  lookupEnhancement,
  insertEnhancement,
  latestSessionEnhancement,
} from './enhancerStore.js';
import { StudioError } from '../studioErrors.js';
import { recordSaved } from '../costLedger.js';

const LLM_EXPANSION_SYSTEM = [
  'You expand short design briefs into visual detail. Output ONLY a JSON object',
  'matching {"scene_details": string, "mood": string, "extras": string[]}.',
  'Write in precise English. Keep any quoted brand text EXACTLY unchanged.',
  'No commentary, no markdown fences.',
].join(' ');

/** Parse a JSON fragment tolerantly (fences/prose around the object). */
function parseJsonFragment(text) {
  const src = String(text || '');
  const start = src.indexOf('{');
  const end = src.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(src.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * Layer-2 LLM expansion with the Layer-6 retry/fallback ladder:
 * local qwen -> (invalid) one local retry -> gemini-flash -> (invalid)
 * honest deterministic continuation (expansion skipped, never faked).
 */
async function llmExpansion({ brief, llm, protectedTexts }) {
  if (!llm || typeof llm.local !== 'function') {
    return { expansion: null, engine_provider: 'deterministic', fallback_used: false };
  }
  const user = JSON.stringify({
    brief: brief.subject,
    environment: brief.environment,
    protected_texts: protectedTexts,
  });
  const hops = [
    { name: 'local_qwen', fn: llm.local },
    { name: 'local_qwen', fn: llm.local }, // exactly one local retry
    ...(typeof llm.cloud === 'function' ? [{ name: 'gemini_flash', fn: llm.cloud }] : []),
  ];
  let fallback = false;
  for (let i = 0; i < hops.length; i += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- deliberate ladder order
      const raw = await hops[i].fn({ system: LLM_EXPANSION_SYSTEM, user, maxTokens: 350 });
      const parsed = parseJsonFragment(raw);
      const valid = parsed && validateLlmExpansion(parsed);
      if (valid && valid.ok) {
        return {
          expansion: valid.data,
          engine_provider: hops[i].name,
          fallback_used: fallback,
        };
      }
    } catch {
      /* hop failed — advance the ladder */
    }
    if (i >= 1) fallback = true; // past the local retry -> fallback territory
  }
  return { expansion: null, engine_provider: 'deterministic', fallback_used: fallback };
}

/**
 * Main entry: enhance one client message into the official output contract.
 *
 * @param {object} db better-sqlite3-style handle (owner-scoped DAL below)
 * @param {object} arg
 * @param {string} arg.ownerId  (mandatory — tenant isolation)
 * @param {string} arg.message  raw client text (Arabic dialect friendly)
 * @param {object} [arg.llm]    { local, cloud } adapters (tests inject spies)
 */
export async function enhancePrompt(db, {
  ownerId,
  sessionId = null,
  message,
  track = 'image',
  presetId = null,
  intensity = 'balanced',
  modifiers = {},
  candidates = 0,
  styleSeed = null,
  protectedBrandText = null,
  providerDialect = null,
  overridePrompt = null,
  referenceNote = null,
  brandLockPalette = null,
  sector = null,
  llm = null,
  skipCache = false,
}) {
  const started = Date.now();
  if (!ownerId) throw new StudioError(500, 'ENHANCER_OWNER_REQUIRED', 'ownerId is mandatory.');
  if (!message || typeof message !== 'string' || message.trim().length < 3 || message.length > 4000) {
    throw new StudioError(400, 'ENHANCER_MESSAGE_INVALID', 'Message must be 3-4000 chars.');
  }
  const finalTrack = ['image', 'ui', 'hybrid'].includes(track) ? track : 'image';

  /* ------------------------- L1: normalization ------------------------- */
  const l1 = runLayer1(message);

  /* --------------------- L5: pre-flight safety ------------------------- */
  const safety = safetyRewrite(l1.normalized_message);

  /* ------------------ L2: contradictions & context --------------------- */
  const resolved = resolveContradictions(safety.text);
  let brief = fillGaps({
    normalized: resolved.text,
    lang: l1.lang,
    direction: l1.direction,
    track: finalTrack,
    sector,
  });
  brief.time_of_day = resolved.flags.time_of_day;

  // Conversational delta merging over the last accepted session contract.
  const prevRow = sessionId ? latestSessionEnhancement(db, ownerId, sessionId) : null;
  let deltas = [];
  let prevContract = null;
  if (prevRow) {
    try {
      const prev = JSON.parse(prevRow.contract_json);
      prevContract = prev.contract || null;
      const merged = mergeConversationalDelta({ brief: prev.brief }, message);
      if (merged) {
        // The follow-up message is a DELTA, not a new scene: keep the
        // previous subject/environment, apply only the changed fields.
        brief = { ...brief, ...merged.brief };
        brief.subject = prev.brief?.subject || brief.subject;
        brief.environment = prev.brief?.environment || brief.environment;
        deltas = merged.deltas;
      }
    } catch {
      /* corrupt prev row -> treat as fresh request */
    }
  }

  // Explicit params win over extraction.
  const protectedTexts = [...l1.locked_texts];
  const brandText = typeof protectedBrandText === 'string' ? protectedBrandText.trim().slice(0, 80) : '';
  if (brandText && !protectedTexts.includes(brandText)) protectedTexts.push(brandText);
  let primaryBrand = brandText || l1.protected_brand_text || null;
  // A merged follow-up inherits the locked entities of the base contract —
  // the delta message itself carries no brand mention by definition.
  if (deltas.length && prevContract?.protected_brand_text) {
    if (!protectedTexts.includes(prevContract.protected_brand_text)) {
      protectedTexts.push(prevContract.protected_brand_text);
    }
    if (!primaryBrand) primaryBrand = prevContract.protected_brand_text;
  }

  const dialect = providerDialect && ['gemini', 'fal'].includes(providerDialect)
    ? providerDialect
    : activeProviderDialect(process.env.IMAGE_PROVIDER);

  /* --------------- L6: cache short-circuit (0 LLM calls) ---------------- */
  const fingerprint = enhancementFingerprint({
    normalized_message: brief.subject,
    session_id: sessionId,
    track: finalTrack,
    preset_id: presetId,
    preset_intensity: intensity,
    modifiers,
    provider_dialect: dialect,
    protected_brand_text: primaryBrand,
    style_seed: styleSeed,
    candidates,
    // Only an APPLIED delta merge shapes the output; a fresh message in a
    // session with history must still hit the cache on repeat.
    prev_contract_id: deltas.length ? (prevRow?.id || null) : null,
  });
  if (!skipCache) {
    const hit = lookupEnhancement(db, ownerId, fingerprint);
    if (hit) {
      const cached = JSON.parse(hit.contract_json);
      // Phase-1 cost ledger: the cache short-circuited the provider that
      // served the ORIGINAL run — a gemini fallback would have been paid,
      // local qwen is $0 (recordSaved books only real savings, honestly).
      recordSaved(db, {
        ownerId,
        provider: hit.fallback_used ? 'gemini' : 'qwen_local',
        operation: 'prompt_enhance',
        cacheSource: 'prompt_cache_hit',
        refId: hit.id,
      });
      return { ...cached.contract, cache_hit: true, enhancement_id: hit.id, fingerprint };
    }
  }

  /* ---------------- L2: LLM gap-filling (retry/fallback) ---------------- */
  let expansion = null;
  let engineProvider = 'deterministic';
  let fallbackUsed = false;
  if (!overridePrompt) {
    const llmRes = await llmExpansion({ brief, llm, protectedTexts });
    expansion = llmRes.expansion;
    engineProvider = llmRes.engine_provider;
    fallbackUsed = llmRes.fallback_used;
    if (expansion) {
      if (expansion.scene_details) brief.scene_details = expansion.scene_details;
      if (expansion.mood) brief.mood = expansion.mood;
      brief.elements = [...brief.elements, ...(expansion.extras || [])];
    }
  }

  /* --------------------- L3: track engineering ------------------------- */
  let enhancedPrompt;
  let uiEnvelope = null;
  if (overridePrompt) {
    enhancedPrompt = tokenHygiene(overridePrompt, { maxLen: 4000 });
  } else if (finalTrack === 'image' || finalTrack === 'hybrid') {
    const specs = visualTrackSpecs(brief, { presetId });
    const negativeSpace = negativeSpaceSpec(brief.direction);
    enhancedPrompt = synthesizeEnglishPrompt({
      brief, specs, protectedTexts, negativeSpace,
    });
  } else {
    // UI track ships with Phase 3 — honest deferred envelope, no fake spec.
    uiEnvelope = uiTrackEnvelope(brief);
    enhancedPrompt = `UI build brief (deferred track): ${brief.subject}`;
  }
  if (brief.scene_details && !enhancedPrompt.includes(brief.scene_details)) {
    enhancedPrompt += `. ${brief.scene_details}`;
  }
  if (brief.mood) enhancedPrompt += `. Mood: ${brief.mood}`;

  /* ------------- L4: preset/brand/negative injection ------------------- */
  const weighting = intensityWeighting(intensity);
  const wrapped = finalTrack === 'ui'
    ? { prompt: enhancedPrompt, applied_preset: null }
    : mergePresetWrapper(enhancedPrompt, presetId, { intensity: weighting.level });
  const brand = brandBinding({
    styleSeed, referenceNote, brandLockPalette,
  });
  let mergedPrompt = wrapped.prompt;
  if (brand.lines.length) mergedPrompt += `. ${brand.lines.join('. ')}`;
  mergedPrompt = tokenHygiene(mergedPrompt, { maxLen: 4000 });

  const negativePrompt = synthesizeNegativePrompt({
    presetId, direction: brief.direction, protectedCount: protectedTexts.length,
  });

  /* ------------- L5: provider dialect + variations --------------------- */
  const dialectPrompt = adaptProviderDialect([mergedPrompt], dialect, 'generate');
  const variationCount = Math.max(0, Math.min(3, Number(candidates) - 1 || 0));
  const variationPrompts = variationCount
    ? diversifyVariations(dialectPrompt, variationCount)
    : [];

  /* ------------------ L6: validate + persist --------------------------- */
  const contract = {
    track: finalTrack,
    provider_dialect: dialect,
    direction: brief.direction,
    protected_brand_text: primaryBrand,
    preset_id: wrapped.applied_preset,
    preset_intensity: weighting.level,
    enhanced_prompt: dialectPrompt,
    negative_prompt: negativePrompt,
    variation_prompts: variationPrompts,
    retry_refinement_applied: false,
    cache_hit: false,
  };
  const valid = validateContract(contract);
  if (!valid.ok) {
    throw new StudioError(500, 'ENHANCER_CONTRACT_INVALID',
      `Enhancer produced an invalid contract: ${valid.issues.join('; ')}`);
  }

  const storedId = insertEnhancement(db, {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    session_id: sessionId,
    fingerprint,
    raw_message: message,
    contract_json: JSON.stringify({
      contract: valid.data,
      brief,
      meta: {
        corrections: l1.corrections,
        dialect_mapped: l1.dialect_mapped,
        resolutions: resolved.resolutions,
        safety_rewrites: safety.rewrites,
        deltas,
        llm_expansion: expansion,
        ui_track: uiEnvelope,
      },
    }),
    track: finalTrack,
    provider_dialect: dialect,
    engine_provider: engineProvider,
    fallback_used: fallbackUsed,
    override_used: Boolean(overridePrompt),
    retry_refinement_applied: false,
    cache_hit: false,
    latency_ms: Date.now() - started,
  });

  return { ...valid.data, enhancement_id: storedId, fingerprint };
}

/**
 * Layer 6 feature 23 — retry-aware self-refinement. Called by the generation
 * pipeline when a quality gate (OCR typography) failed attempt 1: the
 * enhancer reads the failure reason and TIGHTENS constraints for the single
 * allowed retry (annex: one refinement max, no loops).
 */
export function refineForRetry(db, {
  ownerId, sessionId = null, contract, gate = 'ocr', reason = '', missing = [],
}) {
  if (!contract || !contract.enhanced_prompt) {
    throw new StudioError(400, 'ENHANCER_REFINE_INVALID', 'A prior contract is required.');
  }
  const tighten = [];
  if (gate === 'ocr') {
    tighten.push(
      'simplified clean uncluttered background behind all text',
      'maximum contrast between typography and background',
      'flat frontal signage, no perspective distortion on letters',
      'large perfectly legible typography, generous letter spacing',
    );
    if (missing.length) {
      tighten.push(`the exact text ${missing.map((t) => `"${t}"`).join(', ')} must appear once, centered, unobstructed`);
    }
  }
  const refinedPrompt = tokenHygiene(`${contract.enhanced_prompt}. ${tighten.join('. ')}`, { maxLen: 4000 });

  const refined = {
    ...contract,
    enhanced_prompt: refinedPrompt,
    variation_prompts: [], // retry is single-shot; no fresh variations
    retry_refinement_applied: true,
    cache_hit: false,
  };
  const valid = validateContract(refined);
  if (!valid.ok) {
    throw new StudioError(500, 'ENHANCER_CONTRACT_INVALID',
      `Refined contract failed validation: ${valid.issues.join('; ')}`);
  }

  const storedId = insertEnhancement(db, {
    id: crypto.randomUUID(),
    owner_id: ownerId,
    session_id: sessionId,
    fingerprint: `${crypto.createHash('sha256').update(refinedPrompt).digest('hex')}:retry`,
    raw_message: `[retry-refinement:${gate}] ${String(reason).slice(0, 200)}`,
    contract_json: JSON.stringify({ contract: valid.data, brief: null, meta: { gate, reason, missing } }),
    track: valid.data.track,
    provider_dialect: valid.data.provider_dialect,
    engine_provider: 'deterministic',
    fallback_used: false,
    override_used: false,
    retry_refinement_applied: true,
    cache_hit: false,
    latency_ms: 0,
  });
  return { ...valid.data, enhancement_id: storedId };
}
