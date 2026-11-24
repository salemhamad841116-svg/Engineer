/**
 * clarifierStore.js — Layer 9 persistence: clarifier sessions (append/update)
 * and the SHA-256 cache for dynamically generated clarifier cards.
 *
 * Same two-table lesson as the Prompt Enhancer: sessions are the telemetry
 * ledger; the cache table maps a canonical input hash to a rendered card so
 * repeated similar requests replay with 0 LLM calls.
 */

import crypto from 'node:crypto';

export function clarifierFingerprint({ normalizedMessage, intent, missingSlots, verbosityMode }) {
  const canonical = JSON.stringify({
    m: String(normalizedMessage || ''),
    i: intent || null,
    s: [...(missingSlots || [])].sort(),
    v: verbosityMode || 'smart',
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function insertSession(db, row) {
  const id = `clr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
  db.prepare(
    `INSERT INTO studio_clarifier_sessions
     (id, owner_id, project_id, routing_log_id, stage, source, verbosity_mode,
      questions_json, suppressed_slots_json, selected_answers_json, custom_text_input,
      status, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 'pending', ?, ?)`
  ).run(
    id, row.ownerId, row.projectId || null, row.routingLogId || null,
    row.stage || 'pre_gen', row.source, row.verbosityMode || 'smart',
    JSON.stringify(row.questions || []), JSON.stringify(row.suppressedSlots || []),
    Math.round(row.latencyMs || 0), new Date().toISOString()
  );
  return id;
}

export function getSession(db, ownerId, id) {
  return db.prepare(
    'SELECT * FROM studio_clarifier_sessions WHERE id = ? AND owner_id = ?'
  ).get(id, ownerId);
}

export function resolveSession(db, ownerId, id, { status, selectedAnswers, customText }) {
  const result = db.prepare(
    `UPDATE studio_clarifier_sessions
     SET status = ?, selected_answers_json = ?, custom_text_input = ?, resolved_at = ?
     WHERE id = ? AND owner_id = ?`
  ).run(
    status,
    selectedAnswers ? JSON.stringify(selectedAnswers) : null,
    customText || null,
    new Date().toISOString(), id, ownerId
  );
  return result.changes > 0;
}

export function lookupCache(db, inputHash) {
  const row = db.prepare(
    'SELECT * FROM studio_clarifier_cache WHERE input_hash = ?'
  ).get(inputHash);
  if (row) {
    db.prepare(
      'UPDATE studio_clarifier_cache SET hit_count = hit_count + 1, last_used_at = ? WHERE input_hash = ?'
    ).run(new Date().toISOString(), inputHash);
  }
  return row || null;
}

export function insertCache(db, { inputHash, intent, missingSlots, questions, latencyMs }) {
  db.prepare(
    `INSERT OR IGNORE INTO studio_clarifier_cache
     (input_hash, intent, missing_slots_json, questions_json, hit_count, latency_ms, created_at, last_used_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(
    inputHash, intent || 'unknown', JSON.stringify(missingSlots || []),
    JSON.stringify(questions || []), Math.round(latencyMs || 0),
    new Date().toISOString(), new Date().toISOString()
  );
}

export function listSessions(db, ownerId, { limit = 50 } = {}) {
  return db.prepare(
    'SELECT * FROM studio_clarifier_sessions WHERE owner_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(ownerId, limit);
}
