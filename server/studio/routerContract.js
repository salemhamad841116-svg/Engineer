/**
 * Router Contract — the approved data contract for the Smart Intent Router.
 *
 * Defines the 6-intent taxonomy, model tiers, direct commands, and a strict
 * zero-dependency schema validator for LLM classifier output (Layer 7 spec:
 * "strict schema validation such as Zod" — implemented dependency-free so
 * the platform stays auditable and offline-installable).
 */

export const INTENTS = Object.freeze([
  'image_generate',
  'image_edit',
  'ui_generate',
  'ui_edit',
  'hybrid_ui_with_assets',
  'chat_consult',
]);

export const MODEL_TIERS = Object.freeze(['local', 'cloud_flash']);

export const DIRECT_COMMAND_IDS = Object.freeze(['remove_bg', 'upscale_4k', 'export_code']);

// Legacy Phase-1 mapping so existing UI/tests keep working on /api/studio/route.
export const LEGACY_MODE = Object.freeze({
  image_generate: 'image',
  image_edit: 'image',
  ui_generate: 'ui',
  ui_edit: 'ui',
  hybrid_ui_with_assets: 'hybrid',
  chat_consult: 'chat',
});

export function legacyModeFor(intent) {
  return LEGACY_MODE[intent] || 'chat';
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v, min = 1, max = 4000) =>
  typeof v === 'string' && v.trim().length >= min && v.length <= max;

/**
 * Strict validator for the classifier/enricher JSON output.
 * Returns { ok, errors } — callers treat !ok as "broken model output" and
 * trigger the retry/fallback chain (never surface a raw error to clients).
 *
 * @param {object} obj candidate parsed JSON
 * @param {{ validPresetIds?: Set<string> }} [opts]
 */
export function validateRouterOutput(obj, { validPresetIds = null } = {}) {
  const errors = [];
  if (!isObj(obj)) return { ok: false, errors: ['root:not-object'] };

  if (!INTENTS.includes(obj.intent)) errors.push('intent:invalid');
  if (typeof obj.confidence !== 'number' || Number.isNaN(obj.confidence)
      || obj.confidence < 0 || obj.confidence > 1) errors.push('confidence:range');
  if (obj.model_tier !== undefined && !MODEL_TIERS.includes(obj.model_tier)) {
    errors.push('model_tier:invalid');
  }

  if (obj.ui_params !== undefined) {
    if (!isObj(obj.ui_params)) {
      errors.push('ui_params:not-object');
    } else {
      const up = obj.ui_params;
      for (const k of ['domain', 'platform', 'theme', 'direction', 'protected_brand_text']) {
        if (up[k] !== undefined && up[k] !== null && typeof up[k] !== 'string') {
          errors.push(`ui_params.${k}:type`);
        }
      }
      if (up.direction !== undefined && up.direction !== null
          && !['rtl', 'ltr'].includes(up.direction)) errors.push('ui_params.direction:enum');
    }
  }

  if (obj.asset_tasks !== undefined) {
    if (!Array.isArray(obj.asset_tasks)) {
      errors.push('asset_tasks:not-array');
    } else {
      obj.asset_tasks.forEach((t, i) => {
        if (!isObj(t)) { errors.push(`asset_tasks[${i}]:not-object`); return; }
        if (!isStr(t.slot, 1, 40)) errors.push(`asset_tasks[${i}].slot:type`);
        if (!isStr(t.preset_id, 1, 60)) errors.push(`asset_tasks[${i}].preset_id:type`);
        else if (validPresetIds && !validPresetIds.has(t.preset_id)) {
          errors.push(`asset_tasks[${i}].preset_id:unknown`);
        }
        if (typeof t.aspect_ratio !== 'string' || !/^\d{1,2}:\d{1,2}$/.test(t.aspect_ratio)) {
          errors.push(`asset_tasks[${i}].aspect_ratio:format`);
        }
        if (typeof t.ocr_gate !== 'boolean') errors.push(`asset_tasks[${i}].ocr_gate:type`);
        if (!isStr(t.enhanced_prompt, 10, 4000)) errors.push(`asset_tasks[${i}].enhanced_prompt:length`);
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Parse raw model text into JSON — tolerant of markdown fences, strict on
 * content. Returns null on any failure (caller treats as broken output).
 */
export function parseModelJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}
