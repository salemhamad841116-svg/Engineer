/**
 * typographyEngine.js — plan orchestration for the Bilingual In-Image
 * Typography Engine (8th annex, Phase 1): Layer 1 complete (extraction,
 * BiDi, casing lock), Layer 3 core (strategy matrix), Layer 4 core (font
 * vault pairing), Layer 6 core (quoted literal prompting + negative rules),
 * Layer 10 core (policy guardrail). Pure deterministic work, $0.
 */

import { detectScript, detectCasingMode, segmentBiDi } from './textAnalysis.js';
import { decideStrategy, negativeRulesFor, promptDirectiveFor } from './strategyMatrix.js';
import { pickFontPair } from './fontVault.js';
import { assertTextPolicy } from './policyGuard.js';
import { validatePlanInput, validatePlan, MAX_PAID_RETRIES } from './typographySchema.js';

const DEFAULT_SCALE_BY_ROLE = { headline: 1.0, subheadline: 0.55, tagline: 0.4, badge: 0.5, signage: 0.9 };
const DEFAULT_MATERIAL_BY_CATEGORY = {
  calligraphy_heritage: 'gold_embossed',
  classic_serif: 'flat_clean',
  modern_sans: 'flat_clean',
  display_bold: 'flat_clean',
  fintech_mono: 'flat_clean',
};

/**
 * Build the Bilingual Typography Plan (annex contract). Literal text is
 * stored and forwarded VERBATIM — never translated, never reordered,
 * never case-transformed (Exact Brand Casing lock).
 */
export function buildTypographyPlan(db, { ownerId, payload }) {
  const input = validatePlanInput(payload);
  const rawLayers = input.layers && input.layers.length
    ? input.layers
    : [{ layer_role: 'headline', literal_text: input.text }];
  const planCategory = input.style_category || 'modern_sans';
  const scriptsPresent = new Set();

  const layers = rawLayers.map((raw) => {
    assertTextPolicy(raw.literal_text);
    const script = detectScript(raw.literal_text);
    scriptsPresent.add(script);
    const category = raw.style_category || planCategory;
    const { primary, paired } = pickFontPair(db, { script, styleCategory: category });
    return {
      layer_role: raw.layer_role,
      script_mode: script,
      literal_text: raw.literal_text, // VERBATIM — the entity lock
      casing_mode: raw.exact_case === false ? 'plain' : detectCasingMode(raw.literal_text),
      bidi_segments: segmentBiDi(raw.literal_text),
      font_id: primary ? primary.id : 'inter_sans',
      paired_font_id: paired ? paired.id : null,
      material_style: raw.material_style || input.material_style || DEFAULT_MATERIAL_BY_CATEGORY[category] || 'flat_clean',
      relative_scale: raw.relative_scale || DEFAULT_SCALE_BY_ROLE[raw.layer_role] || 0.6,
    };
  });

  const hasAr = scriptsPresent.has('ar');
  const hasEn = scriptsPresent.has('en');
  const hasMixed = scriptsPresent.has('mixed');
  const planScript = hasMixed || (hasAr && hasEn) ? 'mixed' : (hasAr ? 'ar' : 'en');
  const direction = input.direction && input.direction !== 'auto'
    ? input.direction
    : (planScript === 'en' ? 'ltr' : 'rtl');

  // Plan strategy: the strictest layer strategy wins — a single
  // deterministic layer pulls the whole plan onto the compositor track.
  const strategies = layers.map((l) => decideStrategy(l.literal_text));
  const planStrategy = strategies.some((s) => s.render_strategy === 'deterministic_compositor')
    ? 'deterministic_compositor'
    : 'native_generative';

  const provider = input.provider || process.env.IMAGE_PROVIDER || 'gemini';

  return validatePlan({
    script_mode: planScript,
    direction,
    render_strategy: planStrategy,
    ocr_gate_required: true,
    max_paid_retries: MAX_PAID_RETRIES,
    layers,
    negative_typography_rules: negativeRulesFor(scriptsPresent),
    prompt_directives: [{
      provider,
      directive: promptDirectiveFor({
        provider,
        layers: layers.map((l) => ({ literal_text: l.literal_text, layer_role: l.layer_role, script_mode: l.script_mode, relative_scale: l.relative_scale })),
        materialStyle: layers[0].material_style,
      }),
    }],
  });
}
