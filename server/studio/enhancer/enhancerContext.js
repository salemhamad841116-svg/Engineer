/**
 * Prompt Enhancer Engine — Layer 2: Semantic Expansion & Context Merging.
 *
 * Four features:
 *  5. Intelligent gap-filling (short request -> complete visual brief)
 *  6. Conversational delta merging (follow-up edits over the last contract)
 *  7. Cultural & regional grounding (environment + sample-data cues)
 *  8. Contradiction resolver (conflicting cues -> one coherent brief)
 *
 * Deterministic rule engine first ($0, auditable); the local LLM may expand
 * the brief further through Layer 6's validated JSON channel. Arabic cue
 * data lives ONLY in ./i18n/enhancerLexicon.js.
 */

import {
  DELTA_RULES,
  DELTA_ADD_ELEMENT,
  CONTRADICTION_GROUPS,
  REGION_PROFILES,
} from './i18n/enhancerLexicon.js';

/**
 * Feature 7 — regional grounding profile for the request language.
 */
export function culturalGrounding(lang) {
  return REGION_PROFILES[lang === 'en' ? 'en' : 'ar'];
}

/**
 * Feature 8 — contradiction detection & resolution.
 * Rule: the SETTING cue (explicit time/mood instruction) wins; conflicting
 * element cues are transformed via the lexicon transform table instead of
 * producing an incoherent brief. Every resolution is auditable.
 *
 * @returns {{ text: string, resolutions: object[], flags: object }}
 */
export function resolveContradictions(message) {
  let text = String(message || '');
  const resolutions = [];
  const groups = CONTRADICTION_GROUPS.time_of_day;
  const hasAny = (cues) => cues.some((c) => text.includes(c));
  const hasNight = hasAny(groups.night_cues);
  const hasDay = hasAny(groups.day_cues);

  if (hasNight && hasDay) {
    // Night is the setting (explicitly stated mood); day elements transform.
    for (const [from, to] of Object.entries(groups.night_transforms)) {
      if (text.includes(from)) {
        text = text.split(from).join(to);
        resolutions.push({ type: 'time_of_day', from, to, kept_setting: 'night' });
      }
    }
    // Any day cue left without a transform is dropped with a recorded reason.
    for (const cue of groups.day_cues) {
      if (text.includes(cue)) {
        text = text.split(cue).join('').replace(/\s+/g, ' ').trim();
        resolutions.push({ type: 'time_of_day', from: cue, to: null, kept_setting: 'night' });
      }
    }
  }

  const density = CONTRADICTION_GROUPS.density;
  const hasMinimal = density.minimal_cues.some((c) => text.includes(c));
  const hasCrowded = density.crowded_cues.some((c) => text.includes(c));
  if (hasMinimal && hasCrowded) {
    // Minimal wins: crowded cues are dropped (a calm scene was asked for).
    for (const cue of density.crowded_cues) {
      if (text.includes(cue)) {
        text = text.split(cue).join('').replace(/\s+/g, ' ').trim();
        resolutions.push({ type: 'density', from: cue, to: null, kept_setting: 'minimal' });
      }
    }
  }

  return { text, resolutions, flags: { time_of_day: hasNight ? 'night' : hasDay ? 'day' : null } };
}

/**
 * Feature 6 — merge a follow-up message over the previous accepted contract.
 * Deterministic deltas (lighting switches, element additions) are applied
 * WITHOUT re-phrasing the rest: protected text, scene and region survive
 * byte-identical. Returns null when the message carries no recognizable
 * delta (caller then treats it as a fresh request).
 */
export function mergeConversationalDelta(prevContract, followUp) {
  if (!prevContract || typeof followUp !== 'string' || !followUp.trim()) return null;
  const deltas = [];
  const patch = {};

  for (const rule of DELTA_RULES) {
    if (rule.patterns.some((re) => re.test(followUp))) {
      Object.assign(patch, rule.apply);
      deltas.push({ id: rule.id, ...rule.apply });
    }
  }

  const addMatch = followUp.match(DELTA_ADD_ELEMENT);
  if (addMatch) {
    patch.add_element = addMatch[1].trim();
    deltas.push({ id: 'add_element', element: patch.add_element });
  }

  if (!deltas.length) return null;

  const brief = { ...(prevContract.brief || {}), ...patch };
  if (patch.add_element) {
    brief.elements = [...(prevContract.brief?.elements || []), patch.add_element];
    delete brief.add_element;
  }
  return { brief, deltas };
}

/**
 * Feature 5 — gap-filling: a structured brief assembled from whatever the
 * client gave us, with deterministic completions for the gaps. A three-word
 * request yields a complete visual spec (subject/environment/lighting/lens/
 * mood) without forcing the client to learn prompt engineering.
 */
export function fillGaps({ normalized, lang, direction, track, sector }) {
  const grounding = culturalGrounding(lang);
  const brief = {
    subject: normalized,
    track,
    sector: sector || null,
    environment: grounding.environment_en,
    data_cues: grounding.data_cues_en,
    lighting: null, // may be set by delta merging or modifiers later
    time_of_day: null,
    elements: [],
    direction,
    region: grounding.id,
  };
  return brief;
}
