/**
 * policyGuard.js — Layer 10 core: Bilingual Text Policy & Trademark
 * Guardrail. Deterministic denylist check over both languages BEFORE any
 * text reaches a prompt or a composite. The error reports the violated
 * category only — never echoes the matched phrase.
 */

import { normalizeArabicForms } from '../enhancer/enhancerNormalize.js';
import { POLICY_DENYLIST_AR } from './i18n/typographyLexicon.js';
import { StudioError } from '../studioErrors.js';

const POLICY_DENYLIST_EN = {
  hate_violence: [/\bnazi\b/i, /\bisis\b/i, /\bterror(?:ist|ism)?\b/i, /\bhate\b/i],
  explicit: [/\bporn\b/i, /\bexplicit sex\b/i, /\bnsfw\b/i],
  counterfeit_logo: [/\bfake\s+\w+\s+logo\b/i, /\bcounterfeit\b/i, /\bknock\s?off\b/i],
};

/** Returns the violated category or null when the text is clean. */
export function checkTextPolicy(text) {
  const raw = String(text || '');
  for (const [category, patterns] of Object.entries(POLICY_DENYLIST_EN)) {
    for (const pattern of patterns) {
      if (pattern.test(raw)) return category;
    }
  }
  const normalized = normalizeArabicForms(raw).toLowerCase();
  const tokens = new Set(normalized.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  for (const [category, phrases] of Object.entries(POLICY_DENYLIST_AR)) {
    for (const phrase of phrases) {
      const norm = normalizeArabicForms(phrase).toLowerCase();
      if (norm.includes(' ') ? normalized.includes(norm) : tokens.has(norm)) return category;
    }
  }
  return null;
}

export function assertTextPolicy(text) {
  const category = checkTextPolicy(text);
  if (category) {
    throw new StudioError(400, 'POLICY_TEXT_REJECTED', `Text rejected by policy guardrail: ${category}`);
  }
}
