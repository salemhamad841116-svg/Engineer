/**
 * clarifierBank.js — Layer 2 (core) + Layer 4 + Layer 5 static knowledge.
 *
 * In-memory deterministic question graph (Layer 9 spec: "In-Memory Question
 * Graph", $0, sub-15ms). Phase 1 renders ONLY:
 *   - intent_track disambiguation chips (store-style ambiguity)
 *   - image track slots: aspect_ratio / lighting / protected_text / style
 * Phase-3+ slots (platform/theme/direction/density/verticals) are registered
 * here with `phase: 3` so the already-answered scanner (Layer 3 core) can
 * detect and suppress mentions TODAY, while the card renderer never shows
 * them before their phase — an honest phase gate, not a hidden feature.
 */

export const MAX_QUESTIONS = 3; // Layer 4 — Max 3 Questions / 1-Tap Rule.

export const SLOT_REGISTRY = {
  intent_track: {
    track: 'any',
    phase: 1,
    selection_mode: 'single',
    allow_custom_input: false,
    i18n_question_key: 'clarifiers.intent_track',
    critical: true,
    options: [
      { value: 'image_generate', i18n_label_key: 'options.storefront_photo', cost_badge: 'cost.1_credit' },
      { value: 'ui_generate', i18n_label_key: 'options.store_ui', cost_badge: 'cost.2_credits' },
      { value: 'hybrid_ui_with_assets', i18n_label_key: 'options.full_store_app', cost_badge: 'cost.4_credits' },
    ],
  },
  aspect_ratio: {
    track: 'image_generate',
    phase: 1,
    selection_mode: 'single',
    allow_custom_input: false,
    i18n_question_key: 'clarifiers.aspect_ratio',
    critical: true,
    options: [
      { value: '1:1', i18n_label_key: 'options.ratio_square', icon: 'ratio_square', cost_badge: 'cost.free' },
      { value: '16:9', i18n_label_key: 'options.ratio_wide', icon: 'ratio_wide', cost_badge: 'cost.free' },
      { value: '9:16', i18n_label_key: 'options.ratio_tall', icon: 'ratio_tall', cost_badge: 'cost.free' },
    ],
  },
  lighting: {
    track: 'image_generate',
    phase: 1,
    selection_mode: 'single',
    allow_custom_input: false,
    i18n_question_key: 'clarifiers.lighting',
    critical: true,
    options: [
      { value: 'day', i18n_label_key: 'options.light_day', icon: 'sun', cost_badge: 'cost.free' },
      { value: 'golden', i18n_label_key: 'options.light_golden', icon: 'sunset', cost_badge: 'cost.free' },
      { value: 'night', i18n_label_key: 'options.light_night', icon: 'moon', cost_badge: 'cost.free' },
    ],
  },
  protected_text: {
    track: 'image_generate',
    phase: 1,
    selection_mode: 'single',
    allow_custom_input: true, // Layer 4 — Inline Custom "Other" Input (brand text entry).
    i18n_question_key: 'clarifiers.protected_text',
    critical: false,
    options: [
      { value: 'yes', i18n_label_key: 'options.text_yes', cost_badge: 'cost.free' },
      { value: 'no', i18n_label_key: 'options.text_no', cost_badge: 'cost.free' },
    ],
  },
  style: {
    track: 'image_generate',
    phase: 1,
    selection_mode: 'single',
    allow_custom_input: false,
    i18n_question_key: 'clarifiers.style',
    critical: false,
    options: [
      { value: 'realistic', i18n_label_key: 'options.style_realistic', cost_badge: 'cost.free' },
      { value: '3d', i18n_label_key: 'options.style_3d', cost_badge: 'cost.free' },
      { value: 'glass', i18n_label_key: 'options.style_glass', cost_badge: 'cost.free' },
    ],
  },
  // ---- Phase 3 registrations: suppression-detectable, never rendered in P1.
  theme: {
    track: 'ui_generate',
    phase: 3,
    selection_mode: 'single',
    allow_custom_input: true,
    i18n_question_key: 'clarifiers.theme',
    critical: false,
    options: [
      { value: 'dark', i18n_label_key: 'options.dark_mode', swatch_hex: '#090D18', cost_badge: 'cost.free' },
      { value: 'light', i18n_label_key: 'options.light_mode', swatch_hex: '#F8FAFC', cost_badge: 'cost.free' },
      { value: 'glass', i18n_label_key: 'options.glass_mode', swatch_hex: '#7DD3FC', cost_badge: 'cost.free' },
    ],
  },
  platform: {
    track: 'ui_generate',
    phase: 3,
    selection_mode: 'single',
    allow_custom_input: false,
    i18n_question_key: 'clarifiers.platform',
    critical: false,
    options: [
      { value: 'web', i18n_label_key: 'options.device_web', icon: 'desktop', cost_badge: 'cost.free' },
      { value: 'mobile', i18n_label_key: 'options.device_mobile', icon: 'phone', cost_badge: 'cost.free' },
      { value: 'responsive', i18n_label_key: 'options.device_responsive', icon: 'devices', cost_badge: 'cost.free' },
    ],
  },
  direction: {
    track: 'ui_generate',
    phase: 3,
    selection_mode: 'single',
    allow_custom_input: false,
    i18n_question_key: 'clarifiers.direction',
    critical: false,
    options: [
      { value: 'rtl', i18n_label_key: 'options.dir_rtl', cost_badge: 'cost.free' },
      { value: 'ltr', i18n_label_key: 'options.dir_ltr', cost_badge: 'cost.free' },
      { value: 'both', i18n_label_key: 'options.dir_both', cost_badge: 'cost.free' },
    ],
  },
  density: {
    track: 'ui_generate',
    phase: 3,
    selection_mode: 'single',
    allow_custom_input: false,
    i18n_question_key: 'clarifiers.density',
    critical: false,
    options: [
      { value: 'simple', i18n_label_key: 'options.density_simple', cost_badge: 'cost.free' },
      { value: 'pro', i18n_label_key: 'options.density_pro', cost_badge: 'cost.free' },
    ],
  },
};

/**
 * Deterministic bank coverage (Layer 9 — >80% of cases from memory, $0):
 * which slots the static bank can render per intent in Phase 1.
 */
export const BANK_COVERAGE = {
  ambiguous_intent: ['intent_track'],
  image_generate: ['aspect_ratio', 'lighting', 'protected_text', 'style'],
  ui_generate: [], // Phase 3 renders UI clarifiers; suppression works today.
  hybrid_ui_with_assets: ['aspect_ratio', 'lighting'],
};

/**
 * Sector-based recommended pre-selection (Layer 5). The card builder flags
 * the matching option with `recommended: true` — never silently auto-answers.
 */
export const SECTOR_RECOMMENDATIONS = {
  store: { intent_track: 'hybrid_ui_with_assets' },
  trading: { theme: 'dark', platform: 'web' },
  clinic: { theme: 'light' },
  realestate: { aspect_ratio: '16:9' },
};

/** Smart defaults used by 1-Click Skip / circuit-breaker / auto-proceed. */
export const SMART_DEFAULTS = {
  intent_track: 'image_generate',
  aspect_ratio: '16:9',
  lighting: 'day',
  style: 'realistic',
  theme: 'dark',
  platform: 'responsive',
  direction: 'rtl',
  density: 'pro',
};
