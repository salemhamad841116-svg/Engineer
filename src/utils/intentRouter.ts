// src/utils/intentRouter.ts
// AI Engineer Platform — Intent Router (Chat Mode vs Build Mode)

export type PromptMode = 'auto' | 'chat' | 'build';
export type IntentType = 'chat' | 'build';
export type SubIntent =
  | 'greeting'
  | 'qa'
  | 'clarification'
  | 'ambiguous_edit'
  | 'create_conflict'
  | 'build_new'
  | 'modify_code';

export interface IntentResult {
  intent: IntentType;
  subIntent: SubIntent;
  confidence: number;
  reason: string;
  /** True when the user explicitly asked for a NEW, separate project while another one is open. */
  createNewProject?: boolean;
}

const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;

/** Removes Arabic diacritics/tatweel so «ابنِ» and «ابن» route identically. */
export function stripArabicDiacritics(text: string): string {
  return String(text || '').replace(ARABIC_DIACRITICS, '');
}

const CREATE_VERB_REGEX = /(?:^|[^\p{L}\p{N}_])(أنشئ|انشئ|ابن|ابني|اصنع|سوي|اعمل|صمم|برمج|جهز|build|create|make|generate)(?:$|[^\p{L}\p{N}_])/iu;
const APP_NOUN_REGEX = /(تطبيق|موقع|منصة|برنامج|نظام|متجر|مشروع|لوحة تحكم|\bapp\b|\bproject\b|application|website|platform|system|store|dashboard)/i;
const EXPLICIT_NEW_PROJECT_REGEX = /(مشروع(?:اً|ا)?\s+جديد(?:اً|ا)?|تطبيق(?:اً|ا)?\s+جديد(?:اً|ا)?|منصة\s+جديدة|موقع(?:اً|ا)?\s+جديد(?:اً|ا)?|من الصفر|new project|new app|from scratch|separate project)/i;
const EXPLICIT_CURRENT_PROJECT_REGEX = /(الحالي|الحالية|نفس التطبيق|نفس المشروع|هذا التطبيق|هذا المشروع|على التطبيق|للتطبيق|في التطبيق|current project|current app|this app|existing app|existing project)/i;

/**
 * Explicit request to CREATE an application (verb + app noun), e.g.
 * «ابنِ لي تطبيق منصة تداول مع الرسم البياني», «أنشئ تطبيق منصة تداول يحتوي على رسم بياني».
 */
export function isExplicitNewAppCreation(rawPrompt: string): boolean {
  const p = stripArabicDiacritics(rawPrompt).trim();
  if (!p) return false;
  if (mentionsNewProject(p)) return true;
  const hasVerb = CREATE_VERB_REGEX.test(p);
  const hasNoun = APP_NOUN_REGEX.test(p);
  const hasDomain = /(?:تسجيل|صوت|مراس|شات|متجر|تداول|مخاطر|زكاة|ملاحظ|مهام|فواتير|محاسب|حاسب|record|audio|voice|message|chat|store|calc|trade|todo|task)/i.test(p);
  if (hasVerb && hasNoun) return true;
  if (hasNoun && hasDomain) return true;
  return false;
}

export function mentionsNewProject(rawPrompt: string): boolean {
  return EXPLICIT_NEW_PROJECT_REGEX.test(stripArabicDiacritics(rawPrompt));
}

export function mentionsCurrentProject(rawPrompt: string): boolean {
  return EXPLICIT_CURRENT_PROJECT_REGEX.test(stripArabicDiacritics(rawPrompt));
}

const GREETING_REGEX = /^(هلا|أهلا|اهلا|اهلاً|أهلاً|مرحبا|مرحباً|السلام عليكم|سلام عليكم|صباح الخير|مساء الخير|صباح النور|مساء النور|تحياتي|يا هلا|أهلين|اهلين|hello|hi|hey|greetings|good morning|good evening|howdy)([\s!.,؟?].*)?$/i;

const CLARIFICATION_REGEX = /^(شكراً|شكرا|تمام|أوكي|اوكي|ممتاز|يعطيك العافية|تسلم|مشكور|thanks|thank you|great|cool|ok|okay|nice|got it)[\s!.,؟?]*$/i;

const QA_PREFIX_REGEX = /^(اشرح|ما هو|ما هي|ماهو|ماهي|كيف|لماذا|هل يمكن|وضح|علل|ما الفرق|قارن|ماذا يعني|عرف|what is|how does|how do|explain|tell me about|why is|difference between|can you explain|what are)/i;

const BUILD_ACTION_REGEX = /(?:^|[^\p{L}\p{N}_])(أنشئ|انشئ|ابن|ابني|اصنع|سوي|اعمل|عدل|عدلي|تعديل|غير|غيّر|تغيير|حدث|تحديث|أضف|اضف|إضافة|اضافة|أظهر|اظهر|إظهار|اظهار|اعرض|عرض|ارسم|رسم|شارت|تشارت|بيان|بياني|مخطط|احذف|حذف|صلح|برمج|صمم|طور|ركب|حط|لون|زر|أزرار|azrar|build|create|make|add|show|display|render|chart|graph|plot|update|modify|change|edit|fix|generate|scaffold|design|style|redesign|implement|code)(?:$|[^\p{L}\p{N}_])/iu;

const MODIFY_ACTION_REGEX = /(?:^|[^\p{L}\p{N}_])(عدل|عدلي|تعديل|تعديلات|غير|غيّر|تغيير|حدث|تحديث|أضف|اضف|إضافة|اضافة|أظهر|اظهر|إظهار|اظهار|اعرض|عرض|ارسم|رسم|رسومات|شارت|تشارت|بيان|بياني|مخطط|احذف|حذف|صلح|لون|تلوين|أزرق|ازرق|زر|أزرار|ازرار|خط|حجم|شاش|modify|update|change|fix|style|color|blue|button|text|background|chart|graph|plot|show|display|render)(?:$|[^\p{L}\p{N}_])/iu;

/**
 * Detects ambiguous / underspecified modification requests without concrete details
 * Examples: «محتاج تعديل في التطبيق»، «عدل التطبيق»، «أريد تعديل»، «i need to edit the app»
 */
export function isAmbiguousEditRequest(rawPrompt: string): boolean {
  const p = (rawPrompt || '').trim().toLowerCase();
  if (!p) return false;

  // Concrete details indicating specific edits (not ambiguous)
  const hasSpecificDetails = /(رسم|شارت|بيان|بياني|مخطط|لون|أزرق|ازرق|أخضر|اخضر|أحمر|احمر|زر|أزرار|حساب|حاسبة|رصيد|مخاطر|وقف|خسار|ربح|هدف|عنوان|حقل|مدخل|جدول|قائم|سجل|أيقون|نافذة|خط|حجم|chart|graph|plot|color|blue|button|balance|risk|trade|input|table|icon|font)/i.test(p);
  if (hasSpecificDetails) {
    return false;
  }

  const ambiguousPatterns = [
    /^(محتاج|أريد|اريد|ابي|ابغى|ودّي|ودي)\s+(تعديل|أعدل|اعدل|تغيير|تحديث)\s*(في|على|بـ|ب)?\s*(التطبيق|الموقع|البرنامج|الكود|المشروع)?[\s!.,؟?]*$/i,
    /^(عدل|غيّر|غير|حدث)\s*(لي\s+)?(في\s+|على\s+)?(التطبيق|الموقع|البرنامج|الكود|المشروع)[\s!.,؟?]*$/i,
    /^(تعديل|تغيير|تحديث)\s*(في|على)?\s*(التطبيق|الموقع|البرنامج|الكود|المشروع)?[\s!.,؟?]*$/i,
    /^(عندي|لدي)\s+(تعديل|تعديلات|تغيير|تحديث)[\s!.,؟?]*$/i,
    /^(i need|i want|please)\s+(to\s+)?(edit|modify|change|update)\s+(the\s+)?(app|application|code|project|website)[\s!.,؟?]*$/i,
    /^(edit|modify|change|update)\s+(the\s+)?(app|application|code|project|website)[\s!.,؟?]*$/i,
  ];

  return ambiguousPatterns.some((rgx) => rgx.test(p));
}

/**
 * Detects generic / underspecified requests for an app or website without details
 * Examples: «محتاج تطبيق»، «محتاج بنا تطبيق»، «اعمل لي موقع»، «أريد برنامج»، «أريد تطبيق»
 */
export function isGenericAppRequest(rawPrompt: string, hasActiveProject: boolean = false): boolean {
  const p = (rawPrompt || '').trim().toLowerCase();
  if (!p) return false;

  // If there is an active project and the user asks for modification, it's not a generic new app
  const hasEditWord = /(عدل|تعديل|غير|تغيير|حدث|تحديث|أظهر|اعرض|رسم|شارت|لون|أزرق|زر|edit|modify|change|update|show|chart|color)/i.test(p);
  if (hasActiveProject && hasEditWord) {
    return false;
  }

  const genericPatterns = [
    /^(محتاج|أريد|اريد|ابي|ابغى|ودّي|ودي)\s+(بنا[ء]?\s+)?(تطبيق|موقع|برنامج|صفحة|منصة|سستم|سيستم)[\s!.,؟?]*$/i,
    /^(اعمل|سوي|صمم|برمج|ابن[ي]?|أنشئ|انشئ|جهز)\s+(لي\s+)?(تطبيق|موقع|برنامج|صفحة|منصة)[\s!.,؟?]*$/i,
    /^(تطبيق|موقع|برنامج|منصة)[\s!.,؟?]*$/i,
    /^(i need|i want|build me|make me|create)\s+(an?|a)?\s+(app|application|website|site|program|platform)[\s!.,؟?]*$/i,
  ];

  if (genericPatterns.some((rgx) => rgx.test(p))) return true;

  // Short prompts (<= 5 words) asking generally for app without specific domain features
  const words = p.split(/\s+/).filter(Boolean);
  if (words.length <= 5) {
    const hasAppWord = /(تطبيق|موقع|برنامج|منصة|app|website|system)/i.test(p);
    const hasNeedOrAction = /(محتاج|اريد|أريد|ابغى|ابي|سوي|اعمل|صمم|بناء|بنا|ابن|أنشئ|انشئ|need|want|build|make)/i.test(p);
    const hasSpecificDomain = /(تداول|مخاطر|حاسب|أسهم|فوركس|متجر|سلة|مبيعات|إدار|فواتير|محاسب|عقار|مطعم|طبي|مستشفى|مدرسة|حجز|طيران|تسجيل|تسجيلات|صوت|صوتي|ريكورد|مراسلات|شات|محادث|رسائل|موسيقى|فيديو|ملاحظ|دفتر|أخبار|طقس|chat|store|calc|trade|shop|portfolio|todo|task|record|voice|audio|message|messaging|notes?)/i.test(p);

    if (hasAppWord && hasNeedOrAction && !hasSpecificDomain && !hasEditWord) {
      return true;
    }
  }

  return false;
}

/**
 * Classifies a user prompt into 'chat' or 'build' intent.
 * Guarantees that greetings and Q&A never trigger file modifications or build pipelines,
 * while ensuring accurate project modification routing and ambiguous edit clarification.
 */
export function detectIntent(
  rawPrompt: string,
  forcedMode: PromptMode = 'auto',
  hasActiveProject: boolean = false
): IntentResult {
  // Diacritics/tatweel are removed so «عدّل», «غيّر», «ابنِ» route like their plain forms.
  const prompt = stripArabicDiacritics(rawPrompt).trim();

  // 1. Manual user override takes precedence
  if (forcedMode === 'chat') {
    return {
      intent: 'chat',
      subIntent: GREETING_REGEX.test(prompt)
        ? 'greeting'
        : QA_PREFIX_REGEX.test(prompt)
        ? 'qa'
        : 'clarification',
      confidence: 1.0,
      reason: 'Forced by user mode selector (Chat Mode)',
    };
  }

  if (forcedMode === 'build') {
    return {
      intent: 'build',
      subIntent: (MODIFY_ACTION_REGEX.test(prompt) || hasActiveProject) ? 'modify_code' : 'build_new',
      confidence: 1.0,
      reason: 'Forced by user mode selector (Build Mode)',
    };
  }

  // 1.2. Ambiguous Edit Detection: When user requests modification without concrete details
  if (isAmbiguousEditRequest(prompt)) {
    return {
      intent: 'chat',
      subIntent: 'ambiguous_edit',
      confidence: 0.99,
      reason: 'Ambiguous project modification request requiring clarification',
    };
  }

  // 1.5. Clarify-Before-Build Rule: Generic unspecified app requests require clarification
  if (isGenericAppRequest(prompt, hasActiveProject)) {
    return {
      intent: 'chat',
      subIntent: 'clarification',
      confidence: 0.99,
      reason: 'Generic app request requiring clarification before building',
    };
  }

  // 1.6. CREATE_NEW_PROJECT vs EDIT_EXISTING_PROJECT disambiguation
  if (isExplicitNewAppCreation(prompt)) {
    if (mentionsNewProject(prompt)) {
      return {
        intent: 'build',
        subIntent: 'build_new',
        confidence: 0.97,
        reason: 'Explicit request for a new, separate project',
        createNewProject: hasActiveProject,
      };
    }
    if (hasActiveProject && !mentionsCurrentProject(prompt)) {
      return {
        intent: 'chat',
        subIntent: 'create_conflict',
        confidence: 0.9,
        reason: 'New-application request while a project is open: ask whether to create a new project or edit the current one',
      };
    }
    if (!hasActiveProject) {
      return {
        intent: 'build',
        subIntent: 'build_new',
        confidence: 0.96,
        reason: 'Explicit new application request (no project open)',
      };
    }
  }

  // 2. Pure greetings (e.g. «هلا», «مرحبا», «السلام عليكم»)
  const words = prompt.split(/\s+/).filter(Boolean);
  if (GREETING_REGEX.test(prompt) && (!BUILD_ACTION_REGEX.test(prompt) || words.length <= 4)) {
    return {
      intent: 'chat',
      subIntent: 'greeting',
      confidence: 0.98,
      reason: 'Greeting expression detected without build imperatives',
    };
  }

  // 3. Conversational clarifications (e.g. «شكراً», «تمام», «ok»)
  if (CLARIFICATION_REGEX.test(prompt)) {
    return {
      intent: 'chat',
      subIntent: 'clarification',
      confidence: 0.95,
      reason: 'Conversational acknowledgment detected',
    };
  }

  // 4. Educational / Conceptual Q&A (e.g. «اشرح لي React», «ما الفرق بين SQL و NoSQL»)
  if (QA_PREFIX_REGEX.test(prompt) && !BUILD_ACTION_REGEX.test(prompt)) {
    return {
      intent: 'chat',
      subIntent: 'qa',
      confidence: 0.95,
      reason: 'Technical or educational question without project mutation intent',
    };
  }

  // 5. Code build or modification requests
  const isModifyMatch = MODIFY_ACTION_REGEX.test(prompt);
  const isBuildMatch = BUILD_ACTION_REGEX.test(prompt);

  if (isModifyMatch || isBuildMatch) {
    const isModify = isModifyMatch || hasActiveProject;
    return {
      intent: 'build',
      subIntent: isModify ? 'modify_code' : 'build_new',
      confidence: 0.95,
      reason: isModify ? 'Project modification action detected' : 'New application build action detected',
    };
  }

  // 6. Ambiguous / short messages default to Chat Mode for safety only if NOT matching build actions
  if (words.length <= 3) {
    return {
      intent: 'chat',
      subIntent: 'clarification',
      confidence: 0.75,
      reason: 'Short ambiguous message safely routed to chat',
    };
  }

  // Default fallback: If it mentions coding artifacts, treat as build; otherwise chat
  if (/(?:^|[^\p{L}\p{N}_])(app|component|page|button|dashboard|api|database|chart|تطبيق|صفحة|واجهة|قاعدة بيانات|زر|رسم|شارت)(?:$|[^\p{L}\p{N}_])/iu.test(prompt)) {
    return {
      intent: 'build',
      subIntent: hasActiveProject ? 'modify_code' : 'build_new',
      confidence: 0.8,
      reason: 'Software artifact mentioned in prompt',
    };
  }

  return {
    intent: 'chat',
    subIntent: 'qa',
    confidence: 0.7,
    reason: 'General inquiry safely routed to chat conversation',
  };
}
