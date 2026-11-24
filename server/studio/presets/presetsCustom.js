/**
 * presetsCustom.js — Layer 6 core: 1-Click Save as Custom Preset,
 * Favorites/Pinning, and graceful soft-delete (Layer 9 — a deleted custom
 * keeps its row with is_active=0 so resolveWithFallback can walk its
 * parent chain back to the system preset).
 *
 * Every free-text field is sanitized BEFORE it joins a prompt template
 * (Pre-Flight Safety). Every mutation invalidates the in-memory registry.
 */

import crypto from 'node:crypto';
import { invalidateRegistry, getPreset } from './presetsRegistry.js';
import { validateCustomInput, sanitizeFreeText, PIN_INPUT_SCHEMA } from './presetsSchema.js';
import { StudioError } from '../studioErrors.js';

const now = () => new Date().toISOString();

/** Save the winning generation settings as a reusable Custom Preset. */
export function saveCustomPreset(db, { ownerId, payload }) {
  const input = validateCustomInput(payload);
  const base = getPreset(db, input.base_preset_id);
  if (!base || base.is_active !== 1) {
    throw new StudioError(400, 'PRESET_BASE_INVALID', 'Base preset not found or inactive.');
  }
  if (base.is_system !== 1 && base.owner_id !== ownerId) {
    throw new StudioError(403, 'PRESET_BASE_FORBIDDEN', 'Cannot derive from another tenant preset.');
  }
  const id = `cp_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const name = sanitizeFreeText(input.name, 80);
  const wrapperAddition = sanitizeFreeText(input.wrapper_addition || '', 500);
  const negativeAddition = sanitizeFreeText(input.negative_addition || '', 300);
  const wrapper = wrapperAddition ? `${base.positive_prompt_wrapper}, ${wrapperAddition}` : base.positive_prompt_wrapper;
  const negative = negativeAddition ? `${base.negative_prompt_rules}, ${negativeAddition}` : base.negative_prompt_rules;
  db.prepare(`
    INSERT INTO smart_presets (
      id, version, parent_preset_id, project_id, owner_id, is_system, is_active, is_pinned,
      category, budget_tier, i18n_label_key, i18n_description_key, tags_json,
      positive_prompt_wrapper, negative_prompt_rules, optical_physics_json,
      default_aspect_ratio, ocr_gate_mode, modifiers_schema_json, conflict_rules_json,
      intensity_weights_json, provider_dialects_json, post_process_hooks_json,
      palette_json, theme_variants_json, style_seed, created_at, updated_at
    ) VALUES (?,?,?,?,?,0,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, 1, base.id, input.project_id || null, ownerId, input.is_pinned ? 1 : 0,
    base.category, base.budget_tier, name, '',
    JSON.stringify([...(base.tags || []), 'custom']),
    wrapper, negative, JSON.stringify(base.optical_physics || {}),
    input.aspect_ratio || base.default_aspect_ratio,
    input.ocr_gate_mode || base.ocr_gate_mode,
    JSON.stringify(base.modifiers_schema || {}),
    JSON.stringify(base.conflict_rules || []),
    JSON.stringify(base.intensity_weights || {}),
    JSON.stringify(base.provider_dialects || {}),
    JSON.stringify(base.post_process_hooks || {}),
    JSON.stringify(input.palette || base.palette || []),
    JSON.stringify(base.theme_variants || {}),
    input.style_seed ? String(input.style_seed) : (base.style_seed || null),
    now(), now(),
  );
  invalidateRegistry();
  return getPreset(db, id);
}

/** Pin / unpin a preset the caller owns (Favorites & Pinning, Layer 6). */
export function setPinned(db, { ownerId, payload }) {
  const parsed = PIN_INPUT_SCHEMA.parse(payload);
  const row = db.prepare('SELECT * FROM smart_presets WHERE id = ?').get(parsed.pin_id);
  if (!row || row.is_active !== 1) throw new StudioError(404, 'PRESET_NOT_FOUND', 'Preset not found.');
  if (row.is_system !== 1 && row.owner_id !== ownerId) {
    throw new StudioError(403, 'PRESET_FORBIDDEN', 'Preset belongs to another tenant.');
  }
  db.prepare('UPDATE smart_presets SET is_pinned = ?, updated_at = ? WHERE id = ?')
    .run(parsed.is_pinned ? 1 : 0, now(), parsed.pin_id);
  invalidateRegistry();
  return getPreset(db, parsed.pin_id);
}

/**
 * Soft-delete (deactivate) a custom preset the caller owns. The row and its
 * parent chain stay intact — projects referencing it fall back gracefully
 * to the system parent instead of erroring (Layer 9 acceptance gate).
 */
export function deleteCustomPreset(db, { ownerId, id }) {
  const row = db.prepare('SELECT * FROM smart_presets WHERE id = ?').get(id);
  if (!row) throw new StudioError(404, 'PRESET_NOT_FOUND', 'Preset not found.');
  if (row.is_system === 1) throw new StudioError(400, 'PRESET_SYSTEM_IMMUTABLE', 'System presets cannot be deleted.');
  if (row.owner_id !== ownerId) throw new StudioError(403, 'PRESET_FORBIDDEN', 'Preset belongs to another tenant.');
  db.prepare('UPDATE smart_presets SET is_active = 0, updated_at = ? WHERE id = ?').run(now(), id);
  invalidateRegistry();
  return { deleted: true, soft: true, id, parent_preset_id: row.parent_preset_id };
}
