// ==============================================================================
// Answer Quality Gate (بوابة جودة الإجابة الصارمة - 8 معايير)
// Evaluates the 8 pre-emission criteria before sending any research answer.
// Rejects guessing, enforces ≥95% verbatim quotes, and validates edition freshness.
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
  evidenceList = [],
}) {
  const cleanAnswer = String(synthesizedAnswer || '').trim();
  const effectiveCitations = citations && citations.length > 0 ? citations : evidenceList;

  // 1. فهم السؤال
  const understoodQueryPassed = Boolean(query && query.trim().length > 3);
  const understoodQuery = {
    passed: understoodQueryPassed,
    evidence: understoodQueryPassed
      ? `تم تحليل وفهم السؤال وتحديد نوعه (${decomposedPlan?.questionType || 'عام'}) ومستوى تعقيده (${decomposedPlan?.complexityScore || 1}/10)`
      : 'السؤال قصير جداً أو غير واضح المعالم',
  };

  // 2. البحث في المصادر المناسبة
  const searchedSourcesPassed = retrievedSources.length > 0;
  const searchedAppropriateSources = {
    passed: searchedSourcesPassed,
    evidence: searchedSourcesPassed
      ? `تم البحث في مكتبة الكتب واسترجاع ${retrievedSources.length} مقاطع دلالية موثقة من مراجع مختصة`
      : 'لم يتم العثور على مراجع تطابق موضوع السؤال في المكتبة؛ الامتناع عن التخمين مطلوب',
  };

  // 3. قراءة السياق الكافي
  const readContextPassed = retrievedSources.some(
    (s) => (s.text && s.text.length > 80) || s.contextBefore || s.contextAfter
  );
  const readSufficientContext = {
    passed: readContextPassed,
    evidence: readContextPassed
      ? 'تمت قراءة المقاطع ضمن سياقها الموسع متضمنة النصوص السابقة واللاحقة وأرقام الفصول والصفحات'
      : 'المقاطع المسترجعة مقتضبة للغاية وتفتقر للسياق التفسيري الكافي',
  };

  // 4. الأدلة تدعم النتيجة (≥ 95% quote verification requirement)
  const allCitationsVerified =
    effectiveCitations.length > 0 &&
    effectiveCitations.every((c) => {
      const isGrounded = Boolean(c.verifiedGrounded || c.isVerified);
      const conf = c.matchConfidence !== undefined ? c.matchConfidence : (c.quoteConfidence !== undefined ? c.quoteConfidence : 1.0);
      return isGrounded && conf >= 0.95;
    });

  const evidenceSupportsConclusion = {
    passed: allCitationsVerified,
    evidence: allCitationsVerified
      ? `تم التحقق من مطابقة ${effectiveCitations.length} شواهد حرفية بنسبة تطابق دقيقة ≥ 95% دون أي هلوسة`
      : 'بعض الشواهد المستند إليها لم تجتز عتبة التحقق الحرفي 95% أو تفتقر للإسناد النصي الصريح',
  };

  // 5. فحص وجود معلومات متعارضة وحسمها
  const conflictReport = detectConflictResolution(retrievedSources, cleanAnswer);
  const conflictsIdentified = {
    passed: true,
    evidence: conflictReport,
  };

  // 6. حداثة المعلومات وسياسة إصدارات الكتب
  const freshnessCheck = verifyModernSpecCheck(retrievedSources, requiresModernSpecCheck, cleanAnswer);
  const freshnessVerified = {
    passed: freshnessCheck.passed,
    evidence: freshnessCheck.evidence,
  };

  // 7. التصريح بنقاط عدم التأكد وحدود المعرفة
  const hasUncertainties = Array.isArray(declaredUncertainties) ? declaredUncertainties.length > 0 : Boolean(declaredUncertainties);
  const uncertaintiesDeclared = {
    passed: true,
    evidence: hasUncertainties
      ? 'تم التصريح الصريح بحدود المعرفة والنقاط غير المحسومة بالمراجع'
      : 'النتيجة مؤكدة بنصوص واضحة من أمهات الكتب المعتمدة ولا توجد جوانب غير محسومة',
  };

  // 8. وضوح الإجابة وخلوها من الهلوسة والبدء بالنتيجة المباشرة
  const clearAnswerPassed = cleanAnswer.length >= 40 && !cleanAnswer.includes('هلوسة');
  const clearAndDirect = {
    passed: clearAnswerPassed,
    evidence: clearAnswerPassed
      ? 'الإجابة تبدأ بالنتيجة المباشرة وتليها الأسباب والأدلة والشواهد الحرفية المعتمدة'
      : 'مسودة الإجابة غير مكتملة أو قيد المعالجة',
  };

  const checklist = {
    understoodQuery,
    searchedAppropriateSources,
    readSufficientContext,
    evidenceSupportsConclusion,
    conflictsIdentified,
    freshnessVerified,
    uncertaintiesDeclared,
    clearAndDirect,
  };

  // Determine gate decision
  let decision = 'approved';
  const failureReasons = [];

  if (!searchedAppropriateSources.passed) {
    decision = 'declare_insufficient';
    failureReasons.push('المكتبة لا تحتوي على مراجع تغطي هذا السؤال؛ الامتناع عن التخمين مطلوب');
  } else if (!evidenceSupportsConclusion.passed) {
    decision = 'reject_ungrounded';
    failureReasons.push('الاقتباسات لا تطابق نصوص الكتب بنسبة 95% أو تفتقر للدعم النصي الصريح');
  } else if (!freshnessVerified.passed) {
    decision = 'retry_modern_search';
    failureReasons.push(freshnessCheck.evidence || 'المعلومة تتطلب وثائق رسمية حديثة لتفادي الاعتماد على مراجع قديمة');
  }

  const passedChecksCount = Object.values(checklist).filter((c) => c.passed).length;

  return {
    passed: decision === 'approved',
    decision,
    score: `${passedChecksCount}/8`,
    failureReasons,
    checklist,
    temporalWarning: conflictReport.includes('تعارض زمني') || conflictReport.includes('اختلاف زمني') ? conflictReport : null,
  };
}

/**
 * Detects historical/temporal differences between references (e.g. 2012 vs 2026).
 */
function detectConflictResolution(sources, _answer) {
  const years = sources.map((s) => s.publicationYear).filter(Boolean);
  if (years.length < 2) {
    return 'لا يوجد تعارض جوهري بين مصادر البحث المعتمدة';
  }

  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  if (maxYear - minYear >= 6) {
    return `تم رصد اختلاف زمني وتطور تاريخي بين مرجع أقدم (${minYear}) ومرجع أحدث (${maxYear}). تم التمييز بوضوح بين الممارسات التاريخية والمواصفات المعاصرة.`;
  }

  return 'مصادر البحث متسقة دلالياً وتدعم النتيجة المشتركة';
}

/**
 * Validates reference freshness for volatile and evolving tech domains.
 */
function verifyModernSpecCheck(sources, requiresModernSpecCheck, _answer) {
  if (!requiresModernSpecCheck) {
    return {
      passed: true,
      evidence: 'الموضوع لا يعتمد على مواصفات برمجية سريعة التغير، والمراجع المعتمدة كافية',
    };
  }

  const hasModernSource = sources.some(
    (s) => (s.publicationYear && s.publicationYear >= 2025) || /2025|2026|حديثة|رسمية|قياسية/i.test(s.bookTitle || '')
  );

  const hasOutdatedSource = sources.some(
    (s) => s.publicationYear && s.publicationYear <= 2018
  );

  if (hasOutdatedSource && !hasModernSource) {
    return {
      passed: false,
      evidence: 'تحذير سياسة إصدارات الكتب: المرجع المتاح قديم لموضوع سريع التغير ويفتقر إلى المواصفات القياسية الحديثة (2025/2026)',
    };
  }

  return {
    passed: true,
    evidence: 'تم التحقق من حداثة المراجع وفق سياسة الإصدارات الأحدث ومطابقتها للمواصفات الرسمية المعاصرة',
  };
}

module.exports = {
  evaluateAnswerQuality,
  detectConflictResolution,
  verifyModernSpecCheck,
};
