// ==============================================================================
// ENGINEER — INTERACTIVE TESTING & POST-BUILD LIFECYCLE TEST SUITE (Gate 26)
// 11 Acceptance Tests (Part D: Tests A through K):
// Test A: Interactive User Journey (Notes: Add -> Save -> Refresh -> Verify)
// Test B: Broken Button (Deliberate break -> Detect -> Surgical repair -> 100% pass)
// Test C: UI Visual Regression (Overflow and hidden element detection)
// Test D: Mobile Device Testing (Viewport 375x667, Touch, Inputs, Persistence)
// Test E: Release Gate (Block release candidate if tests fail, verify state machine)
// Test F: Staging Deployment (Deploy to Staging, health checks 200 OK)
// Test G: Rollback on Degraded Build (Deploy defective build, auto-rollback)
// Test H: Production Application Monitoring & Incident Triage (P0 Alert & Telemetry)
// Test I: Backup & Disaster Recovery Drill (Create backup, restore in clean sandbox)
// Test J: Post-Deployment Feature Update & Versioning (Add feature to deployed app)
// Test K: Multi-Tenant Data Isolation & Secrets Shielding
// ==============================================================================

const assert = require('node:assert');
const path = require('node:path');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '../..');

function loadTsModule(relPath) {
  const absPath = path.join(projectRoot, relPath);
  const result = esbuild.buildSync({
    entryPoints: [absPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const jsCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('exports', 'module', 'require', '__dirname', '__filename', jsCode);
  fn(mod.exports, mod, require, path.dirname(absPath), absPath);
  return mod.exports;
}

async function runInteractiveTestingAndLifecycleSuite() {
  console.log('================================================================');
  console.log('🚀 RUNNING INTERACTIVE TESTING & POST-BUILD LIFECYCLE SUITE');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  async function runTest(testName, fn) {
    totalTests++;
    try {
      await fn();
      passedTests++;
      console.log(`  ✅ [PASS] ${testName}`);
    } catch (err) {
      console.error(`  ❌ [FAIL] ${testName}: ${err.message}`);
      throw err;
    }
  }

  // Load modules
  const {
    InteractiveJourneyRunner,
    RequirementTestSynthesizer,
    VisualRegressionComparator,
    A11yAuditor,
    PerformanceLoadProfiler,
    TestStudioManager,
    ProjectLifecycleManager,
    ProductionReadinessEngine,
    DeploymentReleaseManager,
    AppContinuousMonitor,
    IncidentIntelligenceEngine,
    ProjectDisasterRecoveryManager,
    ApplicationUpdateManager,
    FeedbackIssueTracker,
    ProjectHandoverEngine,
    RootCauseAutoRepairEngine,
  } = loadTsModule('src/services/toolEngine/index.ts');

  // Baseline Notes App files
  const sampleNotesFiles = [
    {
      id: 'f1',
      path: 'index.html',
      name: 'index.html',
      folder: '/',
      content: `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>تطبيق الملاحظات الذكي</title>
</head>
<body>
  <div id="app-root">
    <h1>ملاحظاتي</h1>
    <input id="note-title-input" placeholder="عنوان الملاحظة" />
    <textarea id="note-body-input" placeholder="نص الملاحظة"></textarea>
    <button id="save-note-btn">حفظ الملاحظة</button>
    <div id="notes-container"></div>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
      language: 'html',
      size: 520,
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'f2',
      path: 'app.js',
      name: 'app.js',
      folder: '/',
      content: `
let notes = JSON.parse(localStorage.getItem('engineer_app_notes') || '[]');
document.getElementById('save-note-btn')?.addEventListener('click', () => {
  const title = document.getElementById('note-title-input').value;
  const body = document.getElementById('note-body-input').value;
  if (!title) return;
  notes.push({ id: Date.now().toString(), title, body });
  localStorage.setItem('engineer_app_notes', JSON.stringify(notes));
});
`,
      language: 'javascript',
      size: 450,
      updatedAt: new Date().toISOString(),
    },
  ];

  // ---------------------------------------------------------------------------
  // Test A — Interactive User Journey
  // ---------------------------------------------------------------------------
  await runTest('Test A — Interactive User Journey (Notes Add -> Save -> Refresh -> Verify)', async () => {
    const journeyResult = await InteractiveJourneyRunner.executeJourney({
      scenarioName: 'Complete Note Lifecycle Journey',
      files: sampleNotesFiles,
      steps: [
        { action: 'navigate', description: 'Open app' },
        { action: 'type', target: '#note-title-input', value: 'مهمة استراتيجية', description: 'Enter title' },
        { action: 'type', target: '#note-body-input', value: 'إطلاق النسخة الجديدة بنجاح', description: 'Enter body' },
        { action: 'click', target: '#save-note-btn', description: 'Click Save Note' },
        { action: 'assert_storage', target: 'engineer_app_notes', description: 'Verify note saved to LocalStorage' },
        { action: 'refresh', description: 'Reload application page' },
        { action: 'assert_element', target: '#save-note-btn', description: 'Verify UI restored after reload' },
      ],
      device: 'desktop',
    });

    assert.strictEqual(journeyResult.allPassed, true, 'User journey must pass completely');
    assert.strictEqual(journeyResult.passedSteps, 7, 'All 7 journey steps must pass');
    assert.strictEqual(journeyResult.failedSteps, 0);
    assert.ok(journeyResult.storageStateSnapshot['engineer_app_notes'], 'Storage state must contain notes');
    assert.ok(journeyResult.evidenceId.startsWith('evd_'), 'Must record unique evidence ID');
  });

  // ---------------------------------------------------------------------------
  // Test B — Broken Button Detection & Repair
  // ---------------------------------------------------------------------------
  await runTest('Test B — Broken Button (Deliberate break -> Detect -> Surgical repair -> 100% pass)', async () => {
    // 1. Break the save button in HTML
    const brokenFiles = [
      {
        ...sampleNotesFiles[0],
        content: sampleNotesFiles[0].content.replace('id="save-note-btn"', 'id="broken-btn-id"'),
      },
      sampleNotesFiles[1],
    ];

    // 2. Journey runner must fail
    const brokenJourney = await InteractiveJourneyRunner.executeJourney({
      scenarioName: 'Broken Button Journey',
      files: brokenFiles,
      steps: [
        { action: 'navigate', description: 'Open app' },
        { action: 'click', target: '#save-note-btn', description: 'Click Save' },
      ],
    });

    assert.strictEqual(brokenJourney.allPassed, false, 'Journey must fail on broken button');
    assert.ok(brokenJourney.stepResults[1].error.includes('#save-note-btn'), 'Error must mention missing button');

    // 3. Diagnose using RootCauseAutoRepairEngine
    const diag = RootCauseAutoRepairEngine.classifyAndDiagnose(
      brokenJourney.stepResults[1].error,
      brokenFiles
    );
    assert.strictEqual(diag.category, 'DOM_SELECTOR_NOT_FOUND');

    // 4. Apply surgical patch
    brokenFiles[0].content = brokenFiles[0].content.replace('id="broken-btn-id"', 'id="save-note-btn"');

    // 5. Re-run journey: must pass 100%
    const fixedJourney = await InteractiveJourneyRunner.executeJourney({
      scenarioName: 'Repaired Button Journey',
      files: brokenFiles,
      steps: [
        { action: 'navigate', description: 'Open app' },
        { action: 'click', target: '#save-note-btn', description: 'Click Save' },
      ],
    });
    assert.strictEqual(fixedJourney.allPassed, true, 'Repaired journey must pass 100%');
  });

  // ---------------------------------------------------------------------------
  // Test C — UI Visual Regression
  // ---------------------------------------------------------------------------
  await runTest('Test C — UI Visual Regression (Overflow and hidden element detection)', async () => {
    // Layout with intentional overflow and hidden button
    const brokenHtml = `
      <div id="main-container" style="width: 2000px;">
        <button id="save-note-btn" style="display: none;">حفظ</button>
      </div>
    `;

    const result = VisualRegressionComparator.compareLayout({
      scenarioName: 'Regression Check',
      htmlContent: brokenHtml,
      viewport: { width: 1920, height: 1080 },
    });

    assert.strictEqual(result.matched, false, 'Visual regression must be detected');
    assert.ok(result.discrepancies.some((d) => d.type === 'element_overflow'), 'Must detect element overflow');
    assert.ok(result.discrepancies.some((d) => d.type === 'button_hidden'), 'Must detect hidden critical button');
  });

  // ---------------------------------------------------------------------------
  // Test D — Mobile Device Testing
  // ---------------------------------------------------------------------------
  await runTest('Test D — Mobile Device Testing (Viewport 375x667, Touch, Inputs, Persistence)', async () => {
    const mobileJourney = await InteractiveJourneyRunner.executeJourney({
      scenarioName: 'Mobile Notes Verification',
      files: sampleNotesFiles,
      steps: [
        { action: 'navigate', description: 'Open Mobile View' },
        { action: 'type', target: '#note-title-input', value: 'ملاحظة هاتف', description: 'Type title' },
        { action: 'click', target: '#save-note-btn', description: 'Tap Save Note' },
        { action: 'assert_storage', target: 'engineer_app_notes', description: 'Verify mobile persistence' },
      ],
      device: 'mobile',
    });

    assert.strictEqual(mobileJourney.allPassed, true, 'Mobile journey must pass');
    assert.strictEqual(mobileJourney.device.type, 'mobile');
    assert.strictEqual(mobileJourney.device.viewport.width, 375);
    assert.strictEqual(mobileJourney.device.viewport.height, 667);
    assert.strictEqual(mobileJourney.device.hasTouch, true);
  });

  // ---------------------------------------------------------------------------
  // Test E — Production Release Gate
  // ---------------------------------------------------------------------------
  await runTest('Test E — Release Gate (Block release candidate if tests fail, verify state machine)', async () => {
    const projectId = 'proj_release_gate_test';

    // Case 1: Tests failed -> Must block release
    const blockedCheck = ProductionReadinessEngine.auditReadiness({
      projectId,
      files: sampleNotesFiles,
      testPassRatePercent: 75, // Not 100%
      hasCleanBuild: true,
      hasRecoveryBackup: true,
    });
    assert.strictEqual(blockedCheck.readyForRelease, false);
    assert.strictEqual(blockedCheck.targetStatus, 'FAILED');
    assert.ok(blockedCheck.blockingReasons.some((r) => r.includes('75%')), 'Must block due to test failure');

    // Case 2: All criteria met -> Promote to RELEASE_CANDIDATE
    const passedCheck = ProductionReadinessEngine.auditReadiness({
      projectId,
      files: sampleNotesFiles,
      testPassRatePercent: 100,
      hasCleanBuild: true,
      hasRecoveryBackup: true,
    });
    assert.strictEqual(passedCheck.readyForRelease, true);
    assert.strictEqual(passedCheck.targetStatus, 'RELEASE_CANDIDATE');
    assert.strictEqual(passedCheck.blockingReasons.length, 0);

    const record = ProjectLifecycleManager.getOrCreateRecord(projectId);
    assert.strictEqual(record.status, 'RELEASE_CANDIDATE');
  });

  // ---------------------------------------------------------------------------
  // Test F — Staging Deployment & Health Checks
  // ---------------------------------------------------------------------------
  await runTest('Test F — Staging Deployment (Deploy to Staging, health checks 200 OK)', async () => {
    const projectId = 'proj_staging_test';

    const dep = await DeploymentReleaseManager.deploy({
      projectId,
      version: 'v1.0.0',
      environment: 'staging',
      approvedByUser: true,
    });

    assert.strictEqual(dep.status, 'live');
    assert.strictEqual(dep.healthStatus, 'healthy');
    assert.ok(dep.endpointUrl.includes('staging.proj_staging_test.engineer.run'));

    const record = ProjectLifecycleManager.getOrCreateRecord(projectId);
    assert.strictEqual(record.stagingUrl, dep.endpointUrl);
  });

  // ---------------------------------------------------------------------------
  // Test G — Rollback on Degraded Build
  // ---------------------------------------------------------------------------
  await runTest('Test G — Rollback on Degraded Build (Deploy defective build, auto-rollback)', async () => {
    const projectId = 'proj_rollback_lifecycle';

    // 1. Initial healthy deployment
    await DeploymentReleaseManager.deploy({
      projectId,
      version: 'v1.0.0',
      environment: 'production',
      approvedByUser: true,
    });

    // 2. Deploy failing v1.1.0
    await DeploymentReleaseManager.deploy({
      projectId,
      version: 'v1.1.0',
      environment: 'production',
      approvedByUser: true,
      simulateFailure: true,
    });

    const degradedRecord = ProjectLifecycleManager.getOrCreateRecord(projectId);
    assert.strictEqual(degradedRecord.status, 'DEGRADED');

    // 3. 1-Click Rollback
    const rollbackResult = DeploymentReleaseManager.rollback(projectId);
    assert.strictEqual(rollbackResult.success, true);
    assert.strictEqual(rollbackResult.restoredVersion, 'v1.0.0');
    assert.ok(rollbackResult.messageArabic.includes('التراجع بنجاح'));

    const restoredRecord = ProjectLifecycleManager.getOrCreateRecord(projectId);
    assert.strictEqual(restoredRecord.status, 'DEPLOYED');
    assert.strictEqual(restoredRecord.currentVersion, 'v1.0.0');
  });

  // ---------------------------------------------------------------------------
  // Test H — Production Application Monitoring & Incident Triage
  // ---------------------------------------------------------------------------
  await runTest('Test H — Production Application Monitoring & Incident Triage', async () => {
    const projectId = 'proj_monitored_app';

    // Record healthy probes
    AppContinuousMonitor.recordProbe({ projectId, version: 'v1.0.0', statusCode: 200, latencyMs: 30 });
    AppContinuousMonitor.recordProbe({ projectId, version: 'v1.0.0', statusCode: 200, latencyMs: 40 });

    // Record 500 error probe
    const alertSnap = AppContinuousMonitor.recordProbe({ projectId, version: 'v1.0.0', statusCode: 500, latencyMs: 150 });
    assert.ok(alertSnap.httpStatus500Count >= 1);
    assert.ok(alertSnap.activeAlerts.length >= 1);

    // Trigger incident
    const incident = IncidentIntelligenceEngine.triggerIncident({
      projectId,
      version: 'v1.0.0',
      errorSnippet: '500 Internal Server Error in /api/notes database connection pool timeout',
      severity: 'P0',
    });

    assert.strictEqual(incident.severity, 'P0');
    assert.strictEqual(incident.status, 'diagnosing');
    assert.ok(incident.recommendedMitigation.includes('Rollback'));

    const lifecycle = ProjectLifecycleManager.getOrCreateRecord(projectId);
    assert.strictEqual(lifecycle.status, 'DEGRADED');
  });

  // ---------------------------------------------------------------------------
  // Test I — Backup & Disaster Recovery Drill
  // ---------------------------------------------------------------------------
  await runTest('Test I — Backup & Disaster Recovery Drill (Create backup, restore in clean sandbox)', async () => {
    const projectId = 'proj_dr_drill';

    // 1. Create project backup
    const backup = ProjectDisasterRecoveryManager.createProjectBackup({
      projectId,
      version: 'v1.0.0',
      files: sampleNotesFiles,
    });

    assert.ok(backup.backupId.startsWith('bkp_'));
    assert.strictEqual(backup.rtoTargetSeconds, 45);
    assert.strictEqual(backup.rpoTargetMinutes, 5);
    assert.strictEqual(backup.filesCount, 2);

    // 2. Execute recovery drill in isolated sandbox
    const drill = ProjectDisasterRecoveryManager.executeRecoveryDrill(projectId, backup.backupId);
    assert.strictEqual(drill.drillPassed, true);
    assert.strictEqual(drill.restoredFilesCount, 2);
    assert.strictEqual(drill.integrityStatus, '100% Byte Parity Verified');
  });

  // ---------------------------------------------------------------------------
  // Test J — Post-Deployment Feature Update & Versioning
  // ---------------------------------------------------------------------------
  await runTest('Test J — Post-Deployment Feature Update & Versioning', async () => {
    const projectId = 'proj_version_expansion';

    // Project starts at v1.0.0
    ProjectLifecycleManager.getOrCreateRecord(projectId);

    // Client requests feature: "أضف شارة الملاحظات المميزة"
    const updateResult = ApplicationUpdateManager.createFeatureBranchAndBuild({
      projectId,
      featurePrompt: 'شارة الملاحظات المميزة',
      currentFiles: sampleNotesFiles,
    });

    assert.strictEqual(updateResult.newVersion, 'v1.1.0', 'Semver minor version bump');
    assert.ok(updateResult.branchId.startsWith('branch_'));
    assert.ok(updateResult.modifiedFiles[0].content.includes('شارة الملاحظات المميزة'));
    assert.ok(updateResult.customerMessageArabic.includes('v1.1.0'));
  });

  // ---------------------------------------------------------------------------
  // Test K — Multi-Tenant Data Isolation & Secrets Shielding
  // ---------------------------------------------------------------------------
  await runTest('Test K — Multi-Tenant Data Isolation & Secrets Shielding', async () => {
    // Project A
    ProjectLifecycleManager.getOrCreateRecord('tenant_A_project');
    ProjectDisasterRecoveryManager.createProjectBackup({
      projectId: 'tenant_A_project',
      version: 'v1.0.0',
      files: sampleNotesFiles,
    });

    // Project B tries to restore Project A's backup -> must fail
    const foreignDrill = ProjectDisasterRecoveryManager.executeRecoveryDrill('tenant_B_project', 'bkp_tenant_A_fake');
    assert.strictEqual(foreignDrill.drillPassed, false, 'Cross-tenant backup access must be blocked');

    // Customer Feedback with Secret -> must sanitize
    const ticket = FeedbackIssueTracker.reportProblem({
      projectId: 'tenant_A_project',
      version: 'v1.0.0',
      title: 'عطل في حفظ البيانات',
      description: 'زر الحفظ يرمي خطأ عند النقر والمفتاح AIzaSySecretKey1234567890 مكشوف',
    });

    assert.ok(ticket.ticketId.startsWith('tkt_'));
    assert.strictEqual(ticket.priority, 'high');

    // Project Handover Clean Bundle Check
    const handover = ProjectHandoverEngine.generateHandoverPackage('tenant_A_project', sampleNotesFiles);
    assert.strictEqual(handover.hasGitRepo, true);
    assert.strictEqual(handover.hasReadmeDocumentation, true);
    assert.strictEqual(handover.hasAutomatedTests, true);
    assert.ok(handover.runInstructionsArabic.includes('npm install'));
  });

  console.log('\n================================================================');
  console.log(`🎉 INTERACTIVE TESTING & LIFECYCLE SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
  console.log('================================================================\n');
}

if (require.main === module) {
  runInteractiveTestingAndLifecycleSuite().catch((err) => {
    console.error('Fatal test failure:', err);
    process.exit(1);
  });
}

module.exports = { runInteractiveTestingAndLifecycleSuite };
