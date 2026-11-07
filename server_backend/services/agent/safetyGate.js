// ==============================================================================
// Safety Gate & Sandbox Isolation Service
// Guards against destructive commands, enforces sandboxing, and manages approvals.
// ==============================================================================

const path = require('path');
const crypto = require('crypto');
const { get, run, all } = require('../../db/database');
const { nowIso } = require('../../utils/clock');

// Known destructive command signatures that must NEVER execute without approval
const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-(?:r|rf|fr)\b/i,
  /\brmdir\b/i,
  /\bdrop\s+(?:table|database|schema)\b/i,
  /\btruncate\s+table\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  /\bchmod\s+-R\s+777\b/i,
  /\b(?:shutdown|reboot|poweroff|init\s+0)\b/i,
  /\bkillall\b/i,
  /\b(?:>|>>)\s*\/dev\/(?:sd|hd|nvme)/i,
  /\bcurl\b.+\|\s*(?:ba)?sh\b/i,
];

// Sensitive paths that must never be deleted or overwritten blindly
const PROTECTED_PATH_PATTERNS = [
  /^\/?etc/i,
  /^\/?var/i,
  /^\/?usr/i,
  /\.git\/(?:config|HEAD)/i,
  /data\/app\.db$/i,
  /\.env$/i,
];

/**
 * Assesses whether a planned operation is considered dangerous and requires approval.
 */
function assessOperationSafety({ actionType, command = '', filePath = '', targetEnv = 'local' }) {
  // 1. Explicit dangerous action types
  if (actionType === 'file_delete') {
    return {
      isDangerous: true,
      reason: 'حذف الملفات يتطلب موافقة صريحة من المستخدم لمنع فقدان البيانات.',
      riskLevel: 'high',
    };
  }

  if (actionType === 'deploy_production' || targetEnv === 'cloud_production') {
    return {
      isDangerous: true,
      reason: 'النشر على بيئة الإنتاج الحية يتطلب اعتماداً صريحاً لضمان الجاهزية.',
      riskLevel: 'high',
    };
  }

  if (actionType === 'schema_drop') {
    return {
      isDangerous: true,
      reason: 'حذف جداول أو حقول في قاعدة البيانات قد يؤدي إلى فقدان بيانات المستخدم.',
      riskLevel: 'critical',
    };
  }

  if (actionType === 'resource_purge') {
    return {
      isDangerous: true,
      reason: 'تطهير الموارد وملفات الكود المصدري يتطلب مراجعة المستخدم.',
      riskLevel: 'medium',
    };
  }

  // 2. Command analysis
  if (command && typeof command === 'string') {
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(command)) {
        return {
          isDangerous: true,
          reason: `الأمر يحتوي على نمط تدميري محظور تلقائياً: ${pattern.source}`,
          riskLevel: 'critical',
        };
      }
    }
  }

  // 3. Path analysis
  if (filePath && typeof filePath === 'string') {
    for (const prot of PROTECTED_PATH_PATTERNS) {
      if (prot.test(filePath)) {
        return {
          isDangerous: true,
          reason: `الملف المحدد يقع ضمن المسارات المحمية الحساسة: ${filePath}`,
          riskLevel: 'critical',
        };
      }
    }

    if (filePath.includes('..') || path.isAbsolute(filePath) && !filePath.startsWith(process.cwd())) {
      return {
        isDangerous: true,
        reason: 'محاولة الخروج من مجلد المشروع (Path Traversal Attempt)',
        riskLevel: 'critical',
      };
    }
  }

  return {
    isDangerous: false,
    reason: 'عملية آمنة تقع ضمن صلاحيات الوكيل التلقائية.',
    riskLevel: 'safe',
  };
}

/**
 * Creates an approval record in the database and puts task in waiting state.
 */
function requestUserApproval({ taskId, actionType, title, description, payload = {} }) {
  const approvalId = 'appr_' + crypto.randomUUID().slice(0, 12);
  const now = nowIso();

  run(
    `INSERT INTO agent_approvals (id, task_id, action_type, title, description, payload_json, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
    approvalId,
    taskId,
    actionType,
    title,
    description,
    JSON.stringify(payload),
    now
  );

  run(
    `UPDATE agent_tasks 
     SET status = 'waiting_approval', current_step = 'waiting_approval', updated_at = ? 
     WHERE id = ?`,
    now,
    taskId
  );

  return get('SELECT * FROM agent_approvals WHERE id = ?', approvalId);
}

/**
 * Resolves an approval request with user's decision ('approved' | 'rejected').
 */
function resolveApproval({ approvalId, decision, userNotes = '' }) {
  const approval = get('SELECT * FROM agent_approvals WHERE id = ?', approvalId);
  if (!approval) throw new Error('طلب الاعتماد غير موجود');
  if (approval.status !== 'pending') throw new Error('تم البت في هذا الطلب مسبقاً');

  const finalStatus = decision === 'approved' ? 'approved' : 'rejected';
  const now = nowIso();

  run(
    `UPDATE agent_approvals 
     SET status = ?, user_notes = ?, resolved_at = ? 
     WHERE id = ?`,
    finalStatus,
    userNotes,
    now,
    approvalId
  );

  // Resume or abort task depending on decision
  const nextTaskStatus = finalStatus === 'approved' ? 'running' : 'failed';
  run(
    `UPDATE agent_tasks 
     SET status = ?, updated_at = ? 
     WHERE id = ?`,
    nextTaskStatus,
    now,
    approval.task_id
  );

  return get('SELECT * FROM agent_approvals WHERE id = ?', approvalId);
}

/**
 * Validates that a file path is strictly within project workspace boundary.
 */
function sanitizeProjectPath(workspaceRoot, relativePath) {
  const cleanRoot = path.resolve(workspaceRoot || process.cwd());
  const resolved = path.resolve(cleanRoot, relativePath.replace(/^[/\\]+/, ''));
  if (!resolved.startsWith(cleanRoot)) {
    throw new Error(`محاولة وصول غير مصرح بها خارج حدود المشروع: ${relativePath}`);
  }
  return resolved;
}

/**
 * List pending approvals for a task or globally.
 */
function listPendingApprovals(taskId = null) {
  if (taskId) {
    return all("SELECT * FROM agent_approvals WHERE task_id = ? AND status = 'pending' ORDER BY created_at ASC", taskId);
  }
  return all("SELECT * FROM agent_approvals WHERE status = 'pending' ORDER BY created_at DESC");
}

module.exports = {
  assessOperationSafety,
  requestUserApproval,
  resolveApproval,
  sanitizeProjectPath,
  listPendingApprovals,
  DESTRUCTIVE_PATTERNS,
};
