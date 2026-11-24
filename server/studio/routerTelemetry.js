/**
 * Layer 7 — Routing Telemetry DAL (SQLite, owner-isolated).
 *
 * Every routing decision is persisted: chosen intent, confidence, latency,
 * provider used, fallback flag, ambiguity flag, cost-block flag, and whether
 * the client later hit the 1-Click Override — the continuous-improvement
 * signal for the routing rules.
 *
 * No SQL outside DAL modules (platform rule). Table: studio_routing_telemetry
 * (migration 035).
 */
import crypto from 'node:crypto';

export function insertRouting(db, {
  ownerId, sessionId = null, intent, confidence, modelTier = null,
  provider, fallbackUsed = false, ambiguous = false, latencyMs = 0,
  costBlocked = false, contractJson = null,
}) {
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO studio_routing_telemetry
      (id, owner_id, session_id, intent, confidence, model_tier, provider,
       fallback_used, ambiguous, override_clicked, corrected_intent,
       latency_ms, cost_blocked, created_at, contract_json)
    VALUES (?,?,?,?,?,?,?,?,?,0,NULL,?,?,?,?)
  `).run(
    id, ownerId, sessionId, intent, confidence, modelTier, provider,
    fallbackUsed ? 1 : 0, ambiguous ? 1 : 0, latencyMs, costBlocked ? 1 : 0,
    new Date().toISOString(), contractJson,
  );
  return id;
}

/** 1-Click Override — flips the flag and records the corrected intent. */
export function markOverride(db, ownerId, id, correctedIntent) {
  const row = db.prepare(
    'SELECT id FROM studio_routing_telemetry WHERE id = ? AND owner_id = ?',
  ).get(id, ownerId);
  if (!row) return null;
  db.prepare(
    'UPDATE studio_routing_telemetry SET override_clicked = 1, corrected_intent = ? WHERE id = ?',
  ).run(correctedIntent, id);
  return getRouting(db, ownerId, id);
}

export function getRouting(db, ownerId, id) {
  return db.prepare(
    'SELECT * FROM studio_routing_telemetry WHERE id = ? AND owner_id = ?',
  ).get(id, ownerId) || null;
}

export function listRouting(db, ownerId, { limit = 50 } = {}) {
  return db.prepare(`
    SELECT * FROM studio_routing_telemetry
    WHERE owner_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
  `).all(ownerId, Math.min(Math.max(Number(limit) || 50, 1), 200));
}

/**
 * Session context for follow-up detection: the most recent non-ambiguous
 * routing that produced an artifact (image or UI) in this session.
 */
export function lastSessionOutputIntent(db, ownerId, sessionId) {
  if (!sessionId) return null;
  const row = db.prepare(`
    SELECT intent FROM studio_routing_telemetry
    WHERE owner_id = ? AND session_id = ? AND ambiguous = 0
      AND intent IN ('image_generate','image_edit','ui_generate','ui_edit','hybrid_ui_with_assets')
    ORDER BY created_at DESC, id DESC LIMIT 1
  `).get(ownerId, sessionId);
  return row ? row.intent : null;
}
