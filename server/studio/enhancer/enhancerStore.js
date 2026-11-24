/**
 * Prompt Enhancer Engine — Layer 6 (b): Store (SHA-256 cache + telemetry DAL).
 *
 * Constitution: ALL enhancer SQL lives in this file only; owner_id is
 * mandatory on every read/write (app-level tenant isolation).
 * Table: studio_prompt_enhancements (migration 038) — one row per enhancement,
 * UNIQUE(owner_id, fingerprint) doubling as the zero-cost prompt cache.
 */

import crypto from 'node:crypto';

const now = () => new Date().toISOString();

/** Deterministic request fingerprint over everything that shapes the output.
 * Session id is included: the same message in different sessions may merge
 * different prior contracts, so it is NOT the same request. */
export function enhancementFingerprint(payload) {
  const canonical = JSON.stringify({
    msg: payload.normalized_message,
    session: payload.session_id || null,
    track: payload.track,
    preset: payload.preset_id || null,
    intensity: payload.preset_intensity,
    modifiers: payload.modifiers || {},
    dialect: payload.provider_dialect,
    brand: payload.protected_brand_text || null,
    seed: payload.style_seed || null,
    candidates: payload.candidates || 0,
    prev: payload.prev_contract_id || null,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

/** Cache lookup — a hit means ZERO LLM/provider calls for this request. */
export function lookupEnhancement(db, ownerId, fingerprint) {
  const ptr = db.prepare(
    'SELECT enhancement_id FROM studio_prompt_cache WHERE owner_id = ? AND fingerprint = ?',
  ).get(ownerId, fingerprint);
  if (!ptr) return null;
  return db.prepare('SELECT * FROM studio_prompt_enhancements WHERE id = ?')
    .get(ptr.enhancement_id) || null;
}

/** Append the run to the telemetry ledger and (idempotently) point the cache
 * at it. The ledger is append-only: every run is recorded; the cache keeps
 * ONE pointer per fingerprint so repeats short-circuit before any LLM call. */
export function insertEnhancement(db, row) {
  db.prepare(`INSERT INTO studio_prompt_enhancements
              (id, owner_id, session_id, fingerprint, raw_message, contract_json,
               track, provider_dialect, engine_provider, fallback_used,
               override_used, retry_refinement_applied, cache_hit, latency_ms, created_at)
              VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(row.id, row.owner_id, row.session_id || null, row.fingerprint,
         row.raw_message, row.contract_json, row.track, row.provider_dialect,
         row.engine_provider, row.fallback_used ? 1 : 0, row.override_used ? 1 : 0,
         row.retry_refinement_applied ? 1 : 0, row.cache_hit ? 1 : 0,
         row.latency_ms || 0, row.created_at || now());
  db.prepare(`INSERT OR IGNORE INTO studio_prompt_cache (owner_id, fingerprint, enhancement_id, created_at)
              VALUES (?,?,?,?)`)
    .run(row.owner_id, row.fingerprint, row.id, row.created_at || now());
  return row.id;
}

/** Most recent accepted contract for a conversational session (delta merging).
 * Retry-refinement rows are excluded: they carry no brief and are pipeline
 * artifacts, not accepted user contracts. */
export function latestSessionEnhancement(db, ownerId, sessionId) {
  if (!sessionId) return null;
  return db.prepare(
    `SELECT * FROM studio_prompt_enhancements
     WHERE owner_id = ? AND session_id = ? AND cache_hit = 0 AND retry_refinement_applied = 0
     ORDER BY created_at DESC LIMIT 1`,
  ).get(ownerId, sessionId) || null;
}

/** Telemetry ledger (owner-isolated), newest first. */
export function listEnhancements(db, ownerId, { limit = 50 } = {}) {
  return db.prepare(
    `SELECT * FROM studio_prompt_enhancements
     WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?`,
  ).all(ownerId, Math.min(Math.max(1, limit), 200));
}
