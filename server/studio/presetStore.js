/**
 * Preset Store — DAL for custom presets and project brand locks.
 * All SQL for studio_custom_presets / studio_project_brand_lock lives here.
 * owner_id is mandatory on every read/write (tenant isolation).
 */
import crypto from 'node:crypto';
import { StudioError } from './studioErrors.js';
import { getRegistryPreset } from './presetRegistry.js';

const now = () => new Date().toISOString();

/* --------------------------- Custom presets --------------------------- */

/**
 * Save a generated asset's full visual configuration as a reusable custom preset.
 * The snapshot (palette, style_seed, wrapper, negative, modifiers, intensity)
 * comes from the asset row — we never trust client-supplied style blobs.
 */
export function saveCustomPresetFromAsset(db, { ownerId, assetId, name, projectId = null }) {
  if (!name || typeof name !== 'string' || name.trim().length < 2 || name.length > 80) {
    throw new StudioError(400, 'STUDIO_PRESET_NAME_INVALID', 'Preset name is required (2-80 characters).');
  }
  const asset = db.prepare('SELECT * FROM studio_assets WHERE id = ? AND owner_id = ?').get(assetId, ownerId);
  if (!asset) throw new StudioError(404, 'STUDIO_ASSET_NOT_FOUND', 'Asset not found.');
  if (!asset.style_seed) {
    throw new StudioError(409, 'STUDIO_ASSET_NO_STYLE', 'This asset predates the preset subsystem and carries no style seed.');
  }
  const id = crypto.randomUUID();
  const t = now();
  db.prepare(`INSERT INTO studio_custom_presets
              (id, owner_id, name, base_preset_id, source_asset_id, wrapper_en, negative_en,
               aspect, ocr_gate, palette_json, style_seed, modifiers_json, intensity, created_at, updated_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, ownerId, name.trim(), asset.preset, asset.id,
         JSON.stringify({ prefix: null, suffix: null }), // custom presets inherit the base wrapper via base_preset_id
         asset.negative, asset.aspect, asset.ocr_gate_mode,
         asset.palette_json, asset.style_seed, asset.modifiers_json, asset.intensity, t, t);
  return getCustomPreset(db, ownerId, id);
}

export function getCustomPreset(db, ownerId, id) {
  const row = db.prepare('SELECT * FROM studio_custom_presets WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!row) throw new StudioError(404, 'STUDIO_PRESET_NOT_FOUND', 'Custom preset not found.');
  return row;
}

export function listCustomPresets(db, ownerId, { limit = 50, offset = 0 } = {}) {
  return db.prepare('SELECT * FROM studio_custom_presets WHERE owner_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(ownerId, Math.min(limit, 100), Math.max(0, offset));
}

export function deleteCustomPreset(db, ownerId, id) {
  const row = getCustomPreset(db, ownerId, id);
  db.prepare('DELETE FROM studio_custom_presets WHERE id = ? AND owner_id = ?').run(id, ownerId);
  db.prepare('UPDATE studio_project_brand_lock SET custom_preset_id = NULL WHERE owner_id = ? AND custom_preset_id = ?')
    .run(ownerId, id);
  return { deleted: true, id: row.id };
}

/* ---------------------------- Brand lock ------------------------------ */

/**
 * Pin a project's visual identity: every later generation inside the project
 * reuses the locked preset, palette and style_seed until explicitly unlocked.
 */
export function setBrandLock(db, { ownerId, projectId, presetId = null, customPresetId = null }) {
  if (!projectId) throw new StudioError(400, 'STUDIO_PROJECT_REQUIRED', 'project_id is required.');
  if (!presetId && !customPresetId) {
    throw new StudioError(400, 'STUDIO_LOCK_TARGET_REQUIRED', 'Provide preset_id or custom_preset_id.');
  }
  let styleSeed;
  let paletteJson;
  if (customPresetId) {
    const cp = getCustomPreset(db, ownerId, customPresetId);
    styleSeed = cp.style_seed;
    paletteJson = cp.palette_json;
  } else {
    const p = getRegistryPreset(presetId);
    if (!p) throw new StudioError(400, 'STUDIO_PRESET_INVALID', `Unknown preset: ${presetId}`);
    styleSeed = crypto.randomBytes(6).toString('hex');
    paletteJson = JSON.stringify(p.palette);
  }
  db.prepare(`INSERT INTO studio_project_brand_lock (project_id, owner_id, preset_id, custom_preset_id, style_seed, palette_json, locked_at)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(project_id) DO UPDATE SET
                owner_id = excluded.owner_id,
                preset_id = excluded.preset_id,
                custom_preset_id = excluded.custom_preset_id,
                style_seed = excluded.style_seed,
                palette_json = excluded.palette_json,
                locked_at = excluded.locked_at`)
    .run(projectId, ownerId, presetId, customPresetId, styleSeed, paletteJson, now());
  return getBrandLock(db, ownerId, projectId);
}

export function getBrandLock(db, ownerId, projectId) {
  if (!projectId) return null;
  const row = db.prepare('SELECT * FROM studio_project_brand_lock WHERE project_id = ?').get(projectId);
  if (!row) return null;
  if (row.owner_id !== ownerId) {
    // A lock owned by someone else must never leak its contents.
    throw new StudioError(403, 'STUDIO_LOCK_FORBIDDEN', 'Brand lock belongs to another owner.');
  }
  return row;
}

export function clearBrandLock(db, ownerId, projectId) {
  const row = getBrandLock(db, ownerId, projectId);
  if (!row) return { locked: false };
  db.prepare('DELETE FROM studio_project_brand_lock WHERE project_id = ? AND owner_id = ?').run(projectId, ownerId);
  return { locked: false, cleared: true };
}
