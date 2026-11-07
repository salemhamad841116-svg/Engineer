// ==============================================================================
// Query Decomposer & Research Level Classifier
// Analyzes user queries, extracts intents, measures complexity, assigns levels,
// and decomposes complex questions into targeted sub-queries with objectives.
// ==============================================================================

const VOLATILE_TECH_KEYWORDS = [
  'react', 'nextjs', 'vue', 'node', 'grpc', 'rest', 'api', 'jwt',
  'tailwind', 'vite', 'typescript', 'microservices', 'cloud', 'sqlite', 'docker'
];

/**
 * Analyzes and classifies a user prompt.
 */
function analyzeAndDecomposeQuery(query, manualLevel = null) {
  const cleanQuery = String(query || '').trim();
  const lower = cleanQuery.toLowerCase();

  // 1. Detect question type
  let questionType = 'factual';
  if (/قارن|مقارنة|الفرق بين|أيهما أفضل|مقابل|versus|vs|compare/i.test(lower)) {
    questionType = 'comparative';
  } else if (/كيف أصمم|معمارية|أفضل ممارسة|هندسة|best practice|architecture|design/i.test(lower)) {
    questionType = 'architectural';
  } else if (/تاريخ|حضارة|قديم|أصول|نشأة|متى تأسست|تأسيس/i.test(lower)) {
    questionType = 'historical';
  } else if (/خطوات|كيفية|طريقة|إجراء|procedure|how to/i.test(lower)) {
    questionType = 'procedural';
  } else if (/تحقق|هل صحيح|تأكد|صحة معلومة|verify/i.test(lower)) {
    questionType = 'verification';
  }

  // 2. Measure complexity (length, multiple conjunctions, comparative clauses)
  const conjunctions = (cleanQuery.match(/(^|\s)(و|أو|مع|بالإضافة إلى|بينما|ولكن|في حين|and|or|with)(\s|[^\s]+)/gi) || []).length;
  const wordCount = cleanQuery.split(/\s+/).filter(Boolean).length;
  let baseComplexity = Math.round(wordCount / 4 + conjunctions * 1.5);
  if (questionType === 'comparative') baseComplexity += 3;
  if (questionType === 'architectural') baseComplexity += 2;
  const complexityScore = Math.min(10, Math.max(1, baseComplexity));

  // 3. Detect need for modern official spec verification
  const requiresModernSpecCheck = VOLATILE_TECH_KEYWORDS.some((kw) => lower.includes(kw));

  // 4. Select research level (Quick, Deep, Expert)
  let selectedLevel = manualLevel;
  if (!selectedLevel || !['quick', 'deep', 'expert'].includes(selectedLevel)) {
    if (complexityScore >= 7 || questionType === 'comparative' || (questionType === 'architectural' && conjunctions >= 2)) {
      selectedLevel = 'expert';
    } else if (complexityScore >= 4 || questionType === 'comparative' || questionType === 'architectural' || requiresModernSpecCheck) {
      selectedLevel = 'deep';
    } else {
      selectedLevel = 'quick';
    }
  }

  // 5. Decompose query into sub-queries
  const subQueries = [];

  if (selectedLevel === 'quick') {
    subQueries.push({
      id: 'sub_1',
      query: cleanQuery,
      objective: 'استرجاع الحقيقة الأساسية المباشرة من المرجع المختص',
      scope: 'single_chapter',
    });
  } else if (questionType === 'comparative') {
    // Split comparative queries
    const parts = cleanQuery.split(/ و | مقابل | مع | مقارنة بـ | vs /i);
    if (parts.length >= 2) {
      subQueries.push({
        id: 'sub_1',
        query: `ما هي خصائص ومبادئ ${parts[0].trim()}`,
        objective: `دراسة المرجع الأول لاستخراج أسس ${parts[0].trim()}`,
        scope: 'source_a',
      });
      subQueries.push({
        id: 'sub_2',
        query: `ما هي خصائص ومبادئ ${parts[1].trim()}`,
        objective: `دراسة المرجع الثاني لاستخراج أسس ${parts[1].trim()}`,
        scope: 'source_b',
      });
      subQueries.push({
        id: 'sub_3',
        query: `أوجه المقارنة والاختلاف بين ${parts[0].trim()} و ${parts[1].trim()}`,
        objective: 'مقارنة الأدلة وتحديد أوجه التناقض والتفضيل المعماري',
        scope: 'synthesis',
      });
    } else {
      subQueries.push(
        { id: 'sub_1', query: cleanQuery, objective: 'البحث عن المصدر الأول', scope: 'primary' },
        { id: 'sub_2', query: `${cleanQuery} مقارنة وتحليل`, objective: 'المقارنة مع المراجع الموازية', scope: 'secondary' }
      );
    }
  } else {
    // Multi-stage decomposition
    subQueries.push({
      id: 'sub_1',
      query: cleanQuery,
      objective: 'البحث عن الفصول والمفاهيم الرئيسية في مكتبة الكتب',
      scope: 'broad_search',
    });
    subQueries.push({
      id: 'sub_2',
      query: `${cleanQuery} تفاصيل وتحليل`,
      objective: 'قراءة السياق الموسع والتأكد من عدم وجود استثناءات أو تعارض',
      scope: 'deep_context',
    });
    if (requiresModernSpecCheck) {
      subQueries.push({
        id: 'sub_3',
        query: `${cleanQuery} أحدث المواصفات الرسمية 2026`,
        objective: 'التحقق من حداثة المعلومة ومطابقتها لأحدث التوثيقات الرسمية',
        scope: 'modern_verification',
      });
    }
  }

  return {
    originalQuery: cleanQuery,
    questionType,
    complexityScore,
    researchLevel: selectedLevel,
    requiresModernSpecCheck,
    subQueries,
  };
}

module.exports = {
  analyzeAndDecomposeQuery,
};
