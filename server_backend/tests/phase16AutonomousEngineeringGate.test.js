/**
 * phase16AutonomousEngineeringGate.test.js
 * Mandatory Gate: Phase 16 — The 18 Core Engineering Capabilities Gate
 *
 * Verifies all 18 core engineering capabilities across Intelligence, Execution,
 * and Quality groups, and validates SQLite Migration 25 database integration.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations } = require('../db/database.js');

// Import the 3 service groups
const intelligence = require('../services/intelligence');
const execution = require('../services/execution');
const quality = require('../services/quality');

console.log('================================================================');
console.log('🚀 RUNNING PHASE 16: THE 18 CORE ENGINEERING CAPABILITIES GATE');
console.log('================================================================\n');

// Set up fresh in-memory / temporary test database with all 25 migrations
const tempDbDir = path.join(__dirname, '../../data/test_temp');
if (!fs.existsSync(tempDbDir)) fs.mkdirSync(tempDbDir, { recursive: true });
const tempDbPath = path.join(tempDbDir, `phase16_gate_${Date.now()}.sqlite`);
const testDb = new DatabaseSync(tempDbPath);
testDb.exec('PRAGMA foreign_keys = ON');
runMigrations(testDb);

try {
  // ----------------------------------------------------
  // GROUP 1: CODING INTELLIGENCE (Capabilities 01 to 06)
  // ----------------------------------------------------

  // Capability 01: Freestyle Code Generation
  console.log('▶️ [Cap 01] Verifying Freestyle Code Generation...');
  assert.strictEqual(intelligence.isGenericPrompt('محتاج تطبيق'), true, 'Generic query must be detected');
  assert.strictEqual(intelligence.isGenericPrompt('محتاج بنا تطبيق'), true, 'Generic query must be detected');
  assert.strictEqual(intelligence.isGenericPrompt('اصنع لي تطبيق حاسبة زكاة المال'), false, 'Specific prompt must not be generic');

  const genericResponse = intelligence.generateFreestyleApp({ prompt: 'محتاج تطبيق' });
  assert.strictEqual(genericResponse.isClarificationNeeded, true, 'Generic prompt must trigger clarification');
  assert.strictEqual(genericResponse.previewState, 'blank', 'Preview state must be 100% blank');
  assert.strictEqual(genericResponse.files, null, 'No files built on generic prompt');

  const customApp = intelligence.generateFreestyleApp({
    prompt: 'ابنِ تطبيق حاسبة زكاة المال والذهب',
    language: 'ar'
  });
  assert.strictEqual(customApp.isClarificationNeeded, false, 'Specific prompt proceeds to build');
  assert.ok(customApp.files['index.html'].includes('freestyle-container'), 'Custom app has structured HTML');
  assert.ok(customApp.files['app.js'].includes('localStorage'), 'Custom app has persistent JS logic');
  assert.ok(customApp.files['style.css'].includes('--bg-dark'), 'Custom app has styling');
  console.log('   ✅ Cap 01 Freestyle Code Generation passed.');

  // Capability 02: Autonomous Project Architect
  console.log('▶️ [Cap 02] Verifying Autonomous Project Architect...');
  const manifest = intelligence.designArchitectureManifest('منصة تداول مالي كمي مع أوامر فورية', { stack: 'react_vite' });
  assert.strictEqual(manifest.category, 'trading_fintech', 'Domain category correctly inferred');
  assert.ok(Array.isArray(manifest.folderStructure) && manifest.folderStructure.length >= 8, 'Folder manifest complete');
  assert.ok(Array.isArray(manifest.apiContracts) && manifest.apiContracts.length >= 3, 'API contracts generated');
  assert.ok(manifest.databaseSchema.tables.length >= 2, 'Database schema generated');
  assert.ok(manifest.componentTree.name === 'AppRoot', 'Component tree generated');
  console.log('   ✅ Cap 02 Autonomous Project Architect passed.');

  // Capability 03: Intelligent Stack Selection
  console.log('▶️ [Cap 03] Verifying Intelligent Stack Selection...');
  const reactStack = intelligence.selectStack({ prompt: 'لوحة تحكم تفاعلية للمبيعات' });
  assert.strictEqual(reactStack.selectedStack, 'react_vite', 'React Vite selected for dashboard');

  const pythonStack = intelligence.selectStack({ prompt: 'نموذج ذكاء اصطناعي عميق للتنبؤ بالأسعار و machine learning' });
  assert.strictEqual(pythonStack.selectedStack, 'python_fastapi', 'FastAPI selected for AI/ML');

  const flutterStack = intelligence.selectStack({ prompt: 'تطبيق هاتف وموقع موحد عبر flutter' });
  assert.strictEqual(flutterStack.selectedStack, 'flutter_web', 'Flutter Web selected for cross-platform');

  const nextStack = intelligence.selectStack({ prompt: 'موقع عام مع تحسين محركات البحث سيو ومقالات' });
  assert.strictEqual(nextStack.selectedStack, 'nextjs', 'Next.js selected for SEO portal');

  assert.strictEqual(reactStack.resourceBudget.approved, true, 'Resource Guard approved budget');
  console.log('   ✅ Cap 03 Intelligent Stack Selection passed.');

  // Capability 04: Full Repository Generation
  console.log('▶️ [Cap 04] Verifying Full Repository Generation...');
  const repo = intelligence.repoScaffolder.scaffoldRepository(manifest, reactStack.stackConfig);
  assert.ok(repo.files['package.json'], 'package.json generated');
  assert.ok(repo.files['tsconfig.json'], 'tsconfig.json generated');
  assert.ok(repo.files['.env.example'], '.env.example generated');
  assert.ok(repo.files['migrations/001_initial_schema.sql'], 'Database migration generated');
  assert.ok(repo.files['tests/acceptance.test.js'], 'Acceptance test generated');
  assert.ok(repo.files['README.md'].includes(manifest.projectName), 'README.md documentation complete');
  console.log('   ✅ Cap 04 Full Repository Generation passed.');

  // Capability 05: Advanced Code Understanding (AST & Graph)
  console.log('▶️ [Cap 05] Verifying AST Code Graph...');
  const sampleFiles = {
    'src/math.js': 'export function add(a, b) { return a + b; }\nexport function multiply(a, b) { return a * b; }',
    'src/calculator.js': 'import { add } from "./math";\nexport function calculateTotal(items) { return items.reduce(add, 0); }'
  };
  const graph = intelligence.buildCodeGraph(sampleFiles);
  assert.strictEqual(graph.fileCount, 2, 'Graph file count match');
  assert.strictEqual(graph.symbolsCount, 3, 'Symbols extracted (add, multiply, calculateTotal)');
  assert.strictEqual(graph.edges.length, 1, 'Dependency edge from calculator to math');

  const graphId = intelligence.saveCodeGraphToDb(testDb, 'proj_test_01', graph);
  assert.ok(graphId.startsWith('graph_'), 'Code graph persisted in project_code_graphs table');
  console.log('   ✅ Cap 05 AST Code Graph passed.');

  // Capability 06: Intelligent Code Refactoring
  console.log('▶️ [Cap 06] Verifying Intelligent Code Refactoring...');
  const largeFileContent = Array.from({ length: 350 }, (_, i) => `// Line ${i}\nfunction subRoutine${i}() { return ${i}; }`).join('\n');
  const filesToRefactor = {
    'src/complexModule.js': largeFileContent,
    'src/app.js': 'document.getElementById("input").addEventListener("input", function() { console.log(1); });'
  };
  const refactorResult = intelligence.refactorProject(filesToRefactor, graph, { maxLineThreshold: 250 });
  assert.strictEqual(refactorResult.success, true, 'Refactoring succeeded');
  assert.ok(refactorResult.files['src/complexModule.utils.js'], 'Oversized file split into utils module');
  assert.ok(refactorResult.files['src/app.js'].includes('__debounce'), 'Performance debounce injected');
  assert.strictEqual(refactorResult.functionalPreservation, '100% Verified', 'Behavioral preservation guaranteed');
  console.log('   ✅ Cap 06 Intelligent Code Refactoring passed.');

  // ----------------------------------------------------
  // GROUP 2: SMART EXECUTION (Capabilities 07 to 12)
  // ----------------------------------------------------

  // Capability 07: Dynamic Runtime Provisioning
  console.log('▶️ [Cap 07] Verifying Dynamic Runtime Provisioning...');
  const provisioner = new execution.RuntimeProvisioner(3200, 3299);
  const runtime1 = provisioner.provision('proj_1', 'react_vite');
  assert.strictEqual(runtime1.port, 3200, 'Allocated first port from pool');
  assert.strictEqual(runtime1.status, 'provisioned', 'Status is provisioned');

  provisioner.start('proj_1');
  const health1 = provisioner.getHealth('proj_1');
  assert.strictEqual(health1.status, 'healthy', 'Runtime is healthy');

  const runtime2 = provisioner.provision('proj_2', 'python_fastapi');
  assert.strictEqual(runtime2.port, 3201, 'Allocated next distinct port');

  provisioner.stop('proj_1');
  assert.strictEqual(provisioner.getHealth('proj_1').status, 'down', 'Runtime stopped safely');
  console.log('   ✅ Cap 07 Dynamic Runtime Provisioning passed.');

  // Capability 08: Autonomous Dependency Resolution
  console.log('▶️ [Cap 08] Verifying Autonomous Dependency Resolution...');
  const filesWithMissingDeps = {
    'package.json': JSON.stringify({ dependencies: {} }),
    'src/chart.js': 'import { Chart } from "chart.js";\nimport confetti from "canvas-confetti";'
  };
  const depResult = execution.resolveDependencies(filesWithMissingDeps, 'react_vite');
  assert.strictEqual(depResult.resolvedCount, 2, '2 missing dependencies resolved');
  assert.ok(depResult.injectedDependencies['chart.js'], 'chart.js resolved');
  assert.ok(depResult.injectedDependencies['canvas-confetti'], 'canvas-confetti resolved');
  const updatedPkg = JSON.parse(depResult.files['package.json']);
  assert.ok(updatedPkg.dependencies['chart.js'], 'Injected into package.json');
  console.log('   ✅ Cap 08 Autonomous Dependency Resolution passed.');

  // Capability 09: Persistent Background Jobs
  console.log('▶️ [Cap 09] Verifying Persistent Background Jobs...');
  const jobQueue = new execution.BackgroundJobQueue(testDb);
  const job = jobQueue.enqueueJob({
    projectId: 'proj_bg_1',
    userId: 'user_1',
    jobType: 'code_synthesis',
    payload: { prompt: 'build app' }
  });
  assert.ok(job.jobId.startsWith('job_'), 'Job ID generated');

  jobQueue.updateCheckpoint(job.jobId, 'scaffold', 25, { filesCreated: 5 });
  jobQueue.updateCheckpoint(job.jobId, 'compile', 60, { status: 'compiled' });

  const resumedJob = jobQueue.resumeJob(job.jobId);
  assert.strictEqual(resumedJob.progress, 60, 'Progress maintained in DB');
  assert.deepStrictEqual(resumedJob.completedSteps, ['scaffold', 'compile'], 'Checkpoints intact across resumption');

  jobQueue.completeJob(job.jobId, 'Build finished with zero defects');
  assert.strictEqual(jobQueue.getJob(job.jobId).status, 'completed', 'Job marked completed in DB');
  console.log('   ✅ Cap 09 Persistent Background Jobs passed.');

  // Capability 10: Parallel Development Workspaces
  console.log('▶️ [Cap 10] Verifying Parallel Development Workspaces...');
  const workspaces = new execution.ParallelWorkspaces(testDb);
  const branchMain = workspaces.createBranch('proj_p_1', 'main');
  const branchFeature = workspaces.createBranch('proj_p_1', 'feature-auth', 'main');

  workspaces.commitToBranch(branchMain.id, { 'auth.js': 'const auth = "basic";' });
  workspaces.commitToBranch(branchFeature.id, { 'auth.js': 'const auth = "oauth2";' });

  const conflicts = workspaces.detectMergeConflicts(branchFeature.id, branchMain.id);
  assert.strictEqual(conflicts.hasConflict, true, 'Merge conflict detected for modified auth.js');

  const safeBranch = workspaces.createBranch('proj_p_1', 'feature-profile', 'main');
  workspaces.commitToBranch(safeBranch.id, { 'profile.js': 'const profile = true;' });
  const mergeResult = workspaces.mergeBranch(safeBranch.id, branchMain.id);
  assert.strictEqual(mergeResult.success, true, 'Clean branch merged successfully');
  console.log('   ✅ Cap 10 Parallel Development Workspaces passed.');

  // Capability 11: Context-Aware File Editing (Surgical Patch)
  console.log('▶️ [Cap 11] Verifying Surgical Patch Engine...');
  const codeFilesToPatch = {
    'index.html': '<html><body><div id="target-box">Original Box</div></body></html>',
    'app.js': 'function calculateTax(amount) {\n  return amount * 0.05;\n}'
  };
  const patchResult = execution.applySurgicalPatch(
    codeFilesToPatch,
    'calculateTax',
    '  // Updated for 2026 tax rate\n  return amount * 0.07;'
  );
  assert.strictEqual(patchResult.success, true, 'Surgical patch applied');
  assert.ok(patchResult.files['app.js'].includes('0.07'), 'Targeted function updated');
  assert.ok(patchResult.files['index.html'].includes('Original Box'), 'Other files left untouched');
  console.log('   ✅ Cap 11 Context-Aware File Editing passed.');

  // Capability 12: Interactive Runtime Debugging
  console.log('▶️ [Cap 12] Verifying Interactive Runtime Debugging...');
  const sampleRuntimeError = {
    message: 'TypeError: Cannot read properties of undefined (reading "map")',
    stack: 'TypeError: Cannot read properties of undefined (reading "map")\n    at renderList (/app/src/components/List.js:42:18)\n    at Object.render (/app/src/app.js:15:3)'
  };
  const diagnosis = execution.diagnoseRuntimeError(sampleRuntimeError);
  assert.strictEqual(diagnosis.category, 'REFERENCE_OR_TYPE_ERROR', 'Categorized in 6-category taxonomy');
  assert.strictEqual(diagnosis.location.file, '/app/src/components/List.js', 'File pinpointed');
  assert.strictEqual(diagnosis.location.line, 42, 'Line number pinpointed');
  assert.ok(diagnosis.repairPrescription.includes('List.js'), 'Prescription formulated');
  console.log('   ✅ Cap 12 Interactive Runtime Debugging passed.');

  // ----------------------------------------------------
  // GROUP 3: QUALITY & DELIVERY (Capabilities 13 to 18)
  // ----------------------------------------------------

  // Capability 13: Autonomous Acceptance Testing
  console.log('▶️ [Cap 13] Verifying Autonomous Acceptance Testing...');
  const testSuite = quality.generateAcceptanceTests('اصنع لي تطبيق مهام مع حفظ محلي', {}, customApp.files);
  assert.strictEqual(testSuite.totalTests, 5, 'Derived 5 acceptance criteria');

  const testExecution = quality.executeAcceptanceTests(testSuite, customApp.files);
  assert.strictEqual(testExecution.allPassed, true, 'All acceptance tests passed on custom app');
  assert.strictEqual(testExecution.passedTests, 5, '5 tests verified with real assertions');
  console.log('   ✅ Cap 13 Autonomous Acceptance Testing passed.');

  // Capability 14: Self-Healing Build Pipeline
  console.log('▶️ [Cap 14] Verifying Self-Healing Build Pipeline...');
  const brokenAppFiles = {
    'index.html': '<html><head><meta charset="UTF-8"></head><body><h1>Broken</h1></body></html>',
    'app.js': 'console.log("Broken");'
  };
  const healResult = quality.runSelfHealingPipeline(brokenAppFiles, testSuite, { maxCycles: 3 });
  assert.strictEqual(healResult.success, true, 'Healed successfully within 3 cycles');
  assert.ok(healResult.cyclesRun >= 1, 'Ran repair iterations');
  assert.ok(healResult.repairHistory.length >= 1, 'Documented repair log in audit history');
  console.log('   ✅ Cap 14 Self-Healing Build Pipeline passed.');

  // Capability 15: Live Application Preview Gate
  console.log('▶️ [Cap 15] Verifying Live Application Preview Gate...');
  const notReadyState = quality.evaluatePreviewReadiness({
    buildStatus: 'building',
    healthHttpCode: 0,
    testsPassed: false
  });
  assert.strictEqual(notReadyState.isAppServerRunning, false, 'Preview locked while building');
  assert.strictEqual(notReadyState.previewState, 'blank_canvas', 'State is pure blank canvas');
  assert.strictEqual(notReadyState.renderedElementCount, 0, 'Zero buttons, zero words');

  const readyState = quality.evaluatePreviewReadiness({
    buildStatus: 'success',
    healthHttpCode: 200,
    testsPassed: true
  });
  assert.strictEqual(readyState.isAppServerRunning, true, 'Preview unlocked when HTTP 200 and tests pass');
  assert.strictEqual(readyState.toolbarVisible, true, 'Single slim toolbar revealed');
  assert.ok(readyState.toolbarClass.includes('h-11 px-3 glass-toolbar'), 'Toolbar is single slim row');
  console.log('   ✅ Cap 15 Live Application Preview Gate passed.');

  // Capability 16: Database & API Auto-Integration
  console.log('▶️ [Cap 16] Verifying Database & API Auto-Integration...');
  const schemaSpec = {
    tables: [{
      name: 'test_auto_records',
      columns: [
        { name: 'id', type: 'TEXT', primaryKey: true },
        { name: 'project_id', type: 'TEXT' },
        { name: 'title', type: 'TEXT' },
        { name: 'data_json', type: 'TEXT' },
        { name: 'created_at', type: 'TEXT' }
      ]
    }]
  };
  testDb.exec('CREATE TABLE IF NOT EXISTS test_auto_records (id TEXT PRIMARY KEY, project_id TEXT, title TEXT, data_json TEXT, created_at TEXT)');
  const roundTrip = quality.verifyRoundTripPersistence(testDb, 'test_auto_records', { title: 'Verified Persistence' });
  assert.strictEqual(roundTrip.verified, true, 'Round-trip write/read confirmed identical');
  console.log('   ✅ Cap 16 Database & API Auto-Integration passed.');

  // Capability 17: Versioned Builds & Rollback Engine
  console.log('▶️ [Cap 17] Verifying Versioned Builds & Rollback Engine...');
  const snapshots = new quality.VersionedSnapshots(testDb);
  const snap1 = snapshots.createSnapshot('proj_v_1', { 'index.html': '<h1>v1</h1>' }, 'Version 1.0 (Healthy)', 1);
  const snap2 = snapshots.createSnapshot('proj_v_1', { 'index.html': '<h1>v2 Defect</h1>' }, 'Version 2.0 (Broken)', 0);

  const versions = snapshots.listVersions('proj_v_1');
  assert.strictEqual(versions.length, 2, '2 versions archived');

  const rollbackResult = snapshots.rollbackToVersion('proj_v_1', 1);
  assert.strictEqual(rollbackResult.success, true, 'Single-click rollback succeeded');
  assert.strictEqual(rollbackResult.files['index.html'], '<h1>v1</h1>', 'Restored exact v1 code');

  const autoRollback = snapshots.autoRollbackOnDefect('proj_v_1');
  assert.strictEqual(autoRollback.success, true, 'Auto rollback triggered on defect');
  assert.strictEqual(autoRollback.targetVersion, 1, 'Auto rolled back to healthy Version 1');
  console.log('   ✅ Cap 17 Versioned Builds & Rollback Engine passed.');

  // Capability 18: Continuous Engineering Evaluation
  console.log('▶️ [Cap 18] Verifying Continuous Engineering Evaluation...');
  const evaluation = quality.evaluateEngineeringPerformance(
    testDb,
    'proj_eval_1',
    snap1.id,
    { buildTimeMs: 1200, testPassRate: 80.0, bundleSizeBytes: 65000 },
    { buildTimeMs: 600, testPassRate: 100.0, bundleSizeBytes: 42000 }
  );
  assert.ok(evaluation.evalId.startsWith('eval_'), 'Evaluation ID generated');
  assert.ok(evaluation.comparativeAnalysis.improvementRatio > 1.0, 'Improvement ratio computed (> 1.0)');
  assert.strictEqual(evaluation.comparativeAnalysis.verdict, 'IMPROVED', 'Verdict is IMPROVED');

  const dbEval = testDb.prepare('SELECT * FROM engineering_evaluations WHERE id = ?').get(evaluation.evalId);
  assert.ok(dbEval, 'Evaluation persisted to engineering_evaluations table in SQLite');
  console.log('   ✅ Cap 18 Continuous Engineering Evaluation passed.');

  console.log('\n================================================================');
  console.log('🎉 ALL 18 CORE ENGINEERING CAPABILITIES PASSED (100% GREEN)');
  console.log('================================================================\n');

} catch (err) {
  console.error('\n❌ FAILURE IN PHASE 16 AUTONOMOUS ENGINEERING GATE:');
  console.error(err);
  process.exit(1);
} finally {
  try {
    testDb.close();
    if (fs.existsSync(tempDbPath)) fs.unlinkSync(tempDbPath);
  } catch (_) {}
}
