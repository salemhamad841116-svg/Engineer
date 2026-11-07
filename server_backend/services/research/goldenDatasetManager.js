// ==============================================================================
// Golden Evaluation Dataset Framework (مجموعة التقييم القياسية)
// Benchmarks research quality: Accuracy, Precision@K, Verbatim Grounding %,
// and Quality Gate Pass Rate across domain questions.
// ==============================================================================

const crypto = require('node:crypto');
const { get, all, run } = require('../../db/database');
const { nowIso } = require('../../utils/clock');
const { executeDeepResearch } = require('./deepResearchEngine');

// 24 Reference Benchmarks (Batch 1 across 5 domains + 2 behavioral tests)
const SEED_BENCHMARK_QA = [
  // [D1: قواعد البيانات]
  {
    id: 'gold_db_01',
    query: 'ما الفرق بين الالتزامية القوية (Strong Consistency) والنهائية (Eventual Consistency)، ومتى أختار كليهما؟',
    category: 'databases',
    expectedAnswer: 'الالتزامية القوية تضمن رؤية أحدث كتابة فوراً وتناسب العمليات المالية، والنهائية تتيح تقارب العقد تدريجياً وتناسب التوافرية',
    expectedBooks: ['موسوعة قواعد البيانات ومعالجة المعاملات ACID', 'هندسة البرمجيات والأنظمة الموزعة الحديثة'],
    expectedQuotes: ['الالتزامية القوية Strong Consistency تضمن رؤية أحدث كتابة فوراً'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_db_02',
    query: 'كيف تنتهك الأنظمة الموزعة نظرية CAP عملياً، وأي ضلع يُضحى به عادة في أنظمة NoSQL؟',
    category: 'databases',
    expectedAnswer: 'استحالة الجمع بين الاتساق والتوافرية عند انقسام الشبكة، والتضحية بالاتساق الصارم لصالح نمط AP والاتساق النهائي',
    expectedBooks: ['موسوعة قواعد البيانات ومعالجة المعاملات ACID', 'هندسة البرمجيات والأنظمة الموزعة الحديثة'],
    expectedQuotes: ['يُضحى عادة بضلع الاتساق الصارم Consistency لصالح التوافرية'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_db_03',
    query: 'ما هي خوارزمية توافق Raft وكيف تختلف عن Paxos من حيث القابلية للفهم والتنفيذ؟',
    category: 'databases',
    expectedAnswer: 'تعتمد Raft على قائد صريح وانتخاب موحد وتوزيع السجلات في مسار أحادي مما يجعلها سهلة الفهم والتنفيذ مقارنة بـ Paxos',
    expectedBooks: ['موسوعة قواعد البيانات ومعالجة المعاملات ACID'],
    expectedQuotes: ['تتميز خوارزمية توافق Raft بسهولة الفهم وقابلية التنفيذ مقارنة بـ Paxos'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_db_04',
    query: 'اشرح الفرق بين عزل القراءة المتكررة (Repeatable Read) والتسلسلي (Serializable) مع مثال ظاهر فرق بينهما.',
    category: 'databases',
    expectedAnswer: 'القراءة المتكررة تضمن ثبات الصفوف لكنها تسمح بظهور القراءات الشبحية Phantom Reads، بينما العزل التسلسلي يمنعها تماماً',
    expectedBooks: ['موسوعة قواعد البيانات ومعالجة المعاملات ACID'],
    expectedQuotes: ['الفرق الجوهري بين عزل القراءة المتكررة Repeatable Read والتسلسلي Serializable هو أن الثاني يمنع ظهور القراءات الشبحية Phantom Reads تماماً'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_db_05',
    query: 'ما هي فهارس B-Tree وLSM-Tree، وأي workload يناسب كل منهما؟',
    category: 'databases',
    expectedAnswer: 'فهارس B-Tree تناسب القراءة العشوائية والبحث بالنطاق في OLTP، وهياكل LSM-Tree تناسب الكتابة الكثيفة المتسلسلة على القرص',
    expectedBooks: ['موسوعة قواعد البيانات ومعالجة المعاملات ACID'],
    expectedQuotes: ['تناسب فهارس B-Tree حمولات القراءة العشوائية والبحث بالنطاق في أنظمة OLTP، بينما تتفوق هياكل LSM-Tree في حمولات الكتابة الكثيفة'],
    minQualityScore: 8.0,
  },

  // [D2: المعمارية]
  {
    id: 'gold_arch_06',
    query: 'ما الفرق المعماري بين الـ Microservices وSOA، ومتى يكون Monolith الخيار الأصح؟',
    category: 'architecture',
    expectedAnswer: 'الخدمات المصغرة تتخلص من ناقل الخدمة ESB وتستخدم قنوات بسيطة، والنظام الأحادي هو الخيار الأصح للمشاريع والفرق الصغيرة',
    expectedBooks: ['هندسة البرمجيات والأنظمة الموزعة الحديثة'],
    expectedQuotes: ['الفرق المعماري بين Microservices و SOA يكمن في التخلص من ناقل الخدمة المؤسسي ESB'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_arch_07',
    query: 'ما هو نمط CQRS وما المشكلة التي يحلها؟',
    category: 'architecture',
    expectedAnswer: 'فصل نموذج تعديل البيانات Commands عن نموذج الاستعلام Queries لحل تباين احتياجات القراءة والكتابة',
    expectedBooks: ['هندسة البرمجيات والأنظمة الموزعة الحديثة', 'Cloud Native Microservices & Distributed Architecture'],
    expectedQuotes: ['نمط CQRS يفصل نموذج تعديل البيانات Commands عن نموذج الاستعلام Queries'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_arch_08',
    query: 'اشرح Saga Pattern لإدارة المعاملات الموزعة وفرقه عن المعاملات الثنائية (2PC).',
    category: 'architecture',
    expectedAnswer: 'معاملات محلية متسلسلة مع معاملات تعويضية Compensating للتراجع دون حظر الموارد كما في 2PC',
    expectedBooks: ['هندسة البرمجيات والأنظمة الموزعة الحديثة'],
    expectedQuotes: ['يعتمد نمط Saga Pattern على سلسلة معاملات محلية مستقلة مع معاملات تعويضية Compensating Transactions'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_arch_09',
    query: 'ما الفرق بين API Gateway وService Mesh وأي مسؤوليات يتحمل كل منهما؟',
    category: 'architecture',
    expectedAnswer: 'بوابة API Gateway تتحمل المرور الخارجي North-South والمصادقة، وشبكة Service Mesh تدير الاتصال الداخلي East-West و mTLS',
    expectedBooks: ['هندسة البرمجيات والأنظمة الموزعة الحديثة'],
    expectedQuotes: ['تتولى بوابة API Gateway حركة المرور الخارجية North-South ومصادقة المستخدمين وتحديد معدل الطلبات، بينما تدير شبكة Service Mesh الاتصال الداخلي East-West'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_arch_10',
    query: 'ما هو الـ Circuit Breaker وكيف يمنع الانهيار المتتالي؟',
    category: 'architecture',
    expectedAnswer: 'نمط مرونة يعمل عبر ثلاث حالات (مغلقة، مفتوحة، نصف مفتوحة) لمنع انهيار السلسلة Cascade Failures',
    expectedBooks: ['هندسة البرمجيات والأنظمة الموزعة الحديثة'],
    expectedQuotes: ['يعمل قاطع الدائرة Circuit Breaker عبر ثلاث حالات: المغلقة Closed والمفتوحة Open ونصف المفتوحة Half-Open ليمنع الانهيار المتتالي'],
    minQualityScore: 8.0,
  },

  // [D3: الويب الحديث]
  {
    id: 'gold_web_11',
    query: 'ما التغييرات الجوهرية في React 19 مقارنة بالإصدارات القديمة؟',
    category: 'modern_web',
    expectedAnswer: 'المكونات خادمة افتراضياً Server Components، إلغاء الحاجة لـ useEffect لجلب البيانات، ودوال Server Actions و useActionState',
    expectedBooks: ['المواصفات القياسية لـ React 19 و Server Actions ومعمارية الويب الحديثة', 'المواصفات القياسية لـ React 19 و Server Actions'],
    expectedQuotes: ['في React 19، أصبحت المكونات خادمة افتراضياً Server Components مع إلغاء الحاجة لخطافات useEffects'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_web_12',
    query: 'ما الفرق بين SSR وSSG وISR في توليد صفحات الويب؟',
    category: 'modern_web',
    expectedAnswer: 'SSR يولد الصفحات عند كل طلب ديناميكياً، SSG يولدها مسبقاً أثناء البناء، و ISR يتيح التوليد الثابت التدريجي في الخلفية',
    expectedBooks: ['المواصفات القياسية لـ React 19 و Server Actions ومعمارية الويب الحديثة'],
    expectedQuotes: ['يولد SSR الصفحات ديناميكياً عند كل طلب، بينما ينشئ SSG الصفحات مسبقاً أثناء البناء Build Time، ويتيح ISR إعادة التوليد الثابت التدريجي'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_web_13',
    query: 'ما هي Web Components ولماذا لم تُحل محل الأطر رغم كونها معياراً؟',
    category: 'modern_web',
    expectedAnswer: 'معايير قياسية (Custom Elements, Shadow DOM, Templates) لم تحل محل الأطر لغياب إدارة الحالة والتصيير الخادمي المتكامل',
    expectedBooks: ['المواصفات القياسية لـ React 19 و Server Actions ومعمارية الويب الحديثة'],
    expectedQuotes: ['توفر Web Components كبسلة معيارية عبر Custom Elements و Shadow DOM، لكنها لم تحل محل الأطر لافتقارها لنظام إدارة الحالة'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_web_14',
    query: 'اشرح آلية عمل HTTP/3 وQUIC وما المشكلة في TCP الذي يحلانه.',
    category: 'modern_web',
    expectedAnswer: 'يعمل QUIC فوق UDP ويحل مشكلة انسداد مقدمة الصف Head-of-Line Blocking في TCP ويتيح مصافحة سريعة 0-RTT',
    expectedBooks: ['المواصفات القياسية لـ React 19 و Server Actions ومعمارية الويب الحديثة'],
    expectedQuotes: ['يعمل HTTP/3 عبر بروتوكول QUIC فوق UDP ليقضي على مشكلة انسداد مقدمة الصف Head-of-Line Blocking في TCP'],
    minQualityScore: 8.0,
  },

  // [D4: التاريخ والمفاهيم]
  {
    id: 'gold_hist_15',
    query: 'كيف تطورت نماذج قواعد البيانات من الشبكية إلى العلائقية إلى NoSQL؟',
    category: 'history',
    expectedAnswer: 'من النماذج الهرمية والشبكية CODASYL بمؤشراتها المادية إلى النموذج العلائقي لإدغار كود 1970 و SQL ثم NoSQL للتوسع الأفقي',
    expectedBooks: ['تاريخ الحوسبة وهندسة البرمجيات والمفاهيم التأسيسية', 'موسوعة قواعد البيانات ومعالجة المعاملات ACID'],
    expectedQuotes: ['تطورت قواعد البيانات من النماذج الهرمية والشبكية CODASYL المعتمدة على المؤشرات المادية، إلى النموذج العلائقي لإدغار كود 1970'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_hist_16',
    query: 'ما أسباب أزمة برمجيات الستينات التي أدت إلى هندسة البرمجيات كتخصص؟',
    category: 'history',
    expectedAnswer: 'تطور قدرات العتاد مقابل فوضى البرمجة وتجاوز الميزانيات والكود الفوضوي مما دفع مؤتمر الناتو 1968 لتأسيس هندسة البرمجيات',
    expectedBooks: ['تاريخ الحوسبة وهندسة البرمجيات والمفاهيم التأسيسية'],
    expectedQuotes: ['اندلعت أزمة البرمجيات في الستينات بسبب القفزة الكبيرة في قدرات العتاد مقابل فوضى البرمجة غير المنضبطة وتجاوز الميزانيات'],
    minQualityScore: 8.0,
  },
  {
    id: 'gold_hist_17',
    query: 'ما الفرق الجوهري بين البرمجة الإجرائية والكائنية والوظيفية من حيث نموذج التفكير؟',
    category: 'history',
    expectedAnswer: 'الإجرائية تتبع خطوات متسلسلة وتغيير الحالة، الكائنية تغلف الحالة والسلوك في كائنات، والوظيفية تعتمد على دوال رياضية نقية غير قابلة للتغيير',
    expectedBooks: ['تاريخ الحوسبة وهندسة البرمجيات والمفاهيم التأسيسية'],
    expectedQuotes: ['الفرق الجوهري يكمن في نموذج التفكير: الإجرائية تتبع خطوات متسلسلة وتعديل الحالة، والكائنية تجمع الحالة والسلوك في كائنات مغلفة، والوظيفية تعتمد على دوال رياضية نقية'],
    minQualityScore: 8.0,
  },

  // [D5: ثنائية اللغة (عربي ↔ إنجليزي)]
  {
    id: 'gold_bilingual_18',
    query: 'ما هي مبادئ تصميم واجهات برمجية RESTful؟',
    category: 'cross_lingual',
    expectedAnswer: 'Core REST principles: statelessness, client-server decoupling, explicit cacheability, layered systems, and uniform interface',
    expectedBooks: ['Cloud Native Microservices & Distributed Architecture'],
    expectedQuotes: ['Core RESTful API architectural principles require statelessness, client-server decoupling, explicit cacheability'],
    minQualityScore: 7.0,
  },
  {
    id: 'gold_bilingual_19',
    query: 'ما هو مفهوم الـ Containerization وأهمية Docker في دورة النشر؟',
    category: 'cross_lingual',
    expectedAnswer: 'Containerization provides OS-level virtualization via cgroups and namespaces, while Docker packages runtimes into immutable images',
    expectedBooks: ['Cloud Native Microservices & Distributed Architecture'],
    expectedQuotes: ['Containerization leverages Linux kernel namespaces and cgroups for process isolation, while Docker packages application runtimes into immutable images'],
    minQualityScore: 7.0,
  },
  {
    id: 'gold_bilingual_20',
    query: 'اشرح الفرق بين Authentication وAuthorization.',
    category: 'cross_lingual',
    expectedAnswer: 'Authentication verifies who you are (401), while authorization determines what permissions you have (403)',
    expectedBooks: ['Cloud Native Microservices & Distributed Architecture'],
    expectedQuotes: ['Authentication verifies who you are through identity credentials, whereas authorization determines what permissions you have'],
    minQualityScore: 7.0,
  },
  {
    id: 'gold_bilingual_21',
    query: 'ما هو الـ Load Balancing وأنواع خوارزمياته؟',
    category: 'cross_lingual',
    expectedAnswer: 'Distributes traffic using Round Robin, Weighted Round Robin, Least Connections, and IP Hash across Layer 4 and 7',
    expectedBooks: ['Cloud Native Microservices & Distributed Architecture'],
    expectedQuotes: ['Load balancing distributes traffic across servers using algorithms such as Round Robin, Weighted Round Robin, Least Connections, and IP Hash'],
    minQualityScore: 7.0,
  },
  {
    id: 'gold_bilingual_22',
    query: 'ما المقصود بـ Idempotency ولماذا تهم الـ APIs؟',
    category: 'cross_lingual',
    expectedAnswer: 'Multiple identical requests produce same side effects; critical for retry safety in payments using Idempotency Keys',
    expectedBooks: ['Cloud Native Microservices & Distributed Architecture'],
    expectedQuotes: ['Idempotency guarantees that making multiple identical requests produces the exact same side effect, making GET, PUT, and DELETE inherently idempotent'],
    minQualityScore: 7.0,
  },

  // [اختبارات سلوكية خاصة]
  {
    id: 'gold_behavior_refusal_23',
    query: 'ما نتائج مباراة الأمس؟',
    category: 'behavioral_refusal',
    expectedAnswer: 'تصريح رسمي بنقص المعلومات وعدم كفاية المراجع (declare_insufficient)',
    expectedBooks: [],
    expectedQuotes: [],
    minQualityScore: 0.0,
    expectedBehavior: 'declare_insufficient',
  },
  {
    id: 'gold_behavior_composite_24',
    query: 'ما الفرق المعماري بين Microservices و Monolith ومتى ننتقل بينهما ولماذا يفشل التحول المتسرع؟',
    category: 'behavioral_composite',
    expectedAnswer: 'تفكيك السؤال إلى مقارنة معمارية ومعايير الانتقال وأسباب فشل التحول المتسرع والإجابة عنها جميعاً',
    expectedBooks: ['هندسة البرمجيات والأنظمة الموزعة الحديثة'],
    expectedQuotes: ['الفرق المعماري بين Microservices و SOA يكمن في التخلص من ناقل الخدمة المؤسسي ESB'],
    minQualityScore: 8.0,
    expectedBehavior: 'composite_decomposition',
  },
];

/**
 * Seeds the golden evaluation dataset table if empty or if count is less than SEED_BENCHMARK_QA.
 */
function seedGoldenDataset(force = false) {
  const currentCount = get('SELECT COUNT(*) as c FROM golden_evaluation_dataset')?.c || 0;
  if (force || currentCount < SEED_BENCHMARK_QA.length) {
    run('DELETE FROM golden_evaluation_dataset');
    for (const item of SEED_BENCHMARK_QA) {
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
function addGoldenBenchmark({ query, category, expectedAnswer, expectedBooks = [], expectedQuotes = [], minQualityScore = 7.0, expectedBehavior = null }) {
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

  return { id, query, category, expectedAnswer, expectedBooks, expectedQuotes, minQualityScore, expectedBehavior, createdAt: now };
}

/**
 * Lists all active golden dataset benchmark pairs.
 */
function listGoldenBenchmarks() {
  seedGoldenDataset();
  const rows = all('SELECT * FROM golden_evaluation_dataset WHERE is_active = 1 ORDER BY id ASC');
  return rows.map((r) => {
    const seedItem = SEED_BENCHMARK_QA.find((s) => s.id === r.id);
    return {
      id: r.id,
      query: r.query,
      category: r.category,
      expectedAnswer: r.expected_answer,
      expectedBooks: JSON.parse(r.expected_books_json || '[]'),
      expectedQuotes: JSON.parse(r.expected_quotes_json || '[]'),
      minQualityScore: r.min_quality_score,
      expectedBehavior: seedItem?.expectedBehavior || null,
      createdAt: r.created_at,
    };
  });
}

/**
 * Runs the automated evaluation harness over the golden evaluation dataset with Recall@5 metric.
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
  let recallAt5PassCount = 0;

  const domainStats = {};

  for (const b of benchmarks) {
    const t0 = Date.now();
    const runResult = await executeDeepResearch({
      query: b.query,
      manualLevel: 'deep',
      tenantContext,
    });
    const duration = Date.now() - t0;

    const retrievedSources = runResult.retrievedSources || [];
    const citations = runResult.citations || [];
    const citedBooks = citations.map((c) => c.bookTitle);
    const qg = runResult.qualityGate || {};

    const isRefusalTest = b.expectedBehavior === 'declare_insufficient' || b.expectedBooks.length === 0;

    let hitRank = -1;
    let recallAt5 = false;
    let hasExpectedBook = false;

    if (isRefusalTest) {
      // In honest refusal: zero citations and declare_insufficient is the expected correct behavior
      const correctlyRefused = qg.decision === 'declare_insufficient' && citations.length === 0;
      recallAt5 = correctlyRefused;
      hasExpectedBook = correctlyRefused;
      hitRank = correctlyRefused ? 1 : -1;
    } else {
      // Search retrieved sources (in ranked order) for first matching expected book
      for (let i = 0; i < retrievedSources.length; i++) {
        const src = retrievedSources[i];
        const match = b.expectedBooks.some((expected) =>
          src.bookTitle.includes(expected) || expected.includes(src.bookTitle) || src.bookId.includes(expected)
        );
        if (match) {
          hitRank = i + 1;
          break;
        }
      }

      // Also check citations list if not matched in retrieved sources
      if (hitRank === -1) {
        const citedMatch = b.expectedBooks.some((expected) =>
          citedBooks.some((cb) => cb.includes(expected) || expected.includes(cb))
        );
        if (citedMatch) hitRank = 1;
      }

      recallAt5 = hitRank > 0 && hitRank <= 5;
      hasExpectedBook = b.expectedBooks.some((expected) =>
        citedBooks.some((cb) => cb.includes(expected) || expected.includes(cb))
      ) || recallAt5;
    }

    // 2. Verbatim Accuracy: Percentage of citations verified >= 95%
    let itemVerbatimPass = 0;
    if (citations.length > 0) {
      for (const c of citations) {
        if (c.verifiedGrounded) {
          itemVerbatimPass++;
          totalVerbatimPassCount++;
        }
        totalCitationsEvaluated++;
      }
    } else if (isRefusalTest) {
      // Refusal test has 0 citations by design (100% compliant)
      itemVerbatimPass = 1;
      totalVerbatimPassCount++;
      totalCitationsEvaluated++;
    }
    const itemVerbatimRate = citations.length > 0
      ? (itemVerbatimPass / citations.length) * 100
      : (isRefusalTest ? 100 : 0);

    // 3. Quality Gate Pass
    const qgPassed = isRefusalTest
      ? qg.decision === 'declare_insufficient'
      : Boolean(qg.passed);

    if (qgPassed) qualityGatePassCount++;
    if (hasExpectedBook) totalPrecisionSum++;
    if (recallAt5) recallAt5PassCount++;

    // Domain breakdown tracking
    const domainKey = b.category;
    if (!domainStats[domainKey]) {
      domainStats[domainKey] = { total: 0, recallAt5Count: 0, gatePassCount: 0 };
    }
    domainStats[domainKey].total++;
    if (recallAt5) domainStats[domainKey].recallAt5Count++;
    if (qgPassed) domainStats[domainKey].gatePassCount++;

    const primaryBook = isRefusalTest
      ? 'لا مرجع (اختبار الامتناع الصادق declare_insufficient)'
      : (citedBooks[0] || retrievedSources[0]?.bookTitle || 'لم يُسترجع');

    results.push({
      benchmarkId: b.id,
      category: b.category,
      query: b.query,
      expectedBooks: b.expectedBooks,
      retrievedBooks: Array.from(new Set(citedBooks.length > 0 ? citedBooks : retrievedSources.slice(0, 3).map((s) => s.bookTitle))),
      primaryBook,
      hitRank: hitRank > 0 ? hitRank : 'غير موجود',
      recallAt5,
      hasExpectedBook,
      citationsCount: citations.length,
      verbatimPassRate: Number(itemVerbatimRate.toFixed(1)),
      qualityGateScore: isRefusalTest ? 'الامتناع الصادق (معتمد)' : (qg.score || '0/8'),
      qualityGatePassed: qgPassed,
      durationMs: duration,
    });
  }

  const overallAccuracy = benchmarks.length > 0 ? (totalPrecisionSum / benchmarks.length) * 100 : 0;
  const overallVerbatimRate = totalCitationsEvaluated > 0 ? (totalVerbatimPassCount / totalCitationsEvaluated) * 100 : 0;
  const overallGatePassRate = benchmarks.length > 0 ? (qualityGatePassCount / benchmarks.length) * 100 : 0;
  const overallRecallAt5Rate = benchmarks.length > 0 ? (recallAt5PassCount / benchmarks.length) * 100 : 0;

  const domainBreakdown = {};
  for (const [dom, stat] of Object.entries(domainStats)) {
    domainBreakdown[dom] = {
      total: stat.total,
      recallAt5Rate: Number(((stat.recallAt5Count / stat.total) * 100).toFixed(1)),
      gatePassRate: Number(((stat.gatePassCount / stat.total) * 100).toFixed(1)),
    };
  }

  return {
    evaluatedCount: benchmarks.length,
    overallMetrics: {
      recallAt5Percent: Number(overallRecallAt5Rate.toFixed(1)),
      sourceAccuracyPercent: Number(overallAccuracy.toFixed(1)),
      verbatimGroundingPercent: Number(overallVerbatimRate.toFixed(1)),
      qualityGatePassRatePercent: Number(overallGatePassRate.toFixed(1)),
      domainBreakdown,
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
