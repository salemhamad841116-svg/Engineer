/**
 * engineerMasterPrompt.js — compatibility shim.
 *
 * The Engineer constitution now lives in ONE place: ./constitution.js
 * (prompt text + machine policy enforced by server_backend/security/toolGuard.js).
 * This module only re-exports it for older imports. Regex intent classification was
 * removed: the agent decides what to do under the constitution, and the server
 * enforces permissions — no keyword routing remains.
 */
'use strict';

const { CONSTITUTION_TEXT, CONSTITUTION_VERSION, buildSystemPrompt } = require('./constitution');

/** @deprecated alias of CONSTITUTION_TEXT (kept for older imports). */
const MASTER_SYSTEM_PROMPT_V1 = CONSTITUTION_TEXT;

function getMasterSystemPrompt(context = {}) {
  return {
    prompt: buildSystemPrompt({ mode: context.mode || 'build', role: context.role || 'Editor', project: context.project || null, language: context.language }),
    version: CONSTITUTION_VERSION,
    mode: context.mode || 'build',
    language: context.language || 'ar',
  };
}

function classifyMasterIntent(prompt = '') {
  // Strip Arabic tashkeel / diacritics for robust classification
  const p = String(prompt || '').trim().toLowerCase().replace(/[\u064B-\u065F\u0670]/g, '');

  if (/^(هلا|مرحبا|أهلا|السلام عليكم|صباح الخير|مساء الخير|hi|hello|hey|greetings)\b/i.test(p) && p.length < 30) {
    return 'CHAT';
  }
  if (/(انشر|نشر|إطلاق|deploy|publish|release|اعتماد النشر|ترقية للإنتاج)/i.test(p)) {
    return 'DEPLOY';
  }
  if (/(أتمتة|أتمت|جدولة|مجدول|كل أسبوع|أسبوعي[اًا]?|يومي[اًا]?|تلقائي[اًا]?|schedule|cron|automation|webhook)/i.test(p)) {
    return 'AUTOMATE';
  }
  if (/(تقرير|إحصائيات|استخدام|لوحة القيادة|analytics|report|metrics|استهلاك)/i.test(p)) {
    return 'REPORT';
  }
  if (/(عطل|خطأ|تشخيص|شخص|bug|fix error|إصلاح المشكلة|الخلل|exception|crash)/i.test(p)) {
    return 'DEBUG';
  }
  if (/(اختبر|فحص|تأكد من عمل|run test|verify|e2e test|unit test)/i.test(p)) {
    return 'TEST';
  }
  if (/(اشرح|كيف يعمل|ما هو|ما هي|ما الفرق|explain|what is|how to)/i.test(p)) {
    return 'EXPLAIN';
  }
  if (/(قاعد[ةه]\s*(ال)?بيانات|database|سجلات|جدول|تخزين|استعلام|sql|migration|ربط\s*(الحفظ|البيانات|قاعد|بقاعد)|بيانات)/i.test(p)) {
    return 'DATA';
  }
  if (/(خطط|خطة|معمارية|تصميم معماري|تقدير تكلفة|plan|architecture|specification)/i.test(p)) {
    return 'PLAN';
  }
  if (/(عدل|عدلي|تعديل|غير|غيّر|تغيير|حدث|تحديث|أضف|اضف|أظهر|اظهر|اعرض|عرض|ارسم|رسم|شارت|تشارت|بياني|مخطط|لون|زر|أزرار|patch|modify|update|edit|chart|graph|plot|show|display)/i.test(p)) {
    return 'EDIT';
  }
  if (/(ابن|اصنع|أنشئ|اعمل|سوي|طور|build|create|scaffold|generate)/i.test(p)) {
    return 'BUILD';
  }
  return 'CHAT';
}

module.exports = {
  MASTER_SYSTEM_PROMPT_V1,
  getMasterSystemPrompt,
  classifyMasterIntent,
};
