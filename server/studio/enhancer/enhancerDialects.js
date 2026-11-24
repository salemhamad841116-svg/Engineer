/**
 * Prompt Enhancer Engine — Layer 5: Provider Dialect Adapter, Safety &
 * Variations.
 *
 *  17. Image provider dialect adapter (gemini narrative vs fal dense-visual,
 *      plus inpainting/outpainting phrasing contexts for Phase 2)
 *  18. Code LLM constraint packager — Phase 3 (honest marker here)
 *  19. Pre-flight safety & policy rewrite (false-positive avoidance)
 *  20. Controlled multi-variation diversification (2-4 real alternatives)
 */

import { SAFETY_REWRITES } from './i18n/enhancerLexicon.js';

export const PROVIDER_DIALECTS = Object.freeze(['gemini', 'fal']);

export function activeProviderDialect(envValue) {
  const v = String(envValue || '').trim().toLowerCase();
  return v === 'fal' || v === 'flux' || v === 'recraft' ? 'fal' : 'gemini';
}

const INPAINT_PREFIX = 'Edit strictly inside the masked region only, keep every pixel outside the mask unchanged, blend edges seamlessly: ';
const OUTPAINT_PREFIX = 'Extend the scene beyond the canvas borders coherently, preserve the original image content unchanged in the center: ';

/**
 * Feature 17 — dialect adaptation. Gemini-family models respond best to a
 * natural narrative paragraph; FLUX/Recraft-family to a dense comma-separated
 * visual tag stream. The transformation is deterministic from the already
 * synthesized prompt segments (no extra LLM spend).
 *
 * @param {string[]} segments ordered prompt facets (subject first)
 * @param {'gemini'|'fal'} dialect
 * @param {'generate'|'inpaint'|'outpaint'} context
 */
export function adaptProviderDialect(segments, dialect, context = 'generate') {
  const clean = segments.map((s) => String(s || '').trim()).filter(Boolean);
  let prompt;
  if (dialect === 'fal') {
    // Dense visual tags: strip sentence punctuation, emit a tag stream.
    prompt = clean.join(', ')
      .replace(/\.\s*/g, ', ')
      .replace(/,\s*,+/g, ', ')
      .replace(/,\s*$/g, '');
  } else {
    // Narrative: full sentences.
    prompt = clean.map((s) => (/[.!?]$/.test(s) ? s : `${s}.`)).join(' ');
  }
  if (context === 'inpaint') return INPAINT_PREFIX + prompt;
  if (context === 'outpaint') return OUTPAINT_PREFIX + prompt;
  return prompt;
}

/**
 * Feature 19 — pre-flight safety rewrite. Benign phrases that image APIs
 * commonly mis-flag are rewritten BEFORE sending (avoids false-positive
 * policy blocks and wasted latency). Every rewrite is auditable.
 */
export function safetyRewrite(text) {
  let out = String(text || '');
  const rewrites = [];
  for (const rule of SAFETY_REWRITES) {
    if (rule.probe.test(out)) {
      out = out.replace(rule.probe, rule.replacement);
      rewrites.push({ reason: rule.reason });
    }
    rule.probe.lastIndex = 0;
  }
  return { text: out, rewrites };
}

/* Feature 20 — variation axes. Deterministic, so 2-4 candidates are real
 * alternatives (camera angle OR lighting differ), never repeated shots. */
const ANGLE_AXIS = [
  'wide-angle eye-level shot',
  'three-quarter perspective shot',
  'slightly low-angle hero shot',
  'top-down flat lay composition',
];
const LIGHT_AXIS = [
  'golden hour warm light',
  'soft diffused studio light',
  'warm twilight lantern glow',
  'cool blue-hour ambient light',
];

/**
 * Feature 20 — controlled diversification: variation i combines a distinct
 * (angle, lighting) pair. Base composition/protected text are preserved;
 * only the photographic treatment varies. Returns up to `count` prompts.
 */
export function diversifyVariations(basePrompt, count) {
  const n = Math.max(0, Math.min(4, Number(count) || 0));
  const out = [];
  const seen = new Set();
  for (let i = 0; out.length < n && i < ANGLE_AXIS.length * LIGHT_AXIS.length; i += 1) {
    const angle = ANGLE_AXIS[i % ANGLE_AXIS.length];
    const light = LIGHT_AXIS[Math.floor(i / ANGLE_AXIS.length) % LIGHT_AXIS.length];
    const variant = `${angle}, ${light}. ${basePrompt}`;
    if (!seen.has(variant)) {
      seen.add(variant);
      out.push(variant);
    }
  }
  return out;
}

/** Feature 18 — Phase-3 marker (code constraint packager ships with the UI track). */
export const CODE_CONSTRAINT_PACKAGER_DEFERRED = Object.freeze({
  deferred: true,
  reason: 'code_constraint_packager_phase_3',
});
