// ==============================================================================
// server_backend/services/agent/modelImprovementPipeline.js
// Model Improvement Pipeline — prepares APPROVED, high-quality training
// examples from real platform activity, exportable as JSONL (SFT format)
// for the external training engine.
//
// Quality contract:
//   - A build example is captured ONLY when verification passed AND files
//     actually changed. Failing or no-op builds are never captured.
//   - A fix example is captured ONLY for lessons the memory accepted as
//     verified (tests passed).
//   - Nothing is exported until a human approves it (approved = 1).
//   - Secrets are redacted at capture time AND again at export time
//     (defense in depth).
//   - Everything is tenant-scoped (owner_id).
// ==============================================================================
'use strict';

const crypto = require('crypto');
const { nowIso } = require('../../utils/clock');

const MAX_INSTRUCTION_CHARS = 2000;
const MAX_FILE_CHARS = 3000;
const MAX_FILES_PER_ENTRY = 3;
const MAX_OUTPUT_CHARS = 9000;

function newId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

// --------------------------------------------------------------------------
// Secret redaction — same families the release packaging scan enforces,
// plus generic key=value credential shapes.
// --------------------------------------------------------------------------
const SECRET_PATTERNS = [
  /AIza[0-9A-Za-z_-]{20,}/g,
  /sk-[0-9A-Za-z]{20,}/g,
  /sk-ant-[0-9A-Za-z_-]{20,}/g,
  /xox[baprs]-[0-9A-Za-z-]{10,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/g,
  /Bearer\s+[0-9A-Za-z._-]{16,}/g,
  /((?:api[_-]?key|apikey|secret|password|passwd|token|access[_-]?token)["'\s]*[:=]["'\s]*)["'][^"'\s]{8,}["']/gi,
];

function redactSecrets(text) {
  let out = String(text || '');
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (m, g1) => (g1 ? g1 + '"<REDACTED>"' : '<REDACTED>'));
  }
  return out;
}

/**
 * Captures a successful build as a candidate training example.
 * @returns {{captured:boolean, id?:string, reason?:string, qualityScore?:number}}
 */
function captureBuildExample({ db, projectId = null, ownerId, prompt, filesModified = [], files = [], verification = null }) {
  if (!ownerId) return { captured: false, reason: 'ownerId required (tenant isolation).' };
  if (!verification || verification.allPassed !== true) {
    return { captured: false, reason: 'Build verification did not pass — only proven builds enter the dataset.' };
  }
  if (!Array.isArray(filesModified) || filesModified.length === 0) {
    return { captured: false, reason: 'No files changed — a no-op build teaches nothing.' };
  }

  // Deterministic quality score: ratio of passed tests when tests exist,
  // otherwise 1.0 (verification passed with no test suite) — recorded honestly.
  const results = Array.isArray(verification.testResults) ? verification.testResults : [];
  const total = results.length;
  const passed = results.filter((t) => t && (t.passed === true || t.status === 'passed')).length;
  const qualityScore = total > 0 ? Math.round((passed / total) * 100) / 100 : 1.0;

  const byPath = new Map((files || []).map((f) => [String(f.path || f.name || '').replace(/^\/+/, ''), f]));
  const artifacts = [];
  for (const p of filesModified.slice(0, MAX_FILES_PER_ENTRY)) {
    const norm = String(p).replace(/^\/+/, '');
    const f = byPath.get(norm) || byPath.get(String(p));
    if (!f) continue;
    artifacts.push({ path: norm, content: redactSecrets(String(f.content || '')).slice(0, MAX_FILE_CHARS) });
  }
  if (artifacts.length === 0) {
    return { captured: false, reason: 'Modified file contents not found in project snapshot.' };
  }

  const id = newId('dse');
  db.prepare(
    `INSERT INTO improvement_dataset_entries
       (id, kind, project_id, owner_id, instruction, input_context, output, quality_score, approved, approved_at, created_at)
     VALUES (?, 'successful_build', ?, ?, ?, ?, ?, ?, 0, NULL, ?)`
  ).run(
    id,
    projectId,
    ownerId,
    redactSecrets(String(prompt || '')).slice(0, MAX_INSTRUCTION_CHARS),
    `files_modified: ${filesModified.join(', ')}`.slice(0, 500),
    redactSecrets(JSON.stringify(artifacts)).slice(0, MAX_OUTPUT_CHARS),
    qualityScore,
    nowIso()
  );
  return { captured: true, id, qualityScore };
}

/**
 * Captures a verified fix (called right after agentMemory accepts a lesson).
 * @returns {{captured:boolean, id?:string, reason?:string}}
 */
function captureFixExample({ db, projectId = null, ownerId, errorSignature = '', rootCause = '', provenFix = '', codeBefore = '', codeAfter = '' }) {
  if (!ownerId) return { captured: false, reason: 'ownerId required (tenant isolation).' };
  if (!String(provenFix || '').trim() && !String(codeAfter || '').trim()) {
    return { captured: false, reason: 'Empty fix — nothing to learn.' };
  }

  const id = newId('dse');
  db.prepare(
    `INSERT INTO improvement_dataset_entries
       (id, kind, project_id, owner_id, instruction, input_context, output, quality_score, approved, approved_at, created_at)
     VALUES (?, 'verified_fix', ?, ?, ?, ?, ?, 1.0, 0, NULL, ?)`
  ).run(
    id,
    projectId,
    ownerId,
    redactSecrets(`Fix this error: ${errorSignature}`).slice(0, MAX_INSTRUCTION_CHARS),
    redactSecrets(`Root cause: ${rootCause}\nBroken code:\n${codeBefore}`).slice(0, MAX_OUTPUT_CHARS / 2),
    redactSecrets(`${provenFix}\n\nFixed code:\n${codeAfter}`).slice(0, MAX_OUTPUT_CHARS),
    nowIso()
  );
  return { captured: true, id };
}

/** Lists dataset entries for one tenant (never across tenants). */
function listEntries({ db, ownerId, approved = null, limit = 100 }) {
  if (!ownerId) return [];
  const cap = Math.min(Math.max(1, limit | 0), 500);
  if (approved === null || approved === undefined) {
    return db
      .prepare(
        `SELECT id, kind, project_id, instruction, quality_score, approved, approved_at, created_at
           FROM improvement_dataset_entries WHERE owner_id = ?
           ORDER BY created_at DESC LIMIT ?`
      )
      .all(ownerId, cap);
  }
  return db
    .prepare(
      `SELECT id, kind, project_id, instruction, quality_score, approved, approved_at, created_at
         FROM improvement_dataset_entries WHERE owner_id = ? AND approved = ?
         ORDER BY created_at DESC LIMIT ?`
    )
    .all(ownerId, approved ? 1 : 0, cap);
}

/**
 * Approves entries for export. Scoped by owner — approving someone else's
 * entry is a no-op (0 rows), which the caller can detect honestly.
 * @returns {{approved:number}}
 */
function approveEntries({ db, ownerId, ids = [] }) {
  if (!ownerId || !Array.isArray(ids) || ids.length === 0) return { approved: 0 };
  const stmt = db.prepare(
    'UPDATE improvement_dataset_entries SET approved = 1, approved_at = ? WHERE id = ? AND owner_id = ?'
  );
  let count = 0;
  const now = nowIso();
  for (const id of ids.slice(0, 200)) {
    const res = stmt.run(now, String(id), ownerId);
    count += res && res.changes ? res.changes : 0;
  }
  return { approved: count };
}

/**
 * Exports APPROVED entries only, as JSONL in standard SFT shape:
 *   {"instruction","input","output","kind","quality_score","meta":{...}}
 * Redaction runs again here (defense in depth).
 */
function exportApprovedDataset({ db, ownerId }) {
  if (!ownerId) return { count: 0, jsonl: '' };
  const rows = db
    .prepare(
      `SELECT id, kind, project_id, instruction, input_context, output, quality_score, created_at
         FROM improvement_dataset_entries
        WHERE owner_id = ? AND approved = 1
        ORDER BY created_at ASC`
    )
    .all(ownerId);

  const exportedAt = nowIso();
  const lines = rows.map((r) =>
    JSON.stringify({
      instruction: redactSecrets(r.instruction),
      input: redactSecrets(r.input_context || ''),
      output: redactSecrets(r.output),
      kind: r.kind,
      quality_score: r.quality_score,
      meta: {
        source: 'engineer-platform',
        entry_id: r.id,
        project_id: r.project_id,
        captured_at: r.created_at,
        exported_at: exportedAt,
      },
    })
  );
  return { count: lines.length, jsonl: lines.join('\n') };
}

/** Aggregate counters for dashboards / oversight. */
function pipelineStats({ db, ownerId }) {
  if (!ownerId) return { total: 0, approved: 0, pending: 0, builds: 0, fixes: 0 };
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN approved = 1 THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN approved = 0 THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN kind = 'successful_build' THEN 1 ELSE 0 END) AS builds,
              SUM(CASE WHEN kind = 'verified_fix' THEN 1 ELSE 0 END) AS fixes
         FROM improvement_dataset_entries WHERE owner_id = ?`
    )
    .get(ownerId);
  return {
    total: row.total || 0,
    approved: row.approved || 0,
    pending: row.pending || 0,
    builds: row.builds || 0,
    fixes: row.fixes || 0,
  };
}

module.exports = {
  captureBuildExample,
  captureFixExample,
  listEntries,
  approveEntries,
  exportApprovedDataset,
  pipelineStats,
  redactSecrets,
};
