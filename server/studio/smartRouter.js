/**
 * Smart Intent Router — 7-layer orchestrator (the platform's routing brain,
 * above workspaceModelRouter).
 *
 * Pipeline per request:
 *   L2 guardrail -> L1 normalize + literal locking -> L2 fast-path
 *   -> L3 follow-up context -> L3 classifier (local -> retry -> cloud)
 *   -> L4 confidence thresholds / ambiguity gate
 *   -> L5 decomposition + complexity-based model tier
 *   -> L6 ui_params + asset task enrichment + Brand Kit
 *   -> L7 cost guard + telemetry
 *
 * Cost contract: layers 1, 2, 4 and the follow-up short-circuit are pure
 * local logic ($0). Paid providers are never called here — the router only
 * FLAGS quota state; the generation service enforces it hard.
 */
import { performance } from 'node:perf_hooks';
import { INTENTS, legacyModeFor } from './routerContract.js';
import { normalizeInput } from './routerNormalize.js';
import { guardMessage, fastPath } from './routerFastPath.js';
import { classifyWithFallback, detectFollowup } from './routerClassifier.js';
import {
  scoreComplexity, modelTierFor, enrichUiParams, decomposeHybrid, decomposeImage,
} from './routerEnrich.js';
import { insertRouting, lastSessionOutputIntent } from './routerTelemetry.js';
import { studioQuota } from './studioService.js';
import { getBrandLock } from './presetStore.js';
import { listRegistry } from './presetRegistry.js';
import { buildAmbiguityOptions, routerLabels } from './i18n/routerLexicon.js';
import { defaultRouterLlm } from './routerLlm.js';

export const CONFIDENCE_EXECUTE = 0.8;
export const CONFIDENCE_AMBIGUOUS_MIN = 0.5;

const VALID_PRESET_IDS = new Set(listRegistry().map((p) => p.id));

// Direct commands executed locally at $0 (Phase-2 rembg/upscale are local
// processing, export is a code read) — they never need paid quota.
const LOCAL_ONLY_COMMANDS = new Set(['remove_bg', 'upscale_4k', 'export_code']);

function costCheckFor(db, ownerId, intent, assetTasks, directCommand) {
  if (directCommand && LOCAL_ONLY_COMMANDS.has(directCommand)) {
    return { required: false, ok: true, remaining: null };
  }
  const needsImages = intent === 'image_generate' || intent === 'image_edit' || intent === 'hybrid_ui_with_assets';
  if (!needsImages) return { required: false, ok: true, remaining: null };
  const quota = studioQuota(db, ownerId);
  const need = Math.max(1, (assetTasks || []).length);
  return { required: true, ok: quota.remaining >= need, remaining: quota.remaining };
}

function brandKitFor(db, ownerId, projectId) {
  if (!projectId) return null;
  try {
    const lock = getBrandLock(db, ownerId, projectId);
    if (!lock) return null;
    return {
      project_id: projectId,
      preset_id: lock.preset_id || null,
      custom_preset_id: lock.custom_preset_id || null,
      style_seed: lock.style_seed || null,
      palette: JSON.parse(lock.palette_json || '[]'),
    };
  } catch {
    return null; // a foreign/invalid project must not break routing
  }
}

/**
 * Route one client request through the 7 layers.
 *
 * @param {object} db platform database handle
 * @param {object} arg
 * @param {string} arg.ownerId
 * @param {string} [arg.sessionId]
 * @param {string} [arg.projectId]
 * @param {string} arg.message
 * @param {object} [arg.signals]  { has_mask, click_target, attached_image, preset_id }
 * @param {object} [arg.answers]  clarifier answers; answers.intent forces a route
 * @param {string} [arg.lang]     'ar' | 'en' — ambiguity/badge labels
 * @param {object} [arg.llm]      injectable { local, cloud } model calls
 */
export async function routeRequest(db, {
  ownerId, sessionId = null, projectId = null, message,
  signals = {}, answers = {}, lang = 'ar', llm = null,
}) {
  const t0 = performance.now();
  const labels = routerLabels(lang);
  const elapsed = () => Math.round((performance.now() - t0) * 100) / 100;

  // L2 guardrail — throws 400 before anything touches a paid path.
  guardMessage(message);

  // L1 — normalization, typo correction, literal locking, UI signals.
  const input = normalizeInput(message, signals);

  const finish = (decision) => {
    const latency = elapsed();
    const routingId = insertRouting(db, {
      ownerId,
      sessionId,
      intent: decision.intent,
      confidence: decision.confidence,
      modelTier: decision.model_tier || null,
      provider: decision.provider,
      fallbackUsed: !!decision.fallback_used,
      ambiguous: decision.status === 'ambiguous',
      latencyMs: latency,
      costBlocked: !!(decision.cost_check && decision.cost_check.required && !decision.cost_check.ok),
      // Full contract replay for downstream executors (UI Builder, hybrid).
      contractJson: JSON.stringify(decision),
    });
    return { ...decision, routing_id: routingId, latency_ms: latency };
  };

  const buildRouted = ({ intent, confidence, provider, via, directCommand = null, fallbackUsed = false }) => {
    // L5 — complexity + model tier.
    const complexity = scoreComplexity(input.normalized);
    const modelTier = modelTierFor(intent, complexity);

    // L6 — parameters + asset tasks.
    const uiParams = enrichUiParams({
      normalized: input.normalized,
      answers,
      protectedBrandText: input.protected_brand_text,
    });
    let assetTasks = [];
    if (intent === 'hybrid_ui_with_assets') {
      assetTasks = decomposeHybrid({
        normalized: input.normalized, uiParams,
        protectedTexts: input.protected_texts, manualPresetId: input.signals.preset_id,
      });
    } else if (intent === 'image_generate') {
      assetTasks = decomposeImage({
        normalized: input.normalized, uiParams,
        protectedTexts: input.protected_texts, manualPresetId: input.signals.preset_id,
      });
    }

    // L7 — pre-flight cost guard (flag only; generation enforces hard).
    const cost = costCheckFor(db, ownerId, intent, assetTasks, directCommand);

    return finish({
      status: 'routed',
      intent,
      confidence,
      model_tier: modelTier,
      mode: legacyModeFor(intent),
      provider,
      via,
      fallback_used: fallbackUsed,
      direct_command: directCommand,
      signals: input.signals,
      corrections: input.corrections,
      protected_brand_text: input.protected_brand_text,
      ui_params: intent === 'chat_consult' ? null : uiParams,
      asset_tasks: assetTasks,
      brand_kit: brandKitFor(db, ownerId, projectId),
      cost_check: cost,
      complexity,
      // L4 — 1-Click Override badge: the UI can flip the route in one tap.
      override_badge: {
        prefix: labels.override_badge_prefix,
        change: labels.override_badge_change,
      },
    });
  };

  const buildAmbiguous = ({ intent, confidence, provider, fallbackUsed = false }) => finish({
    status: 'ambiguous',
    intent, // best guess — NOT executed
    confidence,
    mode: legacyModeFor(intent),
    provider,
    fallback_used: fallbackUsed,
    question: labels.ambiguity_question,
    options: buildAmbiguityOptions(lang, input.normalized),
    corrections: input.corrections,
    protected_brand_text: input.protected_brand_text,
    cost_check: { required: false, ok: true, remaining: null }, // zero paid calls
  });

  // Explicit user clarification (a previous ambiguity answer) wins outright.
  if (answers && typeof answers.intent === 'string' && INTENTS.includes(answers.intent)) {
    return buildRouted({
      intent: answers.intent, confidence: 1.0, provider: 'user_clarified', via: 'user_clarified',
    });
  }

  // L2 — deterministic fast-path (mask / click-to-edit / direct commands).
  const fast = fastPath({ normalized: input.normalized, signals: input.signals });
  if (fast) {
    return buildRouted({ ...fast, provider: 'fast_path', directCommand: fast.direct_command });
  }

  // L3 — session context: follow-up on the last produced artifact ($0).
  const lastIntent = lastSessionOutputIntent(db, ownerId, sessionId);
  const follow = detectFollowup(input.normalized, lastIntent);
  if (follow) {
    return buildRouted({ ...follow, provider: 'context' });
  }

  // L3 — semantic classifier with the L7 retry/fallback chain.
  const models = llm || defaultRouterLlm();
  const cls = await classifyWithFallback({
    normalized: input.normalized,
    signals: input.signals,
    lastIntent,
    llm: models,
    validPresetIds: VALID_PRESET_IDS,
  });

  // L4 — confidence thresholds: execute / clarify (never guess silently).
  if (cls.confidence >= CONFIDENCE_EXECUTE) {
    return buildRouted({
      intent: cls.intent, confidence: cls.confidence,
      provider: cls.provider, via: 'classifier', fallbackUsed: cls.fallback_used,
    });
  }
  return buildAmbiguous({
    intent: cls.intent, confidence: cls.confidence,
    provider: cls.provider, fallbackUsed: cls.fallback_used,
  });
}
