// ==============================================================================
// ENGINEER — EXISTING PROJECT IMPORT & MODERNIZATION ENGINE (Phase 2)
// Imports GitHub / ZIP projects, inspects frameworks, dependencies, and risks,
// and produces comprehensive Health & Modernization Reports.
// ==============================================================================

import path from 'node:path';
import JSZip from 'jszip';
import { Project, ProjectFile } from '../../types/platform';

export interface ProjectHealthReport {
  framework: 'react' | 'nextjs' | 'vue' | 'nodejs' | 'express' | 'flutter' | 'vanilla' | 'unknown';
  frameworkVersion?: string;
  totalFiles: number;
  totalLinesOfCode: number;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'none';
  hasLockfile: boolean;
  scriptsFound: Record<string, string>;
  dependenciesCount: number;
  devDependenciesCount: number;
  securityRisks: {
    severity: 'critical' | 'high' | 'medium' | 'low';
    message: string;
    filePath: string;
  }[];
  healthScore: number; // 0 - 100
  modernizationRecommendations: string[];
}

// -----------------------------------------------------------------------------
// 1. ZIP File Extractor & Sanitizer
// -----------------------------------------------------------------------------

export async function unpackProjectZip(
  zipBuffer: Buffer,
  projectName = 'imported-project'
): Promise<{ files: ProjectFile[]; report: ProjectHealthReport }> {
  const zip = await JSZip.loadAsync(zipBuffer);
  const files: ProjectFile[] = [];

  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (zipEntry.dir) continue;

    // Security Guard: Prevent zip-slip path traversal attacks
    const normalized = path.normalize(relativePath).replace(/^(\.\.(\/|\\|$))+/, '');
    if (normalized.includes('..') || path.isAbsolute(normalized)) {
      continue;
    }

    // Ignore binary or massive artifacts like node_modules or .git
    if (normalized.includes('node_modules/') || normalized.includes('.git/') || normalized.includes('.DS_Store')) {
      continue;
    }

    const content = await zipEntry.async('string');
    const fileName = path.basename(normalized);
    const ext = path.extname(fileName).toLowerCase();

    let language: ProjectFile['language'] = 'javascript';
    if (ext === '.ts' || ext === '.tsx') language = 'typescript';
    else if (ext === '.css') language = 'css';
    else if (ext === '.html') language = 'html';
    else if (ext === '.json') language = 'json';
    else if (ext === '.md') language = 'markdown';
    else if (ext === '.sql') language = 'sql';

    files.push({
      id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: fileName,
      path: `/${normalized.replace(/\\/g, '/')}`,
      folder: path.dirname(normalized) || 'root',
      content,
      language,
      size: content.length,
      updatedAt: new Date().toISOString(),
    });
  }

  const report = analyzeProjectHealth(files, projectName);
  return { files, report };
}

// -----------------------------------------------------------------------------
// 2. Health & Modernization Analyzer
// -----------------------------------------------------------------------------

export function analyzeProjectHealth(files: ProjectFile[], _projectName = 'project'): ProjectHealthReport {
  let framework: ProjectHealthReport['framework'] = 'vanilla';
  let frameworkVersion: string | undefined;
  let packageManager: ProjectHealthReport['packageManager'] = 'none';
  let hasLockfile = false;
  const scriptsFound: Record<string, string> = {};
  let dependenciesCount = 0;
  let devDependenciesCount = 0;
  const securityRisks: ProjectHealthReport['securityRisks'] = [];
  const modernizationRecommendations: string[] = [];

  // Check package.json
  const pkgFile = files.find((f) => f.name === 'package.json');
  if (pkgFile) {
    try {
      const pkg = JSON.parse(pkgFile.content);
      const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      dependenciesCount = Object.keys(pkg.dependencies || {}).length;
      devDependenciesCount = Object.keys(pkg.devDependencies || {}).length;

      if (pkg.scripts) {
        Object.assign(scriptsFound, pkg.scripts);
      }

      if (allDeps['next']) {
        framework = 'nextjs';
        frameworkVersion = allDeps['next'];
      } else if (allDeps['react']) {
        framework = 'react';
        frameworkVersion = allDeps['react'];
      } else if (allDeps['vue']) {
        framework = 'vue';
        frameworkVersion = allDeps['vue'];
      } else if (allDeps['express']) {
        framework = 'express';
        frameworkVersion = allDeps['express'];
      } else {
        framework = 'nodejs';
      }
    } catch (_) {
      securityRisks.push({
        severity: 'medium',
        message: 'ملف package.json غير صالح أو يحتوي على أخطاء تنسيق JSON.',
        filePath: 'package.json',
      });
    }
  }

  // Check Flutter / Dart pubspec.yaml
  const pubspec = files.find((f) => f.name === 'pubspec.yaml');
  if (pubspec) {
    framework = 'flutter';
  }

  // Lockfile inspection
  if (files.some((f) => f.name === 'package-lock.json')) {
    packageManager = 'npm';
    hasLockfile = true;
  } else if (files.some((f) => f.name === 'yarn.lock')) {
    packageManager = 'yarn';
    hasLockfile = true;
  } else if (files.some((f) => f.name === 'pnpm-lock.yaml')) {
    packageManager = 'pnpm';
    hasLockfile = true;
  }

  if (!hasLockfile && pkgFile) {
    securityRisks.push({
      severity: 'medium',
      message: 'عدم وجود ملف Lockfile (package-lock.json) قد يؤدي لتثبيت إصدارات غير متوافقة أو غير آمنة.',
      filePath: 'package.json',
    });
    modernizationRecommendations.push('توليد وتثبيت package-lock.json لتثبيت الإصدارات بدقة.');
  }

  // Secret leak & vulnerability detection in code
  for (const file of files) {
    const text = file.content;

    // Hardcoded API keys detection
    if (/(?:AIza[0-9A-Za-z-_]{35}|sk-[a-zA-Z0-9]{32,}|ghp_[a-zA-Z0-9]{36})/i.test(text)) {
      securityRisks.push({
        severity: 'critical',
        message: `اكتشاف مفتاح API حساس مسجل بشكل صريح داخل الكود في الملف (${file.path}).`,
        filePath: file.path,
      });
      modernizationRecommendations.push(`نقل المفاتيح الحساسة من ${file.path} إلى ملف .env مع استخدام متغيرات البيئة.`);
    }

    // Dangerous eval / innerHTML usage
    if (/\beval\s*\(/.test(text)) {
      securityRisks.push({
        severity: 'high',
        message: `استخدام دالة eval() غير الآمنة في الملف (${file.path}) يمثل ثغرة Code Injection.`,
        filePath: file.path,
      });
    }
  }

  // Compute Lines of Code
  const totalLinesOfCode = files.reduce((acc, f) => acc + f.content.split('\n').length, 0);

  // Health Score Calculation
  let healthScore = 100;
  for (const risk of securityRisks) {
    if (risk.severity === 'critical') healthScore -= 30;
    else if (risk.severity === 'high') healthScore -= 15;
    else if (risk.severity === 'medium') healthScore -= 8;
  }
  if (!scriptsFound['test']) {
    healthScore -= 10;
    modernizationRecommendations.push('إضافة سكربت تشغيل اختبارات آلي (npm test).');
  }
  if (framework === 'react' && !files.some((f) => f.name.endsWith('.tsx') || f.name.endsWith('.ts'))) {
    modernizationRecommendations.push('ترقية المشروع إلى TypeScript لتحسين أمان الأنواع وسرعة التطوير.');
  }

  healthScore = Math.max(10, Math.min(100, healthScore));

  return {
    framework,
    frameworkVersion,
    totalFiles: files.length,
    totalLinesOfCode,
    packageManager,
    hasLockfile,
    scriptsFound,
    dependenciesCount,
    devDependenciesCount,
    securityRisks,
    healthScore,
    modernizationRecommendations,
  };
}

// -----------------------------------------------------------------------------
// 3. Project Creation from Import
// -----------------------------------------------------------------------------

export function createProjectFromImport(
  name: string,
  files: ProjectFile[],
  report: ProjectHealthReport
): Project {
  const now = new Date().toISOString();
  const isRtl = files.some((f) => /[\u0600-\u06FF]/.test(f.content));

  return {
    id: `proj_import_${Date.now()}`,
    name,
    description: `Imported ${report.framework.toUpperCase()} application with ${files.length} files. Health Score: ${report.healthScore}/100.`,
    category: 'app',
    appType: report.framework,
    techStack: report.framework === 'nextjs' ? 'nextjs-fullstack' : 'react-ts-vite',
    template: 'imported-template',
    language: isRtl ? 'ar' : 'en',
    direction: isRtl ? 'rtl' : 'ltr',
    databaseEngine: 'sqlite',
    deployTarget: 'cloud-run-eu',
    starred: false,
    archived: false,
    status: 'ready',
    updatedAt: now,
    createdAt: now,
    storageUsedBytes: files.reduce((acc, f) => acc + f.size, 0),
    storageQuotaBytes: 524288000,
    files,
    openFileIds: [files[0]?.id || ''],
    activeFileId: files[0]?.id || '',
    diagnostics: report.securityRisks.map((r, idx) => ({
      id: `diag_${idx}`,
      filePath: r.filePath,
      line: 1,
      severity: r.severity === 'critical' || r.severity === 'high' ? 'error' : 'warning',
      code: 'SEC_RISK',
      message: r.message,
      rootCause: r.message,
      suggestedFix: 'Resolve security issue based on modernization recommendations.',
      originalSnippet: '',
      fixedSnippet: '',
      fixed: false,
    })),
    tests: [],
    dbTables: [],
    dbBackups: [],
    dbRoles: [],
    gitRepoUrl: '',
    gitCurrentBranch: 'main',
    gitBranches: ['main'],
    gitCommits: [],
    deployments: [],
    chatThreads: [
      {
        id: `chat_${Date.now()}`,
        title: isRtl ? 'محادثة المشروع المستورد' : 'Imported Project Chat',
        updatedAt: now,
        messages: [
          {
            id: `msg_${Date.now()}`,
            role: 'assistant',
            content: isRtl
              ? `تم استيراد المشروع بنجاح (${files.length} ملف، ${report.totalLinesOfCode} سطر كود). إطار العمل المكتشف: ${report.framework}. درجة سلامة المشروع: ${report.healthScore}/100. يمكنك الآن طلب أي تعديل وسأقوم بتنفيذه بأمان.`
              : `Project successfully imported (${files.length} files, ${report.totalLinesOfCode} LOC). Detected framework: ${report.framework}. Health score: ${report.healthScore}/100. You can now request any modifications safely.`,
            timestamp: now,
          },
        ],
      },
    ],
    activeChatId: `chat_${Date.now()}`,
    serverLogs: [
      {
        time: now,
        level: 'info',
        message: `Imported project "${name}" with ${files.length} files. Framework: ${report.framework}.`,
      },
    ],
  };
}
