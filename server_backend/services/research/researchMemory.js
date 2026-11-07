// ==============================================================================
// Research Session Memory & Persistence Engine
// Handles: Session checkpoints, pause/resume, feedback recording, and offline caching.
// ==============================================================================

const crypto = require('node:crypto');
const { get, all, run } = require('../../db/database');
const { nowIso } = require('../../utils/clock');

/**
 * Creates a new research session entry in SQLite.
 */
function createSession({ userId = null, title = 'جلسة بحث معرفي', query, researchLevel = 'deep', isOffline = 1 }) {
  const sessionId = 'rs_' + crypto.randomUUID().slice(0, 12);
  const now = nowIso();

  run(`
    INSERT INTO research_sessions (
      id, user_id, title, query, research_level, status, current_stage,
      stages_json, plan_json, findings_json, quality_gate_json,
      is_offline, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'running', '1_understanding', '[]', '{}', '[]', '{}', ?, ?, ?)
  `,
    sessionId, userId, title, query, researchLevel, isOffline ? 1 : 0, now, now
  );

  return getSession(sessionId);
}

/**
 * Retrieves a session with parsed JSON objects.
 */
function getSession(sessionId) {
  const row = get('SELECT * FROM research_sessions WHERE id = ?', sessionId);
  if (!row) return null;

  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    query: row.query,
    researchLevel: row.research_level,
    status: row.status,
    currentStage: row.current_stage,
    stages: safeJson(row.stages_json, []),
    plan: safeJson(row.plan_json, {}),
    findings: safeJson(row.findings_json, []),
    qualityGate: safeJson(row.quality_gate_json, {}),
    answerMarkdown: row.answer_markdown || '',
    summary: row.summary || '',
    uncertainties: row.uncertainties || '',
    tokenCount: row.token_count || 0,
    costEstimate: row.cost_estimate || 0.0,
    isOffline: Boolean(row.is_offline),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Updates an ongoing session with new stage progress, findings, or final results.
 */
function updateSession(sessionId, updates = {}) {
  const existing = getSession(sessionId);
  if (!existing) return null;

  const now = nowIso();
  const status = updates.status || existing.status;
  const currentStage = updates.currentStage || existing.currentStage;
  const stages = JSON.stringify(updates.stages || existing.stages);
  const plan = JSON.stringify(updates.plan || existing.plan);
  const findings = JSON.stringify(updates.findings || existing.findings);
  const qualityGate = JSON.stringify(updates.qualityGate || existing.qualityGate);
  const answerMarkdown = updates.answerMarkdown !== undefined ? updates.answerMarkdown : existing.answerMarkdown;
  const summary = updates.summary !== undefined ? updates.summary : existing.summary;
  const uncertainties = updates.uncertainties !== undefined ? updates.uncertainties : existing.uncertainties;
  const tokenCount = updates.tokenCount !== undefined ? updates.tokenCount : existing.tokenCount;
  const costEstimate = updates.costEstimate !== undefined ? updates.costEstimate : existing.costEstimate;

  run(`
    UPDATE research_sessions
    SET status = ?, current_stage = ?, stages_json = ?, plan_json = ?,
        findings_json = ?, quality_gate_json = ?, answer_markdown = ?,
        summary = ?, uncertainties = ?, token_count = ?, cost_estimate = ?,
        updated_at = ?
    WHERE id = ?
  `,
    status, currentStage, stages, plan, findings, qualityGate,
    answerMarkdown, summary, uncertainties, tokenCount, costEstimate,
    now, sessionId
  );

  return getSession(sessionId);
}

/**
 * Records user feedback on a session or citation.
 */
function recordFeedback({ sessionId, citationId = null, feedbackType, userComment = '' }) {
  const fbId = 'fb_' + crypto.randomUUID().slice(0, 10);
  const now = nowIso();

  run(`
    INSERT INTO research_feedback (id, session_id, citation_id, feedback_type, user_comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    fbId, sessionId, citationId, feedbackType, userComment, now
  );

  return { id: fbId, sessionId, citationId, feedbackType, userComment, createdAt: now };
}

function safeJson(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  recordFeedback,
};
