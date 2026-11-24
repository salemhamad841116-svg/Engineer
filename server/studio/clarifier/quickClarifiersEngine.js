/**
 * quickClarifiersEngine.js — Quick Clarifiers Engine orchestrator.
 *
 * Official 7th annex, Phase 1 scope:
 *   Layer 1 (detection), 4 (micro-UX card), 5 (defaults/skip/verbosity),
 *   9 (speed/cache/circuit-breaker) complete; cores of 2 (image + track
 *   disambiguation bank), 3 (dynamic questioning + suppression),
 *   7 (brand-kit inheritance), 8 (compiler + enhancer binding + log sync).
 *
 * Zero-Spend Pre-Flight (Layer 1): this engine NEVER touches a paid provider
 * — it has no provider dependency at all, so pre-generation clarification is
 * free by construction, not by discipline.
 */

import { performance } from 'node:perf_hooks';
import { normalizeArabicForms } from '../enhancer/enhancerNormalize.js';
import { detectAnsweredSlots, inferSector, scanCriticalMissing, shouldActivate } from './slotScanner.js';
import { BANK_COVERAGE, SMART_DEFAULTS, SECTOR_RECOMMENDATIONS } from './clarifierBank.js';
import { buildCard, brandInheritance } from './clarifierCard.js';
import { runDynamicQuestions, CircuitBreakerSkip, CIRCUIT_BREAKER_MS } from './dynamicQuestions.js';
import { compileAnswers, syncRoutingLog } from './clarifierCompiler.js';
import * as store from './clarifierStore.js';
import { StudioError } from '../studioErrors.js';

const VALID_VERBOSITY = new Set(['smart', 'guided', 'turbo']);

function loadBrandLock(db, ownerId, projectId) {
  if (!projectId) return null;
  return db.prepare(
    'SELECT * FROM studio_project_brand_lock WHERE project_id = ? AND owner_id = ?'
  ).get(projectId, ownerId) || null;
}

function defaultsFor({ intent, answered, autoAnswers, sector }) {
  const sectorIntent = sector && SECTOR_RECOMMENDATIONS[sector]
    ? SECTOR_RECOMMENDATIONS[sector].intent_track
    : null;
  return {
    intent: intent || sectorIntent || SMART_DEFAULTS.intent_track,
    params: {
      aspect_ratio: answered.aspect_ratio || SMART_DEFAULTS.aspect_ratio,
      lighting: answered.lighting || SMART_DEFAULTS.lighting,
      style: answered.style || SMART_DEFAULTS.style,
      theme: answered.theme || SMART_DEFAULTS.theme,
      platform: answered.platform || SMART_DEFAULTS.platform,
      direction: answered.direction || SMART_DEFAULTS.direction,
      density: answered.density || SMART_DEFAULTS.density,
      ...(autoAnswers.preset_id ? { preset_id: autoAnswers.preset_id } : {}),
      ...(autoAnswers.style_seed ? { style_seed: autoAnswers.style_seed } : {}),
    },
    sector: sector || null,
  };
}

/**
 * POST /clarifiers/evaluate — Layer 1 + 2(core) + 3(core) + 4 + 5 + 7(core) + 9.
 * Deterministic bank answers first (sub-15ms); only genuine non-traditional
 * gaps escalate to the local LLM through the 800ms circuit-breaker; repeats
 * replay from the SHA-256 cache with 0 LLM calls.
 */
export async function evaluateClarifiers(db, {
  ownerId, projectId = null, routingLogId = null,
  message, intent = null, confidence = null, ambiguous = null,
  verbosityMode = 'smart', llm = null,
}) {
  if (!VALID_VERBOSITY.has(verbosityMode)) {
    throw new StudioError(400, 'CLARIFIER_VERBOSITY_INVALID', 'verbosity_mode must be smart, guided or turbo.');
  }
  const startedAt = performance.now();
  const normalized = normalizeArabicForms(String(message || ''));
  const answered = detectAnsweredSlots(normalized);
  const sector = inferSector(normalized);
  const brandLock = loadBrandLock(db, ownerId, projectId);
  const inheritance = brandInheritance(brandLock);

  // Router telemetry is the authoritative ambiguity signal when provided.
  let effectiveAmbiguous = ambiguous;
  if (effectiveAmbiguous === null && routingLogId) {
    const routing = db.prepare(
      'SELECT intent, confidence, ambiguous FROM studio_routing_telemetry WHERE id = ? AND owner_id = ?'
    ).get(routingLogId, ownerId);
    if (routing) {
      effectiveAmbiguous = routing.ambiguous === 1;
      if (!intent) intent = routing.intent;
      if (confidence === null) confidence = routing.confidence;
    }
  }
  if (effectiveAmbiguous === null) {
    effectiveAmbiguous = typeof confidence === 'number' && confidence >= 0.5 && confidence <= 0.79;
  }

  const missing = scanCriticalMissing({ intent, ambiguous: effectiveAmbiguous, answered });

  // Layer 5 — turbo executes immediately; smart stays silent when clear.
  const bypass = (reason) => ({
    bypassed: true,
    reason,
    defaults: defaultsFor({ intent, answered, autoAnswers: inheritance.autoAnswers, sector }),
    suppressed_slots: inheritance.suppressed,
    latency_ms: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
  });
  if (verbosityMode === 'turbo') return bypass('turbo_mode');
  if (verbosityMode === 'smart' && !shouldActivate({
    confidence, ambiguous: effectiveAmbiguous, missing,
  })) {
    return bypass('high_confidence');
  }

  // Renderable Phase-1 bank slots: ambiguous intent first, then track gaps.
  const coverage = BANK_COVERAGE[intent] || [];
  const bankSlots = [];
  if (effectiveAmbiguous && !answered.intent_track) bankSlots.push('intent_track');
  for (const slot of coverage) {
    if (!answered[slot] && !inheritance.suppressed.includes(slot) && !bankSlots.includes(slot)) {
      bankSlots.push(slot);
    }
  }

  let source = 'deterministic_bank';
  let dynamicQuestions = [];
  let suppressedSlots = [
    ...Object.keys(answered),
    ...inheritance.suppressed.filter((s) => !Object.keys(answered).includes(s)),
  ];

  if (bankSlots.length === 0) {
    // Nothing renderable from the bank: a genuinely non-traditional gap.
    // Dynamic path — cache first (0 LLM), then local LLM with circuit-breaker.
    const dynamicGaps = missing.filter((s) => !inheritance.suppressed.includes(s));
    if (dynamicGaps.length === 0 && verbosityMode !== 'guided') {
      return bypass('nothing_to_clarify');
    }
    const fingerprint = store.clarifierFingerprint({
      normalizedMessage: normalized, intent, missingSlots: dynamicGaps, verbosityMode,
    });
    const cached = store.lookupCache(db, fingerprint);
    if (cached) {
      source = 'cache_hit';
      dynamicQuestions = JSON.parse(cached.questions_json);
    } else {
      try {
        dynamicQuestions = await runDynamicQuestions({
          llm, message: normalized, missingSlots: dynamicGaps, intent,
          timeoutMs: CIRCUIT_BREAKER_MS,
        });
        source = 'local_llm';
        store.insertCache(db, {
          inputHash: fingerprint, intent, missingSlots: dynamicGaps,
          questions: dynamicQuestions,
          latencyMs: performance.now() - startedAt,
        });
      } catch (err) {
        if (!(err instanceof CircuitBreakerSkip)) throw err;
        // Silent latency circuit-breaker (Layer 9): proceed on smart defaults.
        const skipLatency = performance.now() - startedAt;
        const skipId = store.insertSession(db, {
          ownerId, projectId, routingLogId, stage: 'pre_gen',
          source: 'circuit_breaker_skipped', verbosityMode,
          questions: [], suppressedSlots, latencyMs: skipLatency,
        });
        store.resolveSession(db, ownerId, skipId, { status: 'timeout_bypassed' });
        return {
          ...bypass('circuit_breaker_skipped'),
          clarifier_id: skipId,
          source: 'circuit_breaker_skipped',
        };
      }
    }
    if (dynamicQuestions.length === 0 && verbosityMode !== 'guided') {
      return bypass('nothing_to_clarify');
    }
  }

  const latencyMs = performance.now() - startedAt;
  const clarifierId = store.insertSession(db, {
    ownerId, projectId, routingLogId, stage: 'pre_gen', source, verbosityMode,
    questions: dynamicQuestions.length ? dynamicQuestions : bankSlots,
    suppressedSlots, latencyMs,
  });
  const card = buildCard({
    clarifierId, routingLogId, stage: 'pre_gen', source, latencyMs,
    bankSlots, dynamicQuestions, suppressedSlots, sector,
  });
  if (card.questions.length === 0) {
    store.resolveSession(db, ownerId, clarifierId, { status: 'auto_proceeded' });
    return bypass('nothing_to_clarify');
  }
  return { bypassed: false, card };
}

/**
 * POST /clarifiers/:id/resolve — Layer 8 core. 0 LLM calls by construction:
 * clicks are compiled deterministically, the original routing row is synced,
 * and the enhancer bindings are returned for direct downstream injection.
 */
export function resolveClarifier(db, { ownerId, clarifierId, answersPayload }) {
  const session = store.getSession(db, ownerId, clarifierId);
  if (!session) throw new StudioError(404, 'CLARIFIER_NOT_FOUND', 'Clarifier session not found.');
  if (session.status !== 'pending') {
    throw new StudioError(409, 'CLARIFIER_ALREADY_CLOSED', `Clarifier session already ${session.status}.`);
  }
  const brandLock = loadBrandLock(db, ownerId, session.project_id);
  const inheritance = brandInheritance(brandLock);
  const compiled = compileAnswers({
    answersPayload, brandAutoAnswers: inheritance.autoAnswers,
  });
  const syncedRouting = syncRoutingLog(db, ownerId, session.routing_log_id, compiled);
  store.resolveSession(db, ownerId, clarifierId, {
    status: 'resolved',
    selectedAnswers: compiled,
    customText: (answersPayload && answersPayload.custom_text_input) || null,
  });
  return {
    ok: true,
    status: 'resolved',
    clarifier_id: clarifierId,
    compiled,
    routing_log_synced: Boolean(syncedRouting),
    llm_calls: 0, // Layer 8 acceptance: provably zero extra LLM calls.
  };
}

/**
 * POST /clarifiers/:id/skip — Layer 5: 1-Click Skip & Build Now with the
 * recommended defaults, recorded honestly as a skip.
 */
export function skipClarifier(db, { ownerId, clarifierId, message = '' }) {
  const session = store.getSession(db, ownerId, clarifierId);
  if (!session) throw new StudioError(404, 'CLARIFIER_NOT_FOUND', 'Clarifier session not found.');
  if (session.status !== 'pending') {
    throw new StudioError(409, 'CLARIFIER_ALREADY_CLOSED', `Clarifier session already ${session.status}.`);
  }
  const answered = detectAnsweredSlots(normalizeArabicForms(String(message || '')));
  const sector = inferSector(normalizeArabicForms(String(message || '')));
  const brandLock = loadBrandLock(db, ownerId, session.project_id);
  const inheritance = brandInheritance(brandLock);
  store.resolveSession(db, ownerId, clarifierId, { status: 'skipped' });
  return {
    ok: true,
    status: 'skipped',
    clarifier_id: clarifierId,
    defaults: defaultsFor({
      intent: null, answered, autoAnswers: inheritance.autoAnswers, sector,
    }),
  };
}
