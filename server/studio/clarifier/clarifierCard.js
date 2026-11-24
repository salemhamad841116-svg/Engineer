/**
 * clarifierCard.js — Layer 4 (Frictionless Micro-UX) + Layer 5 (Smart
 * Defaults & Flow Control) card construction, and Layer 7 (core) brand
 * inheritance.
 *
 * The card carries i18n KEYS only (100% English codebase); the lexicon file
 * resolves display text for clients.
 */

import { SLOT_REGISTRY, SECTOR_RECOMMENDATIONS, MAX_QUESTIONS } from './clarifierBank.js';
import { validateCard } from './clarifierSchema.js';

/** Brand Kit Auto-Fill (Layer 7 core): locked brand assets suppress their
 * questions entirely and pre-fill the compiled answers downstream. */
export function brandInheritance(brandLock) {
  if (!brandLock) return { suppressed: [], autoAnswers: {} };
  const suppressed = [];
  const autoAnswers = {};
  if (brandLock.preset_id || brandLock.custom_preset_id) {
    suppressed.push('style');
    autoAnswers.preset_id = brandLock.preset_id || brandLock.custom_preset_id;
  }
  let palette = [];
  try { palette = JSON.parse(brandLock.palette_json || '[]'); } catch { palette = []; }
  if (palette.length > 0) {
    suppressed.push('theme');
    autoAnswers.palette = palette;
  }
  if (brandLock.style_seed) {
    autoAnswers.style_seed = brandLock.style_seed;
  }
  return { suppressed, autoAnswers };
}

/** Build a card question from the static bank registry, flagging the
 * sector-recommended option (Layer 5) without auto-answering it. */
function bankQuestion(slot, sector) {
  const def = SLOT_REGISTRY[slot];
  const recommendedValue = sector && SECTOR_RECOMMENDATIONS[sector]
    ? SECTOR_RECOMMENDATIONS[sector][slot]
    : null;
  return {
    slot,
    i18n_question_key: def.i18n_question_key,
    selection_mode: def.selection_mode,
    allow_custom_input: def.allow_custom_input,
    options: def.options.map((opt) => ({
      value: opt.value,
      i18n_label_key: opt.i18n_label_key,
      ...(opt.cost_badge ? { cost_badge: opt.cost_badge } : {}),
      ...(opt.swatch_hex ? { swatch_hex: opt.swatch_hex } : {}),
      ...(opt.icon ? { icon: opt.icon } : {}),
      recommended: recommendedValue === opt.value,
    })),
  };
}

/**
 * Assemble the final card from bank slots and/or dynamic questions, honoring:
 *  - Max 3 Questions (Layer 4)
 *  - suppressed slots removed (Layer 3 + 7)
 *  - phase gate: phase-3 slots never render in Phase 1
 * The result is zod-validated against the annex contract before leaving.
 */
export function buildCard({
  clarifierId, routingLogId, stage, source, latencyMs,
  bankSlots = [], dynamicQuestions = [], suppressedSlots = [], sector = null,
}) {
  const suppressed = new Set(suppressedSlots);
  const questions = [];
  for (const slot of bankSlots) {
    const def = SLOT_REGISTRY[slot];
    if (!def || def.phase !== 1 || suppressed.has(slot)) continue;
    questions.push(bankQuestion(slot, sector));
    if (questions.length >= MAX_QUESTIONS) break;
  }
  for (const dq of dynamicQuestions) {
    if (questions.length >= MAX_QUESTIONS) break;
    if (suppressed.has(dq.slot)) continue;
    questions.push({
      slot: dq.slot,
      i18n_question_key: dq.question_key_hint || `clarifiers.dynamic.${dq.slot}`,
      selection_mode: dq.selection_mode,
      allow_custom_input: true,
      options: dq.options.map((opt, idx) => ({
        value: opt.value,
        i18n_label_key: `options.dynamic.${dq.slot}.${opt.value}`,
        cost_badge: 'cost.free',
        recommended: idx === 0,
      })),
    });
  }
  return validateCard({
    clarifier_id: clarifierId,
    routing_log_id: routingLogId || null,
    stage: stage || 'pre_gen',
    source,
    latency_ms: Math.max(0, Math.round((latencyMs || 0) * 100) / 100),
    allow_skip: true,
    auto_proceed_seconds: 0,
    suppressed_slots: [...suppressed],
    questions,
  });
}
