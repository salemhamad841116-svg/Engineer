// ==============================================================================
// Safety Gate & Sandbox Isolation Service
// Guards against destructive commands, enforces sandboxing, and manages approvals.
// ==============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { get, run, all } = require('../../db/database');
const { nowIso } = require('../../utils/clock');
const { recordAgentAudit } = require('./agentAuditService');

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

// Sensitive paths that must never be deleted, read, or overwritten blindly
const PROTECTED_PATH_PATTERNS = [
  /^\/?etc/i,
  /^\/?var/i,
  /^\/?usr/i,
  /\.git\/(?:config|HEAD)/i,
  /(?:^|[/\\])(?:\.data|data)[/\\](?:app\.db|.*\.db)$/i,
  /(?:^|[/\\])\.env(?:\.local|\.production|\.development)?$/i,
  /id_rsa/i,
];

function stripArabicDiacritics(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/[\u064B-\u065F\u0670]/g, '');
}

// Natural language indirect deletion patterns
const NL_DELETION_VERBS = /(?:احذف|حذف|مسح|إزالة|تطهير|نظف|تنظيف|أفرغ|إفراغ|\b(?:delete|remove|clean|purge|erase|wipe|truncate|clear|drop)\b)/i;
const NL_DATA_TARGETS = /(?:مجلد\s+(?:البيانات|data)|data|\bdatabase\b|قاعدة\s+البيانات|سجلات|ملفات|\brecords\b|\btables\b|جداول)/i;

// Secret key & .env exfiltration intents
const SECRET_EXFILTRATION_PATTERNS = [
  /(?:أرسل|اعرض|اطبع|اقرأ|استخرج|send|print|show|cat|read|export|dump).*(?:\.env|env|مفاتيح|أسرار|secret|api[_-]?key|process\.env)/i,
  /\b(?:cat|less|head|tail|more|type)\s+(?:\.\/)?\.env\b/i,
  /\bprocess\.env\b/i,
];

// Adversarial prompt injection keywords
const PROMPT_INJECTION_OVERRIDE_PATTERNS = [
  /(?:تجاهل\s+(?:تعليمات\s+)?السلامة|ignore\s+(?:previous\s+)?(?:safety\s+)?instructions|bypass\s+safety|override\s+safety|jailbreak|تخطى\s+الأمان)/i,
];

/**
 * Assesses whether a planned operation is considered dangerous and requires approval.
 */
function assessOperationSafety({ actionType, command = '', filePath = '', prompt = '', targetEnv = 'local', taskId = null }) {
  const unifiedText = `${prompt} ${command} ${filePath}`.trim();
  const normalizedText = stripArabicDiacritics(unifiedText);

  // 1. Prompt Injection Neutralization: Detect but do not allow override
  let injectionDetected = false;
  for (const injPattern of PROMPT_INJECTION_OVERRIDE_PATTERNS) {
    if (injPattern.test(normalizedText)) {
      injectionDetected = true;
      break;
    }
  }

  // 2. Secret Key & .env Exfiltration Check (Immediate Block + Audit Log)
  const isTargetingEnv = filePath && /(?:^|[/\\])\.env(?:\.[a-z0-9]+)?$/i.test(filePath);
  let isSecretExfiltration = false;
  for (const exfilPattern of SECRET_EXFILTRATION_PATTERNS) {
    if (exfilPattern.test(normalizedText) || isTargetingEnv) {
      isSecretExfiltration = true;
      break;
    }
  }

  if (isSecretExfiltration) {
    const reason = 'محاولة استخراج أسرار أو قراءة ملفات البيئة الحساسة (.env / Secrets Exfiltration Blocked)';
    try {
      recordAgentAudit({
        taskId,
        actionType: 'security_blocked',
        taskPrompt: unifiedText,
        affectedFiles: filePath ? [filePath] : ['.env'],
        safetyDecision: 'blocked',
        details: { reason, rule: 'SECRET_KEY_EXTRACTION_PREVENTED', injectionDetected },
      });
    } catch (_) {}

    return {
      isDangerous: true,
      blocked: true,
      requiresApproval: false,
      reason,
      riskLevel: 'critical',
      injectionDetected,
    };
  }

  // 3. Path Traversal & Obfuscation Analysis
  if (filePath && typeof filePath === 'string') {
    let decodedPath = filePath;
    try {
      decodedPath = decodeURIComponent(filePath);
    } catch (_) {}

    // Check for traversal sequences
    const hasTraversal = decodedPath.includes('..') ||
      /[/\\]\.\.[/\\]/.test(decodedPath) ||
      decodedPath.startsWith('../') ||
      decodedPath.startsWith('..\\') ||
      (path.isAbsolute(decodedPath) && !decodedPath.startsWith(process.cwd()));

    if (hasTraversal) {
      const reason = `محاولة الخروج من مجلد المشروع (Path Traversal Attempt: ${filePath})`;
      try {
        recordAgentAudit({
          taskId,
          actionType: 'security_blocked',
          taskPrompt: unifiedText,
          affectedFiles: [filePath],
          safetyDecision: 'blocked',
          details: { reason, rule: 'PATH_TRAVERSAL_PREVENTED', decodedPath },
        });
      } catch (_) {}

      return {
        isDangerous: true,
        blocked: true,
        requiresApproval: false,
        reason,
        riskLevel: 'critical',
        injectionDetected,
      };
    }

    for (const prot of PROTECTED_PATH_PATTERNS) {
      if (prot.test(decodedPath)) {
        return {
          isDangerous: true,
          requiresApproval: true,
          reason: `الملف المحدد يقع ضمن المسارات المحمية الحساسة: ${decodedPath}`,
          riskLevel: 'critical',
          injectionDetected,
        };
      }
    }
  }

  // 4. Natural Language Indirect Deletion Bypass Detection
  if (NL_DELETION_VERBS.test(normalizedText) && NL_DATA_TARGETS.test(normalizedText)) {
    const reason = 'طلب حذف أو تطهير بيانات بلغة طبيعية غير مباشرة يتطلب موافقة يدوية صريحة ولا يمكن تنفيذه تلقائياً.';
    try {
      recordAgentAudit({
        taskId,
        actionType: 'safety_decision',
        taskPrompt: unifiedText,
        affectedFiles: filePath ? [filePath] : ['data/'],
        safetyDecision: 'flagged_dangerous',
        details: { reason, rule: 'NATURAL_LANGUAGE_DATA_PURGE_GUARD' },
      });
    } catch (_) {}

    return {
      isDangerous: true,
      requiresApproval: true,
      reason,
      riskLevel: 'critical',
      injectionDetected,
    };
  }

  // 5. Explicit dangerous action types
  if (actionType === 'file_delete') {
    return {
      isDangerous: true,
      requiresApproval: true,
      reason: 'حذف الملفات يتطلب موافقة صريحة من المستخدم لمنع فقدان البيانات.',
      riskLevel: 'high',
    };
  }

  if (actionType === 'deploy_production' || targetEnv === 'cloud_production') {
    return {
      isDangerous: true,
      requiresApproval: true,
      reason: 'النشر على بيئة الإنتاج الحية يتطلب اعتماداً صريحاً لضمان الجاهزية.',
      riskLevel: 'high',
    };
  }

  if (actionType === 'schema_drop') {
    return {
      isDangerous: true,
      requiresApproval: true,
      reason: 'حذف جداول أو حقول في قاعدة البيانات قد يؤدي إلى فقدان بيانات المستخدم.',
      riskLevel: 'critical',
    };
  }

  if (actionType === 'resource_purge') {
    return {
      isDangerous: true,
      requiresApproval: true,
      reason: 'تطهير الموارد وملفات الكود المصدري يتطلب مراجعة المستخدم.',
      riskLevel: 'medium',
    };
  }

  // 6. Direct Command Analysis
  if (command && typeof command === 'string') {
    for (const pattern of DESTRUCTIVE_PATTERNS) {
      if (pattern.test(command)) {
        return {
          isDangerous: true,
          requiresApproval: true,
          reason: `الأمر يحتوي على نمط تدميري محظور تلقائياً: ${pattern.source}`,
          riskLevel: 'critical',
        };
      }
    }

    // 7. Nested Script Deep Inspection (e.g. npm run <script> or executing shell script)
    const npmMatch = command.match(/\bnpm\s+(?:run\s+)?([a-z0-9_\-:]+)/i);
    if (npmMatch) {
      const scriptName = npmMatch[1];
      try {
        const pkgPath = path.resolve(process.cwd(), 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          const scriptBody = pkg.scripts?.[scriptName] || '';
          for (const pattern of DESTRUCTIVE_PATTERNS) {
            if (pattern.test(scriptBody)) {
              return {
                isDangerous: true,
                requiresApproval: true,
                reason: `الأمر يستدعي سكربتاً (${scriptName}) يحتوي داخلياً على أمر تدميري: ${scriptBody}`,
                riskLevel: 'critical',
              };
            }
          }
        }
      } catch (_) {}
    }

    // Inspect direct local script file invocation (e.g. ./setup.sh or bash test.sh)
    const fileExecMatch = command.match(/(?:bash|sh|node|zsh)\s+['"]?([^;&|]+\.(?:sh|js|ts|mjs|cjs))['"]?/i);
    if (fileExecMatch) {
      const rawTarget = fileExecMatch[1].trim();
      const scriptFilePath = path.isAbsolute(rawTarget) ? rawTarget : path.resolve(process.cwd(), rawTarget);
      if (fs.existsSync(scriptFilePath)) {
        try {
          const content = fs.readFileSync(scriptFilePath, 'utf8');
          for (const pattern of DESTRUCTIVE_PATTERNS) {
            if (pattern.test(content)) {
              return {
                isDangerous: true,
                requiresApproval: true,
                reason: `فحص عميق للسكربت: الملف المنفذ (${path.basename(scriptFilePath)}) يحتوي داخلياً على تعليمات تدميرية محظورة تلقائياً.`,
                riskLevel: 'critical',
                injectionDetected,
              };
            }
          }
        } catch (_) {}
      }
    }
  }

  return {
    isDangerous: false,
    reason: 'عملية آمنة تقع ضمن صلاحيات الوكيل التلقائية.',
    riskLevel: 'safe',
    injectionDetected,
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

  try {
    recordAgentAudit({
      taskId,
      actionType: 'approval_requested',
      taskPrompt: title || description,
      affectedFiles: payload?.filePath ? [payload.filePath] : [],
      safetyDecision: 'waiting_approval',
      details: { approvalId, actionType, description, payload },
    });
  } catch (_) {}

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

  try {
    recordAgentAudit({
      taskId: approval.task_id,
      actionType: 'approval_resolved',
      taskPrompt: approval.title || approval.description,
      affectedFiles: approval.file_path ? [approval.file_path] : [],
      safetyDecision: finalStatus,
      details: { approvalId, decision: finalStatus, userNotes },
    });
  } catch (_) {}

  return get('SELECT * FROM agent_approvals WHERE id = ?', approvalId);
}

/**
 * Validates that a file path is strictly within project workspace boundary.
 */
function sanitizeProjectPath(workspaceRoot, relativePath) {
  const cleanRoot = path.resolve(workspaceRoot || process.cwd());
  let decoded = String(relativePath || '');
  try {
    decoded = decodeURIComponent(decoded);
  } catch (_) {}

  if (decoded.includes('\0') || decoded.includes('..') || /[/\\]\.\.[/\\]/.test(decoded) || decoded.startsWith('../') || decoded.startsWith('..\\')) {
    throw new Error(`محاولة وصول غير مصرح بها خارج حدود المشروع: ${relativePath}`);
  }

  const resolved = path.resolve(cleanRoot, decoded.replace(/^[/\\]+/, ''));
  if (!resolved.startsWith(cleanRoot) || resolved === cleanRoot) {
    if (resolved === cleanRoot && decoded !== '' && decoded !== '.') {
      throw new Error(`محاولة وصول غير مصرح بها خارج حدود المشروع: ${relativePath}`);
    }
  }
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
