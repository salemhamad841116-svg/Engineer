// ==============================================================================
// Golden Evaluation Dataset Framework (مجموعة التقييم القياسية)
// Benchmarks research quality: Accuracy, Precision@K, Verbatim Grounding %,
// and Quality Gate Pass Rate across domain questions.
// ==============================================================================

const crypto = require('node:crypto');
const { get, all, run } = require('../../db/database');
const { nowIso } = require('../../utils/clock');
const { executeDeepResearch } = require('./deepResearchEngine');

// 5 Initial Standard Reference Benchmarks (Databases, Architecture, History, Modern Web, Cross-Lingual)
const SEED_BENCHMARK_QA = [
  {
    id: 'gold_db_acid_01',
    query: 'ما هي خصائص ACID في قواعد البيانات وما فائدة مستوى Read Committed؟',
    category: 'databases',
    expectedAnswer: 'الذرية والاتساق والعزل والديمومة مع منع القراءة غير المؤكدة Dirty Read',
    expectedBooks: ['موسوعة قواعد البيانات ومعالجة المعاملات ACID'],
    expectedQuotes: ['تعد خصائص ACID الأساس الراسخ لموثوقية المعاملات'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_arch_cap_02',
    query: 'كيف تؤثر نظرية CAP على تصميم الأنظمة الموزعة والاتساق الصارم؟',
    category: 'architecture',
    expectedAnswer: 'استحالة ضمان التناسق والتوافرية وتحمل انقسام الشبكة في آن واحد، والتفضيل بين CP و AP',
    expectedBooks: ['هندسة البرمجيات والأنظمة الموزعة الحديثة'],
    expectedQuotes: ['تنص نظرية CAP على استحالة ضمان التناسق الفوري'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_web_react19_03',
    query: 'ما هي معمارية Server Components في React 19 وكيف تلغي الحاجة لـ useEffect؟',
    category: 'modern_web',
    expectedAnswer: 'تصيير على الخادم افتراضياً وتقليص حجم الحزمة مع استخدام Server Actions',
    expectedBooks: ['المواصفات القياسية الرسمية لـ React 19', 'المواصفات القياسية لـ React 19 و Server Actions'],
    expectedQuotes: ['في React 19، أصبحت المكونات خادمة افتراضياً'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_hist_majan_04',
    query: 'ما هو الدور التجاري لحضارة مجان ودلمون في تجارة النحاس وطرق البحر؟',
    category: 'history',
    expectedAnswer: 'صهر النحاس وتصديره لوادي الرافدين مع مركزية دلمون في تخزين البضائع وتجارة اللؤلؤ',
    expectedBooks: ['تاريخ الجزيرة العربية وحضارات الشرق القديم'],
    expectedQuotes: ['اشتهرت حضارة مجان (في عُمان والإمارات حالياً) في الألفية الثالثة قبل الميلاد بصهر النحاس'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_bilingual_grpc_05',
    query: 'ما هي مزايا gRPC مقابل REST في اتصالات Microservices السحابية؟',
    category: 'cross_lingual',
    expectedAnswer: 'gRPC relies on HTTP/2 multiplexing and Protocol Buffers serialization for 7-10x lower latency',
    expectedBooks: ['Cloud Native Microservices & Distributed Architecture', 'هندسة البرمجيات والأنظمة الموزعة الحديثة'],
    expectedQuotes: ['gRPC utilizes HTTP/2 multiplexing and Protocol Buffers serialization'],
    minQualityScore: 7.0,
  },
];

/**
 * Seeds the golden evaluation dataset table if empty.
 */
function seedGoldenDataset() {
  for (const item of SEED_BENCHMARK_QA) {
    const existing = get('SELECT id FROM golden_evaluation_dataset WHERE id = ?', item.id);
    if (!existing) {
      run(`
        INSERT INTO golden_evaluation_dataset (
          id, query, category, expected_answer, expected_books_json, expected_quotes_json,
          min_quality_score, is_active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `,
        item.id, item.query, item.category, item.expectedAnswer,
        JSON.stringify(item.expectedBooks), JSON.stringify(item.expectedQuotes),
        item.minQualityScore, nowIso()
      );
    }
  }
}

/**
 * Adds a benchmark QA pair to the golden dataset.
 */
function addGoldenBenchmark({ query, category, expectedAnswer, expectedBooks = [], expectedQuotes = [], minQualityScore = 7.0 }) {
  const id = 'gold_' + crypto.randomUUID().slice(0, 10);
  const now = nowIso();

  run(`
    INSERT INTO golden_evaluation_dataset (
      id, query, category, expected_answer, expected_books_json, expected_quotes_json,
      min_quality_score, is_active, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `,
    id, query, category, expectedAnswer,
    JSON.stringify(expectedBooks), JSON.stringify(expectedQuotes),
    minQualityScore, now
  );

  return { id, query, category, expectedAnswer, expectedBooks, expectedQuotes, minQualityScore, createdAt: now };
}

/**
 * Lists all active golden dataset benchmark pairs.
 */
function listGoldenBenchmarks() {
  seedGoldenDataset();
  const rows = all('SELECT * FROM golden_evaluation_dataset WHERE is_active = 1 ORDER BY category ASC');
  return rows.map((r) => ({
    id: r.id,
    query: r.query,
    category: r.category,
    expectedAnswer: r.expected_answer,
    expectedBooks: JSON.parse(r.expected_books_json || '[]'),
    expectedQuotes: JSON.parse(r.expected_quotes_json || '[]'),
    minQualityScore: r.min_quality_score,
    createdAt: r.created_at,
  }));
}

/**
 * Runs the automated evaluation harness over the golden evaluation dataset.
 */
async function evaluateGoldenDataset({ tenantContext = null, maxItems = null } = {}) {
  seedGoldenDataset();
  let benchmarks = listGoldenBenchmarks();
  if (maxItems && maxItems > 0) {
    benchmarks = benchmarks.slice(0, maxItems);
  }

  const results = [];
  let totalPrecisionSum = 0;
  let totalVerbatimPassCount = 0;
  let totalCitationsEvaluated = 0;
  let qualityGatePassCount = 0;

  for (const b of benchmarks) {
    const t0 = Date.now();
    const runResult = await executeDeepResearch({
      query: b.query,
      manualLevel: 'deep',
      tenantContext,
    });
    const duration = Date.now() - t0;

    const citations = runResult.citations || [];
    const citedBooks = citations.map((c) => c.bookTitle);
    const qg = runResult.qualityGate || {};

    // 1. Source Precision: Did we cite at least one expected book?
    const hasExpectedBook = b.expectedBooks.some((expected) =>
      citedBooks.some((cb) => cb.includes(expected) || expected.includes(cb))
    );

    // 2. Verbatim Accuracy: Percentage of citations verified >= 95%
    let itemVerbatimPass = 0;
    for (const c of citations) {
      if (c.verifiedGrounded) {
        itemVerbatimPass++;
        totalVerbatimPassCount++;
      }
      totalCitationsEvaluated++;
    }
    const itemVerbatimRate = citations.length > 0 ? (itemVerbatimPass / citations.length) * 100 : 0;

    // 3. Quality Gate Pass
    const qgPassed = Boolean(qg.passed);
    if (qgPassed) qualityGatePassCount++;
    if (hasExpectedBook) totalPrecisionSum++;

    results.push({
      benchmarkId: b.id,
      category: b.category,
      query: b.query,
      expectedBooks: b.expectedBooks,
      retrievedBooks: Array.from(new Set(citedBooks)),
      hasExpectedBook,
      citationsCount: citations.length,
      verbatimPassRate: Number(itemVerbatimRate.toFixed(1)),
      qualityGateScore: qg.score || '0/8',
      qualityGatePassed: qgPassed,
      durationMs: duration,
    });
  }

  const overallAccuracy = benchmarks.length > 0 ? (totalPrecisionSum / benchmarks.length) * 100 : 0;
  const overallVerbatimRate = totalCitationsEvaluated > 0 ? (totalVerbatimPassCount / totalCitationsEvaluated) * 100 : 0;
  const overallGatePassRate = benchmarks.length > 0 ? (qualityGatePassCount / benchmarks.length) * 100 : 0;

  return {
    evaluatedCount: benchmarks.length,
    overallMetrics: {
      sourceAccuracyPercent: Number(overallAccuracy.toFixed(1)),
      verbatimGroundingPercent: Number(overallVerbatimRate.toFixed(1)),
      qualityGatePassRatePercent: Number(overallGatePassRate.toFixed(1)),
    },
    results,
    timestamp: nowIso(),
  };
}

module.exports = {
  seedGoldenDataset,
  addGoldenBenchmark,
  listGoldenBenchmarks,
  evaluateGoldenDataset,
  SEED_BENCHMARK_QA,
};
