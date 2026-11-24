/**
 * slotScanner.js — Layer 1 (Ambiguity & Missing-Slot Detection) and the
 * deterministic half of Layer 3 (Already-Answered Suppression).
 *
 * Pure functions, $0, no LLM: normalization is delegated to the Prompt
 * Enhancer's Layer-1 normalizer (single source of Arabic-form handling).
 */

import { normalizeArabicForms } from '../enhancer/enhancerNormalize.js';
import { SLOT_ANSWER_KEYWORDS, SECTOR_HINTS } from './i18n/clarifierLexicon.js';
import { BANK_COVERAGE, SLOT_REGISTRY } from './clarifierBank.js';

export const CONFIDENCE_CLEAR = 0.8; // annex: silent at >= 0.80 with complete slots
export const CONFIDENCE_AMBIGUOUS_MIN = 0.5; // annex: activate at 0.50–0.79
export const CONFIDENCE_AMBIGUOUS_MAX = 0.79;

/**
 * Detect slot answers already present in the client's own message.
 * Word-boundary-ish matching on the normalized form (waw-prefix tolerant:
 * keywords are matched both bare and with a leading waw).
 */
export function detectAnsweredSlots(message) {
  const normalized = normalizeArabicForms(String(message || '')).toLowerCase();
  const tokens = new Set(normalized.split(/[^\p{L}\p{N}:]+/u).filter(Boolean));
  const answered = {};
  for (const [slot, valueMap] of Object.entries(SLOT_ANSWER_KEYWORDS)) {
    for (const [value, keywords] of Object.entries(valueMap)) {
      for (const kw of keywords) {
        const norm = normalizeArabicForms(kw).toLowerCase();
        if (tokens.has(norm) || tokens.has(`\u0648${norm}`) || normalized.includes(` ${norm} `)) {
          answered[slot] = value;
          break;
        }
      }
      if (answered[slot]) break;
    }
  }
  return answered;
}

/** Infer the business sector from the normalized message (drives Layer 5). */
export function inferSector(message) {
  const normalized = normalizeArabicForms(String(message || '')).toLowerCase();
  for (const [sector, hints] of Object.entries(SECTOR_HINTS)) {
    for (const hint of hints) {
      if (normalized.includes(normalizeArabicForms(hint).toLowerCase())) return sector;
    }
  }
  return null;
}

/**
 * Critical missing-slot scan (Layer 1). Only slots the current phase can act
 * on are considered. The intent_track slot is "missing" whenever routing was
 * ambiguous (confidence in the 0.50–0.79 band or router status ambiguous).
 */
export function scanCriticalMissing({ intent, ambiguous, answered }) {
  const missing = [];
  if (ambiguous && !answered.intent_track) missing.push('intent_track');
  const coverage = BANK_COVERAGE[intent] || [];
  for (const slot of coverage) {
    const def = SLOT_REGISTRY[slot];
    if (def && def.critical && !answered[slot]) missing.push(slot);
  }
  return missing;
}

/**
 * Decide whether evaluation should produce a card at all (Dynamic Confidence
 * Triggering, Layer 1): silent at high confidence with complete critical
 * slots; active in the ambiguity band or when a critical slot is missing.
 */
export function shouldActivate({ confidence, ambiguous, missing }) {
  if (ambiguous) return true;
  if (missing.length > 0) return true;
  if (typeof confidence === 'number' && confidence < CONFIDENCE_CLEAR) return true;
  return false;
}
