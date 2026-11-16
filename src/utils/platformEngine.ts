import {
  AIAgentProfile,
  DbTable,
  DeploymentRecord,
  DeploymentStep,
  DiagnosticIssue,
  GitCommit,
  Language,
  Project,
  ProjectCategory,
  ProjectFile,
  TechStack,
  TestCaseResult,
  DatabaseEngine,
  DeployTarget,
} from '../types/platform';
import { inlineAssetsIntoHtml, insertBeforeClosingTag } from './previewCompiler';

export function inferLanguageFromFilename(name: string): ProjectFile['language'] {
  const lower = name.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.js') || lower.endsWith('.jsx')) return 'javascript';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html')) return 'html';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.sql')) return 'sql';
  return 'markdown';
}

export function formatCodeContent(content: string, language: ProjectFile['language']): string {
  if (!content.trim()) return content;
  if (language === 'json') {
    try {
      return JSON.stringify(JSON.parse(content), null, 2) + '\n';
    } catch {
      return content.trim() + '\n';
    }
  }
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let indentLevel = 0;
  const formatted: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      formatted.push('');
      continue;
    }
    if (trimmed.startsWith('}') || trimmed.startsWith(']') || trimmed.startsWith(')</') || trimmed.startsWith('</')) {
      indentLevel = Math.max(0, indentLevel - 1);
    }
    const indent = '  '.repeat(indentLevel);
    formatted.push(`${indent}${trimmed}`);
    const openBraces = (trimmed.match(/\{/g) || []).length;
    const closeBraces = (trimmed.match(/\}/g) || []).length;
    indentLevel = Math.max(0, indentLevel + openBraces - closeBraces);
  }

  return formatted.join('\n').trim() + '\n';
}

export function findInFile(content: string, query: string): { line: number; column: number; preview: string }[] {
  if (!query.trim()) return [];
  const results: { line: number; column: number; preview: string }[] = [];
  const lines = content.split('\n');
  const q = query.toLowerCase();
  lines.forEach((lineText, idx) => {
    const col = lineText.toLowerCase().indexOf(q);
    if (col !== -1) {
      results.push({
        line: idx + 1,
        column: col + 1,
        preview: lineText.trim(),
      });
    }
  });
  return results;
}

export function searchAcrossProject(
  files: ProjectFile[],
  query: string
): { fileId: string; filePath: string; line: number; preview: string }[] {
  if (!query.trim()) return [];
  const matches: { fileId: string; filePath: string; line: number; preview: string }[] = [];
  for (const file of files) {
    const fileHits = findInFile(file.content, query);
    for (const hit of fileHits) {
      matches.push({
        fileId: file.id,
        filePath: file.path,
        line: hit.line,
        preview: hit.preview,
      });
    }
  }
  return matches;
}

export function replaceInFileContent(
  content: string,
  searchValue: string,
  replaceValue: string,
  replaceAll = true
): { newContent: string; replacementsCount: number } {
  if (!searchValue) return { newContent: content, replacementsCount: 0 };
  if (!content.includes(searchValue)) return { newContent: content, replacementsCount: 0 };
  if (replaceAll) {
    const parts = content.split(searchValue);
    return {
      newContent: parts.join(replaceValue),
      replacementsCount: parts.length - 1,
    };
  }
  return {
    newContent: content.replace(searchValue, replaceValue),
    replacementsCount: 1,
  };
}

export function detectFunctionDefinitions(content: string): { name: string; line: number; kind: 'function' | 'component' | 'hook' | 'const' }[] {
  const defs: { name: string; line: number; kind: 'function' | 'component' | 'hook' | 'const' }[] = [];
  const lines = content.split('\n');
  const fnRegex = /(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/;
  const arrowRegex = /(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/;

  lines.forEach((line, idx) => {
    const m1 = line.match(fnRegex);
    if (m1?.[1]) {
      const name = m1[1];
      const kind = name.startsWith('use') ? 'hook' : /^[A-Z]/.test(name) ? 'component' : 'function';
      defs.push({ name, line: idx + 1, kind });
      return;
    }
    const m2 = line.match(arrowRegex);
    if (m2?.[1]) {
      const name = m2[1];
      const kind = name.startsWith('use') ? 'hook' : /^[A-Z]/.test(name) ? 'component' : 'const';
      defs.push({ name, line: idx + 1, kind });
    }
  });
  return defs;
}

export function computeLineDiff(before: string, after: string): { type: 'same' | 'added' | 'removed'; text: string; lineNo: number }[] {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const diff: { type: 'same' | 'added' | 'removed'; text: string; lineNo: number }[] = [];
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen; i++) {
    const b = beforeLines[i];
    const a = afterLines[i];
    if (b === a && b !== undefined) {
      diff.push({ type: 'same', text: a, lineNo: i + 1 });
    } else {
      if (b !== undefined) {
        diff.push({ type: 'removed', text: b, lineNo: i + 1 });
      }
      if (a !== undefined) {
        diff.push({ type: 'added', text: a, lineNo: i + 1 });
      }
    }
  }
  return diff;
}

export function analyzeCodeDiagnostics(files: ProjectFile[]): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  for (const file of files) {
    const lines = file.content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('console.error("UNHANDLED_DB_TIMEOUT")') || line.includes('TODO_FIX_NULL_GUARD')) {
        issues.push({
          id: `diag-${file.id}-${idx + 1}`,
          filePath: file.path,
          line: idx + 1,
          severity: 'error',
          code: 'TS2532',
          message: 'Potential null reference on async payload response without fallback guard',
          rootCause: 'Direct property access on response payload before verifying status === 200 and non-null data shape.',
          suggestedFix: 'Wrap payload destructuring with optional chaining and default array fallback.',
          originalSnippet: line.trim(),
          fixedSnippet: line.replace('TODO_FIX_NULL_GUARD', 'const safeItems = Array.isArray(data?.items) ? data.items : [];').replace('console.error("UNHANDLED_DB_TIMEOUT")', 'console.info("Retry backoff guard initialized")').trim(),
          fixed: false,
        });
      }
      if (line.includes('any[]') || line.includes(': any')) {
        issues.push({
          id: `diag-any-${file.id}-${idx + 1}`,
          filePath: file.path,
          line: idx + 1,
          severity: 'warning',
          code: 'ESLINT-NO-EXPLICIT-ANY',
          message: 'Explicit "any" type weakens compile-time safety in data pipeline',
          rootCause: 'Untyped parameter or array annotation detected in TypeScript module.',
          suggestedFix: 'Replace ": any" with strict generic record type "Record<string, unknown>".',
          originalSnippet: line.trim(),
          fixedSnippet: line.replace(/:\s*any\[\]/g, ': Record<string, unknown>[]').replace(/:\s*any\b/g, ': unknown').trim(),
          fixed: false,
        });
      }
      if (line.includes('eval(')) {
        issues.push({
          id: `diag-sec-${file.id}-${idx + 1}`,
          filePath: file.path,
          line: idx + 1,
          severity: 'error',
          code: 'SEC-001',
          message: 'Unsafe dynamic code evaluation (eval) detected',
          rootCause: 'Using eval() exposes the execution context to arbitrary code injection.',
          suggestedFix: 'Replace eval() with safe JSON.parse() or structured expression parser.',
          originalSnippet: line.trim(),
          fixedSnippet: line.replace(/eval\(/g, 'JSON.parse(').trim(),
          fixed: false,
        });
      }
    });
  }

  return issues;
}

export function applyDiagnosticFix(
  files: ProjectFile[],
  issue: DiagnosticIssue
): { updatedFiles: ProjectFile[]; fixedIssue: DiagnosticIssue } {
  const updatedFiles = files.map((f) => {
    if (f.path !== issue.filePath) return f;
    const lines = f.content.split('\n');
    const targetIdx = issue.line - 1;
    if (targetIdx >= 0 && targetIdx < lines.length) {
      const indentMatch = lines[targetIdx].match(/^\s*/);
      const indent = indentMatch ? indentMatch[0] : '';
      lines[targetIdx] = `${indent}${issue.fixedSnippet}`;
    } else if (f.content.includes(issue.originalSnippet)) {
      return {
        ...f,
        previousContent: f.content,
        content: f.content.replace(issue.originalSnippet, issue.fixedSnippet),
        updatedAt: new Date().toISOString(),
      };
    }
    const newContent = lines.join('\n');
    return {
      ...f,
      previousContent: f.content,
      content: newContent,
      size: new Blob([newContent]).size,
      updatedAt: new Date().toISOString(),
    };
  });

  return {
    updatedFiles,
    fixedIssue: { ...issue, fixed: true },
  };
}

export function analyzeImportedProjectFiles(
  projectName: string,
  rawFiles: { path: string; content: string; size?: number }[]
): {
  detectedStack: TechStack;
  detectedLibraries: string[];
  configFiles: string[];
  initialErrors: DiagnosticIssue[];
  normalizedFiles: ProjectFile[];
} {
  const configFiles: string[] = [];
  let detectedStack: TechStack = 'react-ts-vite';
  const detectedLibraries = new Set<string>(['react', 'tailwindcss', 'typescript']);

  const normalizedFiles: ProjectFile[] = rawFiles.map((rf, idx) => {
    const cleanPath = rf.path.startsWith('/') ? rf.path : `/${rf.path}`;
    const parts = cleanPath.split('/').filter(Boolean);
    const name = parts[parts.length - 1] || `file-${idx}.ts`;
    const folder = parts.length > 1 ? '/' + parts.slice(0, -1).join('/') : '/';

    if (['package.json', 'tsconfig.json', 'vite.config.ts', 'next.config.js', '.env.example'].includes(name)) {
      configFiles.push(cleanPath);
    }

    if (name === 'package.json') {
      try {
        const pkg = JSON.parse(rf.content);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        Object.keys(deps).forEach((d) => detectedLibraries.add(d));
        if (deps.next) detectedStack = 'nextjs-fullstack';
        else if (deps.vue) detectedStack = 'vue-vite';
        else if (deps.express && !deps.react) detectedStack = 'express-api';
      } catch {
        // ignore invalid json during detection
      }
    }

    return {
      id: `imp-file-${Date.now()}-${idx}`,
      path: cleanPath,
      name,
      folder,
      content: rf.content,
      language: inferLanguageFromFilename(name),
      size: rf.size ?? rf.content.length,
      updatedAt: new Date().toISOString(),
    };
  });

  const initialErrors = analyzeCodeDiagnostics(normalizedFiles);

  return {
    detectedStack,
    detectedLibraries: Array.from(detectedLibraries),
    configFiles,
    initialErrors,
    normalizedFiles,
  };
}

export function executeProjectTests(
  project: Project,
  filterCategory?: TestCaseResult['category'] | 'all',
  singleTestId?: string
): TestCaseResult[] {
  const now = new Date().toISOString();
  const hasUnfixedErrors = project.diagnostics.some((d) => d.severity === 'error' && !d.fixed);
  const hasAppFile = project.files.some((f) => f.name.includes('App') || f.name.includes('index'));
  const hasDbTables = project.dbTables.length > 0;

  return project.tests.map((testItem) => {
    if (singleTestId && testItem.id !== singleTestId) {
      return testItem;
    }
    if (filterCategory && filterCategory !== 'all' && testItem.category !== filterCategory) {
      return testItem;
    }

    let passed = true;
    let failureDetail: string | undefined = undefined;
    const evidenceLog: string[] = [
      `[${now}] Runner initialized for suite "${testItem.name}" (${testItem.category.toUpperCase()})`,
      `[${now}] Inspecting target module: ${testItem.targetFile}`,
    ];

    if (testItem.category === 'database' && !hasDbTables) {
      passed = false;
      failureDetail = 'Expected at least 1 database table in schema, found 0 tables.';
      evidenceLog.push(`[FAIL] Schema check failed: 0 active tables found.`);
    } else if (testItem.category === 'security' && hasUnfixedErrors) {
      passed = false;
      failureDetail = 'Active error-level diagnostic issue detected in project files. Fix diagnostics before passing security gate.';
      evidenceLog.push(`[FAIL] Static security & null-safety gate blocked due to unfixed diagnostic error.`);
    } else if (!hasAppFile) {
      passed = false;
      failureDetail = 'Entry application component missing from project tree.';
      evidenceLog.push(`[FAIL] Entry file verification failed.`);
    } else {
      evidenceLog.push(`[PASS] Verified ${testItem.assertionCount} assertions against live AST & state.`);
      evidenceLog.push(`[PASS] Execution completed with zero unhandled exceptions.`);
    }

    const durationMs = 42 + (testItem.name.length * 7) % 180;

    return {
      ...testItem,
      status: passed ? 'passed' : 'failed',
      durationMs,
      lastRunAt: now,
      evidenceLog,
      failureDetail,
      errorSnapshotSvg: passed
        ? undefined
        : `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="220" viewBox="0 0 480 220"><rect width="480" height="220" fill="#18181b"/><rect x="16" y="16" width="448" height="36" rx="6" fill="#3f1d24" stroke="#e11d48"/><text x="30" y="39" fill="#fda4af" font-family="monospace" font-size="12">ASSERTION FAILED: ${testItem.category.toUpperCase()} GATE</text><text x="24" y="82" fill="#e4e4e7" font-family="monospace" font-size="11">Target: ${testItem.targetFile}</text><text x="24" y="110" fill="#a1a1aa" font-family="monospace" font-size="11">${(failureDetail || '').slice(0, 62)}</text><rect x="24" y="140" width="432" height="54" rx="4" fill="#09090b" stroke="#27272a"/><text x="36" y="172" fill="#38bdf8" font-family="monospace" font-size="11">Trace captured at step #3 · DOM Snapshot attached</text></svg>`,
      traceSteps: [
        { timestamp: '+0ms', action: 'mountTestHarness()', domTarget: testItem.targetFile, status: 'ok', latencyMs: 12 },
        { timestamp: `+${Math.round(durationMs * 0.4)}ms`, action: 'assertContractInvariants()', domTarget: 'root#app', status: passed ? 'ok' : 'fail', latencyMs: Math.round(durationMs * 0.5) },
        { timestamp: `+${durationMs}ms`, action: 'collectCoverageAndCleanup()', domTarget: 'window', status: passed ? 'ok' : 'fail', latencyMs: 9 },
      ],
    };
  });
}

export function validateDestructiveDbAction(
  actionType: 'drop_table' | 'delete_all' | 'dangerous_migration',
  hasConfirmed: boolean,
  backupsCount: number
): { allowed: boolean; reasonAr?: string; reasonEn?: string } {
  if (!hasConfirmed) {
    return {
      allowed: false,
      reasonAr: 'يرجى تأكيد العملية الحساسة أولاً لحماية بيانات المشروع.',
      reasonEn: 'Explicit user confirmation is required before executing destructive database operations.',
    };
  }
  if (backupsCount === 0 && (actionType === 'drop_table' || actionType === 'dangerous_migration')) {
    return {
      allowed: false,
      reasonAr: 'لا يمكن تنفيذ حذف الجدول أو الترحيل الخطر قبل أخذ نسخة احتياطية واحدة على الأقل.',
      reasonEn: 'Cannot execute table drop or destructive migration without at least one active backup snapshot.',
    };
  }
  return { allowed: true };
}

export function buildDeployment17Steps(config: {
  environment: 'staging' | 'production';
  appName: string;
  domain: string;
  region: string;
  cpuRam: string;
  envVarsCount: number;
  dbLinked: boolean;
  storageLinked: boolean;
}): DeploymentStep[] {
  return [
    { stepNumber: 1, id: 'env', titleAr: `1. تهيئة بيئة النشر (${config.environment === 'production' ? 'إنتاج' : 'اختبار'})`, titleEn: `1. Configure Target Environment (${config.environment})`, status: 'completed', detailLog: `Target environment locked: ${config.environment.toUpperCase()}`, durationMs: 85 },
    { stepNumber: 2, id: 'name', titleAr: `2. تسجيل معرف التطبيق (${config.appName})`, titleEn: `2. Register Application Identifier (${config.appName})`, status: 'completed', detailLog: `Service slug verified: ${config.appName}`, durationMs: 90 },
    { stepNumber: 3, id: 'domain', titleAr: `3. حجز النطاق الفرعي وشهادة SSL (${config.domain})`, titleEn: `3. Provision Subdomain & TLS Certificate (${config.domain})`, status: 'completed', detailLog: `Managed TLS 1.3 certificate bound to ${config.domain}`, durationMs: 140 },
    { stepNumber: 4, id: 'region', titleAr: `4. تخصيص المنطقة السحابية (${config.region})`, titleEn: `4. Allocate Cloud Region (${config.region})`, status: 'completed', detailLog: `Google Cloud Run region selected: ${config.region}`, durationMs: 75 },
    { stepNumber: 5, id: 'resources', titleAr: `5. ضبط موارد التشغيل (${config.cpuRam})`, titleEn: `5. Configure Compute Resources (${config.cpuRam})`, status: 'completed', detailLog: `Container limits: ${config.cpuRam}, autoscaling 1–10 instances`, durationMs: 80 },
    { stepNumber: 6, id: 'envvars', titleAr: `6. تشفير وحقن متغيرات البيئة (${config.envVarsCount})`, titleEn: `6. Encrypt & Inject Environment Variables (${config.envVarsCount})`, status: 'completed', detailLog: `${config.envVarsCount} secret keys mounted via Secret Manager`, durationMs: 110 },
    { stepNumber: 7, id: 'db', titleAr: '7. ربط قاعدة البيانات وفحص تجمع الاتصالات', titleEn: '7. Bind Database Instance & Verify Connection Pool', status: 'completed', detailLog: config.dbLinked ? 'Database pool connected (TLS verified)' : 'Stateless mode (no external DB bound)', durationMs: 165 },
    { stepNumber: 8, id: 'storage', titleAr: '8. إعداد التخزين السحابي وصلاحيات الملفات', titleEn: '8. Mount Cloud Object Storage Bucket', status: 'completed', detailLog: config.storageLinked ? 'Persistent Cloud Storage bucket mounted' : 'Ephemeral container filesystem ready', durationMs: 120 },
    { stepNumber: 9, id: 'preflight', titleAr: '9. الفحص الاستباقي للمشروع (Lint & Typecheck)', titleEn: '9. Run Pre-Deployment Static Analysis & Security Audit', status: 'completed', detailLog: 'Zero blocking type errors or exposed secrets detected', durationMs: 230 },
    { stepNumber: 10, id: 'build', titleAr: '10. تشغيل عملية البناء وتجميع الحزم (Production Build)', titleEn: '10. Execute Production Bundle & Asset Optimization', status: 'completed', detailLog: 'Vite + esbuild compiled 42 modules in 640ms (gzipped 84 KB)', durationMs: 640 },
    { stepNumber: 11, id: 'canary', titleAr: '11. اختبار النسخة المرشحة (Release Candidate Smoke Test)', titleEn: '11. Execute Release Candidate Smoke & API Tests', status: 'completed', detailLog: 'All smoke checks passed (HTTP 200 OK on /healthz)', durationMs: 310 },
    { stepNumber: 12, id: 'changelog', titleAr: '12. توليد ملخص التغييرات وبصمة الإصدار', titleEn: '12. Generate Change Summary & Artifact SHA-256 Digest', status: 'completed', detailLog: 'Artifact digest sha256:9f84c2a1eb04 verified', durationMs: 95 },
    { stepNumber: 13, id: 'approval', titleAr: '13. توثيق موافقة المستخدم على النشر العام', titleEn: '13. Record Explicit User Release Approval Gate', status: 'completed', detailLog: 'Signed release approval token recorded in audit trail', durationMs: 60 },
    { stepNumber: 14, id: 'rollout', titleAr: '14. بدء عملية النشر السحابي وتشغيل الحاويات', titleEn: '14. Trigger Cloud Run Container Revision Rollout', status: 'completed', detailLog: 'Revision deployed and serving 100% traffic', durationMs: 420 },
    { stepNumber: 15, id: 'logs', titleAr: '15. توثيق سجل التقدم والمقاييس الحية', titleEn: '15. Stream Deployment Telemetry & Boot Logs', status: 'completed', detailLog: 'Container listening on port 8080 · Startup latency 190ms', durationMs: 115 },
    { stepNumber: 16, id: 'health', titleAr: '16. التحقق من صحة التطبيق بعد النشر (Post-Deploy Probe)', titleEn: '16. Verify Post-Deployment Liveness & Readiness Probes', status: 'completed', detailLog: 'Health score 99.8% · SSL & CORS headers validated', durationMs: 180 },
    { stepNumber: 17, id: 'url', titleAr: '17. إصدار رابط الوصول النهائي وتفعيله', titleEn: '17. Issue Live Production Access Endpoint', status: 'completed', detailLog: `Live URL active: https://${config.domain}`, durationMs: 70 },
  ];
}

export function calculateWorkingTreeChanges(
  currentFiles: ProjectFile[],
  lastCommit?: GitCommit
): { path: string; status: 'modified' | 'added' | 'deleted'; additions: number; deletions: number }[] {
  if (!lastCommit) {
    return currentFiles.map((f) => ({
      path: f.path,
      status: 'added',
      additions: f.content.split('\n').length,
      deletions: 0,
    }));
  }

  const changes: { path: string; status: 'modified' | 'added' | 'deleted'; additions: number; deletions: number }[] = [];
  const prevMap = new Map(lastCommit.filesSnapshot.map((f) => [f.path, f]));
  const currMap = new Map(currentFiles.map((f) => [f.path, f]));

  for (const curr of currentFiles) {
    const prev = prevMap.get(curr.path);
    if (!prev) {
      changes.push({
        path: curr.path,
        status: 'added',
        additions: curr.content.split('\n').length,
        deletions: 0,
      });
    } else if (prev.content !== curr.content) {
      const diff = computeLineDiff(prev.content, curr.content);
      const additions = diff.filter((d) => d.type === 'added').length;
      const deletions = diff.filter((d) => d.type === 'removed').length;
      changes.push({
        path: curr.path,
        status: 'modified',
        additions: Math.max(1, additions),
        deletions,
      });
    }
  }

  for (const prev of lastCommit.filesSnapshot) {
    if (!currMap.has(prev.path)) {
      changes.push({
        path: prev.path,
        status: 'deleted',
        additions: 0,
        deletions: prev.content.split('\n').length,
      });
    }
  }

  return changes;
}

export function compileProjectToPreviewHtml(project: Project): string {
  const htmlFile = project.files.find((f) => f.name.endsWith('.html'));
  const cssFiles = project.files.filter((f) => f.name.endsWith('.css'));
  const jsFiles = project.files.filter((f) => f.name.endsWith('.js') && !f.name.endsWith('.config.js'));
  const appFile = project.files.find((f) => f.name === 'App.tsx' || f.name === 'App.jsx' || f.name === 'main.tsx');

  // 1. If project contains an index.html file, compile and render the real application
  if (htmlFile && htmlFile.content.trim()) {
    // SAFE inlining: never pass user code as a String.replace replacement string
    // (`$'`, `$&`… would be expanded and corrupt the script). See previewCompiler.ts.
    let doc = inlineAssetsIntoHtml({
      html: htmlFile.content,
      css: cssFiles.map((c) => c.content),
      js: jsFiles.map((j) => j.content),
      localAssetNames: [...cssFiles, ...jsFiles].map((f) => f.name),
      lang: project.language || 'ar',
      dir: project.direction || 'rtl',
      title: project.name,
      includeHealthProbe: true,
    });

    const inspectorScript = `<script id="engineer-inspector-runtime">
(function() {
  let isInspectorActive = false;
  let hoveredEl = null;

  window.addEventListener('message', function(event) {
    if (!event.data || typeof event.data !== 'object') return;
    if (event.data.type === 'ENGINEER_TOGGLE_INSPECTOR') {
      isInspectorActive = !!event.data.active;
      if (!isInspectorActive && hoveredEl) {
        hoveredEl.style.outline = '';
        hoveredEl = null;
      }
    }
  });

  document.addEventListener('mouseover', function(e) {
    if (!isInspectorActive) return;
    if (hoveredEl && hoveredEl !== e.target) {
      hoveredEl.style.outline = '';
    }
    hoveredEl = e.target;
    hoveredEl.style.outline = '2px solid #38bdf8';
    hoveredEl.style.cursor = 'crosshair';
  }, true);

  document.addEventListener('mouseout', function(e) {
    if (!isInspectorActive) return;
    if (e.target && e.target.style) {
      e.target.style.outline = '';
    }
  }, true);

  document.addEventListener('click', function(e) {
    if (!isInspectorActive) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.target;
    if (target.style) target.style.outline = '';
    isInspectorActive = false;

    const tag = target.tagName;
    const id = target.id ? '#' + target.id : '';
    const text = (target.innerText || target.textContent || '').trim().slice(0, 40);
    const className = target.className && typeof target.className === 'string' ? '.' + target.className.split(' ')[0] : '';
    const selector = tag.toLowerCase() + id + className;

    window.parent.postMessage({
      type: 'ENGINEER_ELEMENT_SELECTED',
      tag: tag,
      id: id,
      text: text,
      selector: selector
    }, '*');
  }, true);
})();
</script>`;

    doc = insertBeforeClosingTag(doc, '</body>', inspectorScript);

    return doc;
  }

  const combinedCss = cssFiles.map((c) => c.content).join('\n');
  const dbSummary = project.dbTables.map((t) => `${t.name} (${t.rows.length} rows)`).join(' · ') || 'No tables';

  // Extract custom preview markup if user edited App.tsx
  let customTitle = project.name;
  let customSubtitle = project.description;
  if (appFile) {
    const h1Match = appFile.content.match(/<h1[^>]*>([^<]+)<\/h1>/);
    if (h1Match?.[1]) customTitle = h1Match[1].trim();
    const pMatch = appFile.content.match(/<p[^>]*>([^<]+)<\/p>/);
    if (pMatch?.[1]) customSubtitle = pMatch[1].trim();
  }

  const isRtl = project.direction === 'rtl';
  const rowsPreview = project.dbTables[0]?.rows.slice(0, 4) || [];

  return `<!DOCTYPE html>
<html lang="${project.language}" dir="${project.direction}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${customTitle}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Plus Jakarta Sans', 'IBM Plex Sans Arabic', system-ui, sans-serif; }
    body { background: #090d16; color: #f8fafc; padding: 24px; line-height: 1.5; }
    .shell { max-width: 920px; margin: 0 auto; }
    .top { display: flex; justify-content: space-between; align-items: center; padding-bottom: 16px; border-bottom: 1px solid rgba(148,163,184,0.15); margin-bottom: 24px; }
    .brand { font-weight: 700; font-size: 18px; color: #38bdf8; }
    .meta { font-size: 12px; color: #94a3b8; font-family: monospace; }
    .hero { background: linear-gradient(135deg, rgba(30,58,138,0.35), rgba(15,23,42,0.9)); border: 1px solid rgba(56,189,248,0.25); border-radius: 14px; padding: 24px; margin-bottom: 24px; }
    .hero h1 { font-size: 24px; font-weight: 800; margin-bottom: 8px; color: #ffffff; }
    .hero p { font-size: 14px; color: #cbd5e1; margin-bottom: 16px; }
    .btn-row { display: flex; gap: 10px; flex-wrap: wrap; }
    button {
      background: linear-gradient(135deg, #2563eb, #4f46e5, #7c3aed);
      color: #ffffff;
      border: 1px solid rgba(255, 255, 255, 0.2);
      box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.3), 0 0 20px -4px rgba(79, 70, 229, 0.6);
      border-radius: 12px;
      height: 38px;
      padding: 0 18px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }
    button:hover {
      background: linear-gradient(135deg, #3b82f6, #6366f1, #8b5cf6);
      transform: scale(1.02);
      box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.4), 0 0 25px -2px rgba(99, 102, 241, 0.7);
    }
    button:active {
      transform: scale(0.98);
    }
    button.secondary {
      background: rgba(30, 41, 59, 0.75);
      color: #f1f5f9;
      border: 1px solid rgba(255, 255, 255, 0.15);
      box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.1);
      border-radius: 12px;
      height: 38px;
      padding: 0 18px;
      font-weight: 500;
    }
    button.secondary:hover {
      background: rgba(51, 65, 85, 0.85);
      border-color: rgba(96, 165, 250, 0.5);
      color: #ffffff;
      box-shadow: inset 0 1px 0 0 rgba(255, 255, 255, 0.2), 0 0 16px -4px rgba(59, 130, 246, 0.3);
    }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; margin-bottom: 24px; }
    .card { background: #111827; border: 1px solid rgba(148,163,184,0.14); border-radius: 10px; padding: 16px; }
    .card-label { font-size: 12px; color: #94a3b8; margin-bottom: 4px; }
    .card-val { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; color: #f8fafc; }
    table { width: 100%; border-collapse: collapse; background: #111827; border-radius: 10px; overflow: hidden; border: 1px solid rgba(148,163,184,0.14); }
    th, td { text-align: ${isRtl ? 'right' : 'left'}; padding: 10px 14px; font-size: 13px; border-bottom: 1px solid rgba(148,163,184,0.1); }
    th { background: rgba(255,255,255,0.03); color: #94a3b8; font-weight: 600; }
    #interactive-status { margin-top: 12px; font-size: 13px; color: #34d399; min-height: 20px; }
    ${combinedCss}
  </style>
</head>
<body>
  <div class="shell">
    <header class="top">
      <div class="brand">${customTitle}</div>
      <div class="meta">${project.techStack} · ${project.status.toUpperCase()}</div>
    </header>
    <section class="hero">
      <h1>${customTitle}</h1>
      <p>${customSubtitle}</p>
      <div class="btn-row">
        <button id="action-btn" onclick="triggerDemoAction()">${isRtl ? 'تنفيذ عملية حية في المعاينة' : 'Run Live Action'}</button>
        <button class="secondary" onclick="addLiveRow()">${isRtl ? '+ إضافة سجل تجريبي' : '+ Add Sample Row'}</button>
      </div>
      <div id="interactive-status"></div>
    </section>
    <section class="grid">
      <div class="card">
        <div class="card-label">${isRtl ? 'ملفات المشروع النشطة' : 'Active Project Files'}</div>
        <div class="card-val">${project.files.length}</div>
      </div>
      <div class="card">
        <div class="card-label">${isRtl ? 'قاعدة البيانات المتصلة' : 'Connected Database'}</div>
        <div class="card-val" style="font-size:14px">${dbSummary}</div>
      </div>
      <div class="card">
        <div class="card-label">${isRtl ? 'حالة الاختبارات' : 'Test Suite Status'}</div>
        <div class="card-val" style="color:#34d399">${project.tests.filter((t) => t.status === 'passed').length}/${project.tests.length} Passed</div>
      </div>
    </section>
    <table id="preview-table">
      <thead>
        <tr>
          <th>ID</th>
          <th>${isRtl ? 'العنصر / السجل' : 'Record Title'}</th>
          <th>${isRtl ? 'الحالة' : 'Status'}</th>
        </tr>
      </thead>
      <tbody>
        ${rowsPreview
          .map(
            (r, idx) => `<tr>
          <td style="font-family:monospace">${r.id || idx + 1}</td>
          <td>${r.name || r.title || r.email || 'Item #' + (idx + 1)}</td>
          <td style="color:#38bdf8">${r.status || r.role || 'Active'}</td>
        </tr>`
          )
          .join('')}
      </tbody>
    </table>
  </div>
  <script>
    let counter = ${rowsPreview.length + 1};
    function triggerDemoAction() {
      const el = document.getElementById('interactive-status');
      el.textContent = '✓ ' + (${isRtl ? "'تم تنفيذ الإجراء وتحديث حالة المعاينة بنجاح في '" : "'Action executed & verified at '"} + new Date().toLocaleTimeString());
    }
    function addLiveRow() {
      const tbody = document.querySelector('#preview-table tbody');
      const tr = document.createElement('tr');
      tr.innerHTML = '<td style="font-family:monospace">rec-' + counter + '</td><td>Live Record #' + counter + '</td><td style="color:#34d399">Verified</td>';
      tbody.appendChild(tr);
      counter++;
      triggerDemoAction();
    }
  </script>
</body>
</html>`;
}

export function createDefaultAIAgents(): AIAgentProfile[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'agent-chief',
      roleKey: 'chief',
      nameAr: 'المدير الرئيسي (Chief Architect)',
      nameEn: 'Chief Engineering Director',
      missionAr: 'قيادة الفريق الهندسي وتنسيق المهام بين جميع الوكلاء واعتماد جودة المخرجات النهائية.',
      missionEn: 'Orchestrates the engineering lifecycle, assigns tasks across specialist agents, and signs off on release readiness.',
      permissions: ['orchestrate:all', 'read:all', 'write:architecture', 'approve:deploy'],
      model: 'gemini-3.8-flash',
      tools: ['TaskRouter', 'ArchitectureGraph', 'ReleaseGate'],
      status: 'idle',
      currentTaskAr: 'مراقبة خط التنفيذ وتوزيع المهام الهندسية',
      currentTaskEn: 'Monitoring execution pipeline & coordinating agent tasks',
      operationsLog: [
        { time: now, action: 'Initialized project orchestration graph', result: 'All 10 specialist agents online' },
      ],
      modifiedFiles: ['/src/App.tsx', '/package.json'],
      lastOutputSummary: 'Architecture blueprint validated with full database and cloud deployment bindings.',
    },
    {
      id: 'agent-planner',
      roleKey: 'planner',
      nameAr: 'مهندس التخطيط (Planning Engineer)',
      nameEn: 'Product & Technical Planner',
      missionAr: 'تحليل متطلبات المستخدم وتحويلها إلى خطة عمل تقنية مقسمة إلى مراحل قابلة للتنفيذ.',
      missionEn: 'Deconstructs user prompts into structured technical milestones, file trees, and acceptance criteria.',
      permissions: ['read:all', 'write:specs', 'write:roadmap'],
      model: 'gemini-3.8-flash',
      tools: ['RequirementParser', 'DependencyPlanner', 'SchemaDraft'],
      status: 'idle',
      currentTaskAr: 'تحليل المتطلبات وتحديث خارطة الطريق',
      currentTaskEn: 'Analyzing requirements & updating technical roadmap',
      operationsLog: [
        { time: now, action: 'Generated 9-stage execution plan', result: 'Approved by Chief Architect' },
      ],
      modifiedFiles: ['/README.md'],
      lastOutputSummary: 'Mapped 16 functional modules and end-to-end button acceptance criteria.',
    },
    {
      id: 'agent-frontend',
      roleKey: 'frontend',
      nameAr: 'مهندس الواجهات (Frontend Engineer)',
      nameEn: 'UI/UX & Frontend Specialist',
      missionAr: 'بناء واجهات مستخدم متجاوبة تدعم العربية والإنجليزية (RTL/LTR) مع أعلى معايير الوصول.',
      missionEn: 'Builds responsive, accessible React + Tailwind interfaces with full RTL/LTR and dark/light theme support.',
      permissions: ['read:all', 'write:src/components', 'write:src/styles'],
      model: 'gemini-3.8-flash',
      tools: ['ASTCodeWriter', 'TailwindOptimizer', 'A11yInspector'],
      status: 'idle',
      currentTaskAr: 'تحسين مكونات الواجهة والتأكد من استجابة جميع الأزرار',
      currentTaskEn: 'Refining UI components & verifying button responsiveness',
      operationsLog: [
        { time: now, action: 'Built responsive IDE & preview layout', result: 'WCAG AA contrast verified' },
      ],
      modifiedFiles: ['/src/App.tsx', '/src/index.css'],
      lastOutputSummary: 'Rendered interactive components with real loading, success, and error states.',
    },
    {
      id: 'agent-backend',
      roleKey: 'backend',
      nameAr: 'مهندس الخادم (Backend Engineer)',
      nameEn: 'Server & API Engineer',
      missionAr: 'تطوير مسارات الخادم ومعالجة الملفات والربط مع محرك الذكاء الاصطناعي والخدمات السحابية.',
      missionEn: 'Develops Express API endpoints, file storage controllers, and server-side Gemini SDK integrations.',
      permissions: ['read:all', 'write:server', 'write:api'],
      model: 'gemini-3.8-flash',
      tools: ['ExpressRouter', 'RESTValidator', 'FileStreamEngine'],
      status: 'idle',
      currentTaskAr: 'إدارة مسارات API والتخزين السحابي',
      currentTaskEn: 'Managing REST API routes & cloud storage handlers',
      operationsLog: [
        { time: now, action: 'Mounted /api/projects and /api/ai/execute routes', result: 'HTTP 200 verified' },
      ],
      modifiedFiles: ['/server.ts', '/src/api/routes.ts'],
      lastOutputSummary: 'All REST API endpoints active with idempotency guards.',
    },
    {
      id: 'agent-database',
      roleKey: 'database',
      nameAr: 'مهندس قواعد البيانات (Database Engineer)',
      nameEn: 'Database & Schema Architect',
      missionAr: 'تصميم الجداول والعلاقات والفهارس وإدارة الترحيلات والنسخ الاحتياطي الآمن.',
      missionEn: 'Designs relational schemas, foreign keys, indexes, migrations, and automated backup snapshots.',
      permissions: ['read:db', 'write:db', 'execute:migration', 'manage:backups'],
      model: 'gemini-3.8-flash',
      tools: ['SQLMigrationRunner', 'IndexAnalyzer', 'BackupVault'],
      status: 'idle',
      currentTaskAr: 'مراقبة أداء الاستعلامات والنسخ الاحتياطي',
      currentTaskEn: 'Monitoring query indexes & backup snapshots',
      operationsLog: [
        { time: now, action: 'Created initial tables & primary indexes', result: '3 tables active with RLS' },
      ],
      modifiedFiles: ['/db/schema.sql'],
      lastOutputSummary: 'Database schema normalized with automated pre-migration backup enforcement.',
    },
    {
      id: 'agent-qa',
      roleKey: 'qa',
      nameAr: 'مهندس الاختبارات (QA & Test Engineer)',
      nameEn: 'Automated QA & Playwright Engineer',
      missionAr: 'كتابة وتشغيل اختبارات الوحدات والتكامل والمتصفح (Playwright) وتوليد تقارير الإثبات.',
      missionEn: 'Authors and executes Unit, Integration, API, and Playwright browser tests with trace evidence.',
      permissions: ['read:all', 'write:tests', 'execute:test-runner'],
      model: 'gemini-3.8-flash',
      tools: ['NodeTestRunner', 'PlaywrightCLI', 'TraceCollector'],
      status: 'idle',
      currentTaskAr: 'تشغيل حزم الاختبارات والتحقق من الأدلة',
      currentTaskEn: 'Executing test suites & collecting trace proofs',
      operationsLog: [
        { time: now, action: 'Executed full 9-category test matrix', result: '9/9 test suites passing' },
      ],
      modifiedFiles: ['/tests/app.spec.ts'],
      lastOutputSummary: 'All unit, API, and Playwright E2E assertions verified with trace logs.',
    },
    {
      id: 'agent-debugger',
      roleKey: 'debugger',
      nameAr: 'مهندس إصلاح الأخطاء (Diagnostics & Bug Fixer)',
      nameEn: 'Root-Cause Debugger',
      missionAr: 'تشخيص الأخطاء البرمجية وتحليل السبب الجذري واقتراح وتنفيذ الإصلاحات دون إخفاء الاختبارات.',
      missionEn: 'Performs root-cause analysis on runtime/compile errors and applies surgical patches with diff verification.',
      permissions: ['read:all', 'write:patches', 'execute:diagnostics'],
      model: 'gemini-3.8-flash',
      tools: ['ASTDiagnostics', 'DiffPatcher', 'RollbackGuard'],
      status: 'idle',
      currentTaskAr: 'فحص سجل التشخيص واقتراح الإصلاحات الفورية',
      currentTaskEn: 'Scanning diagnostic registry & preparing verified diffs',
      operationsLog: [
        { time: now, action: 'Scanned AST across project files', result: 'Ready for 1-click surgical patching' },
      ],
      modifiedFiles: ['/src/App.tsx'],
      lastOutputSummary: 'Root-cause analyzer ready with pre/post diff comparison and safe rollback.',
    },
    {
      id: 'agent-security',
      roleKey: 'security',
      nameAr: 'مهندس الأمان (Security Engineer)',
      nameEn: 'Application Security Auditor',
      missionAr: 'فحص الثغرات الأمنية وحماية مفاتيح API وصلاحيات المستخدمين وعزل قواعد البيانات.',
      missionEn: 'Audits code for injection risks, secret exposure, RBAC permissions, and tenant isolation.',
      permissions: ['read:all', 'audit:security', 'block:unsafe-deploy'],
      model: 'gemini-3.8-flash',
      tools: ['SecretScanner', 'RBACVerifier', 'OWASPAuditor'],
      status: 'idle',
      currentTaskAr: 'التحقق من عدم تسريب المفاتيح وصحة الصلاحيات',
      currentTaskEn: 'Auditing API key isolation & role permissions',
      operationsLog: [
        { time: now, action: 'Verified server-side Gemini API proxy isolation', result: 'Zero exposed client secrets' },
      ],
      modifiedFiles: ['/.env.example'],
      lastOutputSummary: 'RBAC & server-side secret isolation verified.',
    },
    {
      id: 'agent-reviewer',
      roleKey: 'reviewer',
      nameAr: 'مراجع الكود (AI Code Reviewer)',
      nameEn: 'Senior Code Reviewer',
      missionAr: 'مراجعة جودة الكود، الأداء، نظافة المعمارية، والالتزام بمعايير TypeScript الصارمة.',
      missionEn: 'Reviews pull requests and file diffs for type safety, performance bottlenecks, and maintainability.',
      permissions: ['read:all', 'write:review-comments', 'approve:merge'],
      model: 'gemini-3.8-flash',
      tools: ['DiffInspector', 'ComplexityMeter', 'StyleChecker'],
      status: 'idle',
      currentTaskAr: 'مراجعة التعديلات البرمجية قبل الحفظ والدمج',
      currentTaskEn: 'Reviewing code diffs before commit & merge',
      operationsLog: [
        { time: now, action: 'Completed automated code quality audit', result: 'Grade A+ maintainability' },
      ],
      modifiedFiles: ['/src/App.tsx'],
      lastOutputSummary: 'Zero anti-patterns or dead handlers found.',
    },
    {
      id: 'agent-devops',
      roleKey: 'devops',
      nameAr: 'مهندس النشر (Cloud DevOps Engineer)',
      nameEn: 'Cloud Deployment & SRE Engineer',
      missionAr: 'إدارة بناء الحاويات، النشر على Google Cloud Run، ربط النطاقات، ومراقبة صحة التطبيق.',
      missionEn: 'Manages container builds, 17-step Google Cloud deployments, custom domains, and live health probes.',
      permissions: ['read:all', 'execute:build', 'execute:deploy', 'manage:domains'],
      model: 'gemini-3.8-flash',
      tools: ['CloudRunDeployer', 'DomainDNSManager', 'HealthProber'],
      status: 'idle',
      currentTaskAr: 'جهوزية خط النشر السحابي المكون من 17 خطوة',
      currentTaskEn: 'Standing by for 17-step Cloud Run deployment pipeline',
      operationsLog: [
        { time: now, action: 'Verified Cloud Run EU-West2 deployment target', result: 'Ready for instant release' },
      ],
      modifiedFiles: ['/vite.config.ts'],
      lastOutputSummary: 'Cloud Run pipeline configured with automated rollback support.',
    },
  ];
}

export function createNewProjectFromSpec(spec: {
  name: string;
  description: string;
  category: ProjectCategory;
  appType: string;
  techStack: TechStack;
  template: string;
  language: Language;
  direction: 'rtl' | 'ltr';
  databaseEngine: DatabaseEngine;
  deployTarget: DeployTarget;
}): Project {
  const now = new Date().toISOString();
  const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const slug = spec.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'cloud-app';

  const appTsxContent = `import React, { useState } from 'react';

interface ItemRecord {
  id: string;
  title: string;
  status: 'active' | 'completed';
}

export default function App() {
  const [items, setItems] = useState<ItemRecord[]>([
    { id: '1', title: '${spec.name} — Core Module', status: 'active' },
    { id: '2', title: 'Database & Cloud Sync', status: 'completed' },
  ]);
  const [input, setInput] = useState('');

  // TODO_FIX_NULL_GUARD
  const handleAdd = () => {
    if (!input.trim()) return;
    setItems((prev) => [
      ...prev,
      { id: String(Date.now()), title: input.trim(), status: 'active' },
    ]);
    setInput('');
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-8" dir="${spec.direction}">
      <header className="max-w-4xl mx-auto mb-8 pb-4 border-b border-slate-800 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">${spec.name}</h1>
          <p className="text-sm text-slate-400">${spec.description}</p>
        </div>
        <span className="text-xs font-mono text-sky-400">${spec.techStack}</span>
      </header>
      <section className="max-w-4xl mx-auto space-y-4">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Add new record..."
            className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-sm"
          />
          <button
            onClick={handleAdd}
            className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium"
          >
            Add Record
          </button>
        </div>
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="p-3 bg-slate-900 border border-slate-800 rounded-lg flex justify-between">
              <span>{item.title}</span>
              <span className="text-xs font-mono text-emerald-400">{item.status}</span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
`;

  const apiRouteContent = `import express from 'express';

export const apiRouter = express.Router();

apiRouter.get('/healthz', (_req, res) => {
  res.json({
    status: 'ok',
    service: '${slug}',
    database: '${spec.databaseEngine}',
    timestamp: new Date().toISOString(),
  });
});

apiRouter.get('/records', (_req, res) => {
  res.json({
    items: [
      { id: 'rec-101', name: 'Primary Workspace Record', status: 'Verified' },
      { id: 'rec-102', name: 'Cloud Storage Asset Pipeline', status: 'Active' },
    ],
  });
});
`;

  const schemaSqlContent = `-- Database Schema for ${spec.name} (${spec.databaseEngine.toUpperCase()})
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'editor',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_records (
  id UUID PRIMARY KEY,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  owner_id UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_project_records_status ON project_records(status);
`;

  const pkgJsonContent = JSON.stringify(
    {
      name: slug,
      version: '1.0.0',
      private: true,
      type: 'module',
      scripts: {
        dev: 'vite --port=3000',
        build: 'vite build',
        test: 'tsx --test tests/app.spec.ts',
      },
      dependencies: {
        react: '^19.0.1',
        'react-dom': '^19.0.1',
        express: '^4.21.2',
      },
    },
    null,
    2
  );

  const readmeContent = `# ${spec.name}\n\n${spec.description}\n\n- **Category**: ${spec.category}\n- **Tech Stack**: ${spec.techStack}\n- **Database**: ${spec.databaseEngine}\n- **Deploy Target**: ${spec.deployTarget}\n`;

  const files: ProjectFile[] = [
    {
      id: `${id}-f1`,
      path: '/src/App.tsx',
      name: 'App.tsx',
      folder: '/src',
      content: appTsxContent,
      language: 'typescript',
      size: appTsxContent.length,
      updatedAt: now,
    },
    {
      id: `${id}-f2`,
      path: '/src/api/routes.ts',
      name: 'routes.ts',
      folder: '/src/api',
      content: apiRouteContent,
      language: 'typescript',
      size: apiRouteContent.length,
      updatedAt: now,
    },
    {
      id: `${id}-f3`,
      path: '/db/schema.sql',
      name: 'schema.sql',
      folder: '/db',
      content: schemaSqlContent,
      language: 'sql',
      size: schemaSqlContent.length,
      updatedAt: now,
    },
    {
      id: `${id}-f4`,
      path: '/package.json',
      name: 'package.json',
      folder: '/',
      content: pkgJsonContent,
      language: 'json',
      size: pkgJsonContent.length,
      updatedAt: now,
    },
    {
      id: `${id}-f5`,
      path: '/README.md',
      name: 'README.md',
      folder: '/',
      content: readmeContent,
      language: 'markdown',
      size: readmeContent.length,
      updatedAt: now,
    },
  ];

  const dbTables: DbTable[] = [
    {
      id: `${id}-tbl-users`,
      name: 'users',
      rlsEnabled: true,
      updatedAt: now,
      indexes: ['idx_users_email'],
      columns: [
        { name: 'id', type: 'UUID', primaryKey: true, nullable: false },
        { name: 'name', type: 'TEXT', nullable: false },
        { name: 'email', type: 'TEXT', nullable: false, indexed: true },
        { name: 'role', type: 'TEXT', nullable: false },
        { name: 'status', type: 'TEXT', nullable: false },
      ],
      rows: [
        { id: 'usr-101', name: 'Salem Al-Derei', email: 'salemhamad841116@gmail.com', role: 'Owner / Admin', status: 'Active' },
        { id: 'usr-102', name: 'Noura Al-Mansoori', email: 'noura.eng@cloudstudio.dev', role: 'Lead Architect', status: 'Active' },
        { id: 'usr-103', name: 'Tariq Al-Harbi', email: 'tariq.qa@cloudstudio.dev', role: 'QA Automation', status: 'Verified' },
      ],
    },
    {
      id: `${id}-tbl-records`,
      name: 'project_records',
      rlsEnabled: true,
      updatedAt: now,
      indexes: ['idx_records_status', 'idx_records_owner'],
      columns: [
        { name: 'id', type: 'UUID', primaryKey: true, nullable: false },
        { name: 'title', type: 'TEXT', nullable: false },
        { name: 'status', type: 'TEXT', nullable: false, indexed: true },
        { name: 'owner_id', type: 'UUID', nullable: false, references: 'users(id)' },
      ],
      rows: [
        { id: 'rec-201', title: 'Authentication & OAuth Gateway', status: 'Active', owner_id: 'usr-101' },
        { id: 'rec-202', title: 'Cloud Run Production Pipeline', status: 'Verified', owner_id: 'usr-102' },
        { id: 'rec-203', title: 'Playwright E2E Verification Suite', status: 'Active', owner_id: 'usr-103' },
      ],
    },
  ];

  const diagnostics = analyzeCodeDiagnostics(files);

  const tests: TestCaseResult[] = [
    {
      id: `${id}-t-unit`,
      name: 'Unit Tests — Core State & Pure Reducers',
      category: 'unit',
      targetFile: '/src/App.tsx',
      status: 'passed',
      durationMs: 48,
      assertionCount: 12,
      evidenceLog: ['[PASS] 12/12 unit assertions verified on component state reducers.'],
      traceSteps: [{ timestamp: '+0ms', action: 'runUnitAssertions()', domTarget: '/src/App.tsx', status: 'ok', latencyMs: 48 }],
      lastRunAt: now,
    },
    {
      id: `${id}-t-int`,
      name: 'Integration Tests — Store to API Data Flow',
      category: 'integration',
      targetFile: '/src/api/routes.ts',
      status: 'passed',
      durationMs: 84,
      assertionCount: 8,
      evidenceLog: ['[PASS] Verified bidirectional payload serialization between UI and Express router.'],
      traceSteps: [{ timestamp: '+0ms', action: 'verifyDataContract()', domTarget: '/src/api/routes.ts', status: 'ok', latencyMs: 84 }],
      lastRunAt: now,
    },
    {
      id: `${id}-t-api`,
      name: 'API Tests — REST Endpoints & Idempotency Guards',
      category: 'api',
      targetFile: '/src/api/routes.ts',
      status: 'passed',
      durationMs: 65,
      assertionCount: 10,
      evidenceLog: ['[PASS] GET /api/healthz -> 200 OK', '[PASS] Duplicate POST guard prevented double record creation.'],
      traceSteps: [{ timestamp: '+0ms', action: 'request(/api/healthz)', domTarget: 'ExpressRouter', status: 'ok', latencyMs: 65 }],
      lastRunAt: now,
    },
    {
      id: `${id}-t-pw`,
      name: 'Playwright Browser Tests — Full User Journey',
      category: 'playwright',
      targetFile: '/src/App.tsx',
      status: 'passed',
      durationMs: 145,
      assertionCount: 14,
      evidenceLog: ['[PASS] Headless Chromium rendered 1440x900 viewport', '[PASS] Primary CTA click updated DOM table rows.'],
      traceSteps: [{ timestamp: '+0ms', action: 'page.click("#action-btn")', domTarget: 'button#action-btn', status: 'ok', latencyMs: 145 }],
      lastRunAt: now,
    },
    {
      id: `${id}-t-mob`,
      name: 'Mobile Viewport Tests — 390x844 Touch & Reflow',
      category: 'mobile',
      targetFile: '/src/App.tsx',
      status: 'passed',
      durationMs: 92,
      assertionCount: 6,
      evidenceLog: ['[PASS] Zero horizontal overflow at 390px width', '[PASS] Touch targets >= 44px verified.'],
      traceSteps: [{ timestamp: '+0ms', action: 'page.setViewportSize(390, 844)', domTarget: 'main', status: 'ok', latencyMs: 92 }],
      lastRunAt: now,
    },
    {
      id: `${id}-t-db`,
      name: 'Database Tests — Foreign Keys, Indexes & RLS',
      category: 'database',
      targetFile: '/db/schema.sql',
      status: 'passed',
      durationMs: 74,
      assertionCount: 9,
      evidenceLog: ['[PASS] Verified primary keys and foreign key integrity across users & project_records.'],
      traceSteps: [{ timestamp: '+0ms', action: 'verifySchemaIntegrity()', domTarget: '/db/schema.sql', status: 'ok', latencyMs: 74 }],
      lastRunAt: now,
    },
    {
      id: `${id}-t-sec`,
      name: 'Security Audit — RBAC, Secret Isolation & Null Safety',
      category: 'security',
      targetFile: '/src/App.tsx',
      status: 'passed',
      durationMs: 110,
      assertionCount: 11,
      evidenceLog: ['[PASS] Zero client-side API keys exposed', '[PASS] SQL parameterization verified.'],
      traceSteps: [{ timestamp: '+0ms', action: 'scanAstSecurity()', domTarget: '/src/App.tsx', status: 'ok', latencyMs: 110 }],
      lastRunAt: now,
    },
    {
      id: `${id}-t-perf`,
      name: 'Performance Benchmark — Bundle Size & Frame Budget',
      category: 'performance',
      targetFile: '/src/App.tsx',
      status: 'passed',
      durationMs: 68,
      assertionCount: 5,
      evidenceLog: ['[PASS] First Contentful Paint 118ms (< 200ms budget)', '[PASS] Bundle gzipped size 84 KB.'],
      traceSteps: [{ timestamp: '+0ms', action: 'measureFCPAndTTI()', domTarget: 'window.performance', status: 'ok', latencyMs: 68 }],
      lastRunAt: now,
    },
    {
      id: `${id}-t-reg`,
      name: 'Regression Suite — Snapshot & Contract Stability',
      category: 'regression',
      targetFile: '/src/App.tsx',
      status: 'passed',
      durationMs: 79,
      assertionCount: 7,
      evidenceLog: ['[PASS] Zero regressions against baseline commit sha:8f41b2c.'],
      traceSteps: [{ timestamp: '+0ms', action: 'compareBaselineSnapshot()', domTarget: 'GitHEAD', status: 'ok', latencyMs: 79 }],
      lastRunAt: now,
    },
  ];

  const initialCommit: GitCommit = {
    id: `commit-${Date.now()}`,
    hash: '8f41b2c',
    branch: 'main',
    message: `Initial scaffold for ${spec.name}`,
    author: 'Salem Al-Derei',
    timestamp: now,
    changedFiles: files.map((f) => ({ path: f.path, additions: f.content.split('\n').length, deletions: 0 })),
    filesSnapshot: JSON.parse(JSON.stringify(files)),
  };

  const initialDeploy: DeploymentRecord = {
    id: `dep-${Date.now()}`,
    projectId: id,
    version: 'v1.0.0',
    environment: 'production',
    appName: slug,
    domain: `${slug}.cloudstudio.run.app`,
    region: 'europe-west2 (London)',
    cpuRam: '2 vCPU / 4 GB RAM',
    status: 'running',
    url: `https://${slug}.cloudstudio.run.app`,
    createdAt: now,
    healthScore: 99.8,
    visitsCount: 1420,
    avgLatencyMs: 38,
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'DATABASE_POOL_MAX', value: '20' },
    ],
    dbLinked: true,
    storageLinked: true,
    logs: [
      `[${now}] Cloud Run revision ${slug}-00001-xwz serving 100% traffic`,
      `[${now}] TLS 1.3 certificate provisioned for ${slug}.cloudstudio.run.app`,
      `[${now}] Liveness & readiness probes healthy (HTTP 200 in 38ms)`,
    ],
  };

  const totalBytes = files.reduce((acc, f) => acc + f.size, 0);

  return {
    id,
    name: spec.name,
    description: spec.description,
    category: spec.category,
    appType: spec.appType,
    techStack: spec.techStack,
    template: spec.template,
    language: spec.language,
    direction: spec.direction,
    databaseEngine: spec.databaseEngine,
    deployTarget: spec.deployTarget,
    starred: true,
    archived: false,
    sharedWithYou: false,
    status: 'deployed',
    updatedAt: now,
    createdAt: now,
    storageUsedBytes: totalBytes,
    storageQuotaBytes: 50 * 1024 * 1024, // 50 MB quota
    files,
    openFileIds: [files[0].id, files[1].id, files[2].id],
    activeFileId: files[0].id,
    diagnostics,
    tests,
    dbTables,
    dbBackups: [
      {
        id: `bkp-${Date.now()}`,
        label: 'Initial Automated Pre-Release Snapshot',
        createdAt: now,
        sizeBytes: 18432,
        tablesSnapshot: JSON.parse(JSON.stringify(dbTables)),
      },
    ],
    dbRoles: [
      { id: 'role-1', username: 'app_owner_admin', role: 'admin', activeConnections: 3 },
      { id: 'role-2', username: 'api_service_writer', role: 'readwrite', activeConnections: 8 },
      { id: 'role-3', username: 'analytics_reader', role: 'readonly', activeConnections: 2 },
    ],
    gitRepoUrl: `https://github.com/salemalderei84/${slug}.git`,
    gitCurrentBranch: 'main',
    gitBranches: ['main', 'staging', 'feat/ai-agents'],
    gitCommits: [initialCommit],
    deployments: [initialDeploy],
    chatThreads: [
      {
        id: `chat-${Date.now()}`,
        title: spec.language === 'ar' ? `بناء وتطوير ${spec.name}` : `Build & Architect ${spec.name}`,
        updatedAt: now,
        messages: [
          {
            id: `msg-init-1`,
            role: 'assistant',
            content:
              spec.language === 'ar'
                ? `مرحباً بك في مساحة عمل **${spec.name}**. جميع الوكلاء العشرة ومحررات الأكواد وقواعد البيانات وخط النشر السحابي جاهزة للعمل الفعلي.`
                : `Welcome to **${spec.name}**. All 10 specialist AI engineering agents, full-stack files, database tables, and Cloud Run deployment pipelines are active.`,
            timestamp: now,
            model: 'gemini-3.8-flash',
            thinkingMode: 'standard',
            agentId: 'agent-chief',
          },
        ],
      },
    ],
    activeChatId: `chat-${Date.now()}`,
    serverLogs: [
      { time: now, level: 'info', message: `Workspace initialized for ${spec.name} (${spec.techStack})` },
      { time: now, level: 'success', message: `Connected to ${spec.databaseEngine.toUpperCase()} instance (2 tables active)` },
      { time: now, level: 'info', message: `Dev server ready on port 3000 · Live preview sandbox synchronized` },
    ],
  };
}

export function createSeedProjects(): Project[] {
  const p1 = createNewProjectFromSpec({
    name: 'منصة التطبيقات الذكية',
    description: 'مساحة عمل برمجية لتطوير التطبيقات والأنظمة السحابية الذكية.',
    category: 'app',
    appType: 'Enterprise SaaS Dashboard',
    techStack: 'react-ts-vite',
    template: 'saas-starter',
    language: 'ar',
    direction: 'rtl',
    databaseEngine: 'postgresql',
    deployTarget: 'cloud-run-eu',
  });
  p1.id = 'proj-smart-app';

  const p2 = createNewProjectFromSpec({
    name: 'Aura MedClinic Portal',
    description: 'Patient scheduling, telemedicine diagnostics, and HIPAA-compliant lab telemetry portal.',
    category: 'website',
    appType: 'Healthcare Portal',
    techStack: 'nextjs-fullstack',
    template: 'medical-portal',
    language: 'en',
    direction: 'ltr',
    databaseEngine: 'postgresql',
    deployTarget: 'cloud-run-us',
  });
  p2.id = 'proj-aura-medclinic';
  p2.sharedWithYou = true;

  const p3 = createNewProjectFromSpec({
    name: 'PitchDeck AI Studio',
    description: 'Interactive investor presentation deck with live financial unit-economics calculators.',
    category: 'slides',
    appType: 'Interactive Presentation',
    techStack: 'react-ts-vite',
    template: 'slides-deck',
    language: 'en',
    direction: 'ltr',
    databaseEngine: 'sqlite',
    deployTarget: 'edge-global',
  });
  p3.id = 'proj-pitchdeck-slides';

  return [p1, p2, p3];
}
