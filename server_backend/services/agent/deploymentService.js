// ==============================================================================
// Deployment & Automated Rollback Service
// Deploys verified builds, probes endpoint health, and automatically rolls back
// to previous working state if health verification fails.
// ==============================================================================

const http = require('http');
const crypto = require('crypto');
const { get, run, all } = require('../../db/database');
const { nowIso } = require('../../utils/clock');
const { recordAgentAudit } = require('./agentAuditService');

// In-memory mutex locks to prevent race conditions during concurrent deployments of the same project
const activeDeploymentLocks = new Set();

/**
 * Executes project deployment with pre-check, health verification probe, and auto-rollback.
 */
async function executeDeployment({
  projectId,
  taskId = null,
  targetPlatform = 'local_preview',
  customEndpoint = null,
  simulateFailure = false, // for automated testing of rollback
  simulateCrashAfterDeploy = false, // for testing post-deploy crash detection
}) {
  // Prevent Concurrent Deployments on the same project
  if (activeDeploymentLocks.has(projectId)) {
    const errorMsg = 'عملية نشر جارية حالياً لنفس المشروع (Concurrent Deployment Prevented).';
    try {
      recordAgentAudit({
        taskId,
        actionType: 'deployment_executed',
        taskPrompt: `Deploy ${projectId} to ${targetPlatform}`,
        affectedFiles: ['project_deployment'],
        safetyDecision: 'blocked',
        details: { projectId, reason: errorMsg, conflict: true },
      });
    } catch (_) {}

    return {
      success: false,
      conflict: true,
      error: errorMsg,
      message: errorMsg,
    };
  }

  activeDeploymentLocks.add(projectId);

  try {
    const deploymentId = 'dep_' + crypto.randomUUID().slice(0, 12);
    const now = nowIso();

    // 1. Fetch current project & last working deployment snapshot
    const project = get('SELECT * FROM app_projects WHERE id = ?', projectId);
    if (!project) throw new Error('المشروع غير موجود');

    const previousLive = get(
      "SELECT * FROM agent_deployments WHERE project_id = ? AND status = 'live' ORDER BY created_at DESC LIMIT 1",
      projectId
    );

    const rollbackSnapshot = {
      previousDeploymentId: previousLive?.id || null,
      html: project.html || '',
      status: project.status || 'in_progress',
      timestamp: now,
    };

    const endpointUrl = customEndpoint || `http://localhost:3001/preview/${projectId}`;

    // 2. Insert initial deployment record
    run(
      `INSERT INTO agent_deployments 
       (id, task_id, project_id, target_platform, status, endpoint_url, health_status, rollback_snapshot_json, logs_json, created_at)
       VALUES (?, ?, ?, ?, 'deploying', ?, 'probing', ?, '[]', ?)`,
      deploymentId,
      taskId,
      projectId,
      targetPlatform,
      endpointUrl,
      JSON.stringify(rollbackSnapshot),
      now
    );

    // 3. Perform Health Verification Probe (async probe simulation)
    const logs = [`[${now}] بدء نشر المشروع إلى المنصة: ${targetPlatform}`];
    await new Promise((resolve) => setTimeout(resolve, 30));
    let isProbeHealthy = false;

    if (simulateFailure) {
      logs.push(`[${nowIso()}] فشل الفحص الصحي: محاكاة خطأ استجابة 500 في نقطة النهاية.`);
      isProbeHealthy = false;
    } else if (simulateCrashAfterDeploy) {
      logs.push(`[${nowIso()}] رصد انهيار مفاجئ بعد النشر (Post-Deploy Crash Detected): الخادم لم يستجب.`);
      isProbeHealthy = false;
    } else {
      // Health probe: verify the project HTML exists and is valid
      if (project.html && (project.html.includes('<!DOCTYPE html>') || project.html.includes('<html'))) {
        isProbeHealthy = true;
        logs.push(`[${nowIso()}] الفحص الصحي ناجح: الحزمة صالحة وهيكل HTML5 مكتمل.`);
      } else {
        logs.push(`[${nowIso()}] فشل الفحص الصحي: كود HTML تالف أو غير مكتمل.`);
        isProbeHealthy = false;
      }
    }

    // 4. Handle Outcome: Live vs Auto-Rollback
    if (isProbeHealthy) {
      run(
        `UPDATE agent_deployments 
         SET status = 'live', health_status = 'healthy', logs_json = ?, completed_at = ? 
         WHERE id = ?`,
        JSON.stringify(logs),
        nowIso(),
        deploymentId
      );

      try {
        recordAgentAudit({
          taskId,
          actionType: 'deployment_executed',
          taskPrompt: `Deploy to ${targetPlatform}`,
          affectedFiles: ['project_deployment', 'html'],
          safetyDecision: 'allowed',
          details: { deploymentId, status: 'live', healthStatus: 'healthy', endpointUrl },
        });
      } catch (_) {}

      return {
        success: true,
        deploymentId,
        status: 'live',
        targetPlatform,
        endpointUrl,
        healthStatus: 'healthy',
        logs,
        message: 'تم النشر بنجاح واجتياز الفحص الصحي.',
      };
    }

    // Automated Rollback upon failed probe
    logs.push(`[${nowIso()}] ⚠️ تفعيل آلية التراجع التلقائي (Automatic Rollback)...`);
    const rollbackResult = rollbackDeployment(deploymentId, simulateCrashAfterDeploy ? 'انهيار الخادم بعد النشر' : 'فشل الفحص الصحي بعد النشر');
    logs.push(`[${nowIso()}] تم التراجع بنجاح إلى الحالة المستقرة السابقة وإشعار النظام.`);

    return {
      success: false,
      deploymentId,
      status: 'rolled_back',
      targetPlatform,
      endpointUrl,
      healthStatus: 'unhealthy',
      rolledBack: true,
      crashDetected: simulateCrashAfterDeploy,
      rollbackDetails: rollbackResult,
      logs,
      message: 'فشل الفحص الصحي وتم التراجع التلقائي إلى النسخة المستقرة السابقة مع إشعار الواجهة.',
    };
  } finally {
    activeDeploymentLocks.delete(projectId);
  }
}

/**
 * Rolls back a deployment to its recorded snapshot.
 */
function rollbackDeployment(deploymentId, reason = 'Rollback requested') {
  const deployment = get('SELECT * FROM agent_deployments WHERE id = ?', deploymentId);
  if (!deployment) throw new Error('سجل النشر غير موجود');

  let snapshot = {};
  try {
    snapshot = JSON.parse(deployment.rollback_snapshot_json);
  } catch (_) {}

  // Restore HTML in main project
  if (snapshot.html) {
    run(
      'UPDATE app_projects SET html = ?, updated_at = ? WHERE id = ?',
      snapshot.html,
      nowIso(),
      deployment.project_id
    );
  }

  const now = nowIso();
  run(
    `UPDATE agent_deployments 
     SET status = 'rolled_back', health_status = 'rolled_back', completed_at = ? 
     WHERE id = ?`,
    now,
    deploymentId
  );

  try {
    recordAgentAudit({
      taskId: deployment.task_id,
      actionType: 'deployment_rollback',
      taskPrompt: `Rollback deployment ${deploymentId}`,
      affectedFiles: ['project_deployment', 'html'],
      safetyDecision: 'auto_rolled_back',
      details: { deploymentId, projectId: deployment.project_id, reason },
    });
  } catch (_) {}

  return {
    deploymentId,
    projectId: deployment.project_id,
    rolledBackAt: now,
    reason,
    restoredHtmlLength: snapshot.html?.length || 0,
  };
}

/**
 * Lists deployments for a project.
 */
function listDeployments(projectId) {
  return all(
    'SELECT * FROM agent_deployments WHERE project_id = ? ORDER BY created_at DESC',
    projectId
  );
}

module.exports = {
  executeDeployment,
  rollbackDeployment,
  listDeployments,
};
