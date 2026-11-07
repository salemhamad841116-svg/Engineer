// ==============================================================================
// Decision Engine Service
// Formulates architectural and tactical options with Pros, Cons, and Impact.
// Empowers user to make informed choices instead of unilateral agent decisions.
// ==============================================================================

const crypto = require('crypto');
const { get, run } = require('../../db/database');
const { nowIso } = require('../../utils/clock');

/**
 * Generates structured decision options for critical forks in project development.
 */
function formulateDecisionOptions({ decisionType = 'architecture', prompt = '', projectContext = {} }) {
  const decisionId = 'dec_' + crypto.randomUUID().slice(0, 10);

  if (decisionType === 'architecture') {
    return {
      decisionId,
      decisionType: 'architecture',
      title: 'اختيار الهيكل المعماري الأساسي للمشروع',
      promptSummary: prompt.slice(0, 100),
      question: 'كيف ترغب في بناء وتنظيم هيكلية هذا المشروع؟',
      options: [
        {
          id: 'opt_modular_components',
          title: 'الهيكل المعياري التفاعلي (Modular Component Architecture)',
          description: 'فصل الواجهة إلى مكونات مستقلة، إدارة حالة مركزية، وتنسيق أنيق مدمج.',
          pros: [
            'قابلية عالية للتوسع وإضافة مزايا مستقبلية دون كسر الأكواد القديمة.',
            'عزل الأخطاء بحيث لا يؤثر عطل جزء على باقي الصفحة.',
            'جاهزية كاملة لبيئات العمل الحديثة والإنتاج.',
          ],
          cons: [
            'عدد ملفات أكثر قليلاً مقارنة بالهيكل المدمج في ملف واحد.',
          ],
          impact: 'أداء ممتاز، سهولة صيانة واختبار فائقة.',
          recommended: true,
        },
        {
          id: 'opt_zero_build_rapid',
          title: 'الهيكل المدمج فائق الخفة (Zero-Build Lightweight)',
          description: 'تطبيق متكامل وسريع، تجميع مرن للأكواد مع استهلاك ذاكرة منخفض للغاية.',
          pros: [
            'إقلاع فوري بدون أي مراحل بناء معقدة.',
            'حجم ملفات بالغ الصغر ومناسب للبيئات المقيدة الموارد.',
            'تعديل وتجربة سريعة وفورية في المتصفح.',
          ],
          cons: [
            'أقل مرونة عند التوسع لمشاريع عملاقة بمئات الشاشات.',
          ],
          impact: 'استهلاك صفر للذاكرة وسرعة استجابة فائقة.',
          recommended: false,
        },
        {
          id: 'opt_fullstack_sqlite',
          title: 'الهيكل السحابي الكامل المتصل بقاعدة بيانات (Fullstack SQLite Backend)',
          description: 'واجهة أمامية مدعومة بمسارات API خلفية وجداول SQLite دائمة.',
          pros: [
            'تخزين واسترجاع حقيقي للبيانات عبر الخادم وقاعدة البيانات.',
            'دعم الاستعلامات والتقارير وحفظ الحالات متعددة المستخدمين.',
          ],
          cons: [
            'يتطلب تشغيل خادم Express مع الواجهة.',
          ],
          impact: 'تطبيق احترافي كامل البيانات (Data-Driven Application).',
          recommended: false,
        },
      ],
      createdAt: nowIso(),
    };
  }

  if (decisionType === 'solution_approach') {
    return {
      decisionId,
      decisionType: 'solution_approach',
      title: 'اختيار أسلوب حل ومعالجة التحدي البرمجي',
      promptSummary: prompt.slice(0, 100),
      question: 'أي أسلوب تفضل أن يتبعه الوكيل في تصحيح وتعديل الكود؟',
      options: [
        {
          id: 'opt_surgical_patch',
          title: 'التعديل الجراحي الموضعي (Surgical Targeted Patch)',
          description: 'تحديد الأسطر الدقيقة المسببة للمشكلة واستبدالها بحذر دون تغيير باقي الكود.',
          pros: [
            'أعلى درجات الأمان — لا يمس الأكواد المستقرة الأخرى.',
            'يحافظ على كامل التوثيق والإعدادات السابقة.',
            'سرعة التحقق الفوري.',
          ],
          cons: [
            'لا يعيد كتابة الهيكل العام إن كان يحتاج تحسيناً كلياً.',
          ],
          impact: 'أمان كامل واستقرار تام للنظام.',
          recommended: true,
        },
        {
          id: 'opt_clean_refactor',
          title: 'إعادة الهيكلة الشاملة (Clean Architectural Refactoring)',
          description: 'إعادة صياغة الدالة أو الملف بالكامل وفق أحدث المعايير البرمجية والأنماط النظيفة.',
          pros: [
            'كود نظيف تماماً وخالٍ من الديون التقنية.',
            'تحسين أسماء المتغيرات والأداء العام.',
          ],
          cons: [
            'تغييرات أوسع في الملف تستدعي فحصاً شاملاً للاعتماديات.',
          ],
          impact: 'جودة كود مرتفعة على المدى الطويل.',
          recommended: false,
        },
      ],
      createdAt: nowIso(),
    };
  }

  if (decisionType === 'deployment_target') {
    return {
      decisionId,
      decisionType: 'deployment_target',
      title: 'اختيار منصة وبيئة النشر',
      promptSummary: prompt.slice(0, 100),
      question: 'إلى أي منصة ترغب بنشر هذا المشروع بعد اجتياز الاختبارات؟',
      options: [
        {
          id: 'opt_local_preview',
          title: 'معاينة محلية معزولة (Sandboxed Local Preview)',
          description: 'تشغيل فوري في بيئة التطوير المحلية المعزولة مع فحص الاستجابة.',
          pros: [
            'فورية وبدون أي تكلفة أو استهلاك شبكي خارجي.',
            'تتيح الفحص الدقيق والتحقق من كل نقطة نهاية قبل الخروج للعامة.',
            'دعم التراجع التلقائي بنقرة واحدة.',
          ],
          cons: [
            'متاحة فقط على جهازك أو شبكتك المحلية.',
          ],
          impact: 'سرعة تحضير فورية وأمان تام.',
          recommended: true,
        },
        {
          id: 'opt_staging_docker',
          title: 'بيئة الاختبار التجريبية (Staging Sandbox Environment)',
          description: 'نشر على حاوية معزولة مطابقة لبيئة الإنتاج مع فحص صحي متقدم.',
          pros: [
            'محاكاة حقيقية لبيئة السحابة مع عزل كامل.',
            'فحص الرابط والـ HTTP Status تلقائياً.',
          ],
          cons: [
            'تتطلب دورة بناء إضافية.',
          ],
          impact: 'تأكيد جاهزية التطبيق للإنتاج.',
          recommended: false,
        },
      ],
      createdAt: nowIso(),
    };
  }

  // Generic fallback decision
  return {
    decisionId,
    decisionType,
    title: 'تحديد مسار التنفيذ',
    promptSummary: prompt.slice(0, 100),
    question: 'يرجى اختيار مسار التنفيذ المفضل:',
    options: [
      {
        id: 'opt_standard',
        title: 'المسار القياسي الموصى به',
        description: 'تنفيذ وفق المعايير البرمجية الآمنة مع إجراء كافة الاختبارات.',
        pros: ['استقرار وموثوقية عالية.'],
        cons: ['يستغرق زمناً قياسياً في الفحص.'],
        impact: 'كود مجرب وموثوق.',
        recommended: true,
      },
      {
        id: 'opt_fast',
        title: 'المسار السريع الفوري',
        description: 'تنفيذ مباشر مع اختبارات أساسية سريعة.',
        pros: ['سرعة فائقة.'],
        cons: ['تغطية اختبارات أخف.'],
        impact: 'تسليم سريع للنموذج الأولي.',
        recommended: false,
      },
    ],
    createdAt: nowIso(),
  };
}

/**
 * Records a user's selection for a decision on a task.
 */
function recordTaskDecisionChoice({ taskId, decisionId, chosenOptionId, userCustomFeedback = '' }) {
  const task = get('SELECT * FROM agent_tasks WHERE id = ?', taskId);
  if (!task) throw new Error('المهمة غير موجودة');

  const decisions = safeJson(task.decisions_json, []);
  decisions.push({
    decisionId,
    chosenOptionId,
    userCustomFeedback,
    decidedAt: nowIso(),
  });

  const stepsLog = safeJson(task.steps_log_json, []);
  stepsLog.push({
    step: 'decision_made',
    message: `اعتمد المستخدم الخيار: ${chosenOptionId}`,
    at: nowIso(),
  });

  run(
    `UPDATE agent_tasks 
     SET decisions_json = ?, steps_log_json = ?, updated_at = ? 
     WHERE id = ?`,
    JSON.stringify(decisions),
    JSON.stringify(stepsLog),
    nowIso(),
    taskId
  );

  return { success: true, taskId, chosenOptionId };
}

function safeJson(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}

module.exports = {
  formulateDecisionOptions,
  recordTaskDecisionChoice,
};
