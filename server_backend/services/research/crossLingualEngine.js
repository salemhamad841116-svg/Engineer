// ==============================================================================
// Cross-Lingual Knowledge Engine (الدعم المعرفي ثنائي اللغة عربي ↔ إنجليزي)
// Bridges language gaps: Maps Arabic queries to English reference material and vice-versa.
// Operates 100% offline via deterministic domain terminology graphs.
// ==============================================================================

const BILINGUAL_DICTIONARY = [
  // Databases & Storage
  { ar: 'قواعد البيانات', en: 'database systems' },
  { ar: 'قاعدة بيانات', en: 'database' },
  { ar: 'معاملات', en: 'transactions' },
  { ar: 'معاملة', en: 'transaction' },
  { ar: 'ذرية', en: 'atomicity' },
  { ar: 'اتساق', en: 'consistency' },
  { ar: 'عزل', en: 'isolation' },
  { ar: 'ديمومة', en: 'durability' },
  { ar: 'مستويات العزل', en: 'isolation levels' },
  { ar: 'قراءة غير مؤكدة', en: 'dirty read' },
  { ar: 'عزل قابل للتسلسل', en: 'serializable isolation' },
  { ar: 'فهارس', en: 'indexes' },
  { ar: 'فهرسة', en: 'indexing' },
  { ar: 'توزيع البيانات', en: 'sharding' },
  { ar: 'نسخ متماثل', en: 'replication' },
  { ar: 'انشطار الدماغ', en: 'split-brain' },

  // Architecture & Distributed Systems
  { ar: 'أنظمة موزعة', en: 'distributed systems' },
  { ar: 'نظام موزع', en: 'distributed system' },
  { ar: 'هندسة البرمجيات', en: 'software architecture' },
  { ar: 'خدمات مصغرة', en: 'microservices' },
  { ar: 'خدمة مصغرة', en: 'microservice' },
  { ar: 'عمارة أحادية', en: 'monolithic architecture' },
  { ar: 'توافرية', en: 'availability' },
  { ar: 'تحمل انقسام الشبكة', en: 'partition tolerance' },
  { ar: 'اتساق تدريجي', en: 'eventual consistency' },
  { ar: 'اتساق صارم', en: 'strong consistency' },
  { ar: 'صفر ثقة', en: 'zero trust' },
  { ar: 'تشفير', en: 'encryption' },
  { ar: 'قواطع الدائرة', en: 'circuit breaker' },
  { ar: 'سجل أحداث', en: 'event sourcing' },
  { ar: 'فصل الاستعلام عن الأوامر', en: 'cqrs' },

  // Protocols & Modern Web
  { ar: 'واجهة برمجة التطبيقات', en: 'api' },
  { ar: 'مكونات خادمة', en: 'server components' },
  { ar: 'إجراءات الخادم', en: 'server actions' },
  { ar: 'تحسين تدريجي', en: 'progressive enhancement' },
  { ar: 'حجم الحزمة', en: 'bundle size' },
  { ar: 'تعديل مباشر', en: 'direct manipulation' },

  // Direct English Acronyms & Standards
  { ar: 'معاملات اسيد', en: 'acid transactions' },
  { ar: 'جي ار بي سي', en: 'grpc' },
  { ar: 'كاب', en: 'cap theorem' },

  // D5 Terms: RESTful APIs, Containerization, Security, Load Balancing, Idempotency
  { ar: 'مبادئ تصميم واجهات برمجية', en: 'restful api architectural principles' },
  { ar: 'واجهات برمجية', en: 'restful apis' },
  { ar: 'واجهات برمجة', en: 'rest apis' },
  { ar: 'ريستفول', en: 'restful' },
  { ar: 'ريست', en: 'rest' },
  { ar: 'حوسبة الحاويات', en: 'containerization' },
  { ar: 'الحاويات', en: 'containerization' },
  { ar: 'حاويات', en: 'containers' },
  { ar: 'دوكر', en: 'docker' },
  { ar: 'دورة النشر', en: 'deployment lifecycle' },
  { ar: 'المصادقة', en: 'authentication' },
  { ar: 'مصادقة', en: 'authentication' },
  { ar: 'التحقق من الهوية', en: 'authentication' },
  { ar: 'التفويض', en: 'authorization' },
  { ar: 'تفويض', en: 'authorization' },
  { ar: 'صلاحيات الوصول', en: 'authorization' },
  { ar: 'موزع الأحمال', en: 'load balancing' },
  { ar: 'موازنة الأحمال', en: 'load balancing' },
  { ar: 'توزيع الأحمال', en: 'load balancing' },
  { ar: 'خوارزميات موازنة', en: 'load balancing algorithms' },
  { ar: 'خوارزميات', en: 'algorithms' },
  { ar: 'اللاتغير بالتكرار', en: 'idempotency' },
  { ar: 'تكرارية العمليات', en: 'idempotency' },
  { ar: 'ايدمبوتنسي', en: 'idempotency' },
  { ar: 'معاملات موزعة', en: 'distributed transactions saga' },
  { ar: 'معاملات ثنائية', en: 'two phase commit 2pc' },
  { ar: 'بوابة واجهات', en: 'api gateway' },
  { ar: 'شبكة خدمات', en: 'service mesh' },
  { ar: 'قاطع دائرة', en: 'circuit breaker' },
  { ar: 'تصيير', en: 'rendering ssr ssg isr' },

  // Stress Batch 2 Terms: Concurrency, Storage, Node.js, Protocols
  { ar: 'قراءة غير مؤكدة', en: 'reading uncommitted changes' },
  { ar: 'قراءة غير مؤكدة', en: 'uncommitted changes' },
  { ar: 'قراءة غير مؤكدة', en: 'dirty read' },
  { ar: 'مستويات العزل', en: 'consistency guarantee' },
  { ar: 'مستوى القراءة المعتمدة', en: 'read committed' },
  { ar: 'معاملات متزامنة', en: 'concurrent transactions' },
  { ar: 'الضغط العكسي', en: 'backpressure' },
  { ar: 'تغرقها الطلبات', en: 'backpressure load shedding' },
  { ar: 'كتابة البيانات أسرع من قراءتها', en: 'lsm-tree write optimized' },
  { ar: 'إعادة إرسال نفس الطلب لا ينفذه مرتين', en: 'idempotency' },
  { ar: 'لا ينفذه مرتين', en: 'idempotency key' },
  { ar: 'قفل ثنائي الطور', en: 'two phase locking 2pl' },
  { ar: 'اعتماد ثنائي الطور', en: 'two phase commit 2pc' },
  { ar: 'التسلسلية كمعيار عزل', en: 'serializability' },
  { ar: 'تنفيذ متسلسل', en: 'serial execution' },
  { ar: 'إصدار طويل الدعم', en: 'long term support lts nodejs' },
  { ar: 'نود جي اس', en: 'nodejs lts release' },

  // History & Heritage
  { ar: 'حضارة', en: 'civilization' },
  { ar: 'تجارة بحرية', en: 'maritime trade' },
  { ar: 'طريق البخور', en: 'incense route' },
  { ar: 'نقوش أثرية', en: 'archaeological inscriptions' },
  { ar: 'صهر النحاس', en: 'copper smelting' },
];

/**
 * Normalizes an Arabic word by stripping common prefixes (الـ، و، ف، ب، ك، لـ).
 */
function normalizeArabicStem(word) {
  if (!word || typeof word !== 'string') return '';
  let w = word.trim();
  if (w.startsWith('ال') && w.length > 3) {
    w = w.slice(2);
  } else if ((w.startsWith('وال') || w.startsWith('فال') || w.startsWith('بال') || w.startsWith('كال') || w.startsWith('لل')) && w.length > 4) {
    w = w.slice(3);
  } else if ((w.startsWith('و') || w.startsWith('ف') || w.startsWith('ب') || w.startsWith('ك')) && w.length > 4) {
    w = w.slice(1);
  }
  return w;
}

/**
 * Detects whether the primary language of the text is Arabic or English.
 */
function detectLanguage(text) {
  if (!text) return 'ar';
  const clean = String(text).trim();
  const arabicChars = (clean.match(/[\u0600-\u06FF\u0750-\u077F]/g) || []).length;
  const latinChars = (clean.match(/[a-zA-Z]/g) || []).length;

  return arabicChars >= latinChars ? 'ar' : 'en';
}

/**
 * Expands a query with cross-lingual terminology equivalents.
 * E.g. Arabic query -> adds corresponding English keywords and concept phrases.
 */
function expandCrossLingualQuery(query) {
  const clean = String(query || '').trim();
  if (!clean) {
    return {
      detectedLanguage: 'ar',
      originalQuery: clean,
      targetLanguage: 'en',
      matchedTerms: [],
      expandedTokens: [],
      crossLingualQuery: '',
      hasCrossLingualTerms: false,
    };
  }

  const lang = detectLanguage(clean);
  const targetLang = lang === 'ar' ? 'en' : 'ar';
  const lower = clean.toLowerCase();
  const words = lower.split(/[\s,،.؟!;:()[\]{}"]+/).filter(Boolean);
  const normalizedWords = lang === 'ar' ? words.map(normalizeArabicStem) : words;

  const matchedTerms = [];
  const expandedTokens = [];

  for (const entry of BILINGUAL_DICTIONARY) {
    const srcTerm = (lang === 'ar' ? entry.ar : entry.en).toLowerCase();
    const tgtTerm = lang === 'ar' ? entry.en : entry.ar;

    // Check direct substring match
    let isMatch = lower.includes(srcTerm);

    // If Arabic, check normalized stem match
    if (!isMatch && lang === 'ar') {
      const srcWords = srcTerm.split(/\s+/).map(normalizeArabicStem);
      const allSrcWordsMatched = srcWords.every((sw) => normalizedWords.includes(sw));
      if (allSrcWordsMatched) {
        isMatch = true;
      }
    }

    if (isMatch && !matchedTerms.includes(tgtTerm)) {
      matchedTerms.push(tgtTerm);
      tgtTerm.split(/\s+/).forEach((t) => {
        const cleanedToken = t.toLowerCase().replace(/[^a-z0-9\u0600-\u06FF]/gu, '');
        if (cleanedToken.length > 2 && !expandedTokens.includes(cleanedToken)) {
          expandedTokens.push(cleanedToken);
        }
      });
    }
  }

  // Also retain Latin words in Arabic queries (e.g. gRPC, REST, CQRS, React)
  if (lang === 'ar') {
    const latinTokens = clean.match(/[a-zA-Z0-9_-]{3,}/g) || [];
    for (const lt of latinTokens) {
      const lowerLt = lt.toLowerCase();
      if (!expandedTokens.includes(lowerLt)) {
        expandedTokens.push(lowerLt);
      }
    }
  }

  const crossLingualQuery = expandedTokens.join(' ');
  const hasCrossLingualTerms = expandedTokens.length > 0;

  return {
    detectedLanguage: lang,
    targetLanguage: targetLang,
    originalQuery: clean,
    matchedTerms,
    expandedTokens,
    crossLingualQuery,
    hasCrossLingualTerms,
  };
}

module.exports = {
  detectLanguage,
  expandCrossLingualQuery,
  BILINGUAL_DICTIONARY,
};
