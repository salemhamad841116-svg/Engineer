// ==============================================================================
// Complete Agent Audit Trail Service
// Mandatorily records every agent action, safety decision, file impact, and outcome.
// Rule: Every agent operation must be auditable with zero blind spots.
// ==============================================================================

const crypto = require('crypto');
const { get, run, all } = require('../../db/database');
const { nowIso } = require('../../utils/clock');

/**
 * Records an immutable audit log entry for any autonomous agent action.
 */
function recordAgentAudit({
  taskId = null,
  actionType,
  taskPrompt = '',
  affectedFiles = [],
  safetyDecision = 'allowed',
  details = {},
  actorId = 'autonomous_agent',
}) {
  if (!actionType) {
    throw new Error('[agentAuditService] actionType is mandatory for audit logging');
  }

  const auditId = 'aud_' + crypto.randomUUID().slice(0, 12);
  const now = nowIso();
  const normalizedFiles = Array.isArray(affectedFiles) ? affectedFiles : [String(affectedFiles)];
  const filesJson = JSON.stringify(normalizedFiles);
  const detailsJson = typeof details === 'string' ? details : JSON.stringify(details);

  try {
    // 1. Record to dedicated agent_audit_logs table
    run(
      `INSERT INTO agent_audit_logs 
       (id, task_id, timestamp, action_type, task_prompt, affected_files_json, safety_decision, details_json, actor_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      auditId,
      taskId,
      now,
      actionType,
      taskPrompt || '',
      filesJson,
      safetyDecision,
      detailsJson,
      actorId
    );

    // 2. Also log to global audit_events for platform-wide traceability
    try {
      const globalAuditId = 'evt_' + crypto.randomUUID().slice(0, 12);
      run(
        `INSERT INTO audit_events 
         (id, at, action, actor_id, actor_name, actor_role, title, outcome, detail)
         VALUES (?, ?, ?, ?, 'AutonomousAgent', 'agent', ?, ?, ?)`,
        globalAuditId,
        now,
        actionType,
        actorId,
        taskPrompt.slice(0, 100) || actionType,
        safetyDecision === 'blocked' ? 'blocked' : 'success',
        detailsJson
      );
    } catch (_) {
      // Ignore if audit_events schema lacks specific fields
    }

    return {
      auditId,
      timestamp: now,
      actionType,
      safetyDecision,
      affectedFiles: normalizedFiles,
      recorded: true,
    };
  } catch (err) {
    console.error('[agentAuditService] ❌ Failed to record audit log:', err.message);
    throw err;
  }
}

/**
 * Retrieves audit log entries matching filters.
 */
function getAgentAuditLogs({ taskId = null, actionType = null, safetyDecision = null, limit = 100 } = {}) {
  let query = 'SELECT * FROM agent_audit_logs WHERE 1=1';
  const params = [];

  if (taskId) {
    query += ' AND task_id = ?';
    params.push(taskId);
  }
  if (actionType) {
    query += ' AND action_type = ?';
    params.push(actionType);
  }
  if (safetyDecision) {
    query += ' AND safety_decision = ?';
    params.push(safetyDecision);
  }

  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(limit);

  const rows = all(query, ...params);
  return rows.map((r) => ({
    ...r,
    affectedFiles: safeJson(r.affected_files_json, []),
    details: safeJson(r.details_json, {}),
  }));
}

/**
 * Verifies that a specific action was recorded in the audit log.
 */
function verifyAuditIntegrity({ actionType, taskId = null, minTimestamp = null }) {
  let query = 'SELECT COUNT(*) as c FROM agent_audit_logs WHERE action_type = ?';
  const params = [actionType];

  if (taskId) {
    query += ' AND task_id = ?';
    params.push(taskId);
  }
  if (minTimestamp) {
    query += ' AND timestamp >= ?';
    params.push(minTimestamp);
  }

  const row = get(query, ...params);
  return (row?.c || 0) > 0;
}

function safeJson(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = {
  recordAgentAudit,
  getAgentAuditLogs,
  verifyAuditIntegrity,
};
