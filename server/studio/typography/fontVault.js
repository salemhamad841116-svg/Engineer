/**
 * fontVault.js — Layer 4 core: Curated AR & EN Commercial Font Vault with
 * Auto Arabic-Latin Font Pairing. DB-backed (typography_fonts), served
 * from a warm in-memory map; pairing follows the paired_font_id column
 * seeded by migration 041 — no hardcoded pairs in engine code.
 */

let cache = null;
let generation = 0;

function warm(db) {
  const rows = db.prepare('SELECT * FROM typography_fonts').all()
    .map((r) => ({ ...r, weights: JSON.parse(r.weights_json || '[]') }));
  cache = { rows, byId: new Map(rows.map((r) => [r.id, r])), generation };
}

export function ensureFontVault(db) {
  if (!cache || cache.generation !== generation) warm(db);
  return cache;
}

export function invalidateFontVault() {
  generation++;
}

export function listFonts(db, { script = null, category = null } = {}) {
  const { rows, byId } = ensureFontVault(db);
  return rows
    .filter((f) => !script || f.script_support === script || (script !== 'bilingual' && f.script_support === 'bilingual'))
    .filter((f) => !category || f.style_category === category)
    .map((f) => ({
      id: f.id,
      family_name: f.family_name,
      script_support: f.script_support,
      style_category: f.style_category,
      weights: f.weights,
      license_type: f.license_type,
      is_system: f.is_system === 1,
      paired_font: f.paired_font_id ? publicFont(byId.get(f.paired_font_id)) : null,
    }));
}

function publicFont(f) {
  if (!f) return null;
  return {
    id: f.id,
    family_name: f.family_name,
    script_support: f.script_support,
    style_category: f.style_category,
    weights: f.weights,
  };
}

/**
 * Auto Arabic-Latin Font Pairing (Layer 4 core): pick the primary font for
 * a layer by its script and the requested style category, then resolve the
 * paired counterpart through the vault's paired_font_id chain — including
 * the reverse direction (an EN layer gets the AR font that pairs to it).
 */
export function pickFontPair(db, { script, styleCategory = 'modern_sans' }) {
  const { byId, rows } = ensureFontVault(db);
  const inCategory = rows.filter((f) => f.is_system === 1 && f.style_category === styleCategory);
  const supports = (f) => f.script_support === 'bilingual' || f.script_support === script;

  let primary = inCategory.find((f) => supports(f) && (script === 'en' ? f.script_support !== 'ar' : true));
  if (!primary) primary = rows.find((f) => f.is_system === 1 && supports(f));
  if (!primary) return { primary: null, paired: null };

  let paired = primary.paired_font_id ? byId.get(primary.paired_font_id) : null;
  if (!paired) {
    // Reverse pairing: find the vault entry that pairs TO this font.
    paired = rows.find((f) => f.paired_font_id === primary.id) || null;
  }
  return { primary, paired: paired || null };
}
