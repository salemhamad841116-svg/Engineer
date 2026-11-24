/**
 * clarifierSchema.js — Zod contracts for the Quick Clarifiers Engine.
 *
 * CLARIFIER_CARD_SCHEMA mirrors the annex's "Quick Clarifier Card JSON
 * Contract" verbatim (keys and nesting), extended only with the engine's own
 * suppressed_slots field required by Layer 3 / Layer 7 acceptance tests.
 */

import { z } from 'zod';

const OptionSchema = z.object({
  value: z.string().min(1),
  i18n_label_key: z.string().min(1),
  cost_badge: z.string().min(1).optional(),
  swatch_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(),
  icon: z.string().min(1).optional(),
  recommended: z.boolean(),
});

const QuestionSchema = z.object({
  slot: z.string().min(1),
  i18n_question_key: z.string().min(1),
  selection_mode: z.enum(['single', 'multi']),
  allow_custom_input: z.boolean(),
  options: z.array(OptionSchema).min(2).max(4),
});

export const CLARIFIER_CARD_SCHEMA = z.object({
  clarifier_id: z.string().min(1),
  routing_log_id: z.string().nullable(),
  stage: z.enum(['pre_gen', 'post_gen', 'micro_edit', 'hybrid_expand']),
  source: z.enum(['deterministic_bank', 'local_llm', 'cache_hit', 'circuit_breaker_skipped']),
  latency_ms: z.number().nonnegative(),
  allow_skip: z.literal(true),
  auto_proceed_seconds: z.number().int().min(0).max(15),
  suppressed_slots: z.array(z.string()),
  questions: z.array(QuestionSchema).min(1).max(3),
});

/** Client clicks payload for POST /clarifiers/:id/resolve (Layer 8 input). */
export const CLARIFIER_ANSWERS_SCHEMA = z.object({
  answers: z.array(z.object({
    slot: z.string().min(1),
    values: z.array(z.string().min(1)).min(1).max(4),
  })).max(3),
  custom_text_input: z.string().max(200).optional(),
});

/** Local-LLM dynamic questioning output (Layer 3 core — validated channel). */
export const DYNAMIC_QUESTIONS_SCHEMA = z.object({
  questions: z.array(z.object({
    slot: z.string().min(1).max(40).regex(/^[a-z][a-z0-9_]*$/),
    selection_mode: z.enum(['single', 'multi']),
    question_key_hint: z.string().max(80).optional(),
    options: z.array(z.object({
      value: z.string().min(1).max(40).regex(/^[a-z0-9_:\-]+$/),
      label_hint: z.string().max(80),
    })).min(2).max(4),
  })).min(1).max(3),
});

/** Structured compiled bindings (Clicks-to-Structured-JSON, Layer 8). */
export const COMPILED_BINDINGS_SCHEMA = z.object({
  intent_override: z.string().nullable(),
  enhancer_bindings: z.object({
    aspect_ratio: z.string().optional(),
    lighting: z.string().optional(),
    style: z.string().optional(),
    theme: z.string().optional(),
    platform: z.string().optional(),
    direction: z.string().optional(),
    density: z.string().optional(),
    protected_brand_text: z.string().nullable().optional(),
    preset_id: z.string().nullable().optional(),
    custom_notes: z.string().optional(),
  }),
});

export function validateCard(card) {
  return CLARIFIER_CARD_SCHEMA.parse(card);
}

export function validateAnswers(payload) {
  return CLARIFIER_ANSWERS_SCHEMA.parse(payload);
}

export function validateDynamicQuestions(payload) {
  return DYNAMIC_QUESTIONS_SCHEMA.parse(payload);
}
