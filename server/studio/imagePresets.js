/**
 * Back-compat shim — the canonical preset source is ./presetRegistry.js.
 * Legacy Phase-1 ids (cinematic/storefront/product) resolve via alias map.
 */
import { PRESET_REGISTRY, getRegistryPreset, resolvePresetId } from './presetRegistry.js';

export const IMAGE_PRESETS = PRESET_REGISTRY.map((p) => ({
  id: p.id,
  label_ar: null, // Arabic labels live in ./i18n/labels.js only
  prefix_en: p.wrapper_en.prefix,
  suffix_en: p.wrapper_en.suffix,
  negative_en: p.negative_en,
  default_aspect: p.default_aspect,
}));

export function getPreset(id) {
  const p = getRegistryPreset(id);
  if (!p) return null;
  return {
    id: p.id,
    prefix_en: p.wrapper_en.prefix,
    suffix_en: p.wrapper_en.suffix,
    negative_en: p.negative_en,
    default_aspect: p.default_aspect,
  };
}

export function listPresets() {
  return PRESET_REGISTRY.map(({ id, default_aspect }) => ({ id, default_aspect }));
}

export { resolvePresetId };
