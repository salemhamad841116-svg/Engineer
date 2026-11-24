/**
 * Prompt Enhancer Engine — Layer 4: Preset, Brand & Negative Rules Injection.
 *
 *  13. Smart preset wrapper merging (no duplication, no contradictory filler)
 *  14. Quick modifiers & intensity weighting (subtle/balanced/strong)
 *  15. Brand Kit & reference binding (palette + style_seed + reference note;
 *      full Brand Vault binding ships in Phase 4)
 *  16. Dynamic negative prompt synthesis (per category, direction-aware)
 */

import { getRegistryPreset, INTENSITY } from '../presetRegistry.js';

/** Feature 13 — merge the preset wrapper around the synthesized prompt. */
export function mergePresetWrapper(prompt, presetId, { intensity = 'balanced' } = {}) {
  const preset = presetId ? getRegistryPreset(presetId) : null;
  if (!preset) return { prompt, applied_preset: null };
  const level = INTENSITY.includes(intensity) ? intensity : 'balanced';

  const parts = [preset.wrapper_en.prefix, prompt];
  if (level !== 'subtle' && preset.wrapper_en.suffix) parts.push(preset.wrapper_en.suffix);
  if (level === 'strong' && preset.wrapper_en.strong_boost) parts.push(preset.wrapper_en.strong_boost);

  // De-duplicate comma-separated fragments (case-insensitive) so merged
  // wrappers never repeat themselves.
  const seen = new Set();
  const merged = parts.join('. ').split(/,\s*/).filter((frag) => {
    const key = frag.trim().toLowerCase().replace(/[.\s]+$/g, '');
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { prompt: merged.join(', '), applied_preset: preset.id };
}

/** Feature 14 — intensity weighting descriptor (auditable contract field). */
export function intensityWeighting(intensity) {
  const level = INTENSITY.includes(intensity) ? intensity : 'balanced';
  return {
    level,
    drops_suffix: level === 'subtle',
    adds_boost: level === 'strong',
  };
}

/**
 * Feature 15 — brand binding (Phase-1 scope): palette + style_seed anchor +
 * optional reference-image description injected into the prompt. The full
 * Brand Vault (cross-mode identity package) is Phase 4 per the annex table.
 */
export function brandBinding({ palette, styleSeed, referenceNote, brandLockPalette }) {
  const lines = [];
  const effectivePalette = (brandLockPalette && brandLockPalette.length ? brandLockPalette : palette) || [];
  if (effectivePalette.length) lines.push(`Color palette: ${effectivePalette.join(', ')}`);
  if (styleSeed) lines.push(`Style seed: ${styleSeed}`);
  if (referenceNote) lines.push(`Match the uploaded reference image: ${referenceNote}`);
  return { lines, palette: effectivePalette };
}

/** Per-category dynamic negative rules (feature 16). */
const CATEGORY_NEGATIVES = {
  photography: 'cartoon, anime, illustration, painting, any text, any letters, watermark, signage',
  commercial: 'distorted text, gibberish letters, warped signs, misspelled signage, low quality, watermark',
  design: 'photograph, realistic texture, noise, busy background, watermark',
  marketing: 'cluttered composition, text over busy areas, distorted letters, gibberish text, watermark',
};

/**
 * Feature 16 — dynamic negative prompt synthesis: preset base + category
 * rules + direction-aware edge protection, de-duplicated.
 */
export function synthesizeNegativePrompt({ presetId, direction, protectedCount = 0 }) {
  const preset = presetId ? getRegistryPreset(presetId) : null;
  const rules = [];
  if (preset?.negative_en) rules.push(preset.negative_en);
  const category = preset?.category;
  if (category && CATEGORY_NEGATIVES[category]) rules.push(CATEGORY_NEGATIVES[category]);
  // Nature/photography scenes: no random text at all; text-bearing scenes
  // (protected entities present) protect the overlay edge instead.
  if (protectedCount > 0) {
    rules.push(direction === 'rtl' ? 'cluttered right edge, low contrast signage' : 'cluttered left edge, low contrast signage');
    rules.push('garbled text, misspelled letters');
  } else {
    rules.push('random floating text, stray captions');
  }
  rules.push('low resolution, blurry, watermark');

  const seen = new Set();
  return rules.join(', ').split(/,\s*/).filter((frag) => {
    const key = frag.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(', ');
}
