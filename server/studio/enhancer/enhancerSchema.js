/**
 * Prompt Enhancer Engine — Layer 6 (a): Schema Validation & Token Hygiene.
 *
 * The official output contract (annex "Prompt Enhancer Output Schema"),
 * validated strictly via zod. LLM-produced expansion fragments are validated
 * through a separate, smaller schema before they may touch the contract.
 */

import { z } from 'zod';

export const ENHANCER_TRACKS = ['image', 'ui', 'hybrid'];
export const ENHANCER_DIALECTS = ['gemini', 'fal'];
export const ENHANCER_INTENSITIES = ['subtle', 'balanced', 'strong'];

export const ENHANCER_OUTPUT_SCHEMA = z.object({
  track: z.enum(ENHANCER_TRACKS),
  provider_dialect: z.enum(ENHANCER_DIALECTS),
  direction: z.enum(['rtl', 'ltr']),
  protected_brand_text: z.string().max(80).nullable(),
  preset_id: z.string().max(64).nullable(),
  preset_intensity: z.enum(ENHANCER_INTENSITIES),
  enhanced_prompt: z.string().min(20).max(4000),
  negative_prompt: z.string().max(2000),
  variation_prompts: z.array(z.string().min(10).max(4000)).max(4),
  retry_refinement_applied: z.boolean(),
  cache_hit: z.boolean(),
});

/**
 * LLM expansion fragment schema (Layer 2 gap-filling channel). The local
 * qwen2.5:7b may ONLY return this small JSON object; anything else is a
 * validation failure that triggers the Layer-6 retry/fallback ladder.
 */
export const LLM_EXPANSION_SCHEMA = z.object({
  scene_details: z.string().min(10).max(600),
  mood: z.string().min(3).max(120),
  extras: z.array(z.string().min(3).max(120)).max(4).default([]),
});

/** Validate + return { ok, data | issues } without throwing. */
export function validateContract(candidate) {
  const res = ENHANCER_OUTPUT_SCHEMA.safeParse(candidate);
  return res.success
    ? { ok: true, data: res.data }
    : { ok: false, issues: res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

export function validateLlmExpansion(candidate) {
  const res = LLM_EXPANSION_SCHEMA.safeParse(candidate);
  return res.success
    ? { ok: true, data: res.data }
    : { ok: false, issues: res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
}

/** Token hygiene: collapse whitespace, drop duplicate comma fragments. */
export function tokenHygiene(prompt, { maxLen = 4000 } = {}) {
  let out = String(prompt || '').replace(/\s+/g, ' ').trim();
  const seen = new Set();
  out = out.split(/,\s*/).filter((frag) => {
    const key = frag.trim().toLowerCase().replace(/[.\s]+$/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
  return out.slice(0, maxLen);
}
