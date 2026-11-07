// ==============================================================================
// Autonomous Coding Agent Master Coordinator (The Unified Agent Core)
// Orchestrates Autonomy, Safety Gate, Surgical Self-Healing, Persistent Memory,
// Resource Cleanup, File Management, and Verified Deployment with Auto-Rollback.
// ==============================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { get, run, all } = require('../../db/database');
const { nowIso } = require('../../utils/clock');
const { getSystemResourceMetrics, performSafeCleanup } = require('./resourceMonitor');
const { assessOperationSafety, requestUserApproval } = require('./safetyGate');
const { formulateDecisionOptions, recordTaskDecisionChoice } = require('./decisionEngine');
const { healProjectFiles } = require('./selfHealingEngine');
const { executeDeployment } = require('./deploymentService');
const { filterRelevantFilesForTask, exportProjectAsZip } = require('./fileTransferService');
const { orchestrateProject } = require('../engineer/orchestrator');
const { recordAgentAudit } = require('./agentAuditService');

/**
 * Initiates an autonomous programming task from natural language specification.
 */
async function executeAutonomousTask({
  projectId = 'proj-fintrack-erp',
  prompt = '',
  autonomyLevel = 'autonomous', // 'autonomous' | 'supervised'
  autoDeploy = false,
  deployTarget = 'local_preview',
  targetFiles = null, // optional array of file paths or { path, content } to track
  simulatePartialFailure = false, // for testing mid-task interruption
  mockResourceExhaustion = false, // for testing resource limit suspension
}) {
  const t0 = Date.now();
  const taskId = 'task_' + crypto.randomUUID().slice(0, 12);
  const now = nowIso();

  // 1. Fetch project and record initial undo snapshot
  const project = get('SELECT * FROM app_projects WHERE id = ?', projectId);
  if (!project) throw new Error('المشروع غير موجود في قاعدة البيانات.');

  // Multi-file SHA-256 snapshotting
  const fileSnapshots = {};
  if (Array.isArray(targetFiles)) {
    for (const tf of targetFiles) {
      const p = typeof tf === 'string' ? tf : tf.path;
      let initialContent = typeof tf === 'object' && tf.content !== undefined ? tf.content : null;
      if (initialContent === null) {
        const absPath = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
        if (fs.existsSync(absPath)) {
          try { initialContent = fs.readFileSync(absPath, 'utf8'); } catch (_) {}
        }
      }
      const safeContent = initialContent || '';
      const sha256 = crypto.createHash('sha256').update(safeContent).digest('hex');
      fileSnapshots[p] = { content: safeContent, sha256 };
    }
  }

  const undoSnapshot = {
    projectId,
    html: project.html || '',
    status: project.status || 'in_progress',
    files: fileSnapshots,
    timestamp: now,
  };

  const stepsLog = [
    { step: 'init', message: 'تهيئة الوكيل البرمجي المستقل وقراءة متطلبات المهمة.', at: now },
  ];

  // 2. Insert initial task record
  run(
    `INSERT INTO agent_tasks 
     (id, project_id, prompt, status, autonomy_level, current_step, steps_log_json, undo_snapshot_json, created_at, updated_at)
     VALUES (?, ?, ?, 'running', ?, 'resource_inspection', ?, ?, ?, ?)`,
    taskId,
    projectId,
    prompt,
    autonomyLevel,
    JSON.stringify(stepsLog),
    JSON.stringify(undoSnapshot),
    now,
    now
  );

  try {
    recordAgentAudit({
      taskId,
      actionType: 'task_execution',
      taskPrompt: prompt,
      affectedFiles: Object.keys(fileSnapshots),
      safetyDecision: 'allowed',
      details: { step: 'init', autonomyLevel },
    });
  } catch (_) {}

  // 3. Pre-flight Resource & Disk Check
  const resourceMetrics = getSystemResourceMetrics();
  let cleanupReport = null;

  // Check if resource limits are exceeded -> transition to 'suspended_resources' gracefully
  if (mockResourceExhaustion || (resourceMetrics.pressureLevel === 'critical' && resourceMetrics.disk.freeMb < 100)) {
    const suspendReason = 'تجاوز استهلاك الموارد الحد الحرج المسموح به — تم إيقاف المهمة تلقائياً بحالة (معلقة-للموارد).';
    stepsLog.push({
      step: 'suspended_resources',
      message: suspendReason,
      at: nowIso(),
    });

    run(
      `UPDATE agent_tasks 
       SET status = 'suspended_resources', current_step = 'suspended_resources', steps_log_json = ?, resource_metrics_json = ?, updated_at = ? 
       WHERE id = ?`,
      JSON.stringify(stepsLog),
      JSON.stringify(resourceMetrics),
      nowIso(),
      taskId
    );

    try {
      recordAgentAudit({
        taskId,
        actionType: 'task_execution',
        taskPrompt: prompt,
        affectedFiles: [],
        safetyDecision: 'blocked',
        details: { status: 'suspended_resources', reason: suspendReason, resourceMetrics },
      });
    } catch (_) {}

    return {
      taskId,
      status: 'suspended_resources',
      message: suspendReason,
      resourceMetrics,
      stepsLog,
    };
  }

  if (resourceMetrics.pressureLevel !== 'normal') {
    stepsLog.push({
      step: 'resource_cleanup',
      message: `رصد ضغط في مساحة التخزين أو الذاكرة (${resourceMetrics.pressureLevel}) — بدء تنظيف الكاش الآمن تلقائياً.`,
      at: nowIso(),
    });
    cleanupReport = performSafeCleanup({ workspaceRoot: process.cwd() });
    stepsLog.push({
      step: 'resource_cleanup_done',
      message: cleanupReport.message,
      at: nowIso(),
    });
  } else {
    stepsLog.push({
      step: 'resources_verified',
      message: `فحص الموارد سليم: الذاكرة متوفرة بنسبة ${100 - resourceMetrics.memory.usagePercent}% والمساحة كافية.`,
      at: nowIso(),
    });
  }

  // 4. Safety Check on Prompt / Action
  const safety = assessOperationSafety({
    actionType: prompt.toLowerCase().includes('delete') ? 'file_delete' : 'code_edit',
    command: prompt,
    prompt,
    taskId,
  });

  if (safety.blocked) {
    stepsLog.push({
      step: 'security_blocked',
      message: `تم حظر المهمة فوراً لأسباب أمنية مشددة: ${safety.reason}`,
      at: nowIso(),
    });

    run(
      `UPDATE agent_tasks 
       SET status = 'failed', current_step = 'security_blocked', steps_log_json = ?, updated_at = ? 
       WHERE id = ?`,
      JSON.stringify(stepsLog),
      nowIso(),
      taskId
    );

    return {
      taskId,
      status: 'failed',
      blocked: true,
      safety,
      stepsLog,
    };
  }

  if (safety.isDangerous && (autonomyLevel === 'supervised' || safety.requiresApproval)) {
    // Escalate to user approval
    const approval = requestUserApproval({
      taskId,
      actionType: 'destructive_command',
      title: 'طلب موافقة أمنية لتنفيذ عملية حساسة',
      description: safety.reason,
      payload: { prompt, safety },
    });

    stepsLog.push({
      step: 'approval_required',
      message: `تم تعليق المهمة بانتظار موافقة المستخدم: ${safety.reason}`,
      at: nowIso(),
    });

    run(
      `UPDATE agent_tasks 
       SET status = 'waiting_approval', current_step = 'waiting_approval', steps_log_json = ?, resource_metrics_json = ?, updated_at = ? 
       WHERE id = ?`,
      JSON.stringify(stepsLog),
      JSON.stringify(resourceMetrics),
      nowIso(),
      taskId
    );

    return {
      taskId,
      status: 'waiting_approval',
      approvalId: approval.id,
      safety,
      stepsLog,
    };
  }

  // 5. Formulation of Architectural Decisions (if project-level fork detected)
  const isArchitectural = prompt.toLowerCase().includes('بنية') || prompt.toLowerCase().includes('هيكل') || prompt.toLowerCase().includes('architecture');
  let decisionBlock = null;
  if (isArchitectural) {
    decisionBlock = formulateDecisionOptions({
      decisionType: 'architecture',
      prompt,
    });
    stepsLog.push({
      step: 'options_presented',
      message: 'تقديم خيارات معمارية بالمزايا والعيوب للمستخدم لاختيار الأنسب.',
      at: nowIso(),
    });
  }

  // 6. Autonomous Code Generation & Execution
  stepsLog.push({
    step: 'code_generation',
    message: 'البدء المستقل في هندسة وتوليد الأكواد المعيارية.',
    at: nowIso(),
  });

  let orchResult;
  try {
    orchResult = await orchestrateProject({
      projectId,
      prompt,
      actor: 'AutonomousCodingAgent',
    });
  } catch (err) {
    // If orchestrator caught errors, prepare for self-healing
    orchResult = {
      status: 'failed',
      testReport: { status: 'failed', consoleErrors: [err.message] },
      files: {},
    };
  }

  // 7. Self-Healing & Closed-Loop Auto-Repair (if errors present)
  let healingResult = null;
  if (orchResult.status === 'failed' || orchResult.testReport?.status === 'failed') {
    stepsLog.push({
      step: 'self_healing_initiated',
      message: 'اكتشاف أخطاء تشغيل — تفعيل محرك التعافي الذاتي والتنقل الجراحي لسطر الخطأ.',
      at: nowIso(),
    });

    healingResult = await healProjectFiles({
      files: orchResult.files,
      initialError: orchResult.testReport?.consoleErrors?.[0] || 'Unknown Runtime Error',
      requirements: orchResult.plan?.requirements || [],
      projectId,
      prompt,
    });

    stepsLog.push({
      step: 'self_healing_complete',
      message: healingResult.resolved
        ? `نجح التعافي الذاتي في ${healingResult.totalAttempts} محاولات جراحية.`
        : `تعذر التعافي التام: ${healingResult.exhaustedExplanation?.summary}`,
      at: nowIso(),
    });
  }

  const finalStatus = (orchResult.status === 'verified' || healingResult?.resolved) ? 'completed' : 'failed';

  // 8. Deployment Phase (if verified and requested)
  let deployResult = null;
  if (finalStatus === 'completed' && autoDeploy) {
    stepsLog.push({
      step: 'deploying',
      message: `بدء نشر المشروع على منصة ${deployTarget} مع فحص الصحة التلقائي.`,
      at: nowIso(),
    });

    deployResult = await executeDeployment({
      projectId,
      taskId,
      targetPlatform: deployTarget,
    });

    stepsLog.push({
      step: 'deployment_status',
      message: deployResult.message,
      at: nowIso(),
    });
  }

  const totalDurationMs = Date.now() - t0;
  stepsLog.push({
    step: 'completed',
    message: finalStatus === 'completed'
      ? `اكتملت المهمة البرمجية بنجاح تام في ${Math.round(totalDurationMs / 1000)} ثانية.`
      : 'انتهت المهمة مع وجود ملاحظات تتطلب مراجعة.',
    at: nowIso(),
  });

  // 9. Update Database Task Record
  run(
    `UPDATE agent_tasks 
     SET status = ?, current_step = 'done', steps_log_json = ?, resource_metrics_json = ?, deployment_record_json = ?, updated_at = ? 
     WHERE id = ?`,
    finalStatus,
    JSON.stringify(stepsLog),
    JSON.stringify({ ...resourceMetrics, cleanupReport }),
    JSON.stringify(deployResult || {}),
    nowIso(),
    taskId
  );

  return {
    taskId,
    status: finalStatus,
    durationMs: totalDurationMs,
    orchestration: orchResult,
    selfHealing: healingResult,
    deployment: deployResult,
    resourceMetrics,
    cleanupReport,
    decisions: decisionBlock,
    stepsLog,
  };
}

/**
 * Reverts all code and project state changes made during an autonomous task.
 */
function undoAutonomousTask(taskId) {
  const task = get('SELECT * FROM agent_tasks WHERE id = ?', taskId);
  if (!task) throw new Error('المهمة غير موجودة');

  // Prevent Double-Undo
  if (task.status === 'rolled_back') {
    return {
      success: false,
      alreadyRolledBack: true,
      taskId,
      message: 'تم التراجع عن هذه المهمة مسبقاً، وتم منع التراجع المزدوج (Double-Undo Prevented).',
    };
  }

  let snapshot = null;
  try {
    snapshot = JSON.parse(task.undo_snapshot_json);
  } catch (_) {}

  if (!snapshot || (!snapshot.html && !snapshot.files)) {
    throw new Error('لا تتوفر لقطة تراجع صالحة لهذه المهمة.');
  }

  const now = nowIso();
  const restoredFiles = [];

  // Restore multi-file state if recorded
  if (snapshot.files && typeof snapshot.files === 'object') {
    for (const [relPath, fileData] of Object.entries(snapshot.files)) {
      try {
        const absPath = path.isAbsolute(relPath) ? relPath : path.resolve(process.cwd(), relPath);
        if (fileData && fileData.content !== undefined) {
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, fileData.content, 'utf8');
        }
        restoredFiles.push(relPath);
      } catch (err) {
        console.warn(`[autonomousAgent] Could not restore file ${relPath}:`, err.message);
      }
    }
  }

  if (snapshot.html) {
    run(
      'UPDATE app_projects SET html = ?, status = ?, updated_at = ? WHERE id = ?',
      snapshot.html,
      snapshot.status || 'in_progress',
      now,
      task.project_id
    );
  }

  run(
    "UPDATE agent_tasks SET status = 'rolled_back', current_step = 'rolled_back', updated_at = ? WHERE id = ?",
    now,
    taskId
  );

  try {
    recordAgentAudit({
      taskId,
      actionType: 'undo_executed',
      taskPrompt: task.prompt,
      affectedFiles: restoredFiles.length > 0 ? restoredFiles : ['project_html'],
      safetyDecision: 'auto_rolled_back',
      details: { restoredFilesCount: restoredFiles.length, projectId: task.project_id },
    });
  } catch (_) {}

  return {
    success: true,
    taskId,
    projectId: task.project_id,
    revertedAt: now,
    restoredFiles,
    message: 'تم التراجع الفوري عن تعديلات المهمة بنجاح واستعادة الحالة السابقة.',
  };
}

/**
 * Retrieves full task status and history.
 */
function getAutonomousTask(taskId) {
  const row = get('SELECT * FROM agent_tasks WHERE id = ?', taskId);
  if (!row) throw new Error('المهمة غير موجودة');

  const approvals = all('SELECT * FROM agent_approvals WHERE task_id = ? ORDER BY created_at DESC', taskId);
  const deployments = all('SELECT * FROM agent_deployments WHERE task_id = ? ORDER BY created_at DESC', taskId);

  return {
    ...row,
    stepsLog: safeJson(row.steps_log_json, []),
    decisions: safeJson(row.decisions_json, []),
    errorContext: safeJson(row.error_context_json, {}),
    resourceMetrics: safeJson(row.resource_metrics_json, {}),
    deploymentRecord: safeJson(row.deployment_record_json, {}),
    approvals,
    deployments,
  };
}

function safeJson(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = {
  executeAutonomousTask,
  undoAutonomousTask,
  getAutonomousTask,
};
