/**
 * Layers 5+6 — Task Decomposition, Model Selector, Parameter Extraction
 * and Prompt Enrichment.
 *
 * - Complexity-based model routing: simple edits/UIs stay on the free local
 *   tier; complex interfaces (charts, order books, multi-panel analytics)
 *   upgrade to cloud_flash automatically.
 * - Hybrid decomposition: an Execution Graph of one ui_task plus parallel
 *   asset_tasks, each bound to the right Smart Preset with its spec-matrix
 *   aspect ratio and OCR gate.
 * - Deterministic English asset prompts (auditable, offline); protected
 *   brand text is emitted as an exact-render instruction, never translated.
 */
import { getRegistryPreset, detectPreset, OCR_GATE } from './presetRegistry.js';
import { detectSector, detectPlatform, detectTheme } from './intentRouter.js';
import {
  COMPLEXITY_SIGNALS, SLOT_HINTS, SCENE_EN, DOMAIN_EN, THEME_EN, SLOT_EN,
} from './i18n/routerLexicon.js';

export const COMPLEXITY_CLOUD_THRESHOLD = 2;

const ARABIC_BLOCK = /[\u0600-\u06FF]/;

/** Count complexity signals (Layer 5). */
export function scoreComplexity(normalized) {
  const text = String(normalized || '').toLowerCase();
  return COMPLEXITY_SIGNALS.reduce(
    (n, s) => (text.includes(s.toLowerCase()) ? n + 1 : n), 0,
  );
}

/** Model tier: only UI-family intents can be upgraded to the cloud tier. */
export function modelTierFor(intent, complexity) {
  const uiFamily = intent === 'ui_generate' || intent === 'ui_edit' || intent === 'hybrid_ui_with_assets';
  if (uiFamily && complexity >= COMPLEXITY_CLOUD_THRESHOLD) return 'cloud_flash';
  return 'local';
}

/** Layer 6 — UI parameter extraction (answers from clarifiers win). */
export function enrichUiParams({ normalized, answers = {}, protectedBrandText = null }) {
  const domain = answers.sector || detectSector(normalized) || null;
  const platform = answers.platform || detectPlatform(normalized) || 'web';
  const theme = answers.theme || detectTheme(normalized) || null;
  const direction = ARABIC_BLOCK.test(String(normalized)) ? 'rtl' : 'ltr';
  return {
    domain,
    platform,
    theme,
    direction,
    protected_brand_text: protectedBrandText || null,
  };
}

function sceneFragments(normalized) {
  const text = String(normalized || '');
  const out = [];
  for (const [ar, en] of Object.entries(SCENE_EN)) {
    if (text.includes(ar)) out.push(en);
  }
  return out;
}

/**
 * Deterministic professional English prompt for one asset slot.
 * Protected texts appear inside an exact-render instruction — verbatim.
 */
export function buildAssetPrompt({ slot, uiParams, protectedTexts = [], normalized }) {
  const parts = [];
  const domainEn = uiParams.domain && DOMAIN_EN[uiParams.domain] ? DOMAIN_EN[uiParams.domain] : 'premium brand';
  const slotEn = SLOT_EN[slot] || SLOT_EN.hero_banner;
  parts.push(`${domainEn} ${slotEn}`);
  if (uiParams.theme && THEME_EN[uiParams.theme]) parts.push(THEME_EN[uiParams.theme]);
  const scenes = sceneFragments(normalized);
  if (scenes.length) parts.push(`scene: ${scenes.join(', ')}`);
  if (protectedTexts.length) {
    parts.push(
      `render these texts EXACTLY as written, legible and correctly spelled: ${protectedTexts.map((t) => `"${t}"`).join(', ')}`,
    );
  }
  return parts.join('. ');
}

function slotTask(hint, { uiParams, protectedTexts, normalized, manualPresetId }) {
  const preset = getRegistryPreset(manualPresetId || hint.preset);
  const effective = preset || getRegistryPreset(hint.preset);
  return {
    slot: hint.slot,
    preset_id: effective.id,
    aspect_ratio: effective.default_aspect,
    ocr_gate: effective.ocr_gate !== OCR_GATE.OFF,
    enhanced_prompt: buildAssetPrompt({
      slot: hint.slot, uiParams, protectedTexts, normalized,
    }),
  };
}

/**
 * Layer 5 — hybrid Execution Graph. Always yields at least one asset task
 * (a hero banner is the universal default for asset-backed UIs). A manual
 * preset selection overrides the per-slot registry default.
 */
export function decomposeHybrid({ normalized, uiParams, protectedTexts = [], manualPresetId = null }) {
  const text = ` ${String(normalized || '').toLowerCase()} `;
  const matched = SLOT_HINTS.filter((h) => h.hints.some((w) => text.includes(w.toLowerCase())));
  const hints = matched.length ? matched : [SLOT_HINTS[0]]; // default hero banner
  const seen = new Set();
  const asset_tasks = [];
  for (const h of hints) {
    if (seen.has(h.slot)) continue;
    seen.add(h.slot);
    asset_tasks.push(slotTask(h, { uiParams, protectedTexts, normalized, manualPresetId }));
  }
  return asset_tasks;
}

/**
 * Standalone image intent -> single asset task bound to the detected (or
 * manually selected) Smart Preset.
 */
export function decomposeImage({ normalized, uiParams, protectedTexts = [], manualPresetId = null }) {
  const detected = manualPresetId || detectPreset(normalized, { sector: uiParams.domain }).preset_id;
  const preset = getRegistryPreset(detected) || getRegistryPreset('cinematic_photo');
  return [{
    slot: 'main_image',
    preset_id: preset.id,
    aspect_ratio: preset.default_aspect,
    ocr_gate: preset.ocr_gate !== OCR_GATE.OFF,
    enhanced_prompt: buildAssetPrompt({
      slot: 'main_image', uiParams, protectedTexts, normalized,
    }),
  }];
}
