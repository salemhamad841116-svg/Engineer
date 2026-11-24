/**
 * typographySchema.js — Zod contracts for the Bilingual In-Image
 * Typography Engine (8th annex): the Bilingual Typography Plan mirrors
 * the annex JSON contract exactly (plus documented Phase-1 extensions:
 * casing_mode, BiDi segments, prompt_directives).
 */

import { z } from 'zod';

export const SCRIPT_MODES = ['ar', 'en', 'mixed'];
export const LAYER_ROLES = ['headline', 'subheadline', 'tagline', 'badge', 'signage'];
export const RENDER_STRATEGIES = ['native_generative', 'deterministic_compositor', 'two_pass_hybrid', 'fallback_compositor'];
export const MATERIAL_STYLES = ['flat_clean', 'gold_embossed', 'neon_glow', 'acrylic_3d', 'wood_engraved', 'marble_carved', 'ink_print'];
export const STYLE_CATEGORIES = ['modern_sans', 'classic_serif', 'display_bold', 'calligraphy_heritage', 'fintech_mono'];

export const OCR_PASS_THRESHOLD = 0.95; // annex: mandatory acceptance >= 95%
export const MAX_PAID_RETRIES = 1;      // annex: budget circuit-breaker

const LAYER_INPUT_SCHEMA = z.object({
  layer_role: z.enum(LAYER_ROLES).default('headline'),
  literal_text: z.string().min(1).max(300),
  style_category: z.enum(STYLE_CATEGORIES).optional(),
  material_style: z.enum(MATERIAL_STYLES).optional(),
  relative_scale: z.number().min(0.1).max(1).optional(),
  exact_case: z.boolean().optional(),
});

export const PLAN_INPUT_SCHEMA = z.object({
  text: z.string().min(1).max(300).optional(),
  layers: z.array(LAYER_INPUT_SCHEMA).min(1).max(5).optional(),
  direction: z.enum(['rtl', 'ltr', 'auto']).optional(),
  style_category: z.enum(STYLE_CATEGORIES).optional(),
  material_style: z.enum(MATERIAL_STYLES).optional(),
  provider: z.enum(['gemini', 'fal', 'openai']).optional(),
  asset_id: z.string().max(80).nullish(),
  project_id: z.string().max(80).nullish(),
}).refine((v) => v.text || (v.layers && v.layers.length > 0), {
  message: 'text or layers is required',
});

export const PLAN_LAYER_SCHEMA = z.object({
  layer_role: z.enum(LAYER_ROLES),
  script_mode: z.enum(SCRIPT_MODES),
  literal_text: z.string().min(1),
  casing_mode: z.enum(['exact_brand', 'upper', 'title', 'plain']),
  bidi_segments: z.array(z.object({
    script: z.enum(['ar', 'en', 'digits', 'punct']),
    text: z.string(),
  })),
  font_id: z.string(),
  paired_font_id: z.string().nullable(),
  material_style: z.enum(MATERIAL_STYLES),
  relative_scale: z.number().min(0.1).max(1),
});

export const TYPOGRAPHY_PLAN_SCHEMA = z.object({
  script_mode: z.enum(SCRIPT_MODES),
  direction: z.enum(['rtl', 'ltr']),
  render_strategy: z.enum(RENDER_STRATEGIES),
  ocr_gate_required: z.boolean(),
  max_paid_retries: z.literal(MAX_PAID_RETRIES),
  layers: z.array(PLAN_LAYER_SCHEMA).min(1).max(5),
  negative_typography_rules: z.string().min(1),
  prompt_directives: z.array(z.object({
    provider: z.enum(['gemini', 'fal', 'openai']),
    directive: z.string(),
  })),
});

export const VERIFY_INPUT_SCHEMA = z.object({
  layers: z.array(z.object({
    layer_role: z.enum(LAYER_ROLES).default('headline'),
    literal_text: z.string().min(1).max(300),
    exact_case: z.boolean().optional(),
  })).max(5).optional(),
  clean_plate_url: z.string().max(500).nullish(),
  image_ref: z.string().max(500).nullish(),
});

export function validatePlanInput(payload) {
  return PLAN_INPUT_SCHEMA.parse(payload);
}

export function validatePlan(plan) {
  return TYPOGRAPHY_PLAN_SCHEMA.parse(plan);
}

export function validateVerifyInput(payload) {
  return VERIFY_INPUT_SCHEMA.parse(payload);
}
