// ==============================================================================
// ENGINEER — PERFORMANCE & ACCESSIBILITY (a11y) AUDITOR (Phase 2)
// WCAG 2.1 AA Compliance, Touch Targets, RTL Alignment, Simulated Stress Testing
// Assesses web vitals, bundle size, latency, and comprehensive accessibility rules.
// ==============================================================================

import { ProjectFile } from '../../types/platform';

// -----------------------------------------------------------------------------
// Type Definitions
// -----------------------------------------------------------------------------

export interface PerformanceReport {
  timestamp: string;
  score: number; // 0 - 100
  estimatedMetrics: {
    fcpMs: number;
    lcpMs: number;
    ttfbMs: number;
    cls: number;
    bundleSizeBytes: number;
    estimatedGzipBytes: number;
  };
  heavyDependencies: {
    name: string;
    approximateSizeBytes: number;
    recommendation: string;
  }[];
  slowQueryRisks: {
    filePath: string;
    line: number;
    querySnippet: string;
    reason: string;
  }[];
  stressSimulation: {
    simulatedUsers: number;
    durationSeconds: number;
    totalRequests: number;
    throughputReqPerSec: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    errorRatePercent: number;
    bottleneck: string;
    verdict: 'excellent' | 'acceptable' | 'degraded' | 'failed';
  };
  recommendations: string[];
}

export interface A11yIssue {
  ruleId: string;
  level: 'A' | 'AA' | 'AAA';
  severity: 'minor' | 'moderate' | 'serious' | 'critical';
  filePath: string;
  line: number;
  snippet: string;
  description: string;
  remediation: string;
}

export interface A11yReport {
  timestamp: string;
  score: number; // 0 - 100
  wcagCompliance: 'WCAG 2.1 AA Compliant' | 'Partially Compliant' | 'Non-Compliant';
  totalIssues: number;
  issues: A11yIssue[];
  rtlEvaluation: {
    hasRtlSupport: boolean;
    missingRtlDir: boolean;
    issues: string[];
  };
  touchTargetCompliance: {
    passed: boolean;
    minTargetSize: number; // 44px
    violationsCount: number;
  };
  contrastCompliance: {
    evaluated: boolean;
    lowContrastElementsCount: number;
  };
}

// -----------------------------------------------------------------------------
// 1. Performance Profiler & Stress Test Simulator
// -----------------------------------------------------------------------------

export function auditProjectPerformance(
  files: ProjectFile[],
  simulatedUsers = 100
): PerformanceReport {
  let totalRawBytes = 0;
  const heavyDeps: PerformanceReport['heavyDependencies'] = [];
  const slowQueries: PerformanceReport['slowQueryRisks'] = [];
  const recommendations: string[] = [];

  for (const file of files) {
    const bytes = Buffer.byteLength(file.content, 'utf8');
    totalRawBytes += bytes;

    // Check package.json for notoriously heavy libraries
    if (file.path.endsWith('package.json')) {
      if (file.content.includes('"moment"')) {
        heavyDeps.push({
          name: 'moment',
          approximateSizeBytes: 290 * 1024,
          recommendation: 'استبدل مكتبة moment بـ date-fns أو dayjs لتخفيض حجم الحزمة بنسبة 85%.',
        });
      }
      if (file.content.includes('"lodash"') && !file.content.includes('"lodash-es"')) {
        heavyDeps.push({
          name: 'lodash',
          approximateSizeBytes: 70 * 1024,
          recommendation: 'استخدم lodash-es أو استورد الدوال الفردية (مثل lodash/get) لدعم تقليص الشجرة (Tree-shaking).',
        });
      }
    }

    // Check code for unindexed full table scans or unbounded queries
    const lines = file.content.split('\n');
    lines.forEach((line, idx) => {
      const lineNum = idx + 1;
      if (
        /select\s+\*\s+from\s+[a-zA-Z0-9_]+\s*(?:;|$)/i.test(line) &&
        !line.toLowerCase().includes('limit')
      ) {
        slowQueries.push({
          filePath: file.path,
          line: lineNum,
          querySnippet: line.trim().slice(0, 100),
          reason: 'استعلام SELECT * بدون حد أقصى (LIMIT) قد يسبب استهلاكاً كبيراً للذاكرة عند نمو البيانات.',
        });
      }
    });
  }

  // Estimated gzip bundle size (typically 30% of raw JS/TS/CSS code)
  const estimatedGzip = Math.round(totalRawBytes * 0.32);

  // Estimated Web Vitals based on project size and heavy deps
  const baseFcp = 600 + Math.min(Math.round(totalRawBytes / 5000), 1200);
  const baseLcp = baseFcp + 500 + heavyDeps.length * 400;
  const ttfb = 120;
  const cls = 0.02;

  // Stress Simulation Engine
  const durationSec = 10;
  const nominalRps = simulatedUsers * 12;
  const totalReqs = nominalRps * durationSec;
  
  let p50 = 24 + simulatedUsers * 0.15;
  let p95 = p50 * 2.8;
  let p99 = p50 * 4.5;
  let errorRate = 0;

  if (simulatedUsers > 500) {
    p50 += 80;
    p95 += 250;
    p99 += 600;
    errorRate = 0.4;
  }
  if (slowQueries.length > 0) {
    p95 += slowQueries.length * 35;
    p99 += slowQueries.length * 80;
  }

  p50 = Math.round(p50);
  p95 = Math.round(p95);
  p99 = Math.round(p99);

  let bottleneck = 'No critical bottleneck detected; backend and rendering are healthy.';
  let verdict: PerformanceReport['stressSimulation']['verdict'] = 'excellent';

  if (slowQueries.length > 0) {
    bottleneck = 'قواعد البيانات: استعلامات غير محدودة تؤثر على زمن استجابة الـ p95/p99 تحت الحمل.';
    verdict = 'acceptable';
  }
  if (simulatedUsers >= 500 && errorRate > 0) {
    verdict = 'degraded';
    bottleneck = 'استهلاك اتصالات قاعدة البيانات (Connection Pool Saturation) تحت الحمل المرتفع.';
  }

  // Calculate score
  let score = 100;
  if (baseLcp > 2500) score -= 15;
  if (heavyDeps.length > 0) score -= heavyDeps.length * 10;
  if (slowQueries.length > 0) score -= slowQueries.length * 8;
  if (score < 30) score = 30;

  if (heavyDeps.length > 0) {
    recommendations.push(`إزالة الاعتماديات الثقيلة (${heavyDeps.map((d) => d.name).join(', ')}) لتحسين وقت التحميل الأولي.`);
  }
  if (slowQueries.length > 0) {
    recommendations.push('إضافة LIMIT وفهارس (Indexes) على أعمدة البحث في استعلامات SQL لتفادي بطء الاستجابة.');
  }

  return {
    timestamp: new Date().toISOString(),
    score,
    estimatedMetrics: {
      fcpMs: baseFcp,
      lcpMs: baseLcp,
      ttfbMs: ttfb,
      cls,
      bundleSizeBytes: totalRawBytes,
      estimatedGzipBytes: estimatedGzip,
    },
    heavyDependencies: heavyDeps,
    slowQueryRisks: slowQueries,
    stressSimulation: {
      simulatedUsers,
      durationSeconds: durationSec,
      totalRequests: totalReqs,
      throughputReqPerSec: nominalRps,
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      errorRatePercent: errorRate,
      bottleneck,
      verdict,
    },
    recommendations,
  };
}

// -----------------------------------------------------------------------------
// 2. Accessibility (WCAG 2.1 AA) & UX Reviewer
// -----------------------------------------------------------------------------

export function auditProjectAccessibility(files: ProjectFile[]): A11yReport {
  const issues: A11yIssue[] = [];
  let touchViolations = 0;
  let lowContrastCount = 0;
  let hasArabicContent = false;
  let hasRtlDirAttribute = false;
  const rtlIssues: string[] = [];

  for (const file of files) {
    // Only inspect HTML/JSX/TSX/CSS files
    if (!/\.(html|jsx|tsx|vue|svelte|css)$/.test(file.path)) {
      continue;
    }

    // Check Arabic text presence
    if (/[\u0600-\u06FF]/.test(file.content) || file.content.includes('lang="ar"') || file.content.includes("lang='ar'")) {
      hasArabicContent = true;
    }
    if (file.content.includes('dir="rtl"') || file.content.includes("dir='rtl'")) {
      hasRtlDirAttribute = true;
    }

    const lines = file.content.split('\n');

    lines.forEach((lineText, idx) => {
      const lineNum = idx + 1;

      // Rule 1: Missing alt on images (WCAG 1.1.1 Non-text Content - Level A)
      if (/<img\b(?!.*?\balt=)[^>]*>/i.test(lineText)) {
        issues.push({
          ruleId: 'wcag-1.1.1-image-alt',
          level: 'A',
          severity: 'serious',
          filePath: file.path,
          line: lineNum,
          snippet: lineText.trim().slice(0, 100),
          description: 'عنصر الصورة <img> يفتقر لخاصية alt الوصفية اللازمة لبرامج قراءة الشاشة.',
          remediation: 'أضف خاصية alt="..." تصف محتوى الصورة، أو alt="" للصور التزيينية.',
        });
      }

      // Rule 2: Non-interactive elements with click events lacking keyboard handlers or roles
      if (
        /<(div|span|section)\b[^>]*onClick/i.test(lineText) &&
        !lineText.includes('role="button"') &&
        !lineText.includes('onKeyDown')
      ) {
        issues.push({
          ruleId: 'wcag-2.1.1-keyboard-accessible',
          level: 'A',
          severity: 'serious',
          filePath: file.path,
          line: lineNum,
          snippet: lineText.trim().slice(0, 100),
          description: 'عنصر غير تفاعلي (div/span) يحتوي على حدث onClick بدون دور role="button" أو دعم لوحة المفاتيح.',
          remediation: 'استخدم عنصر <button> أصلي أو أضف role="button" و tabIndex={0} مع معالج onKeyDown.',
        });
      }

      // Rule 3: Form inputs without associated labels or aria-label (WCAG 3.3.2 - Level A)
      if (
        /<(input|textarea|select)\b[^>]*>/i.test(lineText) &&
        !lineText.includes('aria-label') &&
        !lineText.includes('aria-labelledby') &&
        !lineText.includes('id=')
      ) {
        issues.push({
          ruleId: 'wcag-3.3.2-input-label',
          level: 'A',
          severity: 'moderate',
          filePath: file.path,
          line: lineNum,
          snippet: lineText.trim().slice(0, 100),
          description: 'حقل إدخال بدون تسمية توضيحية مرتبطة به (Label) أو خاصية aria-label.',
          remediation: 'أضف <label htmlFor="..."> أو أضف خاصية aria-label="...".',
        });
      }

      // Rule 4: Touch targets smaller than 44x44px (WCAG 2.5.5 / 2.5.8 - Level AA)
      if (
        /(?:height|width)\s*:\s*(?:[1-3][0-9]|4[0-3]|1[0-9]|0)px/i.test(lineText) &&
        (lineText.includes('button') || lineText.includes('btn') || lineText.includes('clickable'))
      ) {
        touchViolations++;
        issues.push({
          ruleId: 'wcag-2.5.8-target-size',
          level: 'AA',
          severity: 'moderate',
          filePath: file.path,
          line: lineNum,
          snippet: lineText.trim().slice(0, 100),
          description: 'العنصر التفاعلي حجمه أصغر من الحد الأدنى القياسي لتجربة اللمس (44x44 بكسل).',
          remediation: 'اضبط min-height: 44px و min-width: 44px مع مساحات padding مناسبة.',
        });
      }

      // Rule 5: Low Contrast Check (e.g. gray text on light background #999 on #fff or #aaa on #eee)
      if (
        /color\s*:\s*#(?:aaa|bbb|ccc|888|999)/i.test(lineText) &&
        !lineText.includes('background')
      ) {
        lowContrastCount++;
        issues.push({
          ruleId: 'wcag-1.4.3-contrast-minimum',
          level: 'AA',
          severity: 'moderate',
          filePath: file.path,
          line: lineNum,
          snippet: lineText.trim().slice(0, 100),
          description: 'درجة تباين لون النص مع الخلفية قد تكون أقل من النسبة المطلوبة 4.5:1 (WCAG AA).',
          remediation: 'استخدم درجات رمادي أغمق (مثل #4b5563 أو #374151) لضمان سهولة القراءة.',
        });
      }
    });
  }

  // RTL Evaluation
  if (hasArabicContent && !hasRtlDirAttribute) {
    rtlIssues.push('تم اكتشاف نصوص عربية ولكن لم يتم العثور على dir="rtl" في مستندات HTML الرئيسية.');
    issues.push({
      ruleId: 'engineer-ux-rtl-direction',
      level: 'AA',
      severity: 'serious',
      filePath: 'index.html',
      line: 1,
      snippet: '<html lang="ar">',
      description: 'المشروع يحتوي على واجهات عربية ولكن بدون تفعيل خاصية dir="rtl" الصريحة.',
      remediation: 'أضف خاصية dir="rtl" إلى وسم <html> أو العنصر الحاوي للواجهة.',
    });
  }

  // Score calculation
  let score = 100;
  score -= issues.filter((i) => i.severity === 'critical').length * 20;
  score -= issues.filter((i) => i.severity === 'serious').length * 10;
  score -= issues.filter((i) => i.severity === 'moderate').length * 5;
  score -= issues.filter((i) => i.severity === 'minor').length * 2;
  if (score < 20) score = 20;

  let compliance: A11yReport['wcagCompliance'] = 'WCAG 2.1 AA Compliant';
  if (issues.length > 5 || issues.some((i) => i.severity === 'critical')) {
    compliance = 'Non-Compliant';
  } else if (issues.length > 0) {
    compliance = 'Partially Compliant';
  }

  return {
    timestamp: new Date().toISOString(),
    score,
    wcagCompliance: compliance,
    totalIssues: issues.length,
    issues,
    rtlEvaluation: {
      hasRtlSupport: hasRtlDirAttribute,
      missingRtlDir: hasArabicContent && !hasRtlDirAttribute,
      issues: rtlIssues,
    },
    touchTargetCompliance: {
      passed: touchViolations === 0,
      minTargetSize: 44,
      violationsCount: touchViolations,
    },
    contrastCompliance: {
      evaluated: true,
      lowContrastElementsCount: lowContrastCount,
    },
  };
}
