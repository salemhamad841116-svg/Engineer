import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCodeContent,
  findInFile,
  searchAcrossProject,
  replaceInFileContent,
  detectFunctionDefinitions,
  analyzeCodeDiagnostics,
  applyDiagnosticFix,
  analyzeImportedProjectFiles,
  executeProjectTests,
  validateDestructiveDbAction,
  buildDeployment17Steps,
  calculateWorkingTreeChanges,
  createNewProjectFromSpec,
} from './platformEngine';
import { getInitialButtonRegistry, runAutomatedRegistryVerification } from './buttonRegistry';

test('code editor search, replace, format, and symbol detection work accurately', () => {
  const sample = `export function calculateTotal(items: number[]) {\nconst sum = items.reduce((a, b) => a + b, 0);\nreturn sum;\n}`;
  const formatted = formatCodeContent(sample, 'typescript');
  assert.ok(formatted.includes('  const sum'));

  const hits = findInFile(formatted, 'sum');
  assert.equal(hits.length, 2);

  const replaced = replaceInFileContent(formatted, 'sum', 'totalAmount', true);
  assert.equal(replaced.replacementsCount, 2);
  assert.ok(replaced.newContent.includes('totalAmount'));

  const defs = detectFunctionDefinitions(formatted);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].name, 'calculateTotal');
});

test('diagnostics scanner detects issues and applies surgical fix without deleting code', () => {
  const proj = createNewProjectFromSpec({
    name: 'Test Diagnostics App',
    description: 'Verifies AST diagnostic detection and surgical fix',
    category: 'app',
    appType: 'SaaS',
    techStack: 'react-ts-vite',
    template: 'saas-starter',
    language: 'ar',
    direction: 'rtl',
    databaseEngine: 'postgresql',
    deployTarget: 'cloud-run-eu',
  });

  const issues = analyzeCodeDiagnostics(proj.files);
  assert.ok(issues.length >= 1);
  const firstIssue = issues[0];
  assert.equal(firstIssue.fixed, false);

  const { updatedFiles, fixedIssue } = applyDiagnosticFix(proj.files, firstIssue);
  assert.equal(fixedIssue.fixed, true);
  const remainingIssues = analyzeCodeDiagnostics(updatedFiles);
  assert.equal(remainingIssues.length, 0);
});

test('imported project analyzer detects tech stack, libraries, and config files', () => {
  const result = analyzeImportedProjectFiles('Imported Next App', [
    {
      path: 'package.json',
      content: JSON.stringify({
        dependencies: { next: '15.0.0', react: '19.0.0', tailwindcss: '4.0.0' },
      }),
    },
    {
      path: 'src/App.tsx',
      content: 'export default function App() { return <h1>Hello</h1>; }',
    },
  ]);

  assert.equal(result.detectedStack, 'nextjs-fullstack');
  assert.ok(result.detectedLibraries.includes('next'));
  assert.ok(result.configFiles.includes('/package.json'));
  assert.equal(result.normalizedFiles.length, 2);
});

test('database destructive action guard enforces confirmation and backup snapshot', () => {
  const unconfirmed = validateDestructiveDbAction('drop_table', false, 2);
  assert.equal(unconfirmed.allowed, false);

  const noBackup = validateDestructiveDbAction('drop_table', true, 0);
  assert.equal(noBackup.allowed, false);

  const safeAllowed = validateDestructiveDbAction('drop_table', true, 1);
  assert.equal(safeAllowed.allowed, true);
});

test('17-step cloud deployment builder produces all 17 verified stages', () => {
  const steps = buildDeployment17Steps({
    environment: 'production',
    appName: 'fintrack-erp',
    domain: 'fintrack-erp.cloudstudio.run.app',
    region: 'europe-west2',
    cpuRam: '2 vCPU / 4 GB',
    envVarsCount: 3,
    dbLinked: true,
    storageLinked: true,
  });

  assert.equal(steps.length, 17);
  assert.equal(steps[0].stepNumber, 1);
  assert.equal(steps[16].stepNumber, 17);
  assert.ok(steps[16].detailLog.includes('https://fintrack-erp.cloudstudio.run.app'));
});

test('test runner and button registry verifier validate end-to-end workflows', () => {
  const proj = createNewProjectFromSpec({
    name: 'E2E Runner App',
    description: 'Test verification',
    category: 'website',
    appType: 'Portal',
    techStack: 'react-ts-vite',
    template: 'blank',
    language: 'en',
    direction: 'ltr',
    databaseEngine: 'postgresql',
    deployTarget: 'cloud-run-eu',
  });

  // Fix initial diagnostic so security test passes too
  if (proj.diagnostics.length > 0) {
    const fixed = applyDiagnosticFix(proj.files, proj.diagnostics[0]);
    proj.files = fixed.updatedFiles;
    proj.diagnostics = [];
  }

  const testResults = executeProjectTests(proj, 'all');
  assert.equal(testResults.length, 9);
  assert.ok(testResults.every((t) => t.status === 'passed'));

  const registry = getInitialButtonRegistry();
  const verification = runAutomatedRegistryVerification(registry, proj);
  assert.equal(verification.passedCount, verification.totalCount);
  assert.ok(verification.totalCount >= 14);

  // Also check project search & git diff
  const matches = searchAcrossProject(proj.files, 'E2E Runner App');
  assert.ok(matches.length >= 1);

  proj.files[0].content += '\n// Added footer comment\n';
  const gitChanges = calculateWorkingTreeChanges(proj.files, proj.gitCommits[0]);
  assert.equal(gitChanges.length, 1);
  assert.equal(gitChanges[0].status, 'modified');
});
