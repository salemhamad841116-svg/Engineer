/**
 * strategyMatrix.js — Layer 3 core: Bilingual Rendering Strategy Matrix.
 *
 * Decision rules (annex):
 *  - Digit-critical content (prices, URLs, emails, discounts) -> always
 *    deterministic_compositor: one wrong glyph is unacceptable.
 *  - Arabic connected script (any length) and Mixed AR+EN -> deterministic
 *    compositor via HarfBuzz (100% accuracy, zero spelling risk).
 *  - Short English marks (<=3 words, no digit-critical content) ->
 *    native_generative with a hardened prompt + OCR gate.
 *  - Long English paragraphs -> deterministic_compositor.
 * The matrix is pure and explainable: every decision returns its reasons.
 */

import { detectScript, isDigitCritical, wordCount } from './textAnalysis.js';

const NATIVE_MAX_WORDS = 3;

export function decideStrategy(text) {
  const script = detectScript(text);
  const words = wordCount(text);
  const reasons = [];
  if (isDigitCritical(text)) {
    reasons.push('digit_critical_content');
    return { render_strategy: 'deterministic_compositor', script_mode: script, reasons };
  }
  if (script === 'ar') {
    reasons.push('connected_arabic_script');
    return { render_strategy: 'deterministic_compositor', script_mode: script, reasons };
  }
  if (script === 'mixed') {
    reasons.push('mixed_bidi_line');
    return { render_strategy: 'deterministic_compositor', script_mode: script, reasons };
  }
  if (words <= NATIVE_MAX_WORDS) {
    reasons.push('short_english_mark');
    return { render_strategy: 'native_generative', script_mode: script, reasons };
  }
  reasons.push('long_english_paragraph');
  return { render_strategy: 'deterministic_compositor', script_mode: script, reasons };
}

/** Bilingual Typography Negative Prompting (Layer 6 core): exact rule
 * strings per script combination (mixed == the annex contract example). */
export function negativeRulesFor(scriptsPresent) {
  const rules = [];
  if (scriptsPresent.has('en') || scriptsPresent.has('mixed')) {
    rules.push('misspelled English letters', 'duplicated glyphs');
  }
  if (scriptsPresent.has('ar') || scriptsPresent.has('mixed')) {
    rules.push('disconnected Arabic characters', 'missing Arabic dots');
  }
  rules.push('random background gibberish');
  return rules.join(', ');
}

/**
 * Quoted Literal Delimiter Wrapping (Layer 6 core): provider-specific
 * typography directive. Gemini gets a narrative directive, FLUX a compact
 * one; the literal is ALWAYS wrapped in strict double quotes verbatim.
 */
export function promptDirectiveFor({ provider, layers, materialStyle }) {
  const quoted = layers
    .map((l) => `"${l.literal_text}" (${l.layer_role}, ${l.script_mode}, scale ${l.relative_scale})`)
    .join(', ');
  const material = materialStyle || 'flat_clean';
  if (provider === 'fal') {
    return `exact text: ${quoted}, material ${material}, high-contrast clean signboard, sharp vector edges`;
  }
  return [
    `Render the following text exactly as written, character for character, with zero spelling changes: ${quoted}.`,
    `Material style: ${material}. Keep a clean high-contrast surface behind the text for perfect legibility.`,
  ].join(' ');
}
