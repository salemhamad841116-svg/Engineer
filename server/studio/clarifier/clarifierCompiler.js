/**
 * clarifierCompiler.js — Layer 8 (core): Clicks-to-Structured-JSON Compiler.
 *
 * Pure deterministic compilation, 0 LLM calls by construction: validated
 * clicks become binding parameters that override every downstream default
 * (Direct Prompt Enhancer Binding), and the ORIGINAL routing telemetry row
 * is updated in place (Router Log Resolution Sync) — never duplicated.
 */

import { COMPILED_BINDINGS_SCHEMA, validateAnswers } from './clarifierSchema.js';
import { StudioError } from '../studioErrors.js';

const VALID_INTENTS = new Set(['image_generate', 'ui_generate', 'hybrid_ui_with_assets']);

/**
 * Compile validated clicks into the downstream binding object.
 * custom_text_input on the protected_text question becomes the literal
 * protected_brand_text (Inline Custom "Other" Input, Layer 4).
 */
export function compileAnswers({ answersPayload, brandAutoAnswers = {} }) {
  const parsed = validateAnswers(answersPayload);
  const bindings = {};
  let intentOverride = null;
  for (const entry of parsed.answers) {
    const value = entry.values[0];
    switch (entry.slot) {
      case 'intent_track':
        if (VALID_INTENTS.has(value)) intentOverride = value;
        break;
      case 'aspect_ratio': bindings.aspect_ratio = value; break;
      case 'lighting': bindings.lighting = value; break;
      case 'style': bindings.style = value; break;
      case 'theme': bindings.theme = value; break;
      case 'platform': bindings.platform = value; break;
      case 'direction': bindings.direction = value; break;
      case 'density': bindings.density = value; break;
      case 'protected_text':
        if (value === 'no') bindings.protected_brand_text = null;
        break;
      default:
        bindings.custom_notes = bindings.custom_notes
          ? `${bindings.custom_notes}; ${entry.slot}=${entry.values.join('+')}`
          : `${entry.slot}=${entry.values.join('+')}`;
    }
  }
  const customText = (parsed.custom_text_input || '').trim();
  if (customText) bindings.protected_brand_text = customText;
  if (brandAutoAnswers.preset_id && !bindings.preset_id) bindings.preset_id = brandAutoAnswers.preset_id;
  return COMPILED_BINDINGS_SCHEMA.parse({
    intent_override: intentOverride,
    enhancer_bindings: bindings,
  });
}

/**
 * Router Log Resolution Sync (Layer 8): update the original routing row when
 * the resolved intent differs from the routed one. Reuses the telemetry
 * table's existing corrected_intent column — no schema drift, no duplicates.
 * Returns the updated row or null when no sync was required.
 */
export function syncRoutingLog(db, ownerId, routingLogId, compiled) {
  if (!routingLogId || !compiled.intent_override) return null;
  const row = db.prepare(
    'SELECT * FROM studio_routing_telemetry WHERE id = ? AND owner_id = ?'
  ).get(routingLogId, ownerId);
  if (!row) throw new StudioError(404, 'ROUTING_LOG_NOT_FOUND', 'Original routing log row not found.');
  if (row.intent === compiled.intent_override) return null;
  db.prepare(
    'UPDATE studio_routing_telemetry SET corrected_intent = ? WHERE id = ? AND owner_id = ?'
  ).run(compiled.intent_override, routingLogId, ownerId);
  return db.prepare(
    'SELECT * FROM studio_routing_telemetry WHERE id = ? AND owner_id = ?'
  ).get(routingLogId, ownerId);
}
