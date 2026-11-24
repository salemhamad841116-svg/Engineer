/**
 * presetsRegistry.js — In-Memory Registry (Layer 9): the smart_presets
 * table is loaded once into a flat array cache; every read is served from
 * memory in <1ms. Any mutation (custom save, pin, delete) bumps the
 * generation counter and the next read re-warms — never a stale read.
 */

let cache = null;
let generation = 0;

const JSON_FIELDS = [
  'tags_json', 'optical_physics_json', 'modifiers_schema_json', 'conflict_rules_json',
  'intensity_weights_json', 'provider_dialects_json', 'post_process_hooks_json',
  'palette_json', 'theme_variants_json',
];

function parseRow(row) {
  const out = { ...row };
  for (const f of JSON_FIELDS) {
    try { out[f.slice(0, -5)] = JSON.parse(row[f] || (f.endsWith('s_json') ? '[]' : '{}')); }
    catch { out[f.slice(0, -5)] = f.endsWith('s_json') ? [] : {}; }
  }
  return out;
}

function warm(db) {
  const rows = db.prepare('SELECT * FROM smart_presets').all().map(parseRow);
  cache = { rows, byId: new Map(rows.map((r) => [r.id, r])), warmedAt: Date.now() };
}

/** Ensure the registry is warm; re-warm when a mutation bumped the generation. */
export function ensureRegistry(db) {
  if (!cache || cache.generation !== generation) {
    warm(db);
    cache.generation = generation;
  }
  return cache;
}

/** Invalidate after any write — next read re-warms from SQLite. */
export function invalidateRegistry() {
  generation++;
}

export function getPreset(db, id) {
  const { byId } = ensureRegistry(db);
  return byId.get(id) || null;
}

/**
 * List presets visible to a caller: all ACTIVE system presets plus the
 * caller's own active customs. Pinned first (Layer 6 core), then system
 * before custom, then id for stable ordering. Optional tag/id/label search
 * (?q=) and category filter.
 */
export function listPresets(db, { ownerId, q = null, category = null, labelLookup = null } = {}) {
  const { rows } = ensureRegistry(db);
  const needle = q ? String(q).trim().toLowerCase() : null;
  return rows
    .filter((r) => r.is_active === 1)
    .filter((r) => r.is_system === 1 || r.owner_id === ownerId)
    .filter((r) => !category || r.category === category)
    .filter((r) => {
      if (!needle) return true;
      if (r.id.toLowerCase().includes(needle)) return true;
      if ((r.tags || []).some((t) => String(t).toLowerCase().includes(needle))) return true;
      if (labelLookup) {
        const label = String(labelLookup(r.i18n_label_key) || '').toLowerCase();
        if (label.includes(needle)) return true;
      }
      return false;
    })
    .sort((a, b) => (b.is_pinned - a.is_pinned)
      || (b.is_system - a.is_system)
      || a.id.localeCompare(b.id));
}

/**
 * Graceful Preset Fallback (Layer 9): resolve a possibly-missing preset id
 * to a live one. Soft-deleted customs keep their row (is_active=0) and
 * parent chain, so a deleted custom falls back to its system parent
 * seamlessly; an unknown id falls back to the first system preset of the
 * hinted category (or the registry default).
 */
export function resolveWithFallback(db, { id, ownerId, categoryHint = null }) {
  const { byId, rows } = ensureRegistry(db);
  const direct = byId.get(id);
  if (direct && direct.is_active === 1 && (direct.is_system === 1 || direct.owner_id === ownerId)) {
    return { preset: direct, fallback_applied: false };
  }
  if (direct && direct.parent_preset_id) {
    const parent = byId.get(direct.parent_preset_id);
    if (parent && parent.is_active === 1 && parent.is_system === 1) {
      return { preset: parent, fallback_applied: true };
    }
  }
  const pool = rows.filter((r) => r.is_active === 1 && r.is_system === 1);
  const byCategory = categoryHint ? pool.find((r) => r.category === categoryHint) : null;
  const fallback = byCategory || pool[0] || null;
  return { preset: fallback, fallback_applied: true };
}
