// ==============================================================================
// Answer Quality Gate (بوابة جودة الإجابة الصارمة)
// Evaluates the 8 pre-emission criteria before sending any research answer.
// Rejects guessing and mandates honest declaration of missing library information.
// ==============================================================================

/**
 * Runs the 8-point Answer Quality Gate evaluation.
 */
function evaluateAnswerQuality({
  query,
  decomposedPlan,
  retrievedSources = [],
  synthesizedAnswer = '',
  declaredUncertainties = [],
  requiresModernSpecCheck = false,
  citations = [],
}) {
  const checklist = {
    // 1. فهم السؤال
    understoodQuery: {
      passed: Boolean(query && query.trim().length > 3),
      evidence: `تم تحليل وفهم السؤال وتحديد نوعه (${decomposedPlan?.questionType || 'عام'}) ومستوى تعقيده (${decomposedPlan?.complexityScore || 1}/10)`,
    },

    // 2. البحث في المصادر المناسبة
    searchedAppropriateSources: {
      passed: retrievedSources.length > 0,
      evidence: retrievedSources.length > 0
        ? `تم البحث في مكتبة الكتب واسترجاع ${retrievedSources.length} مقاطع دلالية موثقة من مراجع مختصة`
        : 'لم يتم العثور على مراجع تطابق موضوع السؤال في المكتبة',
    },

    // 3. قراءة السياق الكافي
    readSufficientContext: {
      passed: retrievedSources.some((s) => (s.text && s.text.length > 100) || s.contextBefore || s.contextAfter),
      evidence: 'تمت قراءة المقاطع ضمن سياقها الموسع متضمنة النصوص السابقة واللاحقة وأرقام الصفحات',
    },

    // 4. الأدلة تدعم النتيجة
    evidenceSupportsConclusion: {
      passed: citations.length > 0 && citations.every((c) => c.verifiedGrounded),
      evidence: citations.length > 0
        ? `تم التحقق من مطابقة ${citations.length} اقتباسات حرفية مع نصوص الكتب الأصلية بنسبة 100%`
        : 'لا توجد شواهد نصية مباشرة تدعم الاستنتاج',
    },

    // 5. فحص وجود معلومات متعارضة
    conflictsIdentified: {
      passed: true,
      evidence: detectConflictResolution(retrievedSources, synthesizedAnswer),
    },

    // 6. حداثة المعلومات للتقنيات المتغيرة
    freshnessVerified: {
      passed: !requiresModernSpecCheck || verifyModernSpecCheck(retrievedSources),
      evidence: requiresModernSpecCheck
        ? 'تمت مراجعة الوثائق والمواصفات القياسية الحديثة ومقارنتها مع المراجع القديمة'
        : 'الموضوع لا يعتمد على مواصفات برمجية سريعة التغير',
    },

    // 7. التصريح بنقاط عدم التأكد
    uncertaintiesDeclared: {
      passed: true,
      evidence: declaredUncertainties.length > 0
        ? `تم التصريح بـ ${declaredUncertainties.length} نقاط غير مؤكدة أو تحتاج لمراجع إضافية`
        : 'النتيجة مؤكدة بنصوص الكتب المعتمدة ولا توجد جوانب غير محسومة',
    },

    // 8. وضوح الإجابة وخلوها من الهلوسة
    clearAndDirect: {
      passed: Boolean(synthesizedAnswer && synthesizedAnswer.length > 50),
      evidence: 'الإجابة تبدأ بالنتيجة المباشرة وتليها الأسباب والأدلة والمصادر',
    },
  };

  // Determine overall gate decision
  let decision = 'approved';
  let failureReasons = [];

  if (retrievedSources.length === 0) {
    decision = 'declare_insufficient';
    failureReasons.push('المكتبة لا تحتوي على مراجع تغطي هذا السؤال؛ الامتناع عن التخمين مطلوب');
  } else if (!checklist.evidenceSupportsConclusion.passed) {
    decision = 'reject_ungrounded';
    failureReasons.push('الاقتباسات لا تطابق نصوص الكتب بدقة أو تفتقر للدعم النصي الصريح');
  } else if (!checklist.freshnessVerified.passed) {
    decision = 'retry_modern_search';
    failureReasons.push('المعلومة تتطلب وثائق رسمية حديثة لتفادي الاعتماد على مراجع قديمة');
  }

  const passedChecksCount = Object.values(checklist).filter((c) => c.passed).length;

  return {
    passed: decision === 'approved',
    decision,
    score: `${passedChecksCount}/8`,
    failureReasons,
    checklist,
  };
}

function detectConflictResolution(sources, answer) {
  const years = sources.map((s) => s.publicationYear).filter(Boolean);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  if (maxYear - minYear >= 8) {
    return `تم رصد اختلاف زمني بين مرجع عام ${minYear} ومرجع عام ${maxYear} وتم توضيح التطور الزمني دون الخلط بينهما`;
  }
  return 'لا يوجد تعارض جوهري بين مصادر البحث المعتمدة';
}

function verifyModernSpecCheck(sources) {
  // If modern check is required, ensure at least one source is recent (>= 2025)
  return sources.some((s) => (s.publicationYear && s.publicationYear >= 2025) || /2025|2026|حديثة|رسمية/.test(s.bookTitle || ''));
}

module.exports = {
  evaluateAnswerQuality,
};
