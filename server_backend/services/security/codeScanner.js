// ==============================================================================
// server_backend/services/security/codeScanner.js
// Code Review & Security — static scanner for GENERATED project files.
//
// Honest-by-design contract:
//   * Deterministic rule engine (no AI guessing) — every finding has rule id,
//     severity, file, line and a concrete evidence snippet.
//   * Never rewrites code, never blocks saving — it REPORTS. Verdicts are
//     advisory and labelled as static analysis (not a full pentest).
//   * Bounded output: per-rule and total caps so a hostile/huge file cannot
//     flood the response.
// ==============================================================================
'use strict';

const MAX_FINDINGS_PER_RULE = 25;
const MAX_FINDINGS_TOTAL = 120;
const MAX_FILE_BYTES = 512 * 1024;

/**
 * Rules: id, severity (critical|warning|notice), bilingual messages,
 * optional language filter, and match(regex with global flag).
 */
const RULES = [
  {
    id: 'eval-call', severity: 'critical',
    messageAr: 'استخدام eval() — تنفيذ كود ديناميكي خطير وقد يسمح بحقن أوامر',
    messageEn: 'eval() usage — dangerous dynamic code execution (injection risk)',
    languages: ['javascript', 'typescript'],
    pattern: /\beval\s*\(/g,
  },
  {
    id: 'new-function', severity: 'critical',
    messageAr: 'استخدام new Function() — بديل مقنّع لـ eval بنفس خطورة الحقن',
    messageEn: 'new Function() — a disguised eval with the same injection risk',
    languages: ['javascript', 'typescript'],
    pattern: /new\s+Function\s*\(/g,
  },
  {
    id: 'hardcoded-secret', severity: 'critical',
    messageAr: 'سرّ مضمّن في الكود (مفتاح API/كلمة مرور/توكن) — انقله إلى متغيرات البيئة',
    messageEn: 'Hardcoded secret (API key/password/token) — move it to env variables',
    pattern: /(?:api[_-]?key|apikey|secret|password|passwd|token)\s*[:=]\s*['"][A-Za-z0-9_\-\.]{12,}['"]/gi,
  },
  {
    id: 'known-key-format', severity: 'critical',
    messageAr: 'نمط مفتاح حقيقي ظاهر في الكود (sk- / AKIA / ghp_) — أبطله فوراً وانقله للبيئة',
    messageEn: 'Real-looking key format in code (sk- / AKIA / ghp_) — revoke and move to env',
    pattern: /(?:sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,})/g,
  },
  {
    id: 'inner-html', severity: 'warning',
    messageAr: 'كتابة مباشرة في innerHTML — خطر XSS إن كان المحتوى من مدخلات المستخدم',
    messageEn: 'Direct innerHTML write — XSS risk if content comes from user input',
    languages: ['javascript', 'typescript'],
    pattern: /\.innerHTML\s*=[^=]/g,
  },
  {
    id: 'dangerously-set-html', severity: 'warning',
    messageAr: 'dangerouslySetInnerHTML — تأكد من تعقيم المحتوى قبل العرض',
    messageEn: 'dangerouslySetInnerHTML — make sure content is sanitized first',
    languages: ['javascript', 'typescript'],
    pattern: /dangerouslySetInnerHTML/g,
  },
  {
    id: 'document-write', severity: 'warning',
    messageAr: 'document.write() — ممارسة قديمة خطرة تكسر التحميل التدريجي وتفتح باب XSS',
    messageEn: 'document.write() — dangerous legacy practice, breaks parsing and risks XSS',
    languages: ['javascript', 'typescript', 'html'],
    pattern: /document\.write\s*\(/g,
  },
  {
    id: 'insecure-http', severity: 'warning',
    messageAr: 'رابط http:// غير مشفّر — استبدله بـ https://',
    messageEn: 'Insecure http:// URL — switch to https://',
    pattern: /['"(= ]http:\/\/(?!localhost|127\.0\.0\.1|\[::1\])[^\s'")<>\]]+/g,
  },
  {
    id: 'inline-handler', severity: 'warning',
    messageAr: 'معالج حدث مضمّن (onclick=...) داخل HTML — انقله إلى addEventListener',
    messageEn: 'Inline event handler (onclick=...) in HTML — move to addEventListener',
    languages: ['html'],
    pattern: /\son(?:click|load|error|submit|mouseover|change|input|keyup|keydown)\s*=\s*['"][^'"]+['"]/gi,
  },
  {
    id: 'iframe-no-sandbox', severity: 'warning',
    messageAr: 'iframe بدون خاصية sandbox — قيّده بـ sandbox للحماية',
    messageEn: 'iframe without a sandbox attribute — restrict it with sandbox',
    languages: ['html'],
    pattern: /<iframe(?![^>]*\bsandbox=)[^>]*>/gi,
    // one finding per file is enough for this rule
    oncePerFile: true,
  },
  {
    id: 'token-in-localstorage', severity: 'warning',
    messageAr: 'تخزين توكن/سرّ في localStorage — معرّض للسرقة عبر أي XSS',
    messageEn: 'Token/secret stored in localStorage — exposed to any XSS',
    languages: ['javascript', 'typescript'],
    pattern: /localStorage\.setItem\s*\(\s*['"][^'"]*(?:token|secret|password|session|auth)[^'"]*['"]/gi,
  },
  {
    id: 'blank-noopener', severity: 'notice',
    messageAr: 'رابط target=_blank بدون rel=noopener — أضف rel="noopener noreferrer"',
    messageEn: 'target=_blank link without rel=noopener — add rel="noopener noreferrer"',
    languages: ['html'],
    pattern: /target\s*=\s*['"]_blank['"](?![^>]*rel\s*=)/gi,
    oncePerFile: true,
  },
  {
    id: 'console-log-left', severity: 'notice',
    messageAr: 'console.log متروك في الكود — احذفه قبل النشر',
    messageEn: 'Leftover console.log — remove before shipping',
    languages: ['javascript', 'typescript'],
    pattern: /console\.log\s*\(/g,
    maxFindings: 5,
  },
  {
    id: 'todo-left', severity: 'notice',
    messageAr: 'علامة TODO/FIXME غير محسومة في الكود',
    messageEn: 'Unresolved TODO/FIXME marker in code',
    pattern: /(?:\/\/|\/\*|<!--|#)\s*(?:TODO|FIXME|HACK)\b/gi,
    maxFindings: 8,
  },
];

const SEVERITY_PENALTY = { critical: 20, warning: 7, notice: 2 };
const SEVERITY_ORDER = { critical: 0, warning: 1, notice: 2 };

function lineOf(content, index) {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i += 1) {
    if (content.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function snippetOf(content, index, matchLen) {
  const start = Math.max(0, index - 24);
  const end = Math.min(content.length, index + matchLen + 24);
  return content.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 120);
}

/**
 * Scans one file with all applicable rules.
 * @returns {Array<object>} findings
 */
function scanFile(file) {
  const content = String(file.content || '');
  if (!content || content.length > MAX_FILE_BYTES) return [];
  const lang = String(file.language || 'text').toLowerCase();
  const path = String(file.path || file.name || '');
  const findings = [];

  for (const rule of RULES) {
    if (rule.languages && !rule.languages.includes(lang)) continue;
    rule.pattern.lastIndex = 0;
    const cap = rule.maxFindings || MAX_FINDINGS_PER_RULE;
    let m;
    let count = 0;
    while ((m = rule.pattern.exec(content)) !== null) {
      findings.push({
        ruleId: rule.id,
        severity: rule.severity,
        file: path,
        line: lineOf(content, m.index),
        snippet: snippetOf(content, m.index, m[0].length),
        messageAr: rule.messageAr,
        messageEn: rule.messageEn,
      });
      count += 1;
      if (rule.oncePerFile || count >= cap) break;
      if (m.index === rule.pattern.lastIndex) rule.pattern.lastIndex += 1; // zero-width guard
    }
  }
  return findings;
}

/**
 * Scans a whole project's files and computes an advisory score.
 * @param {{files: Array<{path?:string,name?:string,language?:string,content?:string}>}} project
 */
function scanProject(project) {
  const files = Array.isArray(project && project.files) ? project.files : [];
  let findings = [];
  for (const f of files) {
    findings = findings.concat(scanFile(f));
    if (findings.length >= MAX_FINDINGS_TOTAL) break;
  }
  findings = findings.slice(0, MAX_FINDINGS_TOTAL);
  findings.sort((a, b) => (SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]) || a.file.localeCompare(b.file) || a.line - b.line);

  const summary = { critical: 0, warning: 0, notice: 0, total: findings.length, filesScanned: files.length };
  let penalty = 0;
  for (const f of findings) {
    summary[f.severity] += 1;
    penalty += SEVERITY_PENALTY[f.severity];
  }
  const score = Math.max(0, 100 - penalty);
  const grade = score >= 90 ? 'A' : score >= 75 ? 'B' : score >= 55 ? 'C' : 'D';
  return { score, grade, summary, findings };
}

module.exports = { scanProject, scanFile, RULES, MAX_FILE_BYTES };
