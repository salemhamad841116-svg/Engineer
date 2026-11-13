// src/utils/responseFormatter.ts
// AI Engineer Platform — Response Formatter & Leak Sanitizer

/**
 * Sanitizes any assistant output to guarantee zero leaks of internal architecture,
 * agent identities ("Chief Architect", "المدير الرئيسي"), or internal 9-stage pipeline dumps.
 */
export function formatUserFacingResponse(rawContent: string): string {
  if (!rawContent || typeof rawContent !== 'string') {
    return '';
  }

  let text = rawContent;

  // 1. Strip Chief Architect / Internal Agent headers
  text = text.replace(/^(?:تم تنفيذ طلبك بنجاح عبر \*\*.*?\*\*:\s*|Executed your engineering request via \*\*.*?\*\*:\s*)/i, '');
  text = text.replace(/\*\*(?:المدير الرئيسي|Chief Architect|Chief Architect Agent|agent-chief)\*\*:\s*/gi, '');
  text = text.replace(/\b(?:المدير الرئيسي|Chief Architect|Chief Architect Agent|agent-chief)\b:?\s*/gi, '');

  // 2. Strip internal pipeline stage numbers and boilerplate template leaks
  text = text.replace(/1\.\s*\*\*تحليل الطلب والتخطيط\*\*:[^\n]*\n*/gi, '');
  text = text.replace(/2\.\s*\*\*تحديث الأكواد والملفات\*\*:[^\n]*\n*/gi, '');
  text = text.replace(/3\.\s*\*\*البناء والاختبارات\*\*:[^\n]*\n*/gi, '');

  text = text.replace(/1\.\s*\*?\*?Analysis & Planning\*?\*?:[^\n]*\n*/gi, '');
  text = text.replace(/2\.\s*\*?\*?Code & File Updates\*?\*?:[^\n]*\n*/gi, '');
  text = text.replace(/3\.\s*\*?\*?Build & Verification\*?\*?:[^\n]*\n*/gi, '');

  // 3. Strip any system prompt leakage
  text = text.replace(/You are .*? senior full-stack software engineer[^\n]*\n*/gi, '');

  // 4. Clean up any resulting double line-breaks or leading/trailing whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();

  return text;
}
