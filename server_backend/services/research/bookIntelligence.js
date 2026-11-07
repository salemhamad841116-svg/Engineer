// ==============================================================================
// Book Intelligence & High-Fidelity Knowledge Retrieval Engine
// Thin service layer delegating 100% of data persistence and search to KnowledgeDAL.
// Guarantees: Multi-format parsing, 512-token chunking, byte-exact verbatim preservation,
// and strict application-level tenant isolation (RLS).
// ==============================================================================

const {
  knowledgeDal,
  chunkBookContentWithVerbatim,
  AccessDeniedError,
  assertTenantContext,
} = require('../../dal/knowledgeDal');

const SYSTEM_TENANT_CONTEXT = {
  tenantId: 'system_library',
  userId: 'system_admin',
  role: 'admin',
  isSuperAdmin: true,
};

/**
 * Calculates cosine similarity between two Float32Array vectors.
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Splits text into ~512 token chunks with ~15% overlap while preserving verbatim raw chunk.
 */
function chunkBookContent(text, options = {}) {
  return chunkBookContentWithVerbatim(text, options);
}

/**
 * Registers or indexes a book strictly via KnowledgeDAL with tenant context.
 */
function registerBook(bookData, tenantContext = SYSTEM_TENANT_CONTEXT) {
  return knowledgeDal.registerBook(bookData, tenantContext);
}

/**
 * Retrieves book details with its structure and chapter index via KnowledgeDAL.
 */
function getBookDetails(bookId, tenantContext = SYSTEM_TENANT_CONTEXT) {
  return knowledgeDal.getBookDetails(bookId, tenantContext);
}

/**
 * Lists all books available to the specified tenant context via KnowledgeDAL.
 */
function listAvailableBooks(tenantContext = SYSTEM_TENANT_CONTEXT) {
  return knowledgeDal.listBooks(tenantContext);
}

/**
 * Hybrid Semantic & Keyword Retrieval strictly routed through KnowledgeDAL.
 */
function searchBookKnowledge(query, options = {}, tenantContext = SYSTEM_TENANT_CONTEXT) {
  return knowledgeDal.searchBookKnowledge(query, options, tenantContext);
}

/**
 * Retrieves verbatim raw chunk without modifications.
 */
function getVerbatimChunk(chunkId, tenantContext = SYSTEM_TENANT_CONTEXT) {
  return knowledgeDal.getVerbatimChunk(chunkId, tenantContext);
}

/**
 * Initializes the default Reference Library with multi-book seed data.
 * All default reference books are marked as shared library items.
 */
function seedReferenceLibrary() {
  const existingBooks = knowledgeDal.listBooks(SYSTEM_TENANT_CONTEXT);
  if (existingBooks.length >= 5) return;

  // Book 1: Software Architecture
  registerBook({
    id: 'book_sw_arch_2026',
    title: 'هندسة البرمجيات والأنظمة الموزعة الحديثة',
    author: 'د. طارق المنصوري',
    edition: 'الطبعة الثالثة المنقحة',
    publicationYear: 2026,
    language: 'Arabic',
    pagesTotal: 340,
    isSharedLibrary: true,
    toc: [
      { chapter: 1, title: 'الفصل الأول: المبادئ المعمارية وتفكيك الأنظمة Monolith to Microservices', page: 12 },
      { chapter: 2, title: 'الفصل الثاني: بروتوكولات الاتصال gRPC مقابل REST ونواقل الأحداث Event-Driven', page: 75 },
      { chapter: 3, title: 'الفصل الثالث: التوافرية العالية ونظرية CAP وإدارة الحالات الموزعة', page: 142 },
      { chapter: 4, title: 'الفصل الرابع: الأمان وتأمين الخدمات وصفر ثقة Zero Trust Architecture', page: 215 },
    ],
    chapters: [
      {
        title: 'الفصل الأول: المبادئ المعمارية وتفكيك الأنظمة',
        pageStart: 12,
        pageEnd: 74,
        content: `تعتمد هندسة الأنظمة الموزعة على مبدأ الفصل القاطع للمسؤوليات (Separation of Concerns). إن تفكيك النظام الأحادي إلى خدمات صغرى يفرض عزل البيانات لكل خدمة في قاعدة بيانات مستقلة (Database-per-Service Pattern). يمنع تماماً مشاركة جداول قاعدة البيانات المشتركة بين الخدمات لأن ذلك يؤدي إلى اقتران وثيق (Tight Coupling) يجهض فوائد الاستقلالية وسرعة النشر. كما يجب تطبيق نمط Circuit Breaker لمنع انهيار السلسلة Cascade Failures عند تعثر أي خدمة.`,
      },
      {
        title: 'الفصل الثاني: بروتوكولات الاتصال ونواقل الأحداث',
        pageStart: 75,
        pageEnd: 141,
        content: `في معمارية الأنظمة الحديثة لعام 2026، يُفضل استخدام gRPC للاتصال الداخلي بين الخدمات Service-to-Service بسبب اعتماده على HTTP/2 والترميز الثنائي Protocol Buffers مما يقلل الحجم بنسبة تصل إلى 60% مقارنة بـ JSON REST. أما للعمليات غير المتزامنة فالاتصال عبر Event Bus كـ Apache Kafka أو RabbitMQ يضمن معالجة العمليات دون حظر واجهات المستخدم.`,
      },
      {
        title: 'الفصل الثالث: التوافرية العالية ونظرية CAP',
        pageStart: 142,
        pageEnd: 214,
        content: `تنص نظرية CAP على استحالة ضمان التناسق الفوري Consistency والتوافرية Availability وتحمل انقسام الشبكة Partition Tolerance في آن واحد. في الأنظمة المالية يُضحى بالتوافرية الفورية لصالح الاتساق الصارم (Strong Consistency عبر CP)، بينما في أنظمة التجارة والتصفح يُعتمد الاتساق التدريجي (Eventual Consistency عبر AP) لتوفير أداء فوري للمستخدمين.`,
      },
      {
        title: 'الفصل الرابع: الأمان وصفر ثقة Zero Trust',
        pageStart: 215,
        pageEnd: 340,
        content: `نموذج الأمان صفر ثقة (Zero Trust Architecture) يفترض أن الشبكة الداخلية مخترقة بالفعل. يتطلب هذا النموذج التحقق الصارم من كل طلب برمجي باستخدام mTLS (Mutual TLS) والرموز الرقمية الموقعة كـ JWT مع فترات صلاحية قصيرة لا تتجاوز 15 دقيقة، وتشفير البيانات في حالة السكون بواسطة AES-256 وفي حالة النقل بواسطة TLS 1.3.`,
      },
    ],
    fullText: 'مرجع هندسة البرمجيات والأنظمة الموزعة الحديثة 2026.',
  }, SYSTEM_TENANT_CONTEXT);

  // Book 2: Database Systems
  registerBook({
    id: 'book_db_systems_2025',
    title: 'موسوعة قواعد البيانات ومعالجة المعاملات ACID',
    author: 'أ. د. سالم الدارعي',
    edition: 'الطبعة الثانية',
    publicationYear: 2025,
    language: 'Arabic',
    pagesTotal: 410,
    isSharedLibrary: true,
    toc: [
      { chapter: 1, title: 'الفصل الأول: معاملات ACID ومستويات العزل Isolation Levels', page: 15 },
      { chapter: 2, title: 'الفصل الثاني: محركات الفهرسة B-Trees و LSM-Trees', page: 110 },
      { chapter: 3, title: 'الفصل الثالث: النسخ المتماثل وتوزيع البيانات Sharding & Replication', page: 220 },
    ],
    chapters: [
      {
        title: 'الفصل الأول: معاملات ACID ومستويات العزل',
        pageStart: 15,
        pageEnd: 109,
        content: `تعد خصائص ACID الأساس الراسخ لموثوقية المعاملات: الذرية Atomicity، الاتساق Consistency، العزل Isolation، والديمومة Durability. ينص العزل القابل للتسلسل (Serializable Isolation) على أن تنفيذ المعاملات المتزامنة ينتج نفس الأثر كما لو نُفذت واحدة تلو الأخرى بشكل متتابع. إن القراءة غير المؤكدة (Dirty Read) تحدث عندما تقرأ معاملة بيانات عُدلت بواسطة معاملة أخرى لم يتم اعتمادها Commit بعد، ويتم منعها بدءاً من مستوى Read Committed.`,
      },
      {
        title: 'الفصل الثاني: محركات الفهرسة B-Trees و LSM-Trees',
        pageStart: 110,
        pageEnd: 219,
        content: `تتفوق فهارس B-Tree في عمليات القراءة العشوائية والبحث بنطاق Range Scans وتستخدم بكثرة في قواعد البيانات العلائقية مثل PostgreSQL و SQLite. بالمقابل، تعتمد قواعد البيانات الموجهة للكتابة السريعة مثل Cassandra و RocksDB على بنية LSM-Tree (Log-Structured Merge-Tree) التي تحول الكتابات العشوائية إلى كتابات تتابعية متسلسلة على القرص مما يمنحها سرعة كتابة استثنائية.`,
      },
      {
        title: 'الفصل الثالث: النسخ المتماثل وتوزيع البيانات',
        pageStart: 220,
        pageEnd: 410,
        content: `توزيع البيانات عبر Sharding يتطلب اختيار مفتاح تقسيم (Shard Key) متوازن لمنع تكوّن النقاط الساخنة Hotspots. في أنظمة Raft و Paxos الإجماعية، يتطلب إقرار أي معاملة موافقة الأغلبية المطلقة (Quorum = N/2 + 1) من العقد النشطة لتجنب انشطار الدماغ Split-Brain.`,
      },
    ],
    fullText: 'موسوعة قواعد البيانات ومعالجة المعاملات ACID 2025.',
  }, SYSTEM_TENANT_CONTEXT);

  // Book 3: History & Heritage
  registerBook({
    id: 'book_history_arabia_2024',
    title: 'تاريخ الجزيرة العربية وحضارات الشرق القديم',
    author: 'د. فيصل الشامسي',
    edition: 'الطبعة الأولى',
    publicationYear: 2024,
    language: 'Arabic',
    pagesTotal: 290,
    isSharedLibrary: true,
    toc: [
      { chapter: 1, title: 'الفصل الأول: حضارة دلمون ومجان وطرق التجارة البحرية', page: 20 },
      { chapter: 2, title: 'الفصل الثاني: مملكة كندة والأنباط والخط العربي', page: 95 },
      { chapter: 3, title: 'الفصل الثالث: قوافل اللبان وتجارة البخور القديمة', page: 180 },
    ],
    chapters: [
      {
        title: 'الفصل الأول: حضارة دلمون ومجان وطرق التجارة البحرية',
        pageStart: 20,
        pageEnd: 94,
        content: `اشتهرت حضارة مجان (في عُمان والإمارات حالياً) في الألفية الثالثة قبل الميلاد بصهر النحاس وتصديره عبر موانئ الخليج العربي إلى حضارة وادي الرافدين في بلاد سومر وأكاد. وتذكر الألواح المسمارية السومرية استيراد النحاس وحجر الديوريت من مجان، بينما شكلت دلمون (البحرين) المركز التجاري الرئيسي ومستودع البضائع ومصدر اللؤلؤ الطبيعي الفاخر.`,
      },
      {
        title: 'الفصل الثاني: مملكة كندة والأنباط والخط العربي',
        pageStart: 95,
        pageEnd: 179,
        content: `شكلت عاصمة كندة في قرية الفاو مركزاً أدبياً وتجارياً بارزاً، وأظهرت النقوش الأثرية تطور الخط النبطي الذي تفرع منه الخط العربي الحديث. وقد ابتكر الأنباط في البتراء ومدائن صالح نظاماً هندسياً فريداً لحصاد مياه الأمطار ونحت الصخور شكل معجزة معمارية دامت قروناً.`,
      },
      {
        title: 'الفصل الثالث: قوافل اللبان وتجارة البخور',
        pageStart: 180,
        pageEnd: 290,
        content: `سيطرت ممالك جنوب الجزيرة كسبأ وحضرموت ومعين على طريق البخور الأسطوري الذي امتد آلاف الكيلومترات إلى شواطئ البحر الأبيض المتوسط. كان اللبان يُعد أثمن من الذهب في المعابد الرومانية والمصرية، وكانت قوافل الجمال تعبر الصحراء القاحلة عبر شبكة آبار محكمة شكلت شريان الحياة الاقتصادي للعالم القديم.`,
      },
    ],
    fullText: 'تاريخ الجزيرة العربية وحضارات الشرق القديم 2024.',
  }, SYSTEM_TENANT_CONTEXT);

  // Book 4: Legacy Web Engineering
  registerBook({
    id: 'book_legacy_web_2012',
    title: 'أدلة تطوير الويب القديمة والأنظمة الأحادية',
    author: 'م. مروان العوضي',
    edition: 'طبعة تاريخية أرشيفية',
    publicationYear: 2012,
    language: 'Arabic',
    pagesTotal: 180,
    isSharedLibrary: true,
    toc: [
      { chapter: 1, title: 'الفصل الأول: معالجة الأحداث بواسطة jQuery وعيوب التعديل المباشر للـ DOM', page: 10 },
      { chapter: 2, title: 'الفصل الثاني: العمارة الأحادية Monolithic وثغرات الأمان التاريخية', page: 80 },
    ],
    chapters: [
      {
        title: 'الفصل الأول: معالجة الأحداث بواسطة jQuery',
        pageStart: 10,
        pageEnd: 79,
        content: `في عام 2012 كانت مكتبة jQuery هي الأداة المهيمنة لتعديل شجرة عناصر الـ DOM مباشرة. ولكن مع نمو تعقيد التطبيقات، أدى هذا التعديل الإجرائي المباشر إلى فوضى عارمة تسمى Spaghetti Code وصعوبة بالغة في تتبع تدفق البيانات وحالات الواجهة، مما مهد الطريق لظهور المكتبات التصريحية مثل React التي تعتمد النموذج الافتراضي Virtual DOM والتحديث أحادي الاتجاه Unidirectional Data Flow.`,
      },
      {
        title: 'الفصل الثاني: العمارة الأحادية والأنظمة القديمة',
        pageStart: 80,
        pageEnd: 180,
        content: `تعتمد الأنظمة الأحادية القديمة لعام 2012 على دمج منطق الأعمال والعرض وقاعدة البيانات في مسار تنفيذي واحد. ومن عيوبها الخطيرة أن أي خطأ غير معالج في وحدة ثانوية يسبب انهيار التطبيق بالكامل (Single Point of Failure)، فضلاً عن صعوبة التوسع الأفقي مقارنة بالحاويات المصغرة الحديثة.`,
      },
    ],
    fullText: 'أدلة تطوير الويب القديمة والأنظمة الأحادية 2012.',
  }, SYSTEM_TENANT_CONTEXT);

  // Book 5: React 19 Specifications
  registerBook({
    id: 'book_react19_spec_2026',
    title: 'المواصفات القياسية لـ React 19 و Server Actions',
    author: 'فريق هندسة الواجهات المتقدمة',
    edition: 'المعيار الرسمي 1.0',
    publicationYear: 2026,
    language: 'Arabic',
    pagesTotal: 150,
    isSharedLibrary: true,
    toc: [
      { chapter: 1, title: 'الفصل الأول: معمارية المكونات الخادمة React Server Components', page: 8 },
      { chapter: 2, title: 'الفصل الثاني: دوال الإجراءات Server Actions وإلغاء الحاجة لـ useEffects', page: 50 },
    ],
    chapters: [
      {
        title: 'الفصل الأول: معمارية المكونات الخادمة',
        pageStart: 8,
        pageEnd: 49,
        content: `في React 19، أصبحت المكونات خادمة افتراضياً (Server Components by default). يتم تصيير المكون على الخادم وإرسال كود واجهة جاهز دون تضمين حزم جافاسكربت في المتصفح، مما يخفض حجم الحزمة Client Bundle بنسبة تفوق 70% ويسرع التحميل الأولي LCP بشكل ملحوظ. لا يمكن استخدام الخطافات التفاعلية كـ useState داخل Server Components بل تُعزل المكونات التفاعلية بوضوح عبر التوجيه 'use client'.`,
      },
      {
        title: 'الفصل الثاني: Server Actions والتعامل مع النماذج',
        pageStart: 50,
        pageEnd: 150,
        content: `تقدم React 19 دوال Server Actions التي تنفذ التعديلات مباشرة على الخادم مع دعم أصيل للتحسين التدريجي Progressive Enhancement حتى عند تعطيل الجافاسكربت. كما يقدم الخطاف useActionState إدارة آلية لحالات التحميل والأخطاء، والخطاف useOptimistic لتقديم رد فعل فوري للمستخدم قبل انتهاء استجابة الشبكة مما يرفع جودة تجربة الاستخدام إلى أعلى مستوياتها.`,
      },
    ],
    fullText: 'المواصفات القياسية لـ React 19 و Server Actions 2026.',
  }, SYSTEM_TENANT_CONTEXT);
}

module.exports = {
  cosineSimilarity,
  chunkBookContent,
  registerBook,
  getBookDetails,
  listAvailableBooks,
  searchBookKnowledge,
  getVerbatimChunk,
  seedReferenceLibrary,
  SYSTEM_TENANT_CONTEXT,
  AccessDeniedError,
  assertTenantContext,
};
