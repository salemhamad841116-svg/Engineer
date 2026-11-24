/**
 * Layer 1 — Input Normalization & Multimodal Signals.
 *
 * Runs on the server BEFORE any model call ($0):
 * - Arabic letter/diacritic normalization + token-level typo correction
 *   (JS \b never matches Arabic boundaries, so correction maps whole tokens).
 * - Literal Entity Locking: extracts brand/store names verbatim into
 *   protected_brand_text so the prompt enricher can never translate them.
 *
 * Language data lives in i18n/routerLexicon.js — this file stays 100% English.
 */
import {
  TYPO_MAP, BRAND_PREFIXES, BRAND_NAME_HINTS, BRAND_STOP_WORDS,
} from './i18n/routerLexicon.js';

const DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

const STOP_SET = new Set(BRAND_STOP_WORDS);

/**
 * Normalize raw client text.
 * @returns {{ original: string, normalized: string,
 *             corrections: Array<{from:string,to:string}> }}
 */
export function normalizeText(message) {
  const original = String(message ?? '');
  // Work on whitespace tokens; keep original order and spacing collapsed.
  const corrections = [];
  const tokens = original
    .replace(DIACRITICS, '')
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((t) => {
      if (Object.prototype.hasOwnProperty.call(TYPO_MAP, t)) {
        corrections.push({ from: t, to: TYPO_MAP[t] });
        return TYPO_MAP[t];
      }
      return t;
    });
  return { original, normalized: tokens.join(' ').trim(), corrections };
}

/**
 * Literal Entity Locking — pull brand/store names VERBATIM from the original
 * (typo-corrected but otherwise untouched) text.
 *
 * Sources:
 *  - Quoted spans: «...» / "..." / '...'  (always literal, any length 2-60)
 *  - Explicit naming hints: "<hint> X"     (1-3 words, e.g. "named Al-Riyadh")
 *  - Shop-type prefixes: "<prefix> X Y..." (2-4 words — a single generic word
 *    after a prefix is a sector, not a brand, and captures nothing)
 *
 * Capture stops at prepositions/stop words (a store phrase
 * followed by "in the desert" locks only the store name).
 *
 * @returns {{ protected_texts: string[], protected_brand_text: string|null }}
 */
export function extractProtectedTexts(normalized) {
  const found = [];
  const seen = new Set();
  const push = (t) => {
    const clean = String(t || '').trim().replace(/\s+/g, ' ');
    if (clean.length >= 2 && clean.length <= 60 && !seen.has(clean)) {
      seen.add(clean);
      found.push(clean);
    }
  };

  const src = String(normalized || '');

  // 1) Quoted spans — always literal.
  for (const m of src.matchAll(/«([^»]{2,60})»/g)) push(m[1]);
  for (const m of src.matchAll(/"([^"\n]{2,60})"/g)) push(m[1]);

  const tokens = src.split(/\s+/).filter(Boolean);

  // 2) Explicit naming hints (1-3 words allowed).
  for (let i = 0; i < tokens.length; i += 1) {
    if (BRAND_NAME_HINTS.includes(tokens[i])) {
      const take = [];
      for (let j = i + 1; j < tokens.length && take.length < 3; j += 1) {
        if (STOP_SET.has(tokens[j]) || /^[\u060C.,!\u061F?«»"']+$/.test(tokens[j])) break;
        take.push(tokens[j].replace(/^[\u060C.,!\u061F?«»"']+|[\u060C.,!\u061F?«»"']+$/g, ''));
      }
      if (take.length >= 1) push(take.join(' '));
    }
  }

  // 3) Shop-type prefixes (2-4 words required to avoid sector false positives).
  for (let i = 0; i < tokens.length; i += 1) {
    if (BRAND_PREFIXES.includes(tokens[i])) {
      const take = [];
      for (let j = i + 1; j < tokens.length && take.length < 4; j += 1) {
        if (STOP_SET.has(tokens[j]) || /^[\u060C.,!\u061F?«»"']+$/.test(tokens[j])) break;
        take.push(tokens[j].replace(/^[\u060C.,!\u061F?«»"']+|[\u060C.,!\u061F?«»"']+$/g, ''));
      }
      if (take.length >= 2) push(take.join(' '));
    }
  }

  return {
    protected_texts: found,
    protected_brand_text: found.length ? found[0] : null,
  };
}

/**
 * Layer 1 entry: normalize + lock literals + normalize multimodal signals
 * coming from the UI (attachment / mask / click-to-edit / manual preset).
 */
export function normalizeInput(message, signals = {}) {
  const { original, normalized, corrections } = normalizeText(message);
  const { protected_texts, protected_brand_text } = extractProtectedTexts(normalized);
  const s = signals && typeof signals === 'object' ? signals : {};
  return {
    original,
    normalized,
    corrections,
    protected_texts,
    protected_brand_text,
    signals: {
      has_mask: !!s.has_mask,
      click_target: typeof s.click_target === 'string' && s.click_target ? s.click_target : null,
      attached_image: !!s.attached_image,
      preset_id: typeof s.preset_id === 'string' && s.preset_id ? s.preset_id : null,
    },
  };
}
