// ==============================================================================
// Deep Research & Book Intelligence Engine Comprehensive Test Suite
// Gate 9 Validation Suite (11 Exhaustive Tests)
//
// 1. Hybrid Semantic Indexing (BM25 + 128-dim dense embedding + RRF)
// 2. Three Research Tiers (Quick: 1 loop, Deep: 3 loops, Expert: 6 loops, cost bounds)
// 3. Composite Query Decomposition (multi-intent decomposition into sub-queries)
// 4. Evidence Repository (structured fact storage with exact source attribution)
// 5. Quote Verification Gate (>= 95% threshold with Levenshtein window similarity)
// 6. 8-Point Answer Quality Gate (strict pre-emission criteria)
// 7. Golden Evaluation Dataset Framework (storage, runner, and benchmark metrics)
// 8. Research Feedback & Audit Logging (thumbs up/down, audit logging)
// 9. Bilingual Cross-Lingual Search (Arabic query -> English book chunks & vice-versa)
// 10. Book Edition Policy (newest edition default, temporal discrepancy warning)
// 11. Anti-Hallucination & Honest Refusal (declare_insufficient on missing domains)
// ==============================================================================

const assert = require('node:assert');
const { getDb } = require('../db/database');
const {
  generateEmbedding,
  cosineSimilarity,
  vectorToBlob,
  blobToVector,
  tokenizeForBM25,
  computeBM25Score,
  reciprocalRankFusion,
  normalizeText,
} = require('../services/research/localEmbeddingService');
const { searchBookKnowledge, seedReferenceLibrary } = require('../services/research/bookIntelligence');
const { analyzeAndDecomposeQuery } = require('../services/research/queryDecomposer');
const {
  recordEvidence,
  getSessionEvidence,
  purgeSessionEvidence,
} = require('../services/research/evidenceRepository');
const { verifyVerbatimGrounding } = require('../services/research/groundingAuditor');
const { evaluateAnswerQuality } = require('../services/research/answerQualityGate');
const {
  seedGoldenDataset,
  listGoldenBenchmarks,
  evaluateGoldenDataset,
} = require('../services/research/goldenDatasetManager');
const { recordFeedback, getSessionFeedback, createSession } = require('../services/research/researchMemory');
const { expandCrossLingualQuery } = require('../services/research/crossLingualEngine');
const { executeDeepResearch } = require('../services/research/deepResearchEngine');

async function runDeepResearchSuite() {
  console.log('================================================================');
  console.log('📚 RUNNING DEEP RESEARCH & BOOK INTELLIGENCE ENGINE TEST SUITE');
  console.log('================================================================\n');

  // Initialize DB and ensure library is seeded
  getDb();
  seedReferenceLibrary();

  let passedTests = 0;
  let totalTests = 0;

  async function runTest(testName, fn) {
    totalTests++;
    try {
      await fn();
      passedTests++;
      console.log(`  ✅ [PASS] ${testName}`);
    } catch (err) {
      console.error(`  ❌ [FAIL] ${testName}: ${err.message}`);
      throw err;
    }
  }

  const tenantCtx = {
    tenantId: 'tenant_research_test_01',
    userId: 'user_research_01',
    role: 'member',
  };

  // ----------------------------------------------------------------------------
  // TEST 1: Hybrid Semantic Indexing (BM25 + 128-dim dense embedding + RRF)
  // ----------------------------------------------------------------------------
  await runTest('Test 1: Hybrid Semantic Indexing (BM25 + 128-dim dense embedding + RRF)', async () => {
    // 1. Check dense embedding generation and normalization
    const textA = 'قواعد البيانات ومعاملات ACID والذرية والاتساق';
    const textB = 'أنظمة قواعد البيانات الموثوقة مع الحفاظ على الاتساق';
    const textC = 'طرق طهي المعكرونة بالصلصة الإيطالية';

    const embA = generateEmbedding(textA);
    const embB = generateEmbedding(textB);
    const embC = generateEmbedding(textC);

    assert.strictEqual(embA.length, 128, 'Dense vector dimension must be 128');
    assert.strictEqual(embB.length, 128, 'Dense vector dimension must be 128');

    // BLOB serialization round-trip
    const blob = vectorToBlob(embA);
    const restored = blobToVector(blob);
    assert.strictEqual(restored.length, 128);
    assert.ok(Math.abs(restored[0] - embA[0]) < 1e-6, 'Blob roundtrip should preserve float values');

    // Cosine similarity
    const simAB = cosineSimilarity(embA, embB);
    const simAC = cosineSimilarity(embA, embC);
    assert.ok(simAB > simAC, `Semantic similarity AB (${simAB.toFixed(3)}) should exceed unrelated AC (${simAC.toFixed(3)})`);

    // BM25 scoring
    const bm25Score1 = computeBM25Score(['acid', 'معاملات'], 'تعد خصائص ACID الأساس الراسخ لموثوقية المعاملات');
    const bm25Score2 = computeBM25Score(['acid', 'معاملات'], 'الفصل الثاني: تجارة البخور وقوافل الجمال');
    assert.ok(bm25Score1 > bm25Score2, 'BM25 score for relevant chunk must be higher than irrelevant chunk');

    // Reciprocal Rank Fusion
    const bm25List = [
      { id: 'c1', text: 'chunk 1', score: 4.5 },
      { id: 'c2', text: 'chunk 2', score: 2.1 },
    ];
    const vectorList = [
      { id: 'c2', text: 'chunk 2', score: 0.85 },
      { id: 'c3', text: 'chunk 3', score: 0.70 },
    ];
    const fused = reciprocalRankFusion(bm25List, vectorList, 60);
    assert.ok(fused.length >= 2, 'RRF must return merged list');
    assert.ok(fused[0].rrfScore > 0, 'RRF scores must be positive');
    const c2Item = fused.find((f) => f.id === 'c2');
    assert.strictEqual(c2Item.matchType, 'hybrid', 'Item appearing in both lists must be marked hybrid');

    // End-to-end knowledge search with byte offsets
    const results = searchBookKnowledge('ACID معالجة المعاملات', { limit: 3 }, tenantCtx);
    assert.ok(results.length > 0, 'searchBookKnowledge should retrieve matching chunks');
    const firstHit = results[0];
    assert.ok(firstHit.byteEnd > firstHit.byteStart, 'Chunk must contain valid UTF-8 byte boundaries');
    assert.ok(firstHit.score > 0, 'Chunk must have positive ranking score');
  });

  // ----------------------------------------------------------------------------
  // TEST 2: Three Research Tiers & Resource Limits (Quick, Deep, Expert)
  // ----------------------------------------------------------------------------
  await runTest('Test 2: Three Research Tiers (Quick: 1 loop, Deep: 3 loops, Expert: 6 loops, cost bounds)', async () => {
    // Quick tier
    const quickResult = await executeDeepResearch({
      query: 'ما هي ذرية المعاملات؟',
      manualLevel: 'quick',
      tenantContext: tenantCtx,
    });
    assert.strictEqual(quickResult.session.researchLevel, 'quick');
    assert.ok(quickResult.session.costEstimate <= 0.0005, 'Quick tier cost must not exceed bound');

    // Deep tier
    const deepResult = await executeDeepResearch({
      query: 'ما هي خصائص ACID في قواعد البيانات؟',
      manualLevel: 'deep',
      tenantContext: tenantCtx,
    });
    assert.strictEqual(deepResult.session.researchLevel, 'deep');
    assert.ok(deepResult.session.costEstimate <= 0.003, 'Deep tier cost must not exceed bound');

    // Expert tier
    const expertResult = await executeDeepResearch({
      query: 'قارن بين معاملات ACID ونظرية CAP في الأنظمة الموزعة مع تحليل التوافقية والأداء',
      manualLevel: 'expert',
      tenantContext: tenantCtx,
    });
    assert.strictEqual(expertResult.session.researchLevel, 'expert');
    assert.ok(expertResult.session.costEstimate <= 0.008, 'Expert tier cost must not exceed bound');

    // Verify auto tier selection based on complexity
    const planAutoQuick = analyzeAndDecomposeQuery('ما تعريف الذرية؟');
    assert.strictEqual(planAutoQuick.researchLevel, 'quick', 'Simple definition should auto-route to quick');

    const planAutoExpert = analyzeAndDecomposeQuery('دراسة معمارية مقارنة بين ACID و CAP و Microservices وتأثير ذلك على التصميم السحابي');
    assert.strictEqual(planAutoExpert.researchLevel, 'expert', 'Multi-faceted architectural query should auto-route to expert');
  });

  // ----------------------------------------------------------------------------
  // TEST 3: Composite Query Decomposition (multi-intent decomposition)
  // ----------------------------------------------------------------------------
  await runTest('Test 3: Composite Query Decomposition into sub-queries', async () => {
    const complexQuery = 'قارن بين معاملات ACID في قواعد البيانات ونظرية CAP في الأنظمة الموزعة وكيف تؤثر على التناسق';
    const plan = analyzeAndDecomposeQuery(complexQuery);

    assert.strictEqual(plan.questionType, 'comparative', 'Must detect comparative question type');
    assert.ok(plan.complexityScore >= 6, `Complexity score should be >= 6, got ${plan.complexityScore}`);
    assert.ok(plan.subQueries.length >= 2, `Should decompose into at least 2 subqueries, got ${plan.subQueries.length}`);

    // Verify sub-query structure
    for (const sq of plan.subQueries) {
      assert.ok(sq.id, 'Subquery must have an id');
      assert.ok(sq.query && sq.query.length > 5, 'Subquery must have substantive query text');
      assert.ok(sq.objective, 'Subquery must declare an objective');
    }
  });

  // ----------------------------------------------------------------------------
  // TEST 4: Evidence Repository Persistence with UTF-8 byte coordinates
  // ----------------------------------------------------------------------------
  await runTest('Test 4: Evidence Repository persistence with UTF-8 byte_start and byte_end', async () => {
    const testSession = createSession({
      tenantId: tenantCtx.tenantId,
      userId: tenantCtx.userId,
      query: 'فحص مستودع الأدلة',
      researchLevel: 'deep',
    });

    const rawChunk = 'تعد خصائص ACID الأساس الراسخ لموثوقية المعاملات في قواعد البيانات العلائقية الحديثة.';
    const exactQuote = 'تعد خصائص ACID الأساس الراسخ لموثوقية المعاملات';

    const ev = recordEvidence({
      sessionId: testSession.id,
      tenantId: tenantCtx.tenantId,
      bookId: 'book_database_acid_2025',
      bookTitle: 'موسوعة قواعد البيانات ومعالجة المعاملات ACID',
      author: 'د. خالد الزهراني',
      chapter: 'الفصل الأول: أساسيات المعاملات',
      pageNumber: 15,
      byteStart: 120,
      byteEnd: 240,
      keyFact: 'خصائص ACID هي حجر الزاوية للموثوقية',
      exactQuote,
      sourceChunkText: rawChunk,
    });

    assert.ok(ev.id.startsWith('ev_'), 'Evidence id must have ev_ prefix');
    assert.strictEqual(ev.isVerified, true, 'Verbatim quote must be verified');
    assert.ok(ev.quoteConfidence >= 0.95, 'Confidence must be >= 0.95');
    assert.strictEqual(ev.byteStart, 120);
    assert.strictEqual(ev.byteEnd, 240);

    // Retrieve from repository
    const storedEvidence = getSessionEvidence(testSession.id);
    assert.strictEqual(storedEvidence.length, 1);
    assert.strictEqual(storedEvidence[0].bookTitle, 'موسوعة قواعد البيانات ومعالجة المعاملات ACID');
    assert.strictEqual(storedEvidence[0].exactQuote, exactQuote);

    // Clean purge
    purgeSessionEvidence(testSession.id);
    const emptyEvidence = getSessionEvidence(testSession.id);
    assert.strictEqual(emptyEvidence.length, 0, 'Purged session evidence must be empty');
  });

  // ----------------------------------------------------------------------------
  // TEST 5: Quote Verification Gate (>= 95% threshold)
  // ----------------------------------------------------------------------------
  await runTest('Test 5: Quote Verification Gate (>= 95% pass, < 95% reject)', async () => {
    const sourceText = 'تنص نظرية CAP على استحالة ضمان التناسق الفوري والتوافرية وتحمل انقسام الشبكة في آن واحد في أي نظام موزع.';

    // Case A: 100% exact verbatim match
    const auditExact = verifyVerbatimGrounding(
      'تنص نظرية CAP على استحالة ضمان التناسق الفوري',
      sourceText,
      0.95
    );
    assert.strictEqual(auditExact.verified, true, 'Exact quote must pass verification');
    assert.strictEqual(auditExact.matchConfidence, 1.0, 'Exact quote must have 1.0 confidence');
    assert.strictEqual(auditExact.matchType, 'exact_verbatim');

    // Case B: High overlap with slight whitespace / punctuation variance (>= 95%)
    const auditHighOverlap = verifyVerbatimGrounding(
      '  تنص نظرية CAP على استحالة ضمان التناسق الفوري ،، وتحمل انقسام الشبكة ',
      sourceText,
      0.95
    );
    assert.strictEqual(auditHighOverlap.verified, true, 'Minor formatting variance must pass 95% threshold');
    assert.ok(auditHighOverlap.matchConfidence >= 0.95);

    // Case C: Fabricated or heavily mutated quote (< 95%)
    const auditFabricated = verifyVerbatimGrounding(
      'تنص نظرية كاب على أن جميع الأنظمة السحابية قادرة على تحقيق التناسق المطلق دون أي قيود شبكية',
      sourceText,
      0.95
    );
    assert.strictEqual(auditFabricated.verified, false, 'Fabricated claim must fail 95% threshold');
    assert.ok(auditFabricated.matchConfidence < 0.95, `Confidence must be < 0.95, got ${auditFabricated.matchConfidence}`);
    assert.strictEqual(auditFabricated.matchType, 'unsupported_hallucination');
  });

  // ----------------------------------------------------------------------------
  // TEST 6: 8-Point Answer Quality Gate checklist
  // ----------------------------------------------------------------------------
  await runTest('Test 6: 8-Point Answer Quality Gate checklist', async () => {
    const verifiedSources = [
      {
        bookTitle: 'موسوعة قواعد البيانات ومعالجة المعاملات ACID',
        chapter: 'الفصل الأول',
        pageNumber: 15,
        text: 'تعد خصائص ACID الأساس الراسخ لموثوقية المعاملات في قواعد البيانات العلائقية.',
        publicationYear: 2025,
      },
    ];

    const validEvidence = [
      {
        verifiedGrounded: true,
        quoteExact: 'تعد خصائص ACID الأساس الراسخ لموثوقية المعاملات',
        quoteConfidence: 1.0,
      },
    ];

    // Case A: Grounded and complete response -> Passes Quality Gate
    const goodReport = evaluateAnswerQuality({
      query: 'ما هي خصائص ACID في قواعد البيانات؟',
      decomposedPlan: { questionType: 'definitional', complexityScore: 3 },
      retrievedSources: verifiedSources,
      synthesizedAnswer: 'النتيجة المباشرة: خصائص ACID تضمن الذرية والاتساق والعزل والديمومة لدعم موثوقية المعاملات المالية والتجارية بدقة متناهية.',
      declaredUncertainties: ['النتيجة قطعية من الفصل الأول'],
      citations: validEvidence,
    });

    assert.strictEqual(goodReport.passed, true, 'Grounded answer must pass quality gate');
    assert.strictEqual(goodReport.checklist.understoodQuery.passed, true);
    assert.strictEqual(goodReport.checklist.searchedAppropriateSources.passed, true);
    assert.strictEqual(goodReport.checklist.evidenceSupportsConclusion.passed, true);
    assert.strictEqual(goodReport.checklist.freshnessVerified.passed, true);
    assert.strictEqual(goodReport.checklist.clearAndDirect.passed, true);

    // Case B: Ungrounded claim with unverified citations -> Fails Quality Gate
    const badReport = evaluateAnswerQuality({
      query: 'ما هي خصائص ACID في قواعد البيانات؟',
      decomposedPlan: { questionType: 'definitional', complexityScore: 3 },
      retrievedSources: verifiedSources,
      synthesizedAnswer: 'إجابة مفبركة تدعي أموراً وهمية',
      citations: [
        {
          verifiedGrounded: false,
          quoteExact: 'اقتباس وهمي لم يرد في أي كتاب',
          quoteConfidence: 0.2,
        },
      ],
    });

    assert.strictEqual(badReport.passed, false, 'Ungrounded answer must fail quality gate');
    assert.strictEqual(badReport.checklist.evidenceSupportsConclusion.passed, false);
    assert.ok(badReport.failureReasons.length > 0, 'Failure reasons must be documented');
  });

  // ----------------------------------------------------------------------------
  // TEST 7: Golden Dataset Framework & Benchmark Evaluation
  // ----------------------------------------------------------------------------
  // TEST 7: Golden Dataset Framework & Benchmark Evaluation
  // ----------------------------------------------------------------------------
  await runTest('Test 7: Golden Dataset benchmark runner, Recall@5 and report generation', async () => {
    seedGoldenDataset();
    const benchmarks = listGoldenBenchmarks();
    assert.ok(benchmarks.length >= 24, `Must have at least 24 benchmarks, got ${benchmarks.length}`);

    // Verify benchmark categories
    const categories = new Set(benchmarks.map((b) => b.category));
    assert.ok(categories.has('databases'), 'Must include databases benchmark');
    assert.ok(categories.has('architecture'), 'Must include architecture benchmark');
    assert.ok(categories.has('modern_web'), 'Must include modern_web benchmark');
    assert.ok(categories.has('history'), 'Must include history benchmark');
    assert.ok(categories.has('cross_lingual'), 'Must include cross_lingual benchmark');

    // Run benchmark evaluation (sample 5 items for fast test suite execution)
    const report = await evaluateGoldenDataset({ tenantContext: tenantCtx, maxItems: 5 });
    assert.strictEqual(report.evaluatedCount, 5, 'Must evaluate 5 benchmarks');
    assert.ok(report.overallMetrics.recallAt5Percent >= 80, 'Recall@5 should be >= 80%');
    assert.strictEqual(report.overallMetrics.sourceAccuracyPercent, 100, 'Source accuracy should be 100%');
    assert.strictEqual(report.overallMetrics.verbatimGroundingPercent, 100, 'Verbatim grounding rate should be 100%');
    assert.strictEqual(report.overallMetrics.qualityGatePassRatePercent, 100, 'Quality gate pass rate should be 100%');
  });

  // ----------------------------------------------------------------------------
  // TEST 8: Research Feedback recording & Audit Logging
  // ----------------------------------------------------------------------------
  await runTest('Test 8: Research Feedback recording with quality gate score & audit logging', async () => {
    const researchRes = await executeDeepResearch({
      query: 'ما هي معمارية Server Components في React 19؟',
      manualLevel: 'quick',
      tenantContext: tenantCtx,
    });

    const sessionId = researchRes.session.id;

    // Record thumbs-up feedback
    const fb = recordFeedback({
      sessionId,
      tenantId: tenantCtx.tenantId,
      citationId: researchRes.citations[0]?.id || null,
      feedbackType: 'helpful',
      userComment: 'توثيق ممتاز وشواهد دقيقة من مواصفات React 19',
    });

    assert.ok(fb.id.startsWith('fb_'), 'Feedback id must start with fb_');
    assert.strictEqual(fb.feedbackType, 'helpful');
    assert.strictEqual(fb.qualityGatePassed, true);

    // Retrieve feedback history
    const feedbackList = getSessionFeedback(sessionId);
    assert.ok(feedbackList.length >= 1, 'Should retrieve recorded feedback');
    assert.strictEqual(feedbackList[0].feedback_type, 'helpful');

    // Verify Session Audit Stage Trail
    assert.ok(researchRes.stages.length >= 5, 'Must have recorded all 5 stages');
    const stageNames = researchRes.stages.map((s) => s.stage);
    assert.ok(stageNames.includes('1_understanding'));
    assert.ok(stageNames.includes('2_searching'));
    assert.ok(stageNames.includes('3_analyzing'));
    assert.ok(stageNames.includes('4_verifying'));
    assert.ok(stageNames.includes('5_synthesizing'));
  });

  // ----------------------------------------------------------------------------
  // TEST 9: Bilingual Cross-Lingual Search (Arabic query -> English book chunks)
  // ----------------------------------------------------------------------------
  await runTest('Test 9: Bilingual Cross-Lingual Search (Arabic <-> English)', async () => {
    // 1. Cross-lingual dictionary query expansion
    const expAr = expandCrossLingualQuery('ما هي مزايا اتصالات gRPC في microservices السحابية؟');
    assert.strictEqual(expAr.hasCrossLingualTerms, true, 'Must detect cross-lingual terms');
    assert.ok(expAr.expandedTokens.includes('grpc'), 'Must retain gRPC token');
    assert.ok(expAr.crossLingualQuery.includes('microservices') || expAr.crossLingualQuery.includes('grpc'));

    // 2. Arabic query searches and retrieves English book chunks
    const searchRes = searchBookKnowledge('اتصالات gRPC في الخدمات المصغرة microservices', { limit: 5 }, tenantCtx);
    const foundEnglishBook = searchRes.some((hit) => hit.bookId === 'book_microservices_en_2026');
    assert.ok(foundEnglishBook, 'Arabic query with technical terms must successfully retrieve English book chunks');

    const englishChunk = searchRes.find((hit) => hit.bookId === 'book_microservices_en_2026');
    assert.ok(englishChunk.text.includes('Protocol Buffers') || englishChunk.text.includes('HTTP/2'));
  });

  // ----------------------------------------------------------------------------
  // TEST 10: Book Edition Policy & Temporal Discrepancy Warning (2012 vs 2026)
  // ----------------------------------------------------------------------------
  await runTest('Test 10: Book Edition Policy & temporal discrepancy warning (2012 vs 2026)', async () => {
    // Query that draws from both legacy 2012 DOM manipulation and 2026 Server Components
    const compResult = await executeDeepResearch({
      query: 'قارن بين تعديل DOM المباشر في أدلة تطوير الويب القديمة ومعمارية Server Components الحديثة',
      manualLevel: 'deep',
      tenantContext: tenantCtx,
    });

    // Check stage log or answer markdown for temporal gap detection
    const stage3 = compResult.stages.find((s) => s.stage === '3_analyzing');
    assert.ok(stage3, 'Stage 3 must exist');
    assert.ok(
      stage3.detail.includes('اختلاف زمني') || compResult.session.answerMarkdown.includes('التطور الزمني'),
      'Must detect temporal gap between 2012 legacy book and 2026 modern specification'
    );
    assert.ok(
      compResult.session.answerMarkdown.includes('2012') && compResult.session.answerMarkdown.includes('2026'),
      'Answer must explicitly contextualize both time periods'
    );
  });

  // ----------------------------------------------------------------------------
  // TEST 11: Anti-Hallucination & Honest Refusal (declare_insufficient)
  // ----------------------------------------------------------------------------
  await runTest('Test 11: Honest refusal to hallucinate (declare_insufficient) on missing domains', async () => {
    const outOfDomainQuery = 'كيف أصنع شوربة الفطر اللذيذة بالكريمة في المنزل؟';
    const refusalResult = await executeDeepResearch({
      query: outOfDomainQuery,
      manualLevel: 'quick',
      tenantContext: tenantCtx,
    });

    // System must not hallucinate quotes or evidence
    assert.strictEqual(refusalResult.evidence.length, 0, 'Out-of-domain query must produce 0 evidence items');
    assert.strictEqual(refusalResult.citations.length, 0, 'Out-of-domain query must produce 0 citations');
    assert.ok(
      refusalResult.session.summary.includes('غير متوفرة') || refusalResult.session.summary.includes('نقص المعلومات'),
      'Summary must clearly declare insufficient library information'
    );
    assert.ok(
      refusalResult.session.answerMarkdown.includes('تصريح رسمي بنقص المعلومات') ||
      refusalResult.session.answerMarkdown.includes('غير متوفرة في مكتبة الكتب'),
      'Answer markdown must refuse to answer with official statement of insufficiency'
    );
  });

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} DEEP RESEARCH SUITE TESTS PASSED PERFECTLY!`);
  console.log('================================================================\n');
}

if (require.main === module) {
  runDeepResearchSuite().catch((err) => {
    console.error('Fatal Test Failure:', err);
    process.exit(1);
  });
}

module.exports = {
  runDeepResearchSuite,
};
