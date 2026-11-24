/**
 * Prompt Enhancer Engine — Layer 1: Linguistic Normalization & Entity Locking.
 *
 * Four features, all deterministic and local ($0):
 *  1. Arabic normalization & spell-fix (hamza, alef-maqsura, ta-marbuta, typos)
 *  2. Dialect-to-technical mapping (Gulf/colloquial -> design vocabulary)
 *  3. Literal entity locking (protected_brand_text, never translated/altered)
 *  4. Language & RTL/LTR direction detection
 *
 * Arabic data lives ONLY in ./i18n/enhancerLexicon.js.
 */

import {
  SPELL_FIX,
  DIALECT_TECH_TOKENS,
  ENTITY_NAME_PATTERN_SOURCE,
  BRAND_LEAD_NOUNS,
  BRAND_STOP_WORDS,
  BRAND_GENERIC_WORDS,
} from './i18n/enhancerLexicon.js';

const ENTITY_NAME_RE = new RegExp(ENTITY_NAME_PATTERN_SOURCE, 'g');

const ARABIC_RE = /[\u0600-\u06FF]/;

/**
 * Strip diacritics/tatweel, unify hamza/alef-maqsura/ta-marbuta forms.
 * All Arabic code points are written as \uXXXX escapes so this file stays
 * clean under the 100% English Codebase regex gate.
 */
export function normalizeArabicForms(text) {
  let out = String(text || '');
  out = out.replace(/[\u064B-\u0652\u0670\u0640]/g, ''); // diacritics + tatweel
  out = out.replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627'); // hamza carriers -> bare alef
  out = out.replace(/\u0649/g, '\u064A'); // alef maqsura -> ya
  out = out.replace(/\u0629/g, '\u0647'); // ta marbuta -> ha (matching form only)
  return out;
}

/**
 * Feature 1 — spell-fix + form normalization for DESCRIPTIVE text.
 * Protected entities are handled separately (never touched here).
 * Returns { text, corrections: [{from,to}] } — corrections are auditable.
 */
export function normalizeAndSpellFix(message) {
  const corrections = [];
  const tokens = String(message || '').split(/\s+/).filter(Boolean);
  const fixed = tokens.map((tok) => lookupWithWawPrefix(tok, SPELL_FIX, corrections));
  return { text: fixed.join(' '), corrections };
}

/** Token lookup tolerant of the leading conjunction "waw" (and- prefix). */
function lookupWithWawPrefix(tok, table, audit) {
  if (Object.prototype.hasOwnProperty.call(table, tok)) {
    if (audit) audit.push({ from: tok, to: table[tok] });
    return table[tok];
  }
  if (tok.length > 2 && tok[0] === '\u0648') {
    const rest = tok.slice(1);
    if (Object.prototype.hasOwnProperty.call(table, rest)) {
      const mapped = '\u0648' + table[rest];
      if (audit) audit.push({ from: tok, to: mapped });
      return mapped;
    }
  }
  return tok;
}

/**
 * Feature 2 — dialect tokens -> technical design vocabulary (token-level,
 * because JS \b is ASCII-centric and never matches Arabic boundaries).
 * Returns { text, mapped: [{from,to}] }.
 */
export function dialectToTechnical(message) {
  const mapped = [];
  const tokens = String(message || '').split(/\s+/).filter(Boolean);
  const out = tokens.map((tok) => lookupWithWawPrefix(tok, DIALECT_TECH_TOKENS, mapped));
  return { text: out.join(' '), mapped };
}

/**
 * Feature 3 — literal entity locking. Sources: «…» / "…" / '…' quotes and
 * name lead-in patterns. The FIRST locked entity is the primary
 * protected_brand_text; all locked entities are returned for the OCR gate.
 * Locked text is extracted BEFORE normalization and kept byte-verbatim.
 */
export function extractProtectedEntities(message) {
  const texts = [];
  const src = String(message || '');
  const push = (t) => {
    const v = String(t || '').trim();
    if (v && !texts.includes(v)) texts.push(v);
  };
  for (const m of src.matchAll(/«([^»]{2,60})»/g)) push(m[1]);
  for (const m of src.matchAll(/["']([^"'\n]{2,60})["']/g)) push(m[1]);
  ENTITY_NAME_RE.lastIndex = 0;
  for (const m of src.matchAll(ENTITY_NAME_RE)) {
    push(m[1]);
  }
  for (const b of extractBrandCandidates(src)) push(b);
  return {
    protected_brand_text: texts.length ? texts[0] : null,
    locked_texts: texts,
  };
}

/**
 * Brand heuristic for UNQUOTED messages: a business lead noun followed by a
 * 1-3 word candidate that stops at prepositions/descriptors and must contain
 * at least one word that is not a generic product word. Quotes and explicit
 * name patterns (above) always win; this only catches bare mentions like a
 * coffee-store name stated without quotation marks.
 */
const PUNCT_ONLY_RE = /^[\p{P}\p{S}]+$/u;
const LATIN_TOKEN_RE = /[A-Za-z]/;

export function extractBrandCandidates(message) {
  const tokens = String(message || '').split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (!BRAND_LEAD_NOUNS.includes(tokens[i])) continue;
    const candidate = [];
    let hasProper = false;
    // Bilingual brands ("AR name — EN NAME") span up to 7 tokens:
    // 2-3 Arabic words + dash bridge + 1-3 Latin words.
    for (let j = i + 1; j < tokens.length && candidate.length < 7; j += 1) {
      const w = tokens[j];
      // Descriptors, prepositions and OTHER lead nouns terminate capture
      // ("an app FOR a coffee store" is a description, not a brand name).
      if (BRAND_STOP_WORDS.has(w) || BRAND_LEAD_NOUNS.includes(w)) break;
      if (PUNCT_ONLY_RE.test(w)) {
        // Bilingual bridge: a dash followed by a Latin word continues the
        // SAME brand into its English half; otherwise it terminates the
        // capture and is never kept inside the locked name.
        const next = tokens[j + 1];
        if (hasProper && next && LATIN_TOKEN_RE.test(next) && !BRAND_STOP_WORDS.has(next)) {
          candidate.push(w);
          continue;
        }
        break;
      }
      candidate.push(w);
      if (!BRAND_GENERIC_WORDS.has(w)) hasProper = true;
    }
    // Never lock trailing punctuation (a bare dash belongs to the sentence).
    while (candidate.length && PUNCT_ONLY_RE.test(candidate[candidate.length - 1])) candidate.pop();
    // A candidate proves a brand only with a non-generic word AND at least
    // two tokens (a lone adjective after a lead noun is a description).
    if (hasProper && candidate.length >= 2) out.push(candidate.join(' '));
  }
  return out;
}

/** Feature 4 — display language & layout direction. */
export function detectDirection(message) {
  const src = String(message || '');
  const ar = (src.match(new RegExp(ARABIC_RE.source, 'g')) || []).length;
  const en = (src.match(/[a-zA-Z]/g) || []).length;
  return {
    direction: ar >= en && ar > 0 ? 'rtl' : 'ltr',
    lang: ar >= en && ar > 0 ? 'ar' : 'en',
  };
}

/** Layer-1 pipeline in one call (ordered: lock entities FIRST, then normalize). */
export function runLayer1(message) {
  const entities = extractProtectedEntities(message);
  const dir = detectDirection(message);
  const spell = normalizeAndSpellFix(message);
  const dialect = dialectToTechnical(spell.text);
  return {
    normalized_message: dialect.text,
    corrections: spell.corrections,
    dialect_mapped: dialect.mapped,
    ...entities,
    ...dir,
  };
}
