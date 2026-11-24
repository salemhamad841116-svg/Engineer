/**
 * presetsBrandKit.js — Layer 6 core: Brand Preset Lock management on top of
 * the existing studio_project_brand_lock table (migration 034). A locked
 * preset (system or custom) plus its style_seed and palette bind every
 * subsequent generation of the project until explicitly unlocked.
 */

import crypto from 'node:crypto';
import { getBrandLock } from '../presetStore.js';
import { getPreset } from './presetsRegistry.js';
import { validateBrandKitPatch } from './presetsSchema.js';
import { StudioError } from '../studioErrors.js';

const now = () => new Date().toISOString();

function publicBrandKit(lock) {
  if (!lock) return { locked: false, preset_id: null, locked_style_seed: null, palette: [] };
  return {
    locked: true,
    preset_id: lock.preset_id || lock.custom_preset_id || null,
    is_custom: Boolean(lock.custom_preset_id),
    locked_style_seed: lock.style_seed || null,
    palette: (() => { try { return JSON.parse(lock.palette_json || '[]'); } catch { return []; } })(),
    locked_at: lock.locked_at,
  };
}

export function getBrandKit(db, { ownerId, projectId }) {
  if (!projectId) throw new StudioError(400, 'BRAND_KIT_PROJECT_REQUIRED', 'project_id is required.');
  const lock = getBrandLock(db, ownerId, projectId);
  return publicBrandKit(lock);
}

/**
 * PATCH brand-kit: lock a preset onto the project. locked_style_seed is
 * honored verbatim when provided (Layer 6 annex); otherwise a fresh seed
 * is generated once and pinned.
 */
export function patchBrandKit(db, { ownerId, projectId, payload }) {
  if (!projectId) throw new StudioError(400, 'BRAND_KIT_PROJECT_REQUIRED', 'project_id is required.');
  const input = validateBrandKitPatch(payload || {});
  const preset = getPreset(db, input.preset_id);
  if (!preset || preset.is_active !== 1) {
    throw new StudioError(404, 'PRESET_NOT_FOUND', 'Preset not found or inactive.');
  }
  if (preset.is_system !== 1 && preset.owner_id !== ownerId) {
    throw new StudioError(403, 'PRESET_FORBIDDEN', 'Preset belongs to another tenant.');
  }
  const seed = input.locked_style_seed
    || (preset.style_seed ? String(preset.style_seed) : crypto.randomBytes(6).toString('hex'));
  const palette = JSON.stringify(preset.palette || []);
  db.prepare(`INSERT INTO studio_project_brand_lock (project_id, owner_id, preset_id, custom_preset_id, style_seed, palette_json, locked_at)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(project_id) DO UPDATE SET
                owner_id = excluded.owner_id,
                preset_id = excluded.preset_id,
                custom_preset_id = excluded.custom_preset_id,
                style_seed = excluded.style_seed,
                palette_json = excluded.palette_json,
                locked_at = excluded.locked_at`)
    .run(
      projectId, ownerId,
      preset.is_system === 1 ? preset.id : null,
      preset.is_system === 1 ? null : preset.id,
      seed, palette, now(),
    );
  return publicBrandKit(getBrandLock(db, ownerId, projectId));
}
