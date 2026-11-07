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
const { get } = require('../../db/database');

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
  const hasBook7 = existingBooks.some((b) => b.id === 'book_computing_history_2024');
  const book6Details = existingBooks.find((b) => b.id === 'book_microservices_en_2026');
  const book2Details = existingBooks.find((b) => b.id === 'book_db_systems_2025');

  // Reseed if new books or expanded chapters are not yet indexed
  if (existingBooks.length >= 7 && hasBook7 && book6Details && book2Details) {
    const unindexedChunk = get('SELECT id FROM chunks WHERE document_id = ? AND (byte_end = 0 OR embedding_blob IS NULL)', 'book_computing_history_2024');
    if (!unindexedChunk) return;
  }

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
      { chapter: 1, title: 'الفصل الأول: المبادئ المعمارية وتفكيك الأنظمة Monolith to Microservices to SOA', page: 12 },
      { chapter: 2, title: 'الفصل الثاني: بروتوكولات الاتصال gRPC مقابل REST ونواقل الأحداث Event-Driven', page: 75 },
      { chapter: 3, title: 'الفصل الثالث: التوافرية العالية ونظرية CAP وإدارة الحالات الموزعة', page: 142 },
      { chapter: 4, title: 'الفصل الرابع: المعاملات الموزعة ونمط Saga Pattern مقابل 2PC', page: 180 },
      { chapter: 5, title: 'الفصل الخامس: الاتصال بين الخدمات API Gateway مقابل Service Mesh', page: 220 },
      { chapter: 6, title: 'الفصل السادس: مرونة الأنظمة ونمط Circuit Breaker ومنع الانهيار المتتالي', page: 260 },
      { chapter: 7, title: 'الفصل السابع: نمط فصل المسؤولية CQRS وسجل الأحداث', page: 295 },
      { chapter: 8, title: 'الفصل الثامن: الأمان وصفر ثقة Zero Trust Architecture', page: 320 },
    ],
    chapters: [
      {
        title: 'الفصل الأول: المبادئ المعمارية وتفكيك الأنظمة',
        pageStart: 12,
        pageEnd: 74,
        content: `تعتمد هندسة الأنظمة الموزعة على مبدأ الفصل القاطع للمسؤوليات (Separation of Concerns). الفرق المعماري بين Microservices و SOA يكمن في التخلص من ناقل الخدمة المؤسسي ESB، حيث تتبنى الخدمات المصغرة نقاط نهاية ذكية وقنوات نقل بسيطة (Smart Endpoints and Dumb Pipes). ويكون النظام الأحادي Monolith الخيار الأصح للفرق الصغيرة والمشاريع الناشئة والنطاقات البسيطة تفادياً لتعقيد الشبكات وتكلفة التوزيع الباهظة. وعند التفكيك، يُفرض عزل البيانات لكل خدمة في قاعدة بيانات مستقلة (Database-per-Service Pattern).`,
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
        pageEnd: 179,
        content: `تنص نظرية CAP على استحالة ضمان التناسق الفوري Consistency والتوافرية Availability وتحمل انقسام الشبكة في آن واحد، ويُضحى بالاتساق لصالح AP في NoSQL. في الأنظمة المالية يُضحى بالتوافرية الفورية لصالح الاتساق الصارم (Strong Consistency عبر CP)، بينما في أنظمة التجارة والتصفح يُعتمد الاتساق التدريجي (Eventual Consistency عبر AP) لتوفير أداء فوري للمستخدمين.`,
      },
      {
        title: 'الفصل الرابع: المعاملات الموزعة ونمط Saga Pattern',
        pageStart: 180,
        pageEnd: 219,
        content: `يعتمد نمط Saga Pattern على سلسلة معاملات محلية مستقلة مع معاملات تعويضية Compensating Transactions للتراجع، متفوقاً على حظر المعاملات الثنائية 2PC. في بروتوكول المعاملات الثنائية Two-Phase Commit يُقفل النظام الموارد بانتظار إقرار كافة العقد مما يسبب بطء الشبكة وخطراً كبيراً لنقاط الفشل الفردية، بينما يوفر نمط Saga مرونة عالية إما عبر التنسيق المركزي Orchestration أو التوجيه التلقائي Choreography.`,
      },
      {
        title: 'الفصل الخامس: الاتصال بين الخدمات API Gateway مقابل Service Mesh',
        pageStart: 220,
        pageEnd: 259,
        content: `تتولى بوابة API Gateway حركة المرور الخارجية North-South ومصادقة المستخدمين وتحديد معدل الطلبات، بينما تدير شبكة Service Mesh الاتصال الداخلي East-West وتشفير mTLS والمراقبة. تشكل بوابة API Gateway الدرع الحدودي الخارجي للنظام، في حين توفر Service Mesh عبر وكلاء جانبيين Sidecars مرونة توجيه الحزم وتتبع المسارات Observability وإعادة المحاولة التلقائية داخل العنقود.`,
      },
      {
        title: 'الفصل السادس: مرونة الأنظمة ونمط Circuit Breaker',
        pageStart: 260,
        pageEnd: 294,
        content: `يعمل قاطع الدائرة Circuit Breaker عبر ثلاث حالات: المغلقة Closed والمفتوحة Open ونصف المفتوحة Half-Open ليمنع الانهيار المتتالي Cascade Failures عند تعثر الخدمات. في الحالة المغلقة تمر الطلبات طبيعياً؛ وعند تجاوز نسبة الأخطاء العتبة المحددة يتحول القاطع إلى الحالة المفتوحة فيرفض الطلبات فورياً لحماية الخدمة المتعثرة؛ وبعد انقضاء فترة تهدئة يمرر تجريبياً عدداً محدوداً من الطلبات في الحالة نصف المفتوحة للتأكد من تعافي النظام.`,
      },
      {
        title: 'الفصل السابع: نمط فصل المسؤولية CQRS',
        pageStart: 295,
        pageEnd: 319,
        content: `نمط CQRS يفصل نموذج تعديل البيانات Commands عن نموذج الاستعلام Queries لحل تباين احتياجات القراءة والكتابة وتحسين الأداء. يسمح هذا الفصل بتحسين مسار الكتابة للتحقق الصارم من قواعد العمل والاتساق، بينما يُبنى مسار القراءة عبر جداول غير معيارية Denormalized Views أو فهارس مخصصة للاستعلام السريع دون إجهاد النواة التخزينية.`,
      },
      {
        title: 'الفصل الثامن: الأمان وصفر ثقة Zero Trust',
        pageStart: 320,
        pageEnd: 340,
        content: `نموذج الأمان صفر ثقة (Zero Trust Architecture) يفترض أن الشبكة الداخلية مخترقة بالفعل. يتطلب هذا النموذج التحقق الصارم من كل طلب برمجي باستخدام mTLS والرموز الرقمية الموقعة كـ JWT مع فترات صلاحية قصيرة وتشفير البيانات في السكون بـ AES-256 وفي النقل بـ TLS 1.3.`,
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
      { chapter: 3, title: 'الفصل الثالث: التوافق الموزع والنسخ المتماثل Sharding & Raft vs Paxos', page: 220 },
      { chapter: 4, title: 'الفصل الرابع: أنماط الالتزامية ونظرية CAP في أنظمة قواعد البيانات', page: 310 },
      { chapter: 5, title: 'الفصل الخامس: تطور نماذج قواعد البيانات من الشبكية إلى NoSQL', page: 360 },
    ],
    chapters: [
      {
        title: 'الفصل الأول: معاملات ACID ومستويات العزل',
        pageStart: 15,
        pageEnd: 109,
        content: `تعد خصائص ACID الأساس الراسخ لموثوقية المعاملات: الذرية والاتساق والعزل والديمومة. الفرق الجوهري بين عزل القراءة المتكررة Repeatable Read والتسلسلي Serializable هو أن الثاني يمنع ظهور القراءات الشبحية Phantom Reads تماماً عبر إقفال النطاق. في مستوى القراءة المتكررة، يضمن النظام ثبات الصفوف المقروءة، لكن معاملة متزامنة قد تُدرج صفاً جديداً يطابق شرط البحث فيظهر فجأة (القراءة الشبحية). أما العزل التسلسلي فيلغي هذه الظاهرة تماماً كأن المعاملات تُنفذ بالتتابع. كما تُمنع القراءة غير المؤكدة Dirty Read بدءاً من مستوى Read Committed.`,
      },
      {
        title: 'الفصل الثاني: محركات الفهرسة B-Trees و LSM-Trees',
        pageStart: 110,
        pageEnd: 219,
        content: `تناسب فهارس B-Tree حمولات القراءة العشوائية والبحث بالنطاق في أنظمة OLTP، بينما تتفوق هياكل LSM-Tree في حمولات الكتابة الكثيفة المتسلسلة على القرص. تحتفظ فهارس B-Tree بصفحات متوازنة على القرص مما يتيح قراءة واستعلاماً سريعاً ومستقراً كما في PostgreSQL و SQLite. في المقابل، تعتمد هياكل LSM-Tree (Log-Structured Merge-Tree) على استقبال الكتابات في الذاكرة MemTable ثم إفراغها متسلسلة تتابعياً إلى القرص في ملفات SSTables غير قابلة للتعديل، مما يمنحها سرعة كتابة مذهلة كما في Cassandra و RocksDB.`,
      },
      {
        title: 'الفصل الثالث: التوافق الموزع والنسخ المتماثل',
        pageStart: 220,
        pageEnd: 309,
        content: `تتميز خوارزمية توافق Raft بسهولة الفهم وقابلية التنفيذ مقارنة بـ Paxos بفضل اعتمادها على قائد صريح وانتخاب موحد وتوزيع السجلات في مسار أحادي. بينما خوارزمية Paxos تعتمد على جولات متعددة من المقترحات والوعود دون قيادة مركزية مما يجعل بناءها وصيانتها شديدي التعقيد. وفي كلا الخوارزميتين يتطلب اعتماد المعاملة إقرار النصاب القانوني Quorum لمنع انشطار الدماغ Split-Brain.`,
      },
      {
        title: 'الفصل الرابع: أنماط الالتزامية ونظرية CAP',
        pageStart: 310,
        pageEnd: 359,
        content: `الالتزامية القوية Strong Consistency تضمن رؤية أحدث كتابة فوراً وتناسب العمليات المالية، بينما الالتزامية النهائية Eventual Consistency تتيح تقارب العقد تدريجياً لتفضيل التوافرية. في أنظمة قواعد بيانات NoSQL يُضحى عادة بضلع الاتساق الصارم Consistency لصالح التوافرية وتحمل انقسام الشبكة (نمط AP)، حيث تتقارب النسخ المتماثلة تدريجياً لضمان استجابة فورية لملايين المستخدمين بالتزامن.`,
      },
      {
        title: 'الفصل الخامس: تطور نماذج قواعد البيانات',
        pageStart: 360,
        pageEnd: 410,
        content: `تطورت قواعد البيانات من النماذج الهرمية والشبكية CODASYL المعتمدة على المؤشرات المادية، إلى النموذج العلائقي لإدغار كود 1970 المعتمد على الجبر و SQL، وصولاً إلى NoSQL للتوسع الأفقي المرن. النموذج الشبكي كان يتطلب معرفة المسار المادي الدقيق للتنقل بين السجلات، بينما منح النموذج العلائقي استقلالاً كاملاً لمنطق البيانات عن التخزين الفيزيائي عبر لغة SQL التصريحية.`,
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

  // Book 5: React 19 Specifications & Modern Web Architecture
  registerBook({
    id: 'book_react19_spec_2026',
    title: 'المواصفات القياسية لـ React 19 و Server Actions ومعمارية الويب الحديثة',
    author: 'فريق هندسة الواجهات المتقدمة',
    edition: 'المعيار الرسمي 2.0',
    publicationYear: 2026,
    language: 'Arabic',
    pagesTotal: 260,
    isSharedLibrary: true,
    toc: [
      { chapter: 1, title: 'الفصل الأول: معمارية المكونات الخادمة React Server Components', page: 8 },
      { chapter: 2, title: 'الفصل الثاني: دوال الإجراءات Server Actions والتحكم بالحالة', page: 60 },
      { chapter: 3, title: 'الفصل الثالث: استراتيجيات تصيير صفحات الويب SSR و SSG و ISR', page: 120 },
      { chapter: 4, title: 'الفصل الرابع: معايير منصات الويب Web Components ومقارنتها بالأطر الحديثة', page: 175 },
      { chapter: 5, title: 'الفصل الخامس: بروتوكولات النقل الحديثة HTTP/3 و QUIC', page: 220 },
    ],
    chapters: [
      {
        title: 'الفصل الأول: معمارية المكونات الخادمة',
        pageStart: 8,
        pageEnd: 59,
        content: `في React 19، أصبحت المكونات خادمة افتراضياً Server Components مع إلغاء الحاجة لخطافات useEffects لجلب البيانات واعتماد دوال Server Actions و useActionState. يتم تصيير المكون على الخادم وإرسال كود واجهة جاهز دون تضمين حزم جافاسكربت في المتصفح، مما يخفض حجم الحزمة Client Bundle بنسبة تفوق 70% ويسرع التحميل الأولي LCP بشكل ملحوظ. لا يمكن استخدام الخطافات التفاعلية كـ useState داخل Server Components بل تُعزل المكونات التفاعلية بوضوح عبر التوجيه 'use client'.`,
      },
      {
        title: 'الفصل الثاني: Server Actions والتعامل مع النماذج',
        pageStart: 60,
        pageEnd: 119,
        content: `تقدم React 19 دوال Server Actions التي تنفذ التعديلات مباشرة على الخادم مع دعم أصيل للتحسين التدريجي Progressive Enhancement حتى عند تعطيل الجافاسكربت. كما يقدم الخطاف useActionState إدارة آلية لحالات التحميل والأخطاء، والخطاف useOptimistic لتقديم رد فعل فوري للمستخدم قبل انتهاء استجابة الشبكة مما يرفع جودة تجربة الاستخدام إلى أعلى مستوياتها.`,
      },
      {
        title: 'الفصل الثالث: استراتيجيات تصيير صفحات الويب',
        pageStart: 120,
        pageEnd: 174,
        content: `يولد SSR الصفحات ديناميكياً عند كل طلب، بينما ينشئ SSG الصفحات مسبقاً أثناء البناء Build Time، ويتيح ISR إعادة التوليد الثابت التدريجي في الخلفية Revalidation. التصيير على الخادم (SSR) يناسب لوحات التحكم والبيانات اللحظية المخصصة للمستخدم، في حين يحقق التوليد الثابت (SSG) أعلى سرعة وأمان للمواقع التسويقية والمدونات، وتجمع تقنية ISR بين السرعة الفائقة وتحديث المحتوى الثابت دورياً دون إعادة بناء المشروع.`,
      },
      {
        title: 'الفصل الرابع: معايير منصات الويب Web Components',
        pageStart: 175,
        pageEnd: 219,
        content: `توفر Web Components كبسلة معيارية عبر Custom Elements و Shadow DOM، لكنها لم تحل محل الأطر لافتقارها لنظام إدارة الحالة العامة والربط البياني التصريحي وتكامل SSR. على الرغم من كونها معياراً قياسياً مدعوماً في كافة المتصفحات، فإن غياب التحديث التفاعلي التلقائي وصعوبة تدفق البيانات أحادي الاتجاه المعقد يجعل المطورين يفضلون أطر العمل الحديثة لبناء التطبيقات الإنتاجية الضخمة.`,
      },
      {
        title: 'الفصل الخامس: بروتوكولات النقل الحديثة HTTP/3 و QUIC',
        pageStart: 220,
        pageEnd: 260,
        content: `يعمل HTTP/3 عبر بروتوكول QUIC فوق UDP ليقضي على مشكلة انسداد مقدمة الصف Head-of-Line Blocking في TCP ويتيح مصافحة سريعة خالية من التأخير 0-RTT. في بروتوكول TCP التقليدي يؤدي فقدان حزمة بيانات واحدة إلى تجميد كافة التدفقات المتزامنة في الاتصال، بينما في QUIC تظل كل قناة مستقلة تماماً، مع دعم ميزة انتقال الاتصال Connection Migration السلس عند تحول الهاتف من شبكة Wi-Fi إلى بيانات الجوال دون انقطاع.`,
      },
    ],
    fullText: 'المواصفات القياسية لـ React 19 و Server Actions ومعمارية الويب الحديثة 2026.',
  }, SYSTEM_TENANT_CONTEXT);

  // Book 6: History of Computing & Software Foundations (NEW BOOK)
  registerBook({
    id: 'book_computing_history_2024',
    title: 'تاريخ الحوسبة وهندسة البرمجيات والمفاهيم التأسيسية',
    author: 'أ. د. عمر بن يوسف',
    edition: 'الطبعة الأولى',
    publicationYear: 2024,
    language: 'Arabic',
    pagesTotal: 310,
    isSharedLibrary: true,
    toc: [
      { chapter: 1, title: 'الفصل الأول: تطور نماذج قواعد البيانات من الشبكية إلى العلائقية إلى NoSQL', page: 15 },
      { chapter: 2, title: 'الفصل الثاني: أزمة برمجيات الستينات ومؤتمر الناتو 1968 في غارميش', page: 110 },
      { chapter: 3, title: 'الفصل الثالث: نماذج البرمجة التأسيسية: الإجرائية والكائنية والوظيفية', page: 210 },
    ],
    chapters: [
      {
        title: 'الفصل الأول: تطور نماذج قواعد البيانات',
        pageStart: 15,
        pageEnd: 109,
        content: `تطورت قواعد البيانات من النماذج الهرمية والشبكية CODASYL المعتمدة على المؤشرات المادية، إلى النموذج العلائقي لإدغار كود 1970 المعتمد على الجبر و SQL، وصولاً إلى NoSQL للتوسع الأفقي المرن. في النموذج الشبكي كان على المطور كتابة كود تنقل إجرائي يتبع المسار الفيزيائي للسجلات، فجاء نموذج كود Codd ليعزل المنطق المفاهيمي عن العتاد، ثم جاءت ثورة NoSQL لتكسر قيود المخططات الثابتة وتتيح التوزيع على آلاف الخوادم الرخيصة.`,
      },
      {
        title: 'الفصل الثاني: أزمة برمجيات الستينات ومؤتمر الناتو 1968',
        pageStart: 110,
        pageEnd: 209,
        content: `اندلعت أزمة البرمجيات في الستينات بسبب القفزة الكبيرة في قدرات العتاد مقابل فوضى البرمجة غير المنضبطة وتجاوز الميزانيات، مما دعا مؤتمر الناتو 1968 لتأسيس هندسة البرمجيات كفرع هندسي صارم. عانى قطاع الحوسبة من تأخر المشاريع وانهيارها بسبب الاعتماد على الحيل الفردية والكود المعقد المتشابك Spaghetti Code، فكان مؤتمر غارميش نقطة التحول التاريخية التي رسخت مفاهيم البرمجة الهيكلية، ودورة حياة التطوير، وضمان الجودة المنهجي.`,
      },
      {
        title: 'الفصل الثالث: نماذج البرمجة التأسيسية',
        pageStart: 210,
        pageEnd: 310,
        content: `الفرق الجوهري يكمن في نموذج التفكير: الإجرائية تتبع خطوات متسلسلة وتعديل الحالة، والكائنية تجمع الحالة والسلوك في كائنات مغلفة، والوظيفية تعتمد على دوال رياضية نقية خالية من الآثار الجانبية. في البرمجة الإجرائية Procedural يتم التركيز على الخوارزمية وتعديل المتغيرات العامة؛ وفي البرمجة الكائنية Object-Oriented يُبنى النظام على الرسائل والوراثة وتعدد الأشكال؛ بينما في البرمجة الوظيفية Functional Programming تكون البيانات غير قابلة للتغيير Immutability مما يمنع الأخطاء المتزامنة ويسهل اختبار البرمجيات.`,
      },
    ],
    fullText: 'تاريخ الحوسبة وهندسة البرمجيات والمفاهيم التأسيسية 2024 د. عمر بن يوسف.',
  }, SYSTEM_TENANT_CONTEXT);

  // Book 7: English Reference for Bilingual Research & Cloud Native Foundations
  registerBook({
    id: 'book_microservices_en_2026',
    title: 'Cloud Native Microservices & Distributed Architecture',
    author: 'Dr. Arthur Vance',
    edition: '2026 Standard Edition',
    publicationYear: 2026,
    language: 'English',
    pagesTotal: 420,
    isSharedLibrary: true,
    toc: [
      { chapter: 1, title: 'Chapter 1: Microservices Communication - gRPC vs REST APIs', page: 12 },
      { chapter: 2, title: 'Chapter 2: Event Sourcing and CQRS Pattern', page: 80 },
      { chapter: 3, title: 'Chapter 3: RESTful API Architectural Principles and Design', page: 130 },
      { chapter: 4, title: 'Chapter 4: Containerization, Operating System Virtualization, and Docker', page: 190 },
      { chapter: 5, title: 'Chapter 5: Security Architecture: Authentication vs Authorization', page: 250 },
      { chapter: 6, title: 'Chapter 6: High Availability and Load Balancing Algorithms', page: 310 },
      { chapter: 7, title: 'Chapter 7: API Idempotency and Resilient Distributed Systems', page: 370 },
    ],
    chapters: [
      {
        title: 'Chapter 1: Microservices Communication - gRPC vs REST APIs',
        pageStart: 12,
        pageEnd: 79,
        content: `In modern cloud native microservices architectures, gRPC utilizes HTTP/2 multiplexing and Protocol Buffers serialization to deliver up to 7-10x lower latency compared to traditional REST JSON. While REST remains universally compatible for external public APIs, internal microservices backbones standardize on gRPC for high-throughput inter-service communication.`,
      },
      {
        title: 'Chapter 2: Event Sourcing and CQRS Pattern',
        pageStart: 80,
        pageEnd: 129,
        content: `Event Sourcing guarantees state immutability by persisting every domain mutation as an append-only event log. Coupled with Command Query Responsibility Segregation (CQRS), it decouples write models from denormalized read projections, ensuring resilient data consistency without distributed lock contention across microservices boundaries.`,
      },
      {
        title: 'Chapter 3: RESTful API Architectural Principles and Design',
        pageStart: 130,
        pageEnd: 189,
        content: `Core RESTful API architectural principles require statelessness, client-server decoupling, explicit cacheability, layered systems, and a uniform interface with standard HTTP methods. Statelessness mandates that each HTTP request must contain all contextual authentication and parameter data necessary for execution without server-side session dependencies.`,
      },
      {
        title: 'Chapter 4: Containerization and Docker',
        pageStart: 190,
        pageEnd: 249,
        content: `Containerization leverages Linux kernel namespaces and cgroups for process isolation, while Docker packages application runtimes into immutable images ensuring consistent deployment lifecycles. By encapsulating operating system dependencies, Docker guarantees that applications execute identically across local development, staging environments, and production Kubernetes clusters without host drift.`,
      },
      {
        title: 'Chapter 5: Security Architecture: Authentication vs Authorization',
        pageStart: 250,
        pageEnd: 309,
        content: `Authentication verifies who you are through identity credentials, whereas authorization determines what permissions you have, returning 401 Unauthorized versus 403 Forbidden. Modern architectures utilize OpenID Connect and cryptographic JSON Web Tokens (JWT) for authentication, while fine-grained authorization is enforced via Role-Based Access Control (RBAC) and policy engines.`,
      },
      {
        title: 'Chapter 6: High Availability and Load Balancing Algorithms',
        pageStart: 310,
        pageEnd: 369,
        content: `Load balancing distributes traffic across servers using algorithms such as Round Robin, Weighted Round Robin, Least Connections, and IP Hash across Layer 4 and Layer 7. Least Connections dynamically routes new requests to backend instances handling the fewest active concurrent connections, optimizing performance during computationally intensive workloads.`,
      },
      {
        title: 'Chapter 7: API Idempotency and Resilient Distributed Systems',
        pageStart: 370,
        pageEnd: 420,
        content: `Idempotency guarantees that making multiple identical requests produces the exact same side effect, making GET, PUT, and DELETE inherently idempotent unlike POST operations. In distributed financial and payment systems, clients attach unique Idempotency-Key headers so transient network drops and automated retries never cause duplicate financial charges.`,
      },
    ],
    fullText: 'Cloud Native Microservices & Distributed Architecture 2026 Dr. Arthur Vance.',
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
