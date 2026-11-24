/**
 * presetsResolve.js — the resolver: Zero-Click Auto-Preset Detection
 * (Layer 3 core), Modifier Conflict Guard + 4-level intensity (Layer 4
 * core), Multi-Provider Dialect Adapter + Conditional OCR Gate (Layer 7
 * core), RTL/LTR Composition Binding (Layer 3 core), Brand Preset Lock
 * binding (Layer 6 core), and the SHA-256 cache-key contract (Layer 9).
 * Pure deterministic work — zero provider calls.
 */

import crypto from 'node:crypto';
import { normalizeArabicForms } from '../enhancer/enhancerNormalize.js';
import { PRESET_DETECTION_HINTS, PRESETS_V2_I18N } from './i18n/presetsLexicon.js';
import { getPreset, resolveWithFallback, listPresets } from './presetsRegistry.js';
import { validateBundle } from './presetsSchema.js';

const DOMAIN_WEIGHT = 1;
const STYLE_OVERRIDE_WEIGHT = 3; // a style word outranks a plain domain noun

/**
 * Zero-Click Auto-Preset Detection: score every system preset against the
 * normalized message; style-tier hints weigh 3x so "heritage cafe
 * storefront" lands on regional_heritage rather than commercial_storefront.
 * Returns matches sorted by score (ties: registry id order, deterministic).
 */
export function scorePresets(db, message) {
  const normalized = normalizeArabicForms(String(message || '')).toLowerCase();
  const tokens = new Set(normalized.split(/[^\p{L}\p{N}:]+/u).filter(Boolean));
  const has = (kw) => {
    const norm = normalizeArabicForms(kw).toLowerCase();
    if (norm.includes(' ')) return normalized.includes(norm);
    return tokens.has(norm) || tokens.has(`\u0648${norm}`); // waw-prefix tolerance
  };
  const systemPresets = listPresets(db, { ownerId: '' }).filter((r) => r.is_system === 1);
  const scores = [];
  for (const preset of systemPresets) {
    const hints = PRESET_DETECTION_HINTS[preset.id];
    if (!hints) continue;
    let score = 0;
    for (const kw of hints.domain) if (has(kw)) score += DOMAIN_WEIGHT;
    for (const kw of hints.style) if (has(kw)) score += STYLE_OVERRIDE_WEIGHT;
    if (score > 0) scores.push({ preset, score });
  }
  scores.sort((a, b) => b.score - a.score || a.preset.id.localeCompare(b.preset.id));
  return scores;
}

/** Modifier Conflict Guard (Layer 4 core): apply {if, forbid} rules. */
export function applyConflictGuard(preset, activeModifiers) {
  const resolved = [];
  const out = { ...activeModifiers };
  (preset.conflict_rules || []).forEach((rule, idx) => {
    const ifPairs = Object.entries(rule.if || {});
    const matches = ifPairs.every(([k, v]) => out[k] === v);
    if (!matches) return;
    for (const [k, v] of Object.entries(rule.forbid || {})) {
      if (out[k] !== v) continue;
      const options = (preset.modifiers_schema || {})[k] || [];
      const fallbackOption = options.find((opt) => opt !== v) || null;
      resolved.push({
        rule_index: idx,
        matched_if: rule.if,
        modifier: k,
        dropped_value: v,
        switched_to: fallbackOption,
      });
      if (fallbackOption) out[k] = fallbackOption;
      else delete out[k];
    }
  });
  return { modifiers: out, conflicts_resolved: resolved };
}

/** Multi-Provider Dialect Adapter (Layer 7 core): narrative vs compact. */
export function adaptDialect(preset, provider, intensity) {
  const wrapper = preset.positive_prompt_wrapper;
  const negative = preset.negative_prompt_rules;
  const optical = preset.optical_physics || {};
  const override = (preset.provider_dialects || {})[provider];
  if (override && override.wrapper) {
    return { wrapper: override.wrapper, negative: override.negative || negative };
  }
  const opticalSentence = [
    optical.lens ? `shot on ${optical.lens} lens` : null,
    optical.dof ? `${String(optical.dof).replace('_', ' ')} depth of field` : null,
    optical.angle ? `${String(optical.angle).replace('_', ' ')} camera angle` : null,
  ].filter(Boolean).join(', ');
  if (provider === 'fal') {
    // Compact tag style for FLUX / Recraft: keywords, no prose scaffolding.
    const tags = wrapper.split(',').map((p) => p.trim().replace(/^(the|a|an) /i, '')).filter(Boolean);
    if (optical.lens) tags.push(optical.lens);
    if (optical.dof) tags.push(`${optical.dof} dof`);
    if (optical.angle) tags.push(`${String(optical.angle).replace('_', ' ')} angle`);
    return { wrapper: tags.join(', '), negative };
  }
  // Narrative style for Gemini / OpenAI: full sentence scaffolding; the
  // strictest intensity appends an explicit compliance directive.
  let narrative = `${wrapper}, ${opticalSentence}.`;
  if (intensity === 'strict') {
    narrative += ' Follow every listed requirement exactly; do not add unrequested elements.';
  }
  return { wrapper: narrative, negative };
}

const OCR_STATUS_BY_MODE = { always: 'required', on_text_detected: 'conditional', off: 'skipped' };

function cacheKeyComponent({ preset, intensity, aspect, modifiers }) {
  const aspectPart = String(aspect).replace(':', 'x');
  const modsPart = Object.values(modifiers).length
    ? Object.values(modifiers).join('+')
    : 'default';
  return `${preset.id}:v${preset.version}:${intensity}:${aspectPart}:${modsPart}`;
}

/**
 * Resolve a preset into the annex bundle. Selection precedence:
 * explicit preset_id (manual) > project Brand Preset Lock (brand_lock) >
 * Zero-Click detection (auto_detected) > graceful fallback.
 */
export function resolvePreset(db, {
  ownerId, projectId = null, presetId = null, message = '',
  lang = 'ar', intensity = 'balanced', modifiers = {}, provider = 'gemini',
  aspectRatio = null, brandLock = null,
}) {
  let selection_source = 'manual';
  let fallback_applied = false;
  let preset = null;
  let alternatives = [];

  if (presetId) {
    const direct = getPreset(db, presetId);
    if (direct && direct.is_active === 1 && (direct.is_system === 1 || direct.owner_id === ownerId)) {
      preset = direct;
    } else {
      const fb = resolveWithFallback(db, { id: presetId, ownerId });
      preset = fb.preset;
      fallback_applied = true;
    }
  } else if (brandLock && (brandLock.preset_id || brandLock.custom_preset_id)) {
    const lockId = brandLock.preset_id || brandLock.custom_preset_id;
    const fb = resolveWithFallback(db, { id: lockId, ownerId });
    preset = fb.preset;
    fallback_applied = fb.fallback_applied; // deleted locked custom -> system parent
    selection_source = 'brand_lock';
  } else {
    const scored = scorePresets(db, message);
    if (scored.length > 0) {
      preset = scored[0].preset;
      alternatives = scored.slice(1, 4).map((s) => ({
        preset_id: s.preset.id, label_key: s.preset.i18n_label_key, score: s.score,
      }));
    } else {
      preset = getPreset(db, 'cinematic_photo');
      fallback_applied = true;
    }
    selection_source = 'auto_detected';
  }
  if (!preset) {
    const err = new Error('no resolvable preset');
    err.code = 'PRESET_UNRESOLVABLE';
    throw err;
  }

  // Sanitize modifier selections against the preset schema: unknown keys
  // are dropped, unknown values snap to the first declared option.
  const schema = preset.modifiers_schema || {};
  const active = {};
  for (const [key, value] of Object.entries(modifiers || {})) {
    const options = schema[key];
    if (!options) continue;
    active[key] = options.includes(value) ? value : options[0];
  }
  // RTL/LTR Composition Binding: marketing banners reserve quiet space on
  // the reading side automatically when the client did not choose one.
  const rtlSide = lang === 'ar' ? 'right' : 'left';
  if (schema.negative_space_side && !active.negative_space_side) {
    active.negative_space_side = rtlSide;
  }

  const guarded = applyConflictGuard(preset, active);
  const weights = preset.intensity_weights || { subtle: 0.4, balanced: 0.7, strong: 0.9, strict: 1.0 };
  const weight = weights[intensity] ?? weights.balanced ?? 0.7;
  const aspect = aspectRatio || preset.default_aspect_ratio;
  const dialect = adaptDialect(preset, provider, intensity);
  const keyComponent = cacheKeyComponent({ preset, intensity, aspect, modifiers: guarded.modifiers });

  return validateBundle({
    preset_id: preset.id,
    preset_version: preset.version,
    selection_source,
    fallback_applied,
    intensity,
    intensity_weight: weight,
    aspect_ratio: aspect,
    ocr_gate_mode: preset.ocr_gate_mode,
    ocr_status: OCR_STATUS_BY_MODE[preset.ocr_gate_mode],
    rtl_negative_space_side: rtlSide,
    active_modifiers: guarded.modifiers,
    conflicts_resolved: guarded.conflicts_resolved,
    provider_dialect: provider,
    positive_prompt_wrapper: dialect.wrapper,
    negative_prompt_rules: dialect.negative,
    optical_physics: preset.optical_physics || {},
    post_process_hooks: preset.post_process_hooks || { webp: true, rembg: false, upscale_4k: false, svg: false },
    badge: {
      auto_detected: selection_source === 'auto_detected',
      label_key: selection_source === 'auto_detected' ? 'badge.auto_detected' : 'badge.manual',
      change_label_key: 'badge.change',
      alternatives,
    },
    brand_lock: brandLock ? {
      locked: true,
      preset_id: brandLock.preset_id || brandLock.custom_preset_id || null,
      style_seed: brandLock.style_seed || null,
      palette: (() => { try { return JSON.parse(brandLock.palette_json || '[]'); } catch { return []; } })(),
    } : { locked: false, preset_id: null, style_seed: null, palette: [] },
    cache_key_component: keyComponent,
    cache_fingerprint: crypto.createHash('sha256').update(keyComponent).digest('hex'),
  });
}

/** i18n lookup for list responses (labels live in the lexicon file only). */
export function presetLabel(lang, key) {
  const table = PRESETS_V2_I18N[lang === 'en' ? 'en' : 'ar'];
  return table[key] || key;
}
