/**
 * presetsSchema.js — Zod contracts for the Smart Presets Engine v2
 * (updated official annex). The Resolved Preset Bundle mirrors the annex
 * JSON contract exactly; custom-preset input is sanitized before it ever
 * touches a prompt template (Pre-Flight Safety, Layer 9).
 */

import { z } from 'zod';

export const INTENSITY_LEVELS = ['subtle', 'balanced', 'strong', 'strict'];

export const PROVIDER_DIALECTS = ['gemini', 'fal', 'openai'];

export const OCR_GATE_MODES = ['off', 'always', 'on_text_detected'];

export const MODIFIER_MAP_SCHEMA = z.record(
  z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  z.string().regex(/^[a-z0-9_:\- ]{1,60}$/i),
);

/** Annex contract: Resolved Preset Bundle — feeds Prompt Enhancer + image engine. */
export const RESOLVED_BUNDLE_SCHEMA = z.object({
  preset_id: z.string().min(1),
  preset_version: z.number().int().min(1),
  selection_source: z.enum(['auto_detected', 'manual', 'brand_lock']),
  fallback_applied: z.boolean(),
  intensity: z.enum(INTENSITY_LEVELS),
  intensity_weight: z.number().min(0).max(1),
  aspect_ratio: z.string().regex(/^\d+:\d+$/),
  ocr_gate_mode: z.enum(OCR_GATE_MODES),
  ocr_status: z.enum(['required', 'conditional', 'skipped']),
  rtl_negative_space_side: z.enum(['right', 'left']),
  active_modifiers: MODIFIER_MAP_SCHEMA,
  conflicts_resolved: z.array(z.object({
    rule_index: z.number().int().min(0),
    matched_if: MODIFIER_MAP_SCHEMA,
    modifier: z.string(),
    dropped_value: z.string(),
    switched_to: z.string().nullable(),
  })),
  provider_dialect: z.enum(PROVIDER_DIALECTS),
  positive_prompt_wrapper: z.string(),
  negative_prompt_rules: z.string(),
  optical_physics: z.object({
    lens: z.string().optional(),
    dof: z.string().optional(),
    angle: z.string().optional(),
  }).passthrough(),
  post_process_hooks: z.object({
    webp: z.boolean(),
    rembg: z.boolean(),
    upscale_4k: z.boolean(),
    svg: z.boolean(),
  }).passthrough(),
  badge: z.object({
    auto_detected: z.boolean(),
    label_key: z.string(),
    change_label_key: z.string(),
    alternatives: z.array(z.object({
      preset_id: z.string(),
      label_key: z.string(),
      score: z.number(),
    })).max(3),
  }),
  brand_lock: z.object({
    locked: z.boolean(),
    preset_id: z.string().nullable(),
    style_seed: z.string().nullable(),
    palette: z.array(z.string()),
  }).optional(),
  cache_key_component: z.string().min(1),
  cache_fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

export const CUSTOM_PRESET_INPUT_SCHEMA = z.object({
  name: z.string().min(1).max(80),
  base_preset_id: z.string().min(1).max(80),
  project_id: z.string().max(80).nullable().optional(),
  source_asset_id: z.string().max(80).nullable().optional(),
  style_seed: z.string().max(40).nullable().optional(),
  palette: z.array(z.string().regex(/^#[0-9A-Fa-f]{6}$/)).max(12).optional(),
  modifiers: MODIFIER_MAP_SCHEMA.optional(),
  wrapper_addition: z.string().max(500).optional(),
  negative_addition: z.string().max(300).optional(),
  aspect_ratio: z.string().regex(/^\d+:\d+$/).optional(),
  ocr_gate_mode: z.enum(OCR_GATE_MODES).optional(),
  is_pinned: z.boolean().optional(),
});

export const PIN_INPUT_SCHEMA = z.object({
  pin_id: z.string().min(1),
  is_pinned: z.boolean(),
});

export const BRAND_KIT_PATCH_SCHEMA = z.object({
  preset_id: z.string().min(1),
  locked_style_seed: z.string().max(40).nullable().optional(),
});

const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g; // C0/C1 controls stripped from free text
const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) instructions?/gi,
  /system prompt/gi,
  /```/g,
];

/**
 * Pre-Flight Safety & Copyright Sanitization (Layer 9): deterministic
 * cleanup of user-authored strings before they join a prompt template.
 * Control/formatting code points are removed, injection-shaped phrases are
 * cut, whitespace is collapsed, length is capped.
 */
export function sanitizeFreeText(input, maxLen = 500) {
  let out = String(input || '');
  for (const pattern of INJECTION_PATTERNS) out = out.replace(pattern, ' ');
  out = out.replace(CONTROL_CHARS, ' ');
  out = out.replace(/[^\S\n]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  return out.slice(0, maxLen);
}

export function validateBundle(bundle) {
  return RESOLVED_BUNDLE_SCHEMA.parse(bundle);
}

export function validateCustomInput(payload) {
  return CUSTOM_PRESET_INPUT_SCHEMA.parse(payload);
}

export function validateBrandKitPatch(payload) {
  return BRAND_KIT_PATCH_SCHEMA.parse(payload);
}
