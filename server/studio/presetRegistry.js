/**
 * Preset Registry — Smart Presets subsystem (Phase 1 extension).
 *
 * Single source of truth for the six generation modes. Every preset bundles
 * five parameters applied before the provider call:
 *   1. positive_prompt_wrapper  (prefix/suffix/strong_boost templates)
 *   2. negative_prompt_rules    (per-category exclusions)
 *   3. default_aspect_ratio     (manual override allowed upstream)
 *   4. conditional_ocr_gate     ('off' | 'always' | 'on_text_detected')
 *   5. palette_injection        (hex palette, replaced by brand lock if set)
 *
 * Codebase rule: identifiers, templates and comments are English-only.
 * Arabic labels live exclusively in ./i18n/labels.js (label_key lookup).
 */

import { PRESET_KEYWORDS } from './i18n/labels.js';

export const OCR_GATE = Object.freeze({
  OFF: 'off',
  ALWAYS: 'always',
  ON_TEXT: 'on_text_detected',
});

export const INTENSITY = Object.freeze(['subtle', 'balanced', 'strong']);

export const PRESET_REGISTRY = [
  {
    id: 'cinematic_photo',
    label_key: 'cinematic_photo',
    category: 'photography',
    default_aspect: '16:9',
    alt_aspects: ['16:9', '9:16'],
    ocr_gate: OCR_GATE.OFF,
    wrapper_en: {
      prefix: 'Ultra-realistic cinematic photograph, shot on 35mm, shallow depth of field, natural volumetric lighting',
      suffix: 'film grain, high dynamic range, professional color grading, no text anywhere in the frame',
      strong_boost: 'Emphasize anamorphic lens character, motivated natural light sources, and a strong cinematic mood over literal description.',
    },
    negative_en: 'cartoon, anime, illustration, painting, blurry, low quality, any text, any letters, watermark, signage',
    palette: ['#1a2634', '#c98a3d', '#e8d9b8', '#3d5a6c'],
    modifiers: [
      {
        id: 'lighting',
        options: [
          { id: 'day', fragment_en: 'bright natural daylight, clear sky' },
          { id: 'golden_hour', fragment_en: 'golden hour sunset light, long warm shadows' },
          { id: 'neon_night', fragment_en: 'night scene with subtle neon accents, city lights bokeh' },
        ],
      },
      {
        id: 'lens',
        options: [
          { id: 'wide', fragment_en: 'wide-angle 24mm lens, expansive composition' },
          { id: 'portrait', fragment_en: '85mm portrait lens, creamy background compression' },
        ],
      },
    ],
  },
  {
    id: 'commercial_storefront',
    label_key: 'commercial_storefront',
    category: 'commercial',
    default_aspect: '16:9',
    alt_aspects: ['16:9', '1:1'],
    ocr_gate: OCR_GATE.ALWAYS,
    wrapper_en: {
      prefix: 'Professional commercial photography of a modern storefront, architectural photography, signage must be perfectly legible',
      suffix: 'clean illuminated signage, inviting entrance, sharp focus on the facade, straight-on perspective',
      strong_boost: 'Storefront name signage is the hero of the shot: flat frontal angle, high contrast, every letter crisp and readable.',
    },
    negative_en: 'distorted text, gibberish letters, warped signs, misspelled signage, low quality, watermark',
    palette: ['#2b2118', '#d4a24e', '#f5ead6', '#7a5c3e'],
    modifiers: [
      {
        id: 'timing',
        options: [
          { id: 'day', fragment_en: 'bright daytime, natural storefront lighting' },
          { id: 'lit_night', fragment_en: 'night shot with illuminated signage and warm interior glow' },
        ],
      },
      {
        id: 'style',
        options: [
          { id: 'modern', fragment_en: 'modern minimalist facade, clean lines' },
          { id: 'luxury', fragment_en: 'luxury boutique facade, premium materials, brass and marble details' },
          { id: 'heritage', fragment_en: 'heritage style facade, traditional craftsmanship, warm wood' },
          { id: 'classic', fragment_en: 'classic elegant facade, timeless design' },
        ],
      },
    ],
  },
  {
    id: 'product_studio',
    label_key: 'product_studio',
    category: 'commercial',
    default_aspect: '1:1',
    alt_aspects: ['1:1', '4:3'],
    ocr_gate: OCR_GATE.ON_TEXT,
    wrapper_en: {
      prefix: 'Professional product photography, studio lighting, softbox setup, seamless background',
      suffix: 'commercial e-commerce shot, crisp details, realistic reflections, soft shadows, 8k product detail',
      strong_boost: 'Hero product shot: perfect focus stacking, controlled reflections, premium advertising quality.',
    },
    negative_en: 'cluttered background, hands, blurry, distorted label text, watermark, low quality',
    palette: ['#f2f0eb', '#c9b18a', '#2e2a26', '#8c7a5c'],
    modifiers: [
      {
        id: 'surface',
        options: [
          { id: 'marble', fragment_en: 'on polished white marble surface with subtle veins' },
          { id: 'wood', fragment_en: 'on warm natural wood surface' },
          { id: 'dark', fragment_en: 'on dark matte surface, luxury mood, rim lighting' },
          { id: 'pure_white', fragment_en: 'on pure white seamless studio background' },
        ],
      },
      {
        id: 'camera_angle',
        options: [
          { id: 'front', fragment_en: 'straight-on front angle, label facing camera' },
          { id: 'top_down', fragment_en: 'top-down flat lay angle' },
          { id: 'three_quarter', fragment_en: 'three-quarter angle, dynamic product perspective' },
        ],
      },
    ],
  },
  {
    id: 'ui_assets',
    label_key: 'ui_assets',
    category: 'design',
    default_aspect: '1:1',
    alt_aspects: ['1:1', '16:9'],
    ocr_gate: OCR_GATE.OFF,
    wrapper_en: {
      prefix: 'Clean UI design asset, professional digital design, consistent stroke and grid',
      suffix: 'high resolution, production-ready asset, calm composition with clear space for overlay text, no embedded text',
      strong_boost: 'Design-system quality: pixel-clean edges, consistent visual language, harmonious negative space.',
    },
    negative_en: 'photograph, realistic texture, noise, any text, any letters, watermark, busy background',
    palette: ['#0f172a', '#6366f1', '#a5b4fc', '#e2e8f0'],
    modifiers: [
      {
        id: 'style',
        options: [
          { id: '3d', fragment_en: 'soft 3D icon style, subtle depth, studio lighting on the asset' },
          { id: 'glassmorphism', fragment_en: 'glassmorphism style, frosted glass, soft blur, translucent layers' },
          { id: 'flat', fragment_en: 'flat vector style, bold simple shapes, limited palette' },
        ],
      },
      {
        id: 'background',
        options: [
          { id: 'transparent', fragment_en: 'isolated on plain solid background, easily cut out' },
          { id: 'dark', fragment_en: 'on deep dark background' },
          { id: 'light', fragment_en: 'on clean light background' },
        ],
      },
    ],
  },
  {
    id: 'fintech_tech',
    label_key: 'fintech_tech',
    category: 'design',
    default_aspect: '16:9',
    alt_aspects: ['16:9', '1:1'],
    ocr_gate: OCR_GATE.ON_TEXT,
    wrapper_en: {
      prefix: 'Modern fintech digital scene, sleek dark technology aesthetic, precise geometric elements',
      suffix: 'high-end tech branding, subtle grid, depth of field on UI elements, premium and trustworthy mood',
      strong_boost: 'Institutional-grade fintech look: precise data-visualization elements, controlled glow, executive polish.',
    },
    negative_en: 'cartoon, clutter, chaotic layout, distorted text, gibberish letters, watermark, low quality',
    palette: ['#0b1220', '#22d3ee', '#1e3a8a', '#94a3b8'],
    modifiers: [
      {
        id: 'theme',
        options: [
          { id: 'dark_neon', fragment_en: 'dark theme with neon cyan accents, glowing data lines' },
          { id: 'corporate_blue', fragment_en: 'corporate blue theme, clean institutional look' },
          { id: 'glassy', fragment_en: 'glassy translucent panels over dark gradient' },
        ],
      },
    ],
  },
  {
    id: 'marketing_banner',
    label_key: 'marketing_banner',
    category: 'marketing',
    default_aspect: '16:9',
    alt_aspects: ['16:9', '4:5'],
    ocr_gate: OCR_GATE.ALWAYS,
    wrapper_en: {
      prefix: 'Professional advertising banner design, balanced visual composition, marketing-grade artwork',
      suffix: 'clear empty space reserved for headline and CTA button, legible typography zones, brand-ready layout',
      strong_boost: 'Campaign-hero banner: headline zone is deliberately empty and unobstructed, CTA area clearly reserved, every rendered letter crisp.',
    },
    negative_en: 'cluttered composition, text over busy areas, distorted letters, gibberish text, watermark, low quality',
    palette: ['#1f2937', '#f59e0b', '#fef3c7', '#ef4444'],
    modifiers: [
      {
        id: 'text_space',
        options: [
          { id: 'right', fragment_en: 'keep the right third of the composition clean and empty for headline text' },
          { id: 'left', fragment_en: 'keep the left third of the composition clean and empty for headline text' },
          { id: 'center', fragment_en: 'keep the horizontal center band clean and empty for headline text' },
        ],
      },
    ],
  },
];

/* Legacy Phase-1 ids stay valid forever via this alias map. */
const LEGACY_ALIASES = { cinematic: 'cinematic_photo', storefront: 'commercial_storefront', product: 'product_studio' };

const BY_ID = new Map(PRESET_REGISTRY.map((p) => [p.id, p]));

export function resolvePresetId(id) {
  if (!id) return null;
  const canonical = LEGACY_ALIASES[id] || id;
  return BY_ID.has(canonical) ? canonical : null;
}

export function getRegistryPreset(id) {
  const canonical = resolvePresetId(id);
  return canonical ? BY_ID.get(canonical) : null;
}

export function listRegistry() {
  return PRESET_REGISTRY;
}

/**
 * Auto-detect the best preset for a free-text message (no explicit choice).
 * Keyword scoring first; sector fallback; cinematic_photo as the honest default
 * for generic image requests. Returns { preset_id, auto_detected, via }.
 */
export function detectPreset(message, { sector = null } = {}) {
  const n = String(message || '').toLowerCase();
  let best = null;
  let bestHits = 0;
  for (const p of PRESET_REGISTRY) {
    let hits = 0;
    for (const kw of PRESET_KEYWORDS[p.id] || []) if (n.includes(kw)) hits += 1;
    if (hits > bestHits) { best = p; bestHits = hits; }
  }
  if (best) return { preset_id: best.id, auto_detected: true, via: `keyword-match:${bestHits}` };

  const SECTOR_FALLBACK = {
    trading: 'fintech_tech', coffee: 'commercial_storefront', food: 'commercial_storefront',
    fashion: 'product_studio', realestate: 'commercial_storefront',
  };
  if (sector && SECTOR_FALLBACK[sector]) {
    return { preset_id: SECTOR_FALLBACK[sector], auto_detected: true, via: `sector-fallback:${sector}` };
  }
  return { preset_id: 'cinematic_photo', auto_detected: true, via: 'default:image-mode' };
}
