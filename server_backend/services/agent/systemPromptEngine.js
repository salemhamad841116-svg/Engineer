/**
 * systemPromptEngine.js — compatibility shim for the executive-assistant (screens) agent.
 *
 * All prompt text comes from the unified constitution (../ai/constitution.js).
 * Keyword "sensitive operation" regexes were removed: dangerous actions are now blocked
 * by the server-side policy in toolGuard.js (role checks + approval tokens), not by
 * pattern-matching the user's words.
 */
'use strict';

const { buildSystemPrompt: buildConstitutionPrompt, workspaceRoleForAccount, CONSTITUTION_TEXT } = require('../ai/constitution');
const { classifyMasterIntent } = require('../ai/engineerMasterPrompt');

const MASTER_SYSTEM_PROMPT_V1 = CONSTITUTION_TEXT;

const PRIVILEGE_ESCALATION_PATTERNS = [
  /ترقية\s+(حساب|حسابي|الصلاحيات|المستخدم)/i,
  /تغيير\s+الصلاحي(ة|ات)\s+إلى\s+(مدير|أدمن|مسؤول|root)/i,
  /صلاحي(ة|ات)\s+(الأدمن|المدير|الروت|admin|root|superuser)/i,
  /منح\s+(صلاحيات\s+المدير|وصول\s+مطلق|admin)/i,
  /grant\s+admin/i,
  /escalate\s+privilege/i,
  /become\s+(admin|root|superuser)/i,
  /make\s+me\s+admin/i
];

const GUARDRAIL_BYPASS_PATTERNS = [
  /تجاوز\s+(التأكيد|الحماية|بوابة\s+الأمان|التحقق)/i,
  /بدون\s+(تأكيد|موافقة)/i,
  /bypass\s+(guardrail|confirmation|approval)/i,
  /skip\s+confirmation/i
];

const SENSITIVE_PATTERNS = [
  /حذف\s+(كافة|جميع|كل|بيانات|سجلات|قاعدة)/i,
  /مسح\s+(كافة|جميع|كل|بيانات|سجلات)/i,
  /تصفير\s+(البيانات|السجلات|الجدول)/i,
  /delete\s+all/i,
  /drop\s+table/i,
  /delete\s+from/i,
  /truncate/i,
  /إرسال\s+إشعار\s+(جماعي|لكافة\s+المستخدمين|عام)/i,
  ...PRIVILEGE_ESCALATION_PATTERNS,
  ...GUARDRAIL_BYPASS_PATTERNS
];

function isSensitiveOperation(prompt = '') {
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(prompt));
}

function isPrivilegeEscalationAttempt(prompt = '') {
  return PRIVILEGE_ESCALATION_PATTERNS.some((pattern) => pattern.test(prompt));
}

function isGuardrailBypassAttempt(prompt = '') {
  return GUARDRAIL_BYPASS_PATTERNS.some((pattern) => pattern.test(prompt));
}

/** Audience profiles only adjust tone/content; they never grant permissions. */
const ROLE_PROFILES = {
  business_owner: {
    title: 'صاحب شركة ومستثمر (Business Owner)',
    focus: 'KPIs, ROI, time and cost savings, executive summaries. Avoid technical jargon.',
  },
  employee: {
    title: 'موظف تشغيلي ومستخدم يومي (Employee)',
    focus: 'Simple, fast data-entry forms with clear labels and few steps.',
  },
  developer: {
    title: 'مهندس برمجيات ومطور تقني (Developer)',
    focus: 'Field ids, data types, validation rules (min/max/pattern) and API-friendly naming.',
  },
};

function describeScreen(currentScreen) {
  if (!currentScreen || !currentScreen.meta) return 'No screen is open (a new screen will be created).';
  const fields = Array.isArray(currentScreen.fields) ? currentScreen.fields : [];
  return `Active screen: "${currentScreen.meta.title}" (id ${currentScreen.meta.screenId}, view ${currentScreen.meta.viewType}) with fields: ${fields
    .map((f) => `${f.name}:${f.type}`)
    .join(', ')}`;
}

/**
 * Builds the system prompt for the screens agent from the constitution.
 * @param {{userRole?: string, accountRole?: string, workspaceRole?: string, currentScreen?: object, fewShotExamples?: Array, language?: string}} o
 */
function buildSystemPrompt({ userRole = 'business_owner', accountRole, workspaceRole, currentScreen = null, fewShotExamples = [], language } = {}) {
  const audience = ROLE_PROFILES[userRole] || ROLE_PROFILES.business_owner;
  const role = workspaceRole || workspaceRoleForAccount(accountRole);
  const examples = (Array.isArray(fewShotExamples) ? fewShotExamples : [])
    .slice(0, 2)
    .map((ex) => `- Request: "${String(ex.prompt).slice(0, 200)}"`)
    .join('\n');
  const extra = [
    `Audience: ${audience.title}. Focus: ${audience.focus}`,
    describeScreen(currentScreen),
    examples ? `Requests users rated highly (for style only):\n${examples}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const systemPrompt = buildConstitutionPrompt({ mode: 'screens', role, language, extra });
  return {
    systemPrompt,
    temperature: 0.15,
    userRole,
    workspaceRole: role,
    roleTitle: audience.title,
    fewShotCount: Array.isArray(fewShotExamples) ? fewShotExamples.length : 0,
  };
}

/** Fetches approved high-rated examples from ai_feedback (style hints only). */
function fetchDynamicFewShots(db, userRole = 'business_owner', limit = 2) {
  if (!db) return [];
  try {
    const rows = db
      .prepare(
        `SELECT prompt, response_json FROM ai_feedback
         WHERE is_few_shot_candidate = 1 AND rating = 1 AND (user_role = ? OR user_role IS NULL)
         ORDER BY created_at DESC LIMIT ?`
      )
      .all(userRole, limit);
    return rows.map((r) => ({ prompt: r.prompt, response: r.response_json }));
  } catch (_) {
    return [];
  }
}

module.exports = {
  ROLE_PROFILES,
  SENSITIVE_PATTERNS,
  PRIVILEGE_ESCALATION_PATTERNS,
  GUARDRAIL_BYPASS_PATTERNS,
  isSensitiveOperation,
  isPrivilegeEscalationAttempt,
  isGuardrailBypassAttempt,
  classifyMasterIntent,
  MASTER_SYSTEM_PROMPT_V1,
  buildSystemPrompt,
  fetchDynamicFewShots,
};
