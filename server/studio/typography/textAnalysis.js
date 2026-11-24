/**
 * textAnalysis.js — Layer 1 (complete): Bilingual Literal Extraction &
 * Script Normalization.
 *
 *  - Script detection (ar | en | mixed) over Unicode ranges.
 *  - Unicode BiDi segmentation: splits a mixed line into ordered ar/en/
 *    digits/punct runs; the concatenation of segments ALWAYS equals the
 *    input verbatim (no reorder, no translation — proven in tests).
 *  - Exact Brand Casing lock (ChatHSM, iPhone): mixed-case Latin tokens are
 *    flagged exact_brand and never case-transformed.
 *  - Arabic comparison normalization reuses the enhancer's normalizer
 *    (storage stays verbatim; normalization is for scoring only).
 */

import { normalizeArabicForms } from '../enhancer/enhancerNormalize.js';

const ARABIC_RE = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const LATIN_RE = /[A-Za-z]/;
const DIGIT_RE = /[0-9\u0660-\u0669]/;

/** Classify the script of a text: 'ar' | 'en' | 'mixed'. */
export function detectScript(text) {
  const hasAr = ARABIC_RE.test(text);
  const hasEn = LATIN_RE.test(text);
  if (hasAr && hasEn) return 'mixed';
  if (hasAr) return 'ar';
  return 'en';
}

/**
 * BiDi segmentation (Layer 1 core): ordered runs by character class.
 * Whitespace attaches to the CURRENT run so joining the segments returns
 * the input string byte-for-byte.
 */
export function segmentBiDi(text) {
  const segments = [];
  const classify = (ch) => {
    if (ARABIC_RE.test(ch)) return 'ar';
    if (LATIN_RE.test(ch)) return 'en';
    if (DIGIT_RE.test(ch)) return 'digits';
    return 'punct';
  };
  for (const ch of String(text)) {
    const cls = classify(ch);
    const last = segments[segments.length - 1];
    if (last && (last.script === cls || ch === ' ' || cls === 'punct')) {
      last.text += ch;
    } else {
      segments.push({ script: cls, text: ch });
    }
  }
  return segments.filter((s) => s.text.trim().length > 0 || s.text === ' ');
}

/**
 * Exact Brand Casing (Layer 1): a Latin token with interior uppercase
 * (ChatHSM, iPhone, YouTube) is an exact-brand token. The literal is kept
 * verbatim; only the MODE is reported downstream for case-sensitive OCR.
 */
export function detectCasingMode(text) {
  if (!LATIN_RE.test(text)) return 'plain';
  const tokens = String(text).split(/\s+/).filter((t) => LATIN_RE.test(t));
  for (const token of tokens) {
    const letters = token.replace(/[^A-Za-z]/g, '');
    if (letters.length >= 2 && /[a-z]/.test(letters.slice(1)) && /[A-Z]/.test(letters.slice(1))) {
      return 'exact_brand';
    }
    if (/^[a-z]/.test(letters) && /[A-Z]/.test(letters.slice(1))) return 'exact_brand';
  }
  const allLetters = tokens.join('').replace(/[^A-Za-z]/g, '');
  if (allLetters && allLetters === allLetters.toUpperCase()) return 'upper';
  return 'plain';
}

/** Comparison-only normalization (storage always keeps the literal verbatim). */
export function normalizeForComparison(text, { exactCase = false } = {}) {
  let out = String(text || '');
  out = normalizeArabicForms(out); // alef/hamza/taa-marbuta unification, tatweel strip
  out = out.replace(/[\u064B-\u0652\u0670\u0640]/g, ''); // residual diacritics + tatweel
  out = out.replace(/\s+/g, ' ').trim();
  if (!exactCase) out = out.toLowerCase();
  return out;
}

/** Digit-critical content (prices, URLs, emails, phones) forces the
 * deterministic track — a single wrong glyph is unacceptable there. */
export function isDigitCritical(text) {
  const t = String(text);
  // Arabic currency/discount markers are written as ASCII escapes to
  // keep this engine file 100% English (Arabic lives in i18n + fixtures).
  return /(%|https?:\/\/|www\.|@|\d{2,}|SAR|USD|\$|\u0631\.\u0633|\u0631\u064A\u0627\u0644|\u062E\u0635\u0645)/i.test(t);
}

export function wordCount(text) {
  return String(text).trim().split(/\s+/).filter(Boolean).length;
}
