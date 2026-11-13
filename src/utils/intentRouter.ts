// src/utils/intentRouter.ts
// AI Engineer Platform — Intent Router (Chat Mode vs Build Mode)

export type PromptMode = 'auto' | 'chat' | 'build';
export type IntentType = 'chat' | 'build';
export type SubIntent = 'greeting' | 'qa' | 'clarification' | 'build_new' | 'modify_code';

export interface IntentResult {
  intent: IntentType;
  subIntent: SubIntent;
  confidence: number;
  reason: string;
}

const GREETING_REGEX = /^(هلا|أهلا|اهلاً|أهلاً|مرحبا|مرحباً|السلام عليكم|سلام عليكم|صباح الخير|مساء الخير|صباح النور|مساء النور|تحياتي|يا هلا|أهلين|اهلين|hello|hi|hey|greetings|good morning|good evening|howdy)([\s!.,؟?].*)?$/i;

const CLARIFICATION_REGEX = /^(شكراً|شكرا|تمام|أوكي|اوكي|ممتاز|يعطيك العافية|تسلم|مشكور|thanks|thank you|great|cool|ok|okay|nice|got it)[\s!.,؟?]*$/i;

const QA_PREFIX_REGEX = /^(اشرح|ما هو|ما هي|ماهو|ماهي|كيف|لماذا|هل يمكن|وضح|علل|ما الفرق|قارن|ماذا يعني|عرف|what is|how does|how do|explain|tell me about|why is|difference between|can you explain|what are)/i;

const BUILD_ACTION_REGEX = /(?:^|[^\p{L}\p{N}_])(أنشئ|انشئ|ابن|ابني|اصنع|سوي|اعمل|عدل|غير|حدث|أضف|اضف|احذف|صلح|برمج|صمم|طور|ركب|حط|build|create|make|add|update|modify|change|fix|generate|scaffold|design|style|redesign|implement|code)(?:$|[^\p{L}\p{N}_])/iu;

const MODIFY_ACTION_REGEX = /(?:^|[^\p{L}\p{N}_])(عدل|غير|حدث|أضف|اضف|احذف|صلح|لون|زر|خط|حجم|شاش|modify|update|change|fix|style|color|button|text|background)(?:$|[^\p{L}\p{N}_])/iu;

/**
 * Classifies a user prompt into 'chat' or 'build' intent.
 * Guarantees that greetings and Q&A never trigger file modifications or build pipelines.
 */
export function detectIntent(
  rawPrompt: string,
  forcedMode: PromptMode = 'auto'
): IntentResult {
  const prompt = (rawPrompt || '').trim();

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
      subIntent: MODIFY_ACTION_REGEX.test(prompt) ? 'modify_code' : 'build_new',
      confidence: 1.0,
      reason: 'Forced by user mode selector (Build Mode)',
    };
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
  if (BUILD_ACTION_REGEX.test(prompt)) {
    return {
      intent: 'build',
      subIntent: MODIFY_ACTION_REGEX.test(prompt) ? 'modify_code' : 'build_new',
      confidence: 0.92,
      reason: 'Imperative build or code modification action detected',
    };
  }

  // 6. Ambiguous / short messages default to Chat Mode for safety (prevent accidental build)
  if (words.length <= 3) {
    return {
      intent: 'chat',
      subIntent: 'clarification',
      confidence: 0.75,
      reason: 'Short ambiguous message safely routed to chat',
    };
  }

  // Default fallback: If it mentions coding artifacts, treat as build; otherwise chat
  if (/(?:^|[^\p{L}\p{N}_])(app|component|page|button|dashboard|api|database|تطبيق|صفحة|واجهة|قاعدة بيانات|زر)(?:$|[^\p{L}\p{N}_])/iu.test(prompt)) {
    return {
      intent: 'build',
      subIntent: 'build_new',
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
