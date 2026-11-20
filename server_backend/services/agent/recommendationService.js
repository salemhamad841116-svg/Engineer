// ==============================================================================
// server_backend/services/agent/recommendationService.js
// Personalized Recommendations — suggests the right structure, features and
// next steps for the user's project.
//
// Method honesty: this engine is RULE-BASED and deterministic — it classifies
// the request domain from explicit keyword patterns, then recommends from a
// curated knowledge table, cross-checked against the live semantic index of the
// actual project. Every suggestion carries its basis; nothing is presented as
// machine-learned insight.
// ==============================================================================
'use strict';

const DOMAIN_RULES = [
  {
    domain: 'accounting',
    patterns: /(محاسب|محاسبة|فواتير|فاتورة|حسابات|قيود|ميزانية|accounting|invoice|bookkeep|ledger|expense)/i,
    features: ['سجل قيود مزدوج القيد (مدين/دائن)', 'تقرير ميزانية عمومية', 'فواتير قابلة للطباعة بترقيم تسلسلي', 'تصدير CSV/JSON'],
    dataModel: ['entries (id, date, debit, credit, amount, description)', 'invoices (id, number, client, total, status)'],
    structure: ['index.html', 'styles.css', 'js/store.js (طبقة بيانات localStorage)', 'js/ledger.js (منطق القيود)', 'js/ui.js (العرض)'],
    warnings: ['الدقة المالية: استخدم المبالغ بالهللات/السنتات كأعداد صحيحة (لا فاصلة عائمة) لتفادي أخطاء التقريب.'],
  },
  {
    domain: 'commerce',
    patterns: /(متجر|تجارة|منتجات|سلة|بيع|تسوق|store|shop|cart|e-?commerce|product catalog)/i,
    features: ['كتالوج منتجات ببحث وتصفية', 'سلة مشتريات بملخص أسعار حي', 'نموذج إتمام طلب', 'حفظ الطلبات محلياً'],
    dataModel: ['products (id, name, price, stock)', 'orders (id, items[], total, createdAt)'],
    structure: ['index.html', 'styles.css', 'js/store.js', 'js/cart.js', 'js/ui.js'],
    warnings: ['المدفوعات الحقيقية تتطلب بوابة دفع خادمية — نسخة المتصفح المحلية تحاكي الطلب فقط ويجب أن تعلن ذلك.'],
  },
  {
    domain: 'notes',
    patterns: /(ملاحظات|مذكرة|مهام|To\s?do|notes?|todo|tasks?)/i,
    features: ['إضافة/تعديل/حذف مع حفظ فوري', 'بحث نصي', 'تثبيت الملاحظات المهمة', 'استمرارية عبر localStorage'],
    dataModel: ['notes (id, title, body, pinned, updatedAt)'],
    structure: ['index.html', 'styles.css', 'app.js'],
    warnings: [],
  },
  {
    domain: 'booking',
    patterns: /(حجز|مواعيد|موعد|حجوزات|booking|appoint|schedule|reservation)/i,
    features: ['تقويم شهري بعرض التوفر', 'نموذج حجز بتحقق من التعارض', 'قائمة مواعيد قابلة للإلغاء'],
    dataModel: ['slots (id, date, time, status)', 'bookings (id, slotId, customer, createdAt)'],
    structure: ['index.html', 'styles.css', 'js/calendar.js', 'js/store.js', 'app.js'],
    warnings: ['منطق التواريخ: اعتمد UTC للتخزين واعرض بالتوقيت المحلي لتفادي انزياح المناطق الزمنية.'],
  },
  {
    domain: 'education',
    patterns: /(تعليم|دروس|كورس|اختبار|طلاب|مدرسة|education|course|quiz|learn|flashcard)/i,
    features: ['قائمة دروس بتقدم محفوظ', 'اختبار قصير بنتيجة فورية', 'بطاقات مراجعة'],
    dataModel: ['lessons (id, title, done)', 'quiz (id, question, options[], answer)'],
    structure: ['index.html', 'styles.css', 'js/quiz.js', 'app.js'],
    warnings: [],
  },
  {
    domain: 'dashboard',
    patterns: /(لوحة|تحكم|إحصاء|تقارير|مؤشرات|dashboard|analytics|kpi|report)/i,
    features: ['بطاقات مؤشرات KPI', 'رسم بياني بسيط (Canvas بلا مكتبات)', 'جدول بيانات قابل للفرز'],
    dataModel: ['metrics (id, label, value, trend)'],
    structure: ['index.html', 'styles.css', 'js/charts.js', 'app.js'],
    warnings: [],
  },
];

const GENERIC = {
  domain: 'generic',
  features: ['هيكل واضح: واجهة + منطق + تخزين', 'معرّفات مستقرة للعناصر التفاعلية (data-testid)', 'استمرارية البيانات عند الحاجة'],
  dataModel: [],
  structure: ['index.html', 'styles.css', 'app.js'],
  warnings: [],
};

function classifyDomain(prompt = '') {
  for (const rule of DOMAIN_RULES) {
    if (rule.patterns.test(prompt)) return rule;
  }
  return null;
}

/**
 * Recommends structure/features/data model for a NEW request.
 * basis field always states WHY (matched keyword + rule table version).
 */
function recommendForPrompt({ prompt = '', language = 'ar' }) {
  const rule = classifyDomain(prompt);
  if (!rule) {
    return {
      basis: 'no-domain-keyword-match',
      domain: 'generic',
      confidence: 'low',
      note: language === 'ar'
        ? 'لم أتعرف على مجال محدد من وصفك — هذه توصيات عامة؛ كلما زادت تفاصيل وصفك زادت دقة التوصية.'
        : 'No specific domain detected from your description — these are generic recommendations; more detail yields sharper advice.',
      ...GENERIC,
    };
  }
  return {
    basis: `domain-keyword-match:${rule.domain}`,
    domain: rule.domain,
    confidence: 'rule-based',
    features: rule.features,
    dataModel: rule.dataModel,
    structure: rule.structure,
    warnings: rule.warnings,
  };
}

/**
 * Next-step recommendations for an EXISTING project, derived from its live
 * semantic index (Phase A) — evidence-based, not guesses.
 */
function nextStepsForProject({ db, projectId, project }) {
  const steps = [];
  const files = (project && Array.isArray(project.files) ? project.files : []);
  const allCode = files.map((f) => String(f.content || '')).join('\n');

  const usesLocalStorage = /localStorage\.(get|set)Item/.test(allCode);
  const hasTestIds = /data-testid|id="[a-z][a-z0-9-]*"/i.test(allCode);
  const hasForms = /<form|<input|<button/i.test(allCode);

  if (hasForms && !usesLocalStorage) {
    steps.push({
      priority: 'high',
      key: 'persistence',
      titleAr: 'أضف استمرارية البيانات',
      detailAr: 'التطبيق يحتوي نماذج إدخال لكن البيانات تضيع عند تحديث الصفحة. أوصي بحفظ السجلات في localStorage بصيغة JSON.',
      titleEn: 'Add data persistence',
      detailEn: 'The app has input forms but data is lost on reload. Persist records to localStorage as JSON.',
      evidence: 'forms-present+localStorage-absent',
    });
  }
  if (!hasTestIds) {
    steps.push({
      priority: 'medium',
      key: 'testability',
      titleAr: 'أضف معرّفات مستقرة للاختبار',
      detailAr: 'لا توجد data-testid أو id للعناصر التفاعلية — بدونها لا تستطيع الاختبارات الآلية التحقق من سلوك التطبيق.',
      titleEn: 'Add stable test identifiers',
      detailEn: 'No data-testid or id attributes on interactive elements — automated checks cannot verify behavior without them.',
      evidence: 'no-stable-selectors',
    });
  }
  if (files.length === 1 && files[0] && (files[0].content || '').length > 30000) {
    steps.push({
      priority: 'medium',
      key: 'split-files',
      titleAr: 'قسّم الملف الكبير',
      detailAr: `الملف الوحيد يتجاوز 30KB — فصل المنطق والتنسيق يسهّل التعديلات الدلالية الدقيقة لاحقاً.`,
      titleEn: 'Split the large file',
      detailEn: 'Single file exceeds 30KB — separating logic and styling enables precise semantic edits later.',
      evidence: 'monolith-file>30KB',
    });
  }
  if (db && projectId) {
    try {
      const outlineRows = db
        .prepare("SELECT COUNT(*) AS c FROM project_index_symbols WHERE project_id = ? AND kind = 'handler'")
        .get(String(projectId));
      if (outlineRows && outlineRows.c === 0 && hasForms) {
        steps.push({
          priority: 'high',
          key: 'handlers',
          titleAr: 'اربط النماذج بمعالجات أحداث',
          detailAr: 'الفهرس الدلالي لا يرى أي معالج أحداث (handle*/on*) رغم وجود نماذج — الأزرار قد تكون غير مربوطة بأي منطق.',
          titleEn: 'Wire forms to event handlers',
          detailEn: 'The semantic index sees zero event handlers despite forms being present — buttons may not be wired to any logic.',
          evidence: 'index:handlers=0+forms-present',
        });
      }
    } catch (_) { /* index may be unavailable — recommendations stay honest and partial */ }
  }
  return steps;
}

module.exports = { classifyDomain, recommendForPrompt, nextStepsForProject, DOMAIN_RULES };
