// ==============================================================================
// server_backend/services/agent/personalizationService.js
// AI Personalization — adapts the agent's working style to the user.
//
// Expertise model (3 levels): beginner → simplified, jargon-free, step-by-step
// explanations; intermediate → balanced; expert → dense technical language,
// trade-offs, no hand-holding. The level is injected into the system prompt
// (constitution) so EVERY reply adapts, not just one-off answers.
//
// Honesty rules:
//   - An explicit user choice ALWAYS wins over inference (source='explicit'
//     rows are never overwritten by inference).
//   - Inference is signal-based and recorded (signals_json) — the platform can
//     always explain WHY it treats a user at a given level.
// ==============================================================================
'use strict';

const EXPERT_TERMS = /(\b(ast|api|sdk|sql|orm|dto|cors|jwt|oauth|regex|docker|kubernetes|ci\/cd|webhook|middleware|refactor|deploy|localhost|npm|git\s|merge|branch|typescript|react\s|vite|lambda|microservice|graphql|websocket|ssl|dns)\b|`[^`]+`|\/\/|=>|\{\}|console\.|stack\s?trace|exception|traceback)/i;
const BEGINNER_MARKERS_AR = /(ما\s?(أعرف|اعرف)|مبتدئ|بسيط|بساطة|شرح\s?مبسط|ما\s?افهم|علمني|اشرح\s?لي|أول\s?مرة|اول\s?مرة)/;
const BEGINNER_MARKERS_EN = /(\bbeginner\b|\bsimple\b|\bi'?m new\b|\bexplain like\b|\bstep by step\b|\bdon'?t understand\b)/i;
const EXPLICIT_EXPERT = /(أنا\s?(مبرمج|مطور|خبير)|برمج\s?باحتراف|technical\s?details|i'?m\s?a\s?(developer|engineer|programmer))/i;
const EXPLICIT_BEGINNER = /(أنا\s?مبتدئ|لست\s?مبرمج|مو\s?مبرمج|i'?m\s?a\s?beginner|non[\s-]?technical)/i;

const LEVELS = ['beginner', 'intermediate', 'expert'];

/**
 * Infers expertise from message signals. Returns { level, signals } — never
 * throws; ambiguous evidence resolves to 'intermediate' (the safe default).
 */
function inferExpertise(messages = []) {
  const corpus = messages.filter(Boolean).join('\n').slice(0, 20000);
  const signals = {
    expertTermHits: (corpus.match(new RegExp(EXPERT_TERMS.source, 'gi')) || []).length,
    beginnerMarkers: Number(BEGINNER_MARKERS_AR.test(corpus)) + Number(BEGINNER_MARKERS_EN.test(corpus)),
    explicitExpert: EXPLICIT_EXPERT.test(corpus),
    explicitBeginner: EXPLICIT_BEGINNER.test(corpus),
    avgMessageLength: messages.length ? Math.round(corpus.length / messages.length) : 0,
  };

  let level = 'intermediate';
  if (signals.explicitExpert) level = 'expert';
  else if (signals.explicitBeginner) level = 'beginner';
  else if (signals.expertTermHits >= 3) level = 'expert';
  else if (signals.beginnerMarkers >= 1 && signals.expertTermHits === 0) level = 'beginner';

  return { level, signals };
}

/** Reads the stored expertise row (or null). */
function getUserExpertise(db, userId) {
  if (!db || !userId) return null;
  return db.prepare('SELECT user_id, level, source, signals_json, updated_at FROM user_expertise WHERE user_id = ?').get(String(userId)) || null;
}

/** Stores an explicit user choice — the only path that creates source='explicit'. */
function setExplicitExpertise(db, userId, level) {
  if (!LEVELS.includes(level)) {
    throw Object.assign(new Error(`Invalid expertise level: ${level}`), { code: 'EXPERTISE_INVALID' });
  }
  db.prepare(
    `INSERT INTO user_expertise (user_id, level, source, signals_json, updated_at)
     VALUES (?, ?, 'explicit', '{}', ?)
     ON CONFLICT(user_id) DO UPDATE SET level = excluded.level, source = 'explicit', updated_at = excluded.updated_at`
  ).run(String(userId), level, new Date().toISOString());
  return getUserExpertise(db, userId);
}

/**
 * Updates expertise from observed messages. NEVER overrides an explicit choice.
 * Returns the effective row after the update.
 */
function updateInferredExpertise(db, userId, messages = []) {
  if (!db || !userId) return { level: 'intermediate', source: 'default' };
  const existing = getUserExpertise(db, userId);
  if (existing && existing.source === 'explicit') return existing;
  const { level, signals } = inferExpertise(messages);
  db.prepare(
    `INSERT INTO user_expertise (user_id, level, source, signals_json, updated_at)
     VALUES (?, ?, 'inferred', ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       level = excluded.level,
       signals_json = excluded.signals_json,
       updated_at = excluded.updated_at`
  ).run(String(userId), level, JSON.stringify(signals), new Date().toISOString());
  return getUserExpertise(db, userId);
}

/**
 * The prompt section injected into the system prompt. Language-aware.
 */
function renderExpertiseSection(level, language = 'en') {
  const ar = language === 'ar';
  if (level === 'beginner') {
    return ar
      ? 'أسلوب المستخدم: مبتدئ. اشرح بلغة بسيطة بلا مصطلحات تقنية؛ إن اضطررت لمصطلح فعرّفه بجملة واحدة. قسّم أي إجراء إلى خطوات مرقمة قصيرة، واختم بما سيحدث بعد الضغط أو الأمر التالي.'
      : 'User style: beginner. Explain in plain language with no jargon; if a technical term is unavoidable, define it in one sentence. Break actions into short numbered steps and end with what happens next.';
  }
  if (level === 'expert') {
    return ar
      ? 'أسلوب المستخدم: خبير تقني. تحدث بكثافة تقنية: سمِّ الأنماط والمفاضلات والقيود بدقة، وتجنب التبسيط المخل أو الشرح التمهيدي. أجب مباشرة بالخلاصة العملية أولاً.'
      : 'User style: technical expert. Use dense technical language: name patterns, trade-offs and constraints precisely; skip hand-holding and introductory explanations. Lead with the actionable bottom line.';
  }
  return ar
    ? 'أسلوب المستخدم: متوسط المعرفة. وازن بين الوضوح والدقة: مصطلحات تقنية مع شرح موجز عند الحاجة، وخطوات عملية واضحة.'
    : 'User style: intermediate. Balance clarity and precision: technical terms with brief explanations when needed, and clear actionable steps.';
}

module.exports = {
  LEVELS,
  inferExpertise,
  getUserExpertise,
  setExplicitExpertise,
  updateInferredExpertise,
  renderExpertiseSection,
};
