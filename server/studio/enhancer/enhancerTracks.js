/**
 * Prompt Enhancer Engine — Layer 3: Dual-Track Visual & UI Engineering.
 *
 * Phase-1 scope (per the official annex delivery table): the IMAGE track.
 *  9.  Visual & cinematography track (lens, angle, lighting, materials, DOF)
 * 11.  RTL/LTR negative-space engineering (calm zone for headline/CTA)
 * 12.  Precision English prompt synthesis (protected text verbatim)
 *
 * Feature 10 (UI/UX architecture track) ships with Phase 3 — the engine
 * honestly passes UI-track briefs through with a marked, minimal constraint
 * envelope instead of faking an unimplemented track.
 */

const LENS_BY_TRACK = {
  storefront: '35mm lens, straight-on facade perspective',
  product: '85mm lens, shallow depth of field, creamy background separation',
  cinematic: '35mm lens, shallow depth of field',
  default: '50mm lens, balanced perspective',
};

const LIGHTING_BY_FLAG = {
  night: 'night scene, warm interior glow, illuminated signage, city lights bokeh',
  day: 'bright natural daylight, clear sky',
  golden_hour: 'golden hour sunset light, long warm shadows',
  default: 'soft diffused professional lighting',
};

/**
 * Feature 9 — cinematography specs for the image track. Deterministic
 * selection from the brief (no LLM cost); every spec is auditable.
 */
export function visualTrackSpecs(brief, { presetId } = {}) {
  const lens = presetId === 'product_studio' ? LENS_BY_TRACK.product
    : presetId === 'commercial_storefront' ? LENS_BY_TRACK.storefront
    : presetId === 'cinematic_photo' ? LENS_BY_TRACK.cinematic
    : LENS_BY_TRACK.default;
  const lighting = brief.lighting && LIGHTING_BY_FLAG[brief.lighting]
    ? LIGHTING_BY_FLAG[brief.lighting]
    : brief.time_of_day && LIGHTING_BY_FLAG[brief.time_of_day]
      ? LIGHTING_BY_FLAG[brief.time_of_day]
      : LIGHTING_BY_FLAG.default;
  return {
    lens,
    lighting,
    materials: 'realistic premium materials, true-to-life textures',
    render: 'high dynamic range, professional color grading, sharp focus',
    composition: 'balanced professional composition with a clear focal point',
  };
}

/**
 * Feature 11 — negative space engineering. Arabic (RTL) layouts put the
 * headline zone on the RIGHT; English (LTR) on the LEFT. The zone must be
 * calm and low-contrast so overlay text stays legible.
 */
export function negativeSpaceSpec(direction) {
  return direction === 'rtl'
    ? 'calm low-contrast negative space on the right side of the composition, reserved for Arabic headline and CTA overlay'
    : 'calm low-contrast negative space on the left side of the composition, reserved for English headline and CTA overlay';
}

/**
 * Feature 12 — precision English synthesis. The brief (Arabic intent) is
 * rendered into technical English; protected entities are embedded VERBATIM
 * in their original language with an exact-rendering instruction, never
 * translated. The subject line keeps the client's normalized intent visible
 * to the model as translated context.
 */
export function synthesizeEnglishPrompt({ brief, specs, protectedTexts, negativeSpace }) {
  const parts = [];
  parts.push(`Client concept (translated intent): ${brief.subject}`);
  parts.push(`Setting: ${brief.environment}`);
  if (brief.elements.length) parts.push(`Additional elements: ${brief.elements.join(', ')}`);
  parts.push(specs.composition);
  parts.push(specs.lighting);
  parts.push(specs.lens);
  parts.push(specs.materials);
  parts.push(specs.render);
  parts.push(negativeSpace);
  if (brief.data_cues) parts.push(`Context cues: ${brief.data_cues}`);
  if (protectedTexts.length) {
    parts.push(
      'IMPORTANT — render these texts EXACTLY, legible and correctly spelled on signage/banners: '
      + protectedTexts.map((t) => `"${t}"`).join(', ') + '.',
    );
  }
  return parts.join('. ');
}

/**
 * Honest Phase-1 UI-track envelope (feature 10 ships in Phase 3): the brief
 * is preserved and marked so the caller never mistakes it for the full
 * UI/UX architecture expansion.
 */
export function uiTrackEnvelope(brief) {
  return {
    deferred: true,
    reason: 'ui_track_phase_3',
    subject: brief.subject,
    direction: brief.direction,
  };
}
