/**
 * engineerMasterSuite.test.js
 * Comprehensive Acceptance Suite for Engineer Master System Prompt v1.0 & Tool Registry
 *
 * Verifies all 12 Core Acceptance Criteria (T01 - T12):
 * - T01: Intent CHAT -> Natural conversation, zero tool execution
 * - T02: Intent BUILD -> End-to-end scaffolding, build, preview live, acceptance tests pass
 * - T03: Intent EDIT -> Minimal surgical patch, 100% preservation of unrelated code
 * - T04: Intent DATA -> Schema migration & verified persistence round-trip
 * - T05: Intent TEST -> Automated browser & DOM verification with evidence record
 * - T06: Intent DEBUG -> Runtime diagnosis & honest failure reporting for broken code
 * - T07: Intent AUTOMATE -> Persistent job scheduling in SQLite engineering_jobs
 * - T08: Intent REPORT -> Real metrics from database with provenance & timeframe (zero fake data)
 * - T09: Security & Permissions -> Reject unauthorized tenant access with 403 & audit log
 * - T10: Interrupt Long Build -> State paused & resumed without duplicate writes
 * - T11: Intent DEPLOY -> Pre-release checks, explicit confirmation gate, deployment evidence
 * - T12: Preview Gate -> Strict blank canvas (#09090B) until 100% live readiness
 */

const assert = require('node:assert');
const crypto = require('node:crypto');
const { getDb } = require('../db/database');
const { classifyMasterIntent, MASTER_SYSTEM_PROMPT_V1 } = require('../services/ai/engineerMasterPrompt');
const { ToolRegistry, defaultToolRegistry } = require('../services/engineer/toolRegistry');
const { TruthfulnessEngine, TRUTHFULNESS_STATUSES } = require('../services/engineer/truthfulnessEngine');
const { evaluatePreviewReadiness } = require('../services/quality/livePreviewGate');
const { diagnoseRuntimeError, ERROR_TAXONOMY } = require('../services/execution/runtimeDebugger');
const { surgicalPatch, computePatchDiff } = require('../services/execution/surgicalPatchEngine');
const { BackgroundJobQueue } = require('../services/execution/backgroundJobQueue');

console.log('================================================================');
console.log('🚀 RUNNING ENGINEER MASTER SYSTEM PROMPT v1.0 ACCEPTANCE SUITE (T01–T12)');
console.log('================================================================\n');

const db = getDb();
const toolRegistry = new ToolRegistry(db);
const truthEngine = new TruthfulnessEngine(toolRegistry);
const jobQueue = new BackgroundJobQueue(db);

let passedCount = 0;
const totalTests = 12;

async function runTest(testId, name, fn) {
  process.stdout.write(`▶️ [${testId}] ${name}... `);
  try {
    await fn();
    passedCount++;
    console.log('✅ PASSED');
  } catch (err) {
    console.log('❌ FAILED: ' + err.message);
    throw err;
  }
}

(async () => {
  // ----------------------------------------------------
  // T01: Intent CHAT -> natural reply, zero tool executions
  // ----------------------------------------------------
  await runTest('T01', 'Intent CHAT -> Natural reply, zero tool executions', async () => {
    const prompt = 'هلا، كيف حالك؟';
    const intent = classifyMasterIntent(prompt);
    assert.strictEqual(intent, 'CHAT', 'Prompt classified as CHAT');

    const res = await truthEngine.processMasterRequest({ prompt, db });
    assert.strictEqual(res.intent, 'CHAT');
    assert.strictEqual(res.executedToolsCount, 0, 'Zero tools executed on greeting');
    assert.strictEqual(res.evidenceRecords.length, 0, 'Zero evidence records generated for chat');
    assert.ok(res.userMessage.includes('أهلاً') || res.userMessage.includes('مهندس'), 'Natural friendly Arabic greeting');
    assert.ok(!res.userMessage.includes('Chief Architect'), 'Internal agent labels completely shielded');
    assert.ok(!res.userMessage.includes('toolRegistry'), 'Internal tool names shielded');
  });

  // ----------------------------------------------------
  // T02: Intent BUILD -> real project, successful build, live preview, passing acceptance tests
  // ----------------------------------------------------
  await runTest('T02', 'Intent BUILD -> Real project, successful build, live preview, passing tests', async () => {
    const prompt = 'ابنِ تطبيق مهام احترافي مع قائمة وإضافة وفلترة';
    const intent = classifyMasterIntent(prompt);
    assert.strictEqual(intent, 'BUILD', 'Prompt classified as BUILD');

    const res = await truthEngine.processMasterRequest({
      prompt,
      projectId: 'proj_build_test_' + Date.now().toString(36),
      userId: 'test_user_build',
      db
    });

    assert.strictEqual(res.intent, 'BUILD');
    assert.strictEqual(res.state, TRUTHFULNESS_STATUSES.VERIFIED, 'Build state is VERIFIED');
    assert.ok(res.executedToolsCount >= 3, 'Multiple execution tools invoked');
    assert.ok(res.evidenceRecords.length >= 3, 'Evidence records captured for plan, runtime, and tests');
    assert.strictEqual(res.preview.previewState, 'live_iframe', 'Live preview active');
    assert.strictEqual(res.preview.isAppServerRunning, true, 'App server confirmed running');
    assert.strictEqual(res.preview.toolbarVisible, true, 'Preview toolbar visible');
    assert.ok(res.userMessage.includes('اكتمل تنفيذ المميزات') || res.userMessage.includes('المعاينة'), 'Truthful completion message');
    assert.ok(!res.userMessage.includes('Chief Architect'), 'Internal agent roles shielded from user');
  });

  // ----------------------------------------------------
  // T03: Intent EDIT -> minimal surgical patch, unrelated features preserved
  // ----------------------------------------------------
  await runTest('T03', 'Intent EDIT -> Minimal surgical patch, unrelated features preserved', async () => {
    const prompt = 'عدّل لون زر الحفظ إلى الأخضر';
    const intent = classifyMasterIntent(prompt);
    assert.strictEqual(intent, 'EDIT', 'Prompt classified as EDIT');

    const originalCode = `import React from 'react';
export default function TaskManager() {
  const [filter, setFilter] = React.useState('all');
  return (
    <div className="p-6">
      <h1 className="text-xl font-bold">مهامي</h1>
      <button id="save-btn" className="bg-blue-600 text-white px-4 py-2">حفظ التغييرات</button>
      <button id="cancel-btn" className="bg-gray-200 text-gray-800 px-4 py-2">إلغاء</button>
    </div>
  );
}`;

    const res = await truthEngine.processMasterRequest({
      prompt,
      projectId: 'proj_edit_test',
      files: { 'src/App.tsx': originalCode },
      db
    });

    assert.strictEqual(res.intent, 'EDIT');
    assert.strictEqual(res.state, TRUTHFULNESS_STATUSES.VERIFIED);
    const patchedContent = res.data.patchedContent;
    assert.ok(patchedContent.includes('bg-emerald-600'), 'Color patched surgically to emerald');
    assert.ok(patchedContent.includes('cancel-btn'), 'Cancel button completely preserved');
    assert.ok(patchedContent.includes('setFilter'), 'Unrelated React state completely preserved');
    assert.ok(res.data.diff.changedLines.length > 0, 'Computed diff shows precise modified line');
  });

  // ----------------------------------------------------
  // T04: Intent DATA -> real database, successful write and read
  // ----------------------------------------------------
  await runTest('T04', 'Intent DATA -> Real database schema & roundtrip persistence verified', async () => {
    const prompt = 'اربط الحفظ بقاعدة البيانات';
    const intent = classifyMasterIntent(prompt);
    assert.strictEqual(intent, 'DATA', 'Prompt classified as DATA');

    const res = await truthEngine.processMasterRequest({
      prompt,
      projectId: 'proj_data_test',
      files: {
        'src/App.tsx': 'export default function App() { return <div>Tasks App</div>; }'
      },
      db
    });

    assert.strictEqual(res.intent, 'DATA');
    assert.strictEqual(res.state, TRUTHFULNESS_STATUSES.VERIFIED);
    assert.ok(res.data.tablesCreated && res.data.tablesCreated.length > 0, 'Database tables created for entities');
    assert.ok(res.data.apiRoutesGenerated && res.data.apiRoutesGenerated.length > 0, 'REST endpoints auto-wired');
    assert.ok(res.evidenceRecords.some(e => e.evidenceRef && e.evidenceRef.includes('db_migration')), 'Migration evidence ref logged');
  });

  // ----------------------------------------------------
  // T05: Intent TEST -> real browser and DOM testing with evidence record
  // ----------------------------------------------------
  await runTest('T05', 'Intent TEST -> Real browser and DOM testing with evidence record', async () => {
    const prompt = 'اختبر إضافة وحذف مهمة';
    const intent = classifyMasterIntent(prompt);
    assert.strictEqual(intent, 'TEST', 'Prompt classified as TEST');

    const res = await truthEngine.processMasterRequest({
      prompt,
      projectId: 'proj_test_suite',
      files: {
        'src/App.tsx': '<!DOCTYPE html><html dir="rtl"><head><title>App</title></head><body><div id="root">App</div></body></html>'
      },
      db
    });

    assert.strictEqual(res.intent, 'TEST');
    assert.strictEqual(res.state, TRUTHFULNESS_STATUSES.VERIFIED);
    assert.ok(res.executedToolsCount >= 2, 'Executed acceptance tests and browser tests');
    assert.ok(res.data.browserRun.passed >= 3, 'Browser checks passed');
    assert.ok(res.evidenceRecords.some(e => e.evidenceRef && e.evidenceRef.startsWith('browser_run_')), 'Browser evidence ref recorded');
  });

  // ----------------------------------------------------
  // T06: Intent DEBUG -> runtime diagnosis and honest failure reporting
  // ----------------------------------------------------
  await runTest('T06', 'Intent DEBUG -> Runtime diagnosis & honest failure reporting for broken handler', async () => {
    const brokenError = {
      message: 'TypeError: Cannot read properties of undefined (reading "title")',
      stack: 'TypeError: Cannot read properties of undefined (reading "title")\n    at TaskItem (src/components/TaskItem.tsx:18:24)\n    at renderWithHooks (node_modules/react-dom:123:45)'
    };

    const diag = diagnoseRuntimeError(brokenError);
    assert.strictEqual(diag.category, ERROR_TAXONOMY.REFERENCE_OR_TYPE_ERROR, 'Classified error accurately');
    assert.strictEqual(diag.location.file, 'src/components/TaskItem.tsx', 'Pinpointed source file');
    assert.strictEqual(diag.location.line, 18, 'Pinpointed exact error line');
    assert.ok(diag.repairPrescription.includes('null-coalescing') || diag.repairPrescription.includes('missing identifier'), 'Precise prescription');

    // Test truthfulness engine refusal to declare success when unhealed defects remain
    const unhealedRes = truthEngine.validateTaskCompletion({
      taskId: 'task_broken',
      projectId: 'proj_broken',
      acceptanceCriteria: ['TaskItem renders without TypeError'],
      evidenceRecords: [
        { tool: 'tests.run', resultStatus: 'FAILED', data: { failedTests: 1 } }
      ]
    });

    assert.strictEqual(unhealedRes.status, TRUTHFULNESS_STATUSES.FAILED, 'Strictly refused to declare success for failing tests');
    assert.strictEqual(unhealedRes.isComplete, false, 'isComplete must be false');
    assert.ok(unhealedRes.failedCriteria.length > 0, 'Recorded failed criteria');
  });

  // ----------------------------------------------------
  // T07: Intent AUTOMATE -> persistent job scheduling in SQLite engineering_jobs
  // ----------------------------------------------------
  await runTest('T07', 'Intent AUTOMATE -> Persistent job scheduling in SQLite engineering_jobs', async () => {
    const prompt = 'أرسل تقريراً أسبوعياً بملخص المهام';
    const intent = classifyMasterIntent(prompt);
    assert.strictEqual(intent, 'AUTOMATE', 'Prompt classified as AUTOMATE');

    const res = await truthEngine.processMasterRequest({
      prompt,
      projectId: 'proj_automate_test',
      userId: 'user_auto_1',
      db
    });

    assert.strictEqual(res.intent, 'AUTOMATE');
    assert.strictEqual(res.state, TRUTHFULNESS_STATUSES.VERIFIED);
    assert.ok(res.data.jobId, 'Generated persistent jobId');

    // Verify row actually exists in SQLite engineering_jobs
    const jobRow = db.prepare('SELECT * FROM engineering_jobs WHERE id = ?').get(res.data.jobId);
    assert.ok(jobRow, 'Job persisted in engineering_jobs database table');
    assert.strictEqual(jobRow.status, 'queued');
    assert.strictEqual(jobRow.project_id, 'proj_automate_test');
    assert.strictEqual(jobRow.user_id, 'user_auto_1');
  });

  // ----------------------------------------------------
  // T08: Intent REPORT -> real metrics with provenance & timeframe (zero fake data)
  // ----------------------------------------------------
  await runTest('T08', 'Intent REPORT -> Real metrics from database with provenance & timeframe', async () => {
    const prompt = 'أعطني تقرير الاستخدام الشهري والتقييمات';
    const intent = classifyMasterIntent(prompt);
    assert.strictEqual(intent, 'REPORT', 'Prompt classified as REPORT');

    const res = await truthEngine.processMasterRequest({
      prompt,
      projectId: 'proj_report_test',
      db
    });

    assert.strictEqual(res.intent, 'REPORT');
    assert.strictEqual(res.state, TRUTHFULNESS_STATUSES.VERIFIED);
    assert.strictEqual(res.data.provenance, 'sqlite://production_tables', 'Verified provenance from sqlite');
    assert.strictEqual(res.data.timeframe, 'monthly', 'Verified timeframe parameter');
    assert.strictEqual(typeof res.data.activeProjects, 'number', 'Real integer count of active projects');
    assert.strictEqual(typeof res.data.totalBuilds, 'number', 'Real integer count of total builds');
    assert.strictEqual(typeof res.data.evaluationsRun, 'number', 'Real integer count of evaluations');
    assert.ok(!res.userMessage.includes('$50,000') && !res.userMessage.includes('10,000 users'), 'Zero invented or fabricated numbers');
  });

  // ----------------------------------------------------
  // T09: Security & Permissions -> reject unauthorized tenant access with 403 & audit log
  // ----------------------------------------------------
  await runTest('T09', 'Security & Permissions -> Reject unauthorized tenant access with 403 & audit log', async () => {
    // Seed user and project owned by user_victim_owner
    const victimUserId = 'usr_victim_owner_' + Date.now().toString(36);
    const victimProjId = 'proj_victim_' + Date.now().toString(36);
    
    db.prepare(`
      INSERT INTO users (id, email, name, role, status, created_at)
      VALUES (?, ?, 'Victim Owner', 'supervisor', 'active', datetime('now'))
    `).run(victimUserId, victimUserId + '@test.local');

    db.prepare(`
      INSERT INTO app_projects (id, user_id, name, slug, created_at, updated_at)
      VALUES (?, ?, 'Victim Project', ?, datetime('now'), datetime('now'))
    `).run(victimProjId, victimUserId, 'slug-' + victimProjId);

    // Attacker attempts to access or mutate victim project
    const res = await truthEngine.processMasterRequest({
      prompt: 'عدل الكود الخاص بي',
      projectId: victimProjId,
      userId: 'user_attacker_intruder',
      role: 'user',
      db
    });

    assert.strictEqual(res.httpStatus, 403, 'HTTP 403 returned for unauthorized tenant access');
    assert.strictEqual(res.state, TRUTHFULNESS_STATUSES.FAILED);
    assert.strictEqual(res.executedToolsCount, 0, 'Zero tools executed on forbidden project');

    // Verify security event logged in agent_audit_logs
    const auditRow = db.prepare("SELECT * FROM agent_audit_logs WHERE action_type = 'unauthorized_project_access' ORDER BY id DESC LIMIT 1").get();
    assert.ok(auditRow, 'Security violation persisted in agent_audit_logs');
    assert.strictEqual(auditRow.safety_decision, 'DENIED');
  });

  // ----------------------------------------------------
  // T10: Interrupt Long Build -> state paused & resumed without duplicate writes
  // ----------------------------------------------------
  await runTest('T10', 'Interrupt Long Build -> State paused & resumed without duplicate writes', async () => {
    const job = jobQueue.enqueueJob({
      projectId: 'proj_interrupt_test',
      userId: 'user_builder',
      jobType: 'full_stack_build',
      payload: { target: 'production' }
    });

    assert.ok(job.jobId, 'Job enqueued');

    // Step 1: Checkpoint scaffold
    jobQueue.updateCheckpoint(job.jobId, 'scaffold_files', 35, { filesCount: 5 });

    // Step 2: Interrupt / Pause build
    const paused = jobQueue.pauseJob(job.jobId, 'User paused the build via UI');
    assert.strictEqual(paused, true, 'Job paused successfully');

    const pausedDbRow = jobQueue.getJob(job.jobId);
    assert.strictEqual(pausedDbRow.status, 'paused', 'Job status updated to paused in engineering_jobs');

    // Step 3: Resume without duplicate writes
    const resumeInfo = jobQueue.resumeJob(job.jobId);
    assert.strictEqual(resumeInfo.canResume, true, 'Job is marked resumable');
    assert.ok(resumeInfo.completedSteps.includes('scaffold_files'), 'Previously completed step preserved');
    assert.strictEqual(resumeInfo.progress, 35, 'Progress maintained at 35% without starting from zero');
  });

  // ----------------------------------------------------
  // T11: Intent DEPLOY -> pre-release checks, confirmation gate, deployment evidence
  // ----------------------------------------------------
  await runTest('T11', 'Intent DEPLOY -> Pre-release checks, confirmation gate, deployment evidence', async () => {
    // Seed project with valid HTML for health probe
    db.prepare(`
      INSERT OR REPLACE INTO app_projects (id, user_id, name, slug, html, status, created_at, updated_at)
      VALUES ('proj_deploy_test', 'usr_test_admin', 'Deploy Test', 'deploy-test', '<!DOCTYPE html><html dir="rtl"><head><title>Live App</title></head><body>Live Ready</body></html>', 'completed', datetime('now'), datetime('now'))
    `).run();

    const prompt = 'انشر التطبيق على بيئة الإنتاج';
    const intent = classifyMasterIntent(prompt);
    assert.strictEqual(intent, 'DEPLOY', 'Prompt classified as DEPLOY');

    // Attempt 1: Unconfirmed deployment request -> Blocked with WAITING_APPROVAL
    const unconfirmedRes = await truthEngine.processMasterRequest({
      prompt,
      projectId: 'proj_deploy_test',
      userId: 'usr_test_admin',
      role: 'admin',
      confirmed: false,
      preApproved: false,
      db
    });

    assert.strictEqual(unconfirmedRes.state, TRUTHFULNESS_STATUSES.WAITING_APPROVAL, 'Approval gate blocks unconfirmed publish');
    assert.strictEqual(unconfirmedRes.approvalRequired, true, 'approvalRequired flag set');
    assert.strictEqual(unconfirmedRes.executedToolsCount, 0, 'Zero deployments made without confirmation');
    assert.ok(unconfirmedRes.userMessage.includes('موافقتك') || unconfirmedRes.userMessage.includes('تأكيدك'), 'Confirmation prompt message');

    // Attempt 2: Explicitly confirmed deployment request -> Proceed with release checks & publish
    const confirmedRes = await truthEngine.processMasterRequest({
      prompt,
      projectId: 'proj_deploy_test',
      userId: 'usr_test_admin',
      role: 'admin',
      confirmed: true,
      db
    });

    assert.strictEqual(confirmedRes.state, TRUTHFULNESS_STATUSES.VERIFIED, 'Confirmed deployment is VERIFIED');
    assert.strictEqual(confirmedRes.executedToolsCount, 2, 'Pre-release checks and publication executed');
    assert.ok(confirmedRes.evidenceRecords.some(e => e.evidenceRef && e.evidenceRef.startsWith('deployment_')), 'Deployment evidence captured');
  });

  // ----------------------------------------------------
  // T12: Preview Gate -> strictly blank canvas (#09090B) until 100% live readiness
  // ----------------------------------------------------
  await runTest('T12', 'Preview Gate -> Strictly blank canvas (#09090B) until 100% live readiness', async () => {
    // Condition A: Build still generating
    const condA = evaluatePreviewReadiness({ isGenerating: true });
    assert.strictEqual(condA.previewState, 'blank_canvas', 'State is blank_canvas while generating');
    assert.strictEqual(condA.canvasClass, 'bg-[#09090B]', 'Enforces strict #09090B canvas');
    assert.strictEqual(condA.renderedElementCount, 0, 'Zero rendered elements/mock buttons');
    assert.strictEqual(condA.toolbarVisible, false, 'Toolbar invisible during generation');

    // Condition B: Runtime health probe failed
    const condB = evaluatePreviewReadiness({ buildStatus: 'success', healthHttpCode: 502, testsPassed: true });
    assert.strictEqual(condB.previewState, 'blank_canvas');
    assert.strictEqual(condB.canvasClass, 'bg-[#09090B]');
    assert.strictEqual(condB.isAppServerRunning, false);

    // Condition C: Tests have not passed
    const condC = evaluatePreviewReadiness({ buildStatus: 'success', healthHttpCode: 200, testsPassed: false });
    assert.strictEqual(condC.previewState, 'blank_canvas');
    assert.strictEqual(condC.canvasClass, 'bg-[#09090B]');

    // Condition D: 100% Green & Verified
    const condD = evaluatePreviewReadiness({ buildStatus: 'success', healthHttpCode: 200, testsPassed: true, isGenerating: false });
    assert.strictEqual(condD.previewState, 'live_iframe', 'Unlocks live iframe only when 100% green');
    assert.strictEqual(condD.isAppServerRunning, true);
    assert.strictEqual(condD.toolbarVisible, true);
    assert.strictEqual(condD.indicators.statusBadge, 'Live');
  });

  // Summary
  console.log('\n================================================================');
  console.log(`🏆 ALL ${passedCount}/${totalTests} ACCEPTANCE TESTS (T01–T12) PASSED 100% GREEN!`);
  console.log('================================================================\n');
})();
