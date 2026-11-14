// ==============================================================================
// ENGINEER — CORE ENGINE HARDENING & BENCHMARK TEST SUITE (Phase 4)
// 15 Comprehensive Autonomous Verification Gates:
// - Intelligent Planning (DAG, Feasibility, Dynamic Re-planning)
// - Code Intelligence (Incremental Caching, Impact Analysis)
// - Advanced Code Generation & Syntax Pre-verification
// - Secure Execution & Resource Quotas
// - Advanced Verification (Vertical-slice DOM, Persistence, Regression Suite)
// - Root-Cause Debugging & 6-Taxonomy Auto-Repair Engine
// - Project Context & Crash Recovery Journal
// - Preview Delivery & Safe Rollback
// - The Mandatory 5-Stage Notes Application Benchmark
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

async function runCoreEngineHardeningSuite() {
  console.log('================================================================');
  console.log('🚀 RUNNING CORE ENGINE HARDENING & BENCHMARK SUITE');
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
    IntelligentPlanningEngine,
    RootCauseAutoRepairEngine,
    AdvancedVerificationEngine,
    ProjectContextMemoryEngine,
    PreviewDeliveryEngine,
    EngineeringEvaluationBenchmarkEngine,
    IncrementalSymbolCache,
    calculateSymbolImpact,
    ToolExecutionOrchestrator,
    universalToolRegistry,
    initializeCoreTools,
  } = loadTsModule('src/services/toolEngine/index.ts');

  const { verifyCodeSyntax } = loadTsModule('src/utils/autonomousAppBuilder.ts');

  initializeCoreTools();

  // ---------------------------------------------------------------------------
  // Test 1: Intelligent Planning DAG Decomposition
  // ---------------------------------------------------------------------------
  await runTest('Test 1: Intelligent Planning DAG Decomposition', async () => {
    const dag = IntelligentPlanningEngine.buildTaskDAG({
      projectId: 'proj_notes_1',
      prompt: 'أنشئ تطبيق ملاحظات مع حفظ في قاعدة البيانات وواجهة تفاعلية واختبارات شاملة',
    });

    assert.ok(dag.id.startsWith('dag_'), 'DAG must have unique ID');
    assert.strictEqual(dag.isValid, true, 'DAG must be valid without cycles');
    assert.ok(dag.nodes.length >= 4, 'DAG must contain at least 4 decomposed task nodes');
    assert.ok(dag.executionOrder.includes('node_core_logic'), 'Execution order must contain core logic');
    assert.ok(dag.executionOrder.includes('node_frontend_ui'), 'Execution order must contain UI components');
    assert.ok(dag.executionOrder.includes('node_verification'), 'Execution order must contain verification');
  });

  // ---------------------------------------------------------------------------
  // Test 2: Plan Feasibility Validator
  // ---------------------------------------------------------------------------
  await runTest('Test 2: Plan Feasibility Validator', async () => {
    const validDag = IntelligentPlanningEngine.buildTaskDAG({
      projectId: 'proj_valid',
      prompt: 'Build a task manager dashboard',
    });
    const validReport = IntelligentPlanningEngine.validatePlanFeasibility(validDag);
    assert.strictEqual(validReport.feasible, true, 'Valid plan must be reported as feasible');
    assert.strictEqual(validReport.errors.length, 0, 'Valid plan must have zero errors');

    // Test with missing dependency
    const brokenDag = {
      ...validDag,
      nodes: [
        {
          id: 'task_orphan',
          title: 'Orphan task',
          phase: 'frontend',
          dependencies: ['missing_dep_node'],
          acceptanceCriteria: [],
          status: 'pending',
        },
      ],
    };
    const invalidReport = IntelligentPlanningEngine.validatePlanFeasibility(brokenDag);
    assert.strictEqual(invalidReport.feasible, false, 'Plan with missing dependency must fail feasibility check');
    assert.ok(invalidReport.errors.some((e) => e.includes('missing_dep_node')), 'Must report missing dependency name');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Dynamic Re-planning on Failure
  // ---------------------------------------------------------------------------
  await runTest('Test 3: Dynamic Re-planning on Failure', async () => {
    const dag = IntelligentPlanningEngine.buildTaskDAG({
      projectId: 'proj_replan',
      prompt: 'Build e-commerce store',
    });

    // Mark first node completed
    dag.nodes[0].status = 'completed';

    // Fail second node
    const replanResult = IntelligentPlanningEngine.replanOnFailure(
      dag,
      'node_core_logic',
      'Syntax error in controller router'
    );

    assert.ok(replanResult.updatedDAG.nodes.some((n) => n.id.startsWith('node_repair_')), 'Must insert repair node');
    assert.strictEqual(dag.nodes[0].status, 'completed', 'Completed nodes must be preserved');
    assert.ok(replanResult.rePlanActions.length >= 2, 'Must output re-plan actions log');
  });

  // ---------------------------------------------------------------------------
  // Test 4: Incremental Code Intelligence & Symbol Caching
  // ---------------------------------------------------------------------------
  await runTest('Test 4: Incremental Code Intelligence & Symbol Caching', async () => {
    IncrementalSymbolCache.clearCache();

    const files = [
      {
        id: 'f1',
        path: 'src/services/auth.ts',
        name: 'auth.ts',
        folder: 'src/services',
        content: 'export function loginUser(email: string) { return true; }',
        language: 'typescript',
        size: 58,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'f2',
        path: 'src/services/payment.ts',
        name: 'payment.ts',
        folder: 'src/services',
        content: 'export function processPayment(amount: number) { return { status: "ok" }; }',
        language: 'typescript',
        size: 75,
        updatedAt: new Date().toISOString(),
      },
    ];

    // First indexing pass: both files must be re-indexed
    const pass1 = IncrementalSymbolCache.indexProjectFilesIncrementally(files);
    assert.strictEqual(pass1.reIndexedFiles.length, 2, 'First pass must index all 2 files');
    assert.strictEqual(pass1.cachedFiles.length, 0, 'First pass should have 0 cached files');
    assert.strictEqual(pass1.totalSymbols, 2, 'Should find 2 exported symbols');

    // Second indexing pass without changes: both files must come from cache
    const pass2 = IncrementalSymbolCache.indexProjectFilesIncrementally(files);
    assert.strictEqual(pass2.reIndexedFiles.length, 0, 'Unchanged files must not be re-parsed');
    assert.strictEqual(pass2.cachedFiles.length, 2, 'Unchanged files must be served from cache');

    // Modify one file: only modified file should be re-indexed
    files[1].content = 'export function processPayment(amount: number, currency: string) { return { status: "ok" }; }';
    const pass3 = IncrementalSymbolCache.indexProjectFilesIncrementally(files);
    assert.strictEqual(pass3.reIndexedFiles.length, 1, 'Only modified file should be re-indexed');
    assert.strictEqual(pass3.cachedFiles.length, 1, 'Unmodified file must remain cached');
    assert.strictEqual(pass3.reIndexedFiles[0], 'src/services/payment.ts');
  });

  // ---------------------------------------------------------------------------
  // Test 5: AST Symbol Extraction & Deep Caller Impact Analysis
  // ---------------------------------------------------------------------------
  await runTest('Test 5: AST Symbol Extraction & Deep Caller Impact Analysis', async () => {
    const projectFiles = [
      {
        id: 'f1',
        path: 'src/utils/calc.ts',
        name: 'calc.ts',
        folder: 'src/utils',
        content: 'export function calculateDiscount(price: number) { return price * 0.9; }',
        language: 'typescript',
        size: 70,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'f2',
        path: 'src/controllers/order.ts',
        name: 'order.ts',
        folder: 'src/controllers',
        content: `
import { calculateDiscount } from '../utils/calc';
export function checkout() {
  const total = calculateDiscount(100);
  return total;
}
`,
        language: 'typescript',
        size: 150,
        updatedAt: new Date().toISOString(),
      },
    ];

    const impact = calculateSymbolImpact('calculateDiscount', 'src/utils/calc.ts', projectFiles);
    assert.strictEqual(impact.targetSymbol, 'calculateDiscount');
    assert.strictEqual(impact.totalCallSites, 1, 'Must detect 1 call site in checkout()');
    assert.strictEqual(impact.affectedFiles[0], 'src/controllers/order.ts');
    assert.strictEqual(impact.breakingChangesRisk, 'medium');
  });

  // ---------------------------------------------------------------------------
  // Test 6: Pre-Verification Syntax Guard
  // ---------------------------------------------------------------------------
  await runTest('Test 6: Pre-Verification Syntax Guard', async () => {
    // Valid JS
    const validJs = 'function hello() { return { status: "ok" }; }';
    const checkValid = verifyCodeSyntax(validJs, 'javascript');
    assert.strictEqual(checkValid.valid, true, 'Valid JS syntax must pass');

    // Broken JS: unclosed brace
    const brokenJs = 'function hello() { return { status: "ok" };';
    const checkBroken = verifyCodeSyntax(brokenJs, 'javascript');
    assert.strictEqual(checkBroken.valid, false, 'Unclosed brace must be caught');
    assert.ok(checkBroken.error?.includes('Unclosed syntax tokens'), 'Must report unclosed tokens');

    // Broken JSON
    const brokenJson = '{"name": "test",}';
    const checkBrokenJson = verifyCodeSyntax(brokenJson, 'json');
    assert.strictEqual(checkBrokenJson.valid, false, 'Malformed JSON must fail pre-verification');
  });

  // ---------------------------------------------------------------------------
  // Test 7: Secure Execution & Process Constraints
  // ---------------------------------------------------------------------------
  await runTest('Test 7: Secure Execution & Process Constraints', async () => {
    // Blacklisted command check
    const dangerousRes = await universalToolRegistry.executeTool(
      'terminal.execute',
      { command: 'rm -rf /' },
      { projectId: 'sec_proj', userId: 'usr_sec', userRole: 'Admin' }
    );
    assert.strictEqual(dangerousRes.success, false, 'Blacklisted system command must be blocked');
    assert.ok(dangerousRes.error?.includes('blocked') || dangerousRes.error?.includes('Security'), 'Must mention security block');

    // Safe command check
    const safeRes = await universalToolRegistry.executeTool(
      'terminal.execute',
      { command: 'node -e "console.log(12345)"' },
      { projectId: 'sec_proj', userId: 'usr_sec', userRole: 'Admin' }
    );
    assert.strictEqual(safeRes.success, true, 'Safe sandboxed command must succeed');
    assert.strictEqual(safeRes.result.exitCode, 0, 'Exit code must be 0');
    assert.ok(safeRes.result.stdout.includes('12345'), 'Stdout must match output');
  });

  // ---------------------------------------------------------------------------
  // Test 8: Advanced Vertical-Slice Verification Engine
  // ---------------------------------------------------------------------------
  await runTest('Test 8: Advanced Vertical-Slice Verification Engine', async () => {
    const html = `
<!DOCTYPE html>
<html>
<body>
  <div id="app-root">
    <button id="add-btn">Add Note</button>
    <div id="notes-list"></div>
  </div>
</body>
</html>`;
    const js = 'console.log("App ready");';

    const report = await AdvancedVerificationEngine.runVerticalSliceTest({
      htmlContent: html,
      jsContent: js,
      userActions: [{ action: 'click', target: '#add-btn' }],
      expectedAssertions: [
        { name: 'App Root Exists', type: 'element_exists', selector: '#app-root' },
        { name: 'Add Button Present', type: 'element_exists', selector: '#add-btn' },
        { name: 'Zero Runtime Exceptions', type: 'no_console_errors' },
      ],
    });

    assert.strictEqual(report.allPassed, true, 'All vertical slice assertions must pass');
    assert.strictEqual(report.passedAssertions, 3);
    assert.strictEqual(report.failedAssertions, 0);
  });

  // ---------------------------------------------------------------------------
  // Test 9: Regression Test Suite Runner
  // ---------------------------------------------------------------------------
  await runTest('Test 9: Regression Test Suite Runner', async () => {
    const existingTests = [
      {
        id: 't1',
        name: 'Auth flow',
        category: 'regression',
        targetFile: 'src/auth.js',
        status: 'passed',
        durationMs: 5,
        assertionCount: 2,
        evidenceLog: ['ok'],
        traceSteps: [],
      },
      {
        id: 't2',
        name: 'Payment calculation',
        category: 'regression',
        targetFile: 'src/payment.js',
        status: 'failed',
        durationMs: 5,
        assertionCount: 1,
        evidenceLog: ['calc mismatch'],
        traceSteps: [],
      },
    ];

    const modifiedFiles = [
      {
        id: 'f_pay',
        path: 'src/payment.js',
        name: 'payment.js',
        folder: 'src',
        content: '',
        language: 'javascript',
        size: 10,
        updatedAt: new Date().toISOString(),
      },
    ];

    const regression = AdvancedVerificationEngine.runRegressionSuite(existingTests, modifiedFiles);
    assert.strictEqual(regression.regressionFree, false, 'Must flag regression on modified file with failing test');
    assert.ok(regression.regressions[0].includes('Payment calculation'), 'Must identify regression test name');
  });

  // ---------------------------------------------------------------------------
  // Test 10: Root-Cause Debugging & 6-Category Error Taxonomy
  // ---------------------------------------------------------------------------
  await runTest('Test 10: Root-Cause Debugging & 6-Category Error Taxonomy', async () => {
    // 1. Syntax Error
    const d1 = RootCauseAutoRepairEngine.classifyAndDiagnose('SyntaxError: Unexpected token } in app.js:45:12');
    assert.strictEqual(d1.category, 'SYNTAX_ERROR');
    assert.strictEqual(d1.culpritLine, 45);

    // 2. DOM Selector Not Found
    const d2 = RootCauseAutoRepairEngine.classifyAndDiagnose('Error: querySelector #save-note-btn element not found in DOM');
    assert.strictEqual(d2.category, 'DOM_SELECTOR_NOT_FOUND');

    // 3. Database Constraint
    const d3 = RootCauseAutoRepairEngine.classifyAndDiagnose('SQLITE_CONSTRAINT: duplicate key in products table');
    assert.strictEqual(d3.category, 'DATABASE_CONSTRAINT_VIOLATION');

    // 4. API Contract Mismatch
    const d4 = RootCauseAutoRepairEngine.classifyAndDiagnose('API Error: 404 Not Found schema validation failed on /api/users');
    assert.strictEqual(d4.category, 'API_CONTRACT_MISMATCH');

    // 5. Deployment / Build
    const d5 = RootCauseAutoRepairEngine.classifyAndDiagnose('Error: Cannot find module "express" exit code 1');
    assert.strictEqual(d5.category, 'DEPLOYMENT_BUILD_ERROR');

    // 6. Runtime Exception
    const d6 = RootCauseAutoRepairEngine.classifyAndDiagnose('TypeError: undefined is not a function at Object.run (app.js:20:5)');
    assert.strictEqual(d6.category, 'RUNTIME_EXCEPTION');
    assert.strictEqual(d6.culpritLine, 20);
  });

  // ---------------------------------------------------------------------------
  // Test 11: Stack-Trace Pinpointing & Surgical Patch Generation
  // ---------------------------------------------------------------------------
  await runTest('Test 11: Stack-Trace Pinpointing & Surgical Patch Generation', async () => {
    const projectFiles = [
      {
        id: 'f_html',
        path: 'index.html',
        name: 'index.html',
        folder: '/',
        content: '<!DOCTYPE html><html><body><div id="root"></main></body></html>',
        language: 'html',
        size: 60,
        updatedAt: new Date().toISOString(),
      },
    ];

    const diag = RootCauseAutoRepairEngine.classifyAndDiagnose(
      'DOM Error: selector "#save-note-btn" element not found in index.html',
      projectFiles
    );

    const patch = RootCauseAutoRepairEngine.generateSurgicalPatch(diag, projectFiles);
    assert.ok(patch !== null, 'Surgical patch proposal must be generated');
    assert.strictEqual(patch.filePath, 'index.html');
    assert.ok(patch.replacementContent.includes('id="save-note-btn"'), 'Patch must inject the missing element');
  });

  // ---------------------------------------------------------------------------
  // Test 12: Project Context & Crash Recovery Journal
  // ---------------------------------------------------------------------------
  await runTest('Test 12: Project Context & Crash Recovery Journal', async () => {
    const projectId = 'proj_journal_test';

    ProjectContextMemoryEngine.appendJournal({
      projectId,
      currentPhase: 'EXECUTING',
      lastCompletedTask: 'Database schema applied',
      snapshotHash: 'snap_123',
      technicalDecisions: ['Configured SQLite store', 'Added indexed title'],
    });

    const recovered = ProjectContextMemoryEngine.recoverContext(projectId);
    assert.ok(recovered !== null, 'Must recover recorded journal entry');
    assert.strictEqual(recovered.currentPhase, 'EXECUTING');
    assert.strictEqual(recovered.lastCompletedTask, 'Database schema applied');
    assert.strictEqual(recovered.technicalDecisions[0], 'Configured SQLite store');
  });

  // ---------------------------------------------------------------------------
  // Test 13: Preview Engine & Automated Rollback on Unrecoverable Defect
  // ---------------------------------------------------------------------------
  await runTest('Test 13: Preview Engine & Automated Rollback on Unrecoverable Defect', async () => {
    const projectId = 'proj_rollback_test';

    // Register initial stable snapshot
    ProjectContextMemoryEngine.registerStableSnapshot(projectId, 'stable_snapshot_v1');

    // Case A: Verification Passed -> Live preview created
    const passDelivery = PreviewDeliveryEngine.processPreviewAndDelivery({
      projectId,
      currentSnapshotId: 'snapshot_v2',
      verificationPassed: true,
      appTitle: 'تطبيق المهام',
    });
    assert.strictEqual(passDelivery.rollbackTriggered, false);
    assert.strictEqual(passDelivery.exportReady, true);
    assert.ok(passDelivery.previewUrl.includes('snapshot_v2'));

    // Case B: Verification Failed -> Automatic Rollback to snapshot_v2 (the last verified stable snapshot)
    const failDelivery = PreviewDeliveryEngine.processPreviewAndDelivery({
      projectId,
      currentSnapshotId: 'broken_snapshot_v3',
      verificationPassed: false,
      appTitle: 'تطبيق المهام',
    });
    assert.strictEqual(failDelivery.rollbackTriggered, true);
    assert.strictEqual(failDelivery.exportReady, false);
    assert.strictEqual(failDelivery.stableSnapshotId, 'snapshot_v2', 'Must roll back to last stable snapshot');
    assert.ok(failDelivery.customerMessageArabic.includes('التراجع تلقائياً'), 'Must inform user of rollback in Arabic');
  });

  // ---------------------------------------------------------------------------
  // Test 14: Autonomous Orchestrator Full Cycle with Self-Healing
  // ---------------------------------------------------------------------------
  await runTest('Test 14: Autonomous Orchestrator Full Cycle with Self-Healing', async () => {
    const testProject = {
      id: 'proj_orch_hardening',
      title: 'تطبيق المهام والملاحظات',
      category: 'app',
      techStack: 'react-ts-vite',
      database: 'sqlite',
      deployTarget: 'cloud-run-eu',
      files: [
        {
          id: 'f_h1',
          path: 'index.html',
          name: 'index.html',
          folder: '/',
          content: '<!DOCTYPE html><html><head><title>App</title></head><body><h1>Notes</h1></body></html>',
          language: 'html',
          size: 80,
          updatedAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const taskRecord = await ToolExecutionOrchestrator.executeTask({
      projectId: testProject.id,
      prompt: 'أنشئ متجر ملاحظات مع قاعدة بيانات واختبارات',
      project: testProject,
    });

    assert.strictEqual(taskRecord.status, 'COMPLETED', 'Orchestration must complete successfully');
    assert.ok(taskRecord.taskDAG, 'Orchestration task must contain taskDAG');
    assert.ok(taskRecord.taskDAG.nodes.length >= 4, 'DAG must have at least 4 nodes');
    assert.ok(taskRecord.toolsInvoked.includes('versions.create_snapshot'), 'Must invoke versions snapshot');
    assert.ok(taskRecord.toolsInvoked.includes('code.dependency_graph'), 'Must invoke dependency graph');
    assert.ok(taskRecord.toolsInvoked.includes('browser.launch_test'), 'Must invoke browser verification');
    assert.ok(!taskRecord.customerMessage.includes('Chief Architect'), 'Zero leaks: no internal titles');
    assert.ok(!taskRecord.customerMessage.includes('ToolExecutionOrchestrator'), 'Zero leaks: no internal engine names');
  });

  // ---------------------------------------------------------------------------
  // Test 15: Mandatory First Benchmark Scenario (Notes App 5 Stages)
  // ---------------------------------------------------------------------------
  await runTest('Test 15: Mandatory First Benchmark Scenario (Notes App 5 Stages)', async () => {
    const benchmarkResult = await EngineeringEvaluationBenchmarkEngine.runNotesAppBenchmark();

    // Verify Stage 1
    assert.strictEqual(benchmarkResult.stage1Created, true, 'Stage 1: Notes app must be created');

    // Verify Stage 2
    assert.strictEqual(benchmarkResult.stage2Modified, true, 'Stage 2: Notes app must be modified (Tags + Export)');

    // Verify Stage 3
    assert.strictEqual(benchmarkResult.stage3DefectDetected, true, 'Stage 3: Deliberate defect must be detected');

    // Verify Stage 4
    assert.strictEqual(benchmarkResult.stage4AutoRepaired, true, 'Stage 4: Defect must be diagnosed and surgically repaired');

    // Verify Stage 5
    assert.strictEqual(benchmarkResult.stage5Verified, true, 'Stage 5: Verification must pass 100% after repair');

    // Verify Metrics
    assert.strictEqual(benchmarkResult.metrics.passRatePercent, 100, 'Pass rate must be 100%');
    assert.ok(benchmarkResult.metrics.repairAttemptsCount >= 1, 'Repair attempts must be recorded');
    assert.strictEqual(benchmarkResult.metrics.regressionsCount, 0, 'Zero regressions allowed');
    assert.ok(benchmarkResult.reportArabic.includes('تطبيق الملاحظات'), 'Arabic comparative report must be generated');

    console.log('\n--- FIRST BENCHMARK COMPARATIVE RESULTS ---');
    console.log(`  Initial Creation: Passed ✅`);
    console.log(`  Feature Expansion: Passed ✅`);
    console.log(`  Defect Detection: Passed ✅`);
    console.log(`  Root-Cause Diagnosis & Surgical Patch: Passed ✅`);
    console.log(`  Post-Repair Verification: 100% Passed ✅`);
    console.log(`  Benchmark Latency: ${benchmarkResult.metrics.totalDurationMs}ms`);
    console.log(`  Baseline Pass Rate: ${benchmarkResult.metrics.beforeHardeningBaseline.passRatePercent}% -> Hardened: ${benchmarkResult.metrics.passRatePercent}%`);
    console.log(`  Baseline Repair Quality: ${benchmarkResult.metrics.beforeHardeningBaseline.repairSuccessRatePercent}% -> Hardened: 100%`);
  });

  console.log('\n================================================================');
  console.log(`🎉 CORE ENGINE HARDENING SUITE COMPLETE: ${passedTests}/${totalTests} PASSED (100%)`);
  console.log('================================================================\n');
}

if (require.main === module) {
  runCoreEngineHardeningSuite().catch((err) => {
    console.error('Fatal test failure:', err);
    process.exit(1);
  });
}

module.exports = { runCoreEngineHardeningSuite };
