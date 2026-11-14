// ==============================================================================
// ENGINEER — ADVANCED SOFTWARE ENGINEERING SUITE (Phase 2)
// Full Acceptance Verification for 15 Engineering Capabilities & Integrated End-to-End Flow
// ==============================================================================

const assert = require('node:assert');
const path = require('node:path');
const esbuild = require('esbuild');
const JSZip = require('jszip');

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

async function runPhase2AdvancedEngineeringSuite() {
  console.log('================================================================');
  console.log('🚀 RUNNING PHASE 2 ADVANCED SOFTWARE ENGINEERING TEST SUITE');
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

  // Load Engineering Engines
  const {
    calculateSymbolImpact,
    buildProjectDependencyGraph,
    parseSymbolsInFile,
  } = loadTsModule('src/services/engineering/codeIntelligenceEngine.ts');

  const {
    createRollbackSnapshot,
    restoreRollbackSnapshot,
    createModificationPlan,
    applyModificationPlan,
  } = loadTsModule('src/services/engineering/safeModificationEngine.ts');

  const {
    unpackProjectZip,
    analyzeProjectHealth,
    createProjectFromImport,
  } = loadTsModule('src/services/engineering/projectImportModernizer.ts');

  const {
    synthesizeCodeFromDesign,
    generateDiscrepancyReport,
  } = loadTsModule('src/services/engineering/designToCodeEngine.ts');

  const {
    designTableSchema,
    generateMigration,
    executeSafeMigration,
    rollbackToDbBackup,
  } = loadTsModule('src/services/engineering/databaseArchitect.ts');

  const {
    generateSbomAndAuditDependencies,
    auditProjectSecurity,
    createHumanApprovalRequest,
    resolveHumanApproval,
    verifyHumanApprovalToken,
  } = loadTsModule('src/services/engineering/dependencySecurityAudit.ts');

  const {
    auditProjectPerformance,
    auditProjectAccessibility,
  } = loadTsModule('src/services/engineering/performanceA11yAuditor.ts');

  const {
    exportStandaloneProjectZip,
    generateCleanEnvExample,
    generateProjectReadme,
  } = loadTsModule('src/services/engineering/projectExportEngine.ts');

  const { createSeedProjects } = loadTsModule('src/utils/platformEngine.ts');

  // ---------------------------------------------------------------------------
  // Test 1: Code Intelligence & AST Dependency Graph
  // ---------------------------------------------------------------------------
  await runTest('Domain 1: AST Parsing & Dependency Graph Generation', () => {
    const files = [
      {
        id: 'f1',
        name: 'apiClient.ts',
        path: 'src/apiClient.ts',
        content: `
          export interface UserData { id: string; name: string; }
          export async function fetchUserData(userId: string): Promise<UserData> {
            return { id: userId, name: "Ali" };
          }
        `,
        language: 'typescript',
        size: 200,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'f2',
        name: 'UserProfile.tsx',
        path: 'src/UserProfile.tsx',
        content: `
          import { fetchUserData } from './apiClient';
          export function UserProfile() {
            const data = fetchUserData("123");
            return <div>{data.name}</div>;
          }
        `,
        language: 'typescript',
        size: 200,
        updatedAt: new Date().toISOString(),
      },
    ];

    const symbols = parseSymbolsInFile('src/apiClient.ts', files[0].content);
    assert.ok(symbols.some((s) => s.name === 'fetchUserData' && s.kind === 'function'));
    assert.ok(symbols.some((s) => s.name === 'UserData' && s.kind === 'interface'));

    const graph = buildProjectDependencyGraph(files);
    assert.strictEqual(graph.totalFiles, 2);
    assert.ok(graph.nodes['src/UserProfile.tsx'].dependsOn.includes('src/apiClient.ts'));
    assert.ok(graph.nodes['src/apiClient.ts'].dependedOnBy.includes('src/UserProfile.tsx'));
  });

  // ---------------------------------------------------------------------------
  // Test 2: Symbol Impact Analysis & Breaking Change Detection
  // ---------------------------------------------------------------------------
  await runTest('Domain 2: Symbol Impact Analysis on Caller Sites', () => {
    const files = [
      {
        id: 'f1',
        name: 'authService.ts',
        path: 'src/authService.ts',
        content: 'export function authenticate(token: string) { return true; }',
        language: 'typescript',
        size: 100,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'f2',
        name: 'header.tsx',
        path: 'src/header.tsx',
        content: "import { authenticate } from './authService';\nauthenticate('abc');",
        language: 'typescript',
        size: 100,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'f3',
        name: 'login.tsx',
        path: 'src/login.tsx',
        content: "import { authenticate } from './authService';\nconst ok = authenticate('xyz');",
        language: 'typescript',
        size: 100,
        updatedAt: new Date().toISOString(),
      },
    ];

    const impact = calculateSymbolImpact('authenticate', 'src/authService.ts', files);
    assert.strictEqual(impact.targetSymbol, 'authenticate');
    assert.strictEqual(impact.totalCallSites, 2);
    assert.strictEqual(impact.affectedFiles.length, 2);
    assert.ok(impact.breakingChangesRisk === 'medium' || impact.breakingChangesRisk === 'high');
  });

  // ---------------------------------------------------------------------------
  // Test 3: Safe Code Modification, Conflict Guard & Rollback
  // ---------------------------------------------------------------------------
  await runTest('Domain 3: Safe Modification, Unsaved Edits Conflict & 1-Click Rollback', () => {
    const seed = createSeedProjects()[0];
    const targetFile = seed.files[0];
    const originalContent = targetFile.content;

    // 1. Create Rollback Snapshot
    const snapshot = createRollbackSnapshot(seed, 'Pre-test snapshot');
    assert.ok(snapshot.id.startsWith('snap_'));

    // 2. Conflict detection: Mark file dirty
    targetFile.isDirty = true;
    const impact = calculateSymbolImpact('', targetFile.path, seed.files);
    const plan = createModificationPlan(
      'Update file header',
      seed,
      impact,
      { [targetFile.path]: originalContent + '\n// Added safe modification' }
    );
    assert.strictEqual(plan.hasUnsavedConflicts, true);
    assert.strictEqual(plan.requiresUserApproval, true);

    // 3. Clear dirty state and apply cleanly
    targetFile.isDirty = false;
    const cleanPlan = createModificationPlan(
      'Update file header',
      seed,
      impact,
      { [targetFile.path]: originalContent + '\n// Added safe modification' }
    );
    assert.strictEqual(cleanPlan.hasUnsavedConflicts, false);
    const applyRes = applyModificationPlan(cleanPlan, seed, false);
    assert.strictEqual(applyRes.success, true);
    assert.ok(targetFile.content.includes('// Added safe modification'));

    // 4. Test Rollback
    const restoreRes = restoreRollbackSnapshot(seed, snapshot.id);
    assert.strictEqual(restoreRes.success, true);
    assert.strictEqual(targetFile.content, originalContent);
  });

  // ---------------------------------------------------------------------------
  // Test 4: Existing Project Import & Framework Discovery
  // ---------------------------------------------------------------------------
  await runTest('Domain 4: ZIP Project Ingestion & Modernization Report', async () => {
    const zip = new JSZip();
    zip.file(
      'package.json',
      JSON.stringify({
        name: 'legacy-react-app',
        version: '1.0.0',
        scripts: { build: 'vite build', start: 'vite' },
        dependencies: { react: '^18.2.0', 'react-dom': '^18.2.0' },
      })
    );
    zip.file('src/App.tsx', 'import React from "react"; export function App() { return <h1>Legacy</h1>; }');
    zip.file('src/index.css', 'body { margin: 0; }');

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
    const { files, report } = await unpackProjectZip(zipBuffer, 'legacy-react-app');

    assert.strictEqual(files.length, 3);
    assert.strictEqual(report.framework, 'react');
    assert.ok(report.scriptsFound.build);
    assert.ok(report.healthScore >= 50);

    const importedProject = createProjectFromImport('legacy-react-app', files, report);
    assert.strictEqual(importedProject.name, 'legacy-react-app');
    assert.strictEqual(importedProject.files.length, 3);
  });

  // ---------------------------------------------------------------------------
  // Test 5: Visual Design-to-Code & Discrepancy Reporting
  // ---------------------------------------------------------------------------
  await runTest('Domain 5: Visual Design-to-Code Synthesis & Discrepancy Report', () => {
    const designSpec = {
      title: 'بوابة الخدمات الهندسية',
      layout: 'dashboard',
      colorPalette: {
        primary: '#2563eb',
        background: '#f8fafc',
        surface: '#ffffff',
        text: '#0f172a',
        accent: '#10b981',
      },
      typography: {
        fontFamily: 'Tajawal, sans-serif',
        headingSize: '2rem',
        bodySize: '1rem',
      },
      components: [
        { type: 'navbar', title: 'الرئيسية', rtlSupport: true },
        { type: 'hero', title: 'مرحبا بك في بوابة الخدمات', rtlSupport: true },
        { type: 'cards_grid', title: 'المشاريع الحالية', elementsCount: 3, rtlSupport: true },
        { type: 'form', title: 'تواصل معنا', rtlSupport: true },
      ],
      responsiveBreakpoints: ['mobile', 'tablet', 'desktop'],
      direction: 'rtl',
    };

    const synthesized = synthesizeCodeFromDesign(designSpec);
    assert.ok(synthesized.html.includes('dir="rtl"'));
    assert.ok(synthesized.html.includes('بوابة الخدمات'));
    assert.ok(synthesized.css.includes('@media'));
    assert.ok(synthesized.discrepancyReport.overallSimilarityScore >= 80);
    assert.strictEqual(synthesized.discrepancyReport.layoutAlignmentScore >= 80, true);
  });

  // ---------------------------------------------------------------------------
  // Test 6: Database Architect & Non-Destructive Migrations
  // ---------------------------------------------------------------------------
  await runTest('Domain 6: Database Schema, Dangerous Migration Guard & Rollback', () => {
    const seed = createSeedProjects()[0];
    seed.dbTables = [
      {
        id: 't1',
        name: 'customers',
        columns: [{ name: 'id', type: 'UUID', primaryKey: true }],
        rows: [{ id: '1', name: 'Company A' }],
        rlsEnabled: true,
        updatedAt: new Date().toISOString(),
      },
    ];

    // 1. Dangerous Migration Detection: DROP TABLE
    const dangerousMig = generateMigration(
      'Remove Customers Table',
      'DROP TABLE customers;',
      'CREATE TABLE customers (id UUID PRIMARY KEY);',
      seed.dbTables
    );
    assert.strictEqual(dangerousMig.isDangerous, true);
    assert.ok(dangerousMig.dangerDetails.dropsTable === 'customers');
    assert.ok(dangerousMig.dangerDetails.affectsExistingData === true);

    // 2. Guard: Must reject without explicit human approval
    const blockedRes = executeSafeMigration(dangerousMig, seed, false);
    assert.strictEqual(blockedRes.success, false);
    assert.ok(blockedRes.error.includes('بوابة الأمان'));

    // 3. Execution upon explicit human approval with automated pre-backup
    const approvedRes = executeSafeMigration(dangerousMig, seed, true);
    assert.strictEqual(approvedRes.success, true);
    assert.ok(approvedRes.backupSnapshotId);
    assert.strictEqual(seed.dbTables.length, 0);

    // 4. Test atomic database rollback
    const rollbackRes = rollbackToDbBackup(seed, approvedRes.backupSnapshotId);
    assert.strictEqual(rollbackRes, true);
    assert.strictEqual(seed.dbTables.length, 1);
    assert.strictEqual(seed.dbTables[0].name, 'customers');
  });

  // ---------------------------------------------------------------------------
  // Test 7: Dependency Intelligence & SBOM Generation
  // ---------------------------------------------------------------------------
  await runTest('Domain 7: SBOM Generation (CycloneDX) & Dependency Auditing', () => {
    const files = [
      {
        id: 'f1',
        name: 'package.json',
        path: 'package.json',
        content: JSON.stringify({
          name: 'cloud-app',
          dependencies: {
            lodash: '4.17.15',
            express: '^4.18.2',
          },
        }),
        language: 'json',
        size: 100,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'f2',
        name: 'package-lock.json',
        path: 'package-lock.json',
        content: '{}',
        language: 'json',
        size: 2,
        updatedAt: new Date().toISOString(),
      },
    ];

    const sbom = generateSbomAndAuditDependencies('cloud-app', files);
    assert.strictEqual(sbom.bomFormat, 'CycloneDX-JSON');
    assert.strictEqual(sbom.summary.hasLockfile, true);
    assert.strictEqual(sbom.summary.lockfileType, 'npm');
    assert.strictEqual(sbom.components.length, 2);
    // Known CVE check for lodash 4.17.15
    const lodashComp = sbom.components.find((c) => c.name === 'lodash');
    assert.ok(lodashComp);
    assert.ok(lodashComp.vulnerabilities.length > 0);
  });

  // ---------------------------------------------------------------------------
  // Test 8: Security Auditing (SQLi, Injection, Secrets, XSS)
  // ---------------------------------------------------------------------------
  await runTest('Domain 8: Static Security Auditing & Vulnerability Scans', () => {
    const filesWithVulnerabilities = [
      {
        id: 'sec1',
        name: 'db.ts',
        path: 'src/db.ts',
        content: 'const res = query("SELECT * FROM users WHERE id = " + userId);',
        language: 'typescript',
        size: 100,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'sec2',
        name: 'cmd.ts',
        path: 'src/cmd.ts',
        content: 'const out = execSync(`ping ${host}`);',
        language: 'typescript',
        size: 100,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'sec3',
        name: 'api.ts',
        path: 'src/api.ts',
        content: 'const OPENAI_KEY = "sk-1234567890abcdef1234567890abcdef12345678";',
        language: 'typescript',
        size: 100,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'sec4',
        name: 'view.tsx',
        path: 'src/view.tsx',
        content: '<div dangerouslySetInnerHTML={{ __html: userHtml }} />',
        language: 'typescript',
        size: 100,
        updatedAt: new Date().toISOString(),
      },
    ];

    const report = auditProjectSecurity(filesWithVulnerabilities);
    assert.strictEqual(report.status, 'failed');
    assert.ok(report.vulnerabilities.some((v) => v.type === 'sql_injection'));
    assert.ok(report.vulnerabilities.some((v) => v.type === 'command_injection'));
    assert.ok(report.vulnerabilities.some((v) => v.type === 'secret_leak'));
    assert.ok(report.vulnerabilities.some((v) => v.type === 'xss'));
    assert.ok(report.secretsDetected.length > 0);
  });

  // ---------------------------------------------------------------------------
  // Test 9: Human Safety Gates
  // ---------------------------------------------------------------------------
  await runTest('Domain 9: Human Safety Gate Tokens & Decision Workflow', () => {
    const req = createHumanApprovalRequest('drop_database', 'Drop production database for maintenance', 'agent_db');
    assert.strictEqual(req.status, 'pending');

    // Token verification before approval must fail
    const preCheck = verifyHumanApprovalToken(req.id, 'dummy');
    assert.strictEqual(preCheck.valid, false);

    // Resolve with approval
    const approved = resolveHumanApproval(req.id, 'approved', 'Salem Al-Derei', 'Confirmed maintenance window');
    assert.strictEqual(approved.status, 'approved');
    assert.ok(approved.approvalToken);

    // Verify valid token
    const tokenCheck = verifyHumanApprovalToken(req.id, approved.approvalToken);
    assert.strictEqual(tokenCheck.valid, true);
  });

  // ---------------------------------------------------------------------------
  // Test 10: Performance Profiler & Concurrent Stress Simulator
  // ---------------------------------------------------------------------------
  await runTest('Domain 10: Performance Profiling & Concurrent Stress Simulation', () => {
    const files = [
      {
        id: 'p1',
        name: 'package.json',
        path: 'package.json',
        content: JSON.stringify({ dependencies: { moment: '^2.29.4' } }),
        language: 'json',
        size: 50,
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'p2',
        name: 'query.ts',
        path: 'src/query.ts',
        content: 'const all = db.query("SELECT * FROM large_table;");',
        language: 'typescript',
        size: 60,
        updatedAt: new Date().toISOString(),
      },
    ];

    const perf = auditProjectPerformance(files, 200);
    assert.ok(perf.estimatedMetrics.fcpMs > 0);
    assert.ok(perf.heavyDependencies.some((d) => d.name === 'moment'));
    assert.ok(perf.slowQueryRisks.length > 0);
    assert.strictEqual(perf.stressSimulation.simulatedUsers, 200);
    assert.ok(perf.stressSimulation.throughputReqPerSec > 0);
    assert.ok(perf.stressSimulation.p50LatencyMs > 0);
    assert.ok(perf.stressSimulation.p95LatencyMs >= perf.stressSimulation.p50LatencyMs);
  });

  // ---------------------------------------------------------------------------
  // Test 11: Accessibility (WCAG 2.1 AA) & UX Reviewer
  // ---------------------------------------------------------------------------
  await runTest('Domain 11: WCAG 2.1 AA, Touch Targets & RTL Alignment', () => {
    const files = [
      {
        id: 'a1',
        name: 'index.html',
        path: 'index.html',
        // Arabic text without dir="rtl", img without alt, input without label
        content: `
          <html lang="ar">
            <body>
              <img src="/logo.png" />
              <input type="text" name="search" />
              <div onClick={() => console.log('click')}>Click Me</div>
              <button style="height: 30px; width: 30px;">Small</button>
            </body>
          </html>
        `,
        language: 'html',
        size: 300,
        updatedAt: new Date().toISOString(),
      },
    ];

    const a11y = auditProjectAccessibility(files);
    assert.ok(a11y.wcagCompliance === 'Non-Compliant' || a11y.wcagCompliance === 'Partially Compliant');
    assert.ok(a11y.issues.some((i) => i.ruleId === 'wcag-1.1.1-image-alt'));
    assert.ok(a11y.issues.some((i) => i.ruleId === 'wcag-3.3.2-input-label'));
    assert.ok(a11y.issues.some((i) => i.ruleId === 'wcag-2.5.8-target-size'));
    assert.ok(a11y.issues.some((i) => i.ruleId === 'engineer-ux-rtl-direction'));
    assert.strictEqual(a11y.touchTargetCompliance.passed, false);
    assert.strictEqual(a11y.rtlEvaluation.missingRtlDir, true);
  });

  // ---------------------------------------------------------------------------
  // Test 12: Professional Standalone Export & Zero Secrets Leakage Gate
  // ---------------------------------------------------------------------------
  await runTest('Domain 12: Professional Standalone Export & Zero Secrets Leak Gate', async () => {
    const project = {
      id: 'proj_exp',
      name: 'TaskMaster Pro',
      description: 'Enterprise Project Management System',
      category: 'Productivity',
      files: [
        {
          id: 'f1',
          name: '.env',
          path: '.env',
          content: 'DATABASE_URL=postgres://real_user:secret_pass@10.0.0.1/prod\nOPENAI_KEY=sk-realSecretKeyHere1234567890abcdef',
          language: 'dotenv',
          size: 100,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'f2',
          name: 'package.json',
          path: 'package.json',
          content: JSON.stringify({ name: 'taskmaster', scripts: { dev: 'tsx server.ts' } }),
          language: 'json',
          size: 80,
          updatedAt: new Date().toISOString(),
        },
        {
          id: 'f3',
          name: 'server.ts',
          path: 'src/server.ts',
          content: 'console.log(process.env.DATABASE_URL, process.env.STRIPE_SECRET_KEY);',
          language: 'typescript',
          size: 80,
          updatedAt: new Date().toISOString(),
        },
      ],
      dbTables: [
        {
          id: 't1',
          name: 'tasks',
          columns: [
            { name: 'id', type: 'UUID', primaryKey: true },
            { name: 'title', type: 'TEXT', nullable: false },
          ],
          rows: [],
          rlsEnabled: true,
          updatedAt: new Date().toISOString(),
        },
      ],
      dbBackups: [],
      deployments: [],
      updatedAt: new Date().toISOString(),
    };

    const exported = await exportStandaloneProjectZip(project);
    assert.strictEqual(exported.manifest.secretsLeaked, false);
    assert.strictEqual(exported.manifest.hasEnvExample, true);
    assert.strictEqual(exported.manifest.hasReadme, true);
    assert.strictEqual(exported.manifest.hasMigrations, true);
    assert.strictEqual(exported.manifest.hasApiDocs, true);

    // Unpack the exported ZIP to verify physical contents
    const unzipped = await JSZip.loadAsync(exported.zipBuffer);
    const fileNames = Object.keys(unzipped.files);

    // Real .env MUST NOT be in the export package
    assert.strictEqual(fileNames.includes('.env'), false, 'FATAL: Plaintext .env leaked in export package!');

    // Sanitized .env.example MUST exist
    assert.strictEqual(fileNames.includes('.env.example'), true);
    const envExampleContent = await unzipped.file('.env.example').async('string');
    assert.strictEqual(envExampleContent.includes('secret_pass'), false);
    assert.ok(envExampleContent.includes('DATABASE_URL'));
    assert.ok(envExampleContent.includes('STRIPE_SECRET_KEY'));

    // Production README.md MUST exist
    assert.strictEqual(fileNames.includes('README.md'), true);
    const readmeContent = await unzipped.file('README.md').async('string');
    assert.ok(readmeContent.includes('TaskMaster Pro'));
    assert.ok(readmeContent.includes('npm install'));

    // Database Migration MUST exist
    assert.strictEqual(fileNames.includes('migrations/001_initial_schema.sql'), true);
    const migContent = await unzipped.file('migrations/001_initial_schema.sql').async('string');
    assert.ok(migContent.includes('CREATE TABLE IF NOT EXISTS "tasks"'));
  });

  // ---------------------------------------------------------------------------
  // Test 13: Integrated End-to-End Acceptance Scenario
  // ---------------------------------------------------------------------------
  await runTest('Domain 13: Integrated End-to-End Acceptance Scenario (Full Lifecycle)', async () => {
    // Stage 1: Ingest external project ZIP
    const initialZip = new JSZip();
    initialZip.file(
      'package.json',
      JSON.stringify({
        name: 'invoice-engine',
        version: '1.0.0',
        scripts: { dev: 'tsx index.ts', build: 'tsc' },
        dependencies: { express: '^4.18.2' },
      })
    );
    initialZip.file(
      'src/invoiceService.ts',
      'export function calculateTax(amount: number): number { return amount * 0.15; }'
    );
    initialZip.file(
      'src/checkout.ts',
      'import { calculateTax } from "./invoiceService";\nexport function checkout(total: number) { return total + calculateTax(total); }'
    );

    const initBuffer = await initialZip.generateAsync({ type: 'nodebuffer' });
    const { files: importedFiles, report: health } = await unpackProjectZip(initBuffer, 'invoice-engine');
    const project = createProjectFromImport('invoice-engine', importedFiles, health);
    assert.strictEqual(project.files.length, 3);

    // Stage 2: Code Intelligence & Impact Analysis when changing calculateTax
    const impact = calculateSymbolImpact('calculateTax', 'src/invoiceService.ts', project.files);
    assert.strictEqual(impact.totalCallSites, 1);
    assert.ok(impact.affectedFiles.includes('src/checkout.ts'));

    // Stage 3: Safe Surgical Modification with Rollback Snapshot
    const snapshot = createRollbackSnapshot(project, 'Before tax logic update');
    const modPlan = createModificationPlan(
      'Update tax rate calculation',
      project,
      impact,
      {
        'src/invoiceService.ts': 'export function calculateTax(amount: number): number { return amount * 0.20; }',
      }
    );
    const modRes = applyModificationPlan(modPlan, project);
    assert.strictEqual(modRes.success, true);
    assert.ok(project.files.find((f) => f.path.replace(/^\/+/, '') === 'src/invoiceService.ts')?.content.includes('0.20'));

    // Stage 4: Database Architect - Add Tables & Safe Migration
    project.dbTables = [
      designTableSchema({
        entityName: 'invoices',
        fields: [
          { name: 'id', type: 'UUID', primaryKey: true },
          { name: 'amount', type: 'INTEGER', nullable: false },
          { name: 'tax', type: 'INTEGER', nullable: false },
        ],
      }),
    ];
    assert.strictEqual(project.dbTables.length, 1);
    assert.strictEqual(project.dbTables[0].name, 'invoices');

    // Stage 5: Full Engineering Audit (Security, SBOM, Performance, a11y)
    const sbom = generateSbomAndAuditDependencies(project.name, project.files);
    const security = auditProjectSecurity(project.files);
    const perf = auditProjectPerformance(project.files, 150);
    const a11y = auditProjectAccessibility(project.files);
    assert.ok(sbom.summary.totalDependencies > 0);
    assert.strictEqual(security.status, 'passed');
    assert.ok(perf.estimatedMetrics.bundleSizeBytes > 0);
    assert.ok(a11y.score > 0);

    // Stage 6: Export Clean Standalone Runnable Project
    const standalone = await exportStandaloneProjectZip(project);
    assert.strictEqual(standalone.manifest.secretsLeaked, false);
    assert.strictEqual(standalone.manifest.hasEnvExample, true);
    assert.strictEqual(standalone.manifest.hasReadme, true);
    assert.strictEqual(standalone.manifest.hasMigrations, true);
    assert.ok(standalone.base64Zip.length > 500);
  });

  console.log('\n================================================================');
  console.log(`🎉 PHASE 2 ADVANCED ENGINEERING SUITE PASSED (${passedTests}/${totalTests} TESTS)`);
  console.log('================================================================\n');
}

// Execute if run directly
if (require.main === module) {
  runPhase2AdvancedEngineeringSuite().catch((err) => {
    console.error('Test suite failed:', err);
    process.exit(1);
  });
}

module.exports = { runPhase2AdvancedEngineeringSuite };
