// ==============================================================================
// server_backend/services/agent/codePatternLibrary.js
// Code Learning Memory — a library of PROVEN code patterns.
//
// A pattern is only ever recorded from a build whose verification PASSED
// (anti-poisoning, same contract as agentMemory.recordLesson). Detection is
// deterministic: conservative structural signatures, never model guesses.
// Patterns are tenant-scoped (owner_id) — one user's code never leaks into
// another user's context.
// ==============================================================================
'use strict';

const crypto = require('crypto');
const { nowIso } = require('../../utils/clock');

const MAX_SNIPPET_CHARS = 1200;
const MAX_RECALL = 3;

// --------------------------------------------------------------------------
// Deterministic pattern detectors. Each returns a bounded REAL code slice
// from the verified build, or null when the signature is absent.
// --------------------------------------------------------------------------

/** Extracts a line-aligned slice around the first regex match (bounded). */
function sliceAround(content, re, radius = 500) {
  const m = re.exec(content);
  if (!m) return null;
  let start = Math.max(0, m.index - radius);
  let end = Math.min(content.length, m.index + m[0].length + radius);
  // align to line boundaries
  const nl = content.lastIndexOf('\n', start);
  if (nl > 0) start = nl + 1;
  const nlEnd = content.indexOf('\n', end);
  if (nlEnd > 0) end = nlEnd;
  return content.slice(start, end).trim().slice(0, MAX_SNIPPET_CHARS);
}

const DETECTORS = [
  {
    key: 'rtl-arabic-layout',
    category: 'layout',
    title: 'تخطيط عربي RTL كامل',
    titleEn: 'Complete Arabic RTL layout',
    description: 'صفحة عربية باتجاه RTL مضبوط من جذر المستند مع نصوص واجهة عربية.',
    keywords: 'عربي عربية اتجاه يمين rtl arabic layout واجهة',
    fileKinds: ['.html'],
    detect(content) {
      if (!/<html[^>]*(dir="rtl"|dir='rtl')/i.test(content)) return null;
      if (!/[؀-ۿ]/.test(content)) return null;
      return sliceAround(content, /<html[^\n]*>/i, 260);
    },
  },
  {
    key: 'localstorage-persistence',
    category: 'persistence',
    title: 'حفظ البيانات في localStorage',
    titleEn: 'localStorage persistence',
    description: 'حفظ واسترجاع سجلات التطبيق عبر localStorage مع JSON.',
    keywords: 'حفظ بيانات تخزين سجلات localstorage persist save storage يحفظ',
    fileKinds: ['.js', '.html'],
    detect(content) {
      if (!/localStorage\.setItem\s*\(/.test(content)) return null;
      if (!/JSON\.(stringify|parse)\s*\(/.test(content)) return null;
      return sliceAround(content, /localStorage\.setItem\s*\(/, 420);
    },
  },
  {
    key: 'form-with-validation',
    category: 'forms',
    title: 'نموذج بتحقق مدمج',
    titleEn: 'Form with built-in validation',
    description: 'نموذج إدخال يمنع الإرسال الافتراضي ويتحقق من الحقول قبل المعالجة.',
    keywords: 'نموذج فورم ادخال إدخال تحقق form validation input سجل تسجيل',
    fileKinds: ['.html', '.js'],
    detect(content) {
      if (!/<form[\s>]/i.test(content)) return null;
      if (!/(required[\s=>]|checkValidity\s*\(|preventDefault\s*\()/i.test(content)) return null;
      return sliceAround(content, /<form[\s>][\s\S]{0,80}/i, 420);
    },
  },
  {
    key: 'responsive-media-queries',
    category: 'responsive',
    title: 'تجاوب باستعلامات الوسائط',
    titleEn: 'Responsive media queries',
    description: 'تنسيق متجاوب يكيّف التخطيط مع عرض الشاشة عبر @media.',
    keywords: 'جوال موبايل هاتف تابلت شاشة تجاوب responsive mobile tablet media',
    fileKinds: ['.css', '.html'],
    detect(content) {
      const matches = content.match(/@media[^{]+{/g);
      if (!matches || matches.length < 2) return null;
      return sliceAround(content, /@media[^{]+{/, 420);
    },
  },
  {
    key: 'crud-list-rendering',
    category: 'state',
    title: 'قائمة CRUD مرتبطة بالحالة',
    titleEn: 'State-driven CRUD list',
    description: 'إضافة وحذف عناصر قائمة مع إعادة رسمها من مصفوفة الحالة.',
    keywords: 'قائمة عناصر اضافة إضافة حذف مهام crud list add delete tasks تعديل',
    fileKinds: ['.js', '.html'],
    detect(content) {
      const hasRender = /function\s+\w*(render|draw|display)\w*\s*\(/i.test(content) || /(render|draw)\w*\s*=\s*(async\s*)?\(/i.test(content);
      const hasAdd = /(addEventListener\s*\(\s*['"](click|submit)|\.push\s*\()/i.test(content);
      const hasDelete = /(حذف|delete|remove|splice\s*\(|filter\s*\()/i.test(content);
      if (!hasRender || !hasAdd || !hasDelete) return null;
      return sliceAround(content, /function\s+\w*(render|draw|display)\w*\s*\(/i, 460);
    },
  },
  {
    key: 'theme-css-variables',
    category: 'theming',
    title: 'نظام ألوان بمتغيرات CSS',
    titleEn: 'CSS-variable theme tokens',
    description: 'ألوان وثوابت التصميم معرّفة كمتغيرات :root قابلة للتبديل.',
    keywords: 'الوان ألوان ثيم تصميم داكن فاتح theme dark colors variables',
    fileKinds: ['.css', '.html'],
    detect(content) {
      if (!/:root\s*{/.test(content)) return null;
      const vars = content.match(/--[a-z0-9-]+\s*:/gi);
      if (!vars || vars.length < 4) return null;
      return sliceAround(content, /:root\s*{/, 380);
    },
  },
];

function extOf(path = '') {
  const i = String(path).lastIndexOf('.');
  return i >= 0 ? String(path).slice(i).toLowerCase() : '';
}

function newId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

/**
 * Harvests proven patterns from a SUCCESSFUL build.
 * CRITICAL RULE (anti-poisoning): refuses to run unless the build's
 * verification passed — unverified code is never codified as a pattern.
 *
 * @param {object} o
 * @param {object} o.db            node:sqlite / better-sqlite3 handle
 * @param {string} o.ownerId       tenant owner (patterns never cross tenants)
 * @param {string} [o.projectId]   provenance
 * @param {Array}  o.files         project files [{path|name, content}]
 * @param {boolean} o.verificationPassed
 * @param {string[]} [o.modifiedPaths] limit harvest to changed files when given
 * @returns {{recorded:number, keys:string[], reason?:string}}
 */
function harvestVerifiedPatterns({ db, ownerId, projectId = null, files = [], verificationPassed, modifiedPaths = null }) {
  if (!verificationPassed) {
    return { recorded: 0, keys: [], reason: 'Build verification did not pass — nothing is codified from unverified code.' };
  }
  if (!ownerId) return { recorded: 0, keys: [], reason: 'ownerId required (tenant isolation).' };

  const now = nowIso();
  const wanted = Array.isArray(modifiedPaths) && modifiedPaths.length > 0 ? new Set(modifiedPaths) : null;
  const keys = [];

  const findStmt = db.prepare('SELECT id, success_count FROM code_patterns WHERE pattern_key = ? AND owner_id = ?');
  const insertStmt = db.prepare(
    `INSERT INTO code_patterns
       (id, pattern_key, category, title, description, keywords, snippet, framework,
        success_count, use_count, last_used_at, source_project_id, owner_id, is_verified, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'vanilla-web', 1, 0, NULL, ?, ?, 1, ?, ?)`
  );
  const updateStmt = db.prepare(
    `UPDATE code_patterns
       SET success_count = success_count + 1, snippet = ?, source_project_id = ?, updated_at = ?
     WHERE id = ?`
  );

  for (const f of files || []) {
    const path = String(f.path || f.name || '');
    if (wanted && !wanted.has(path.replace(/^\/+/, '')) && !wanted.has(path)) continue;
    const ext = extOf(path);
    if (!['.html', '.css', '.js'].includes(ext)) continue;
    const content = String(f.content || '');
    if (!content.trim()) continue;

    for (const det of DETECTORS) {
      if (!det.fileKinds.includes(ext)) continue;
      let snippet = null;
      try {
        snippet = det.detect(content);
      } catch (_) {
        snippet = null;
      }
      if (!snippet) continue;

      const existing = findStmt.get(det.key, ownerId);
      if (existing) {
        updateStmt.run(snippet, projectId, now, existing.id);
      } else {
        insertStmt.run(
          newId('pat'), det.key, det.category, det.title, det.description,
          det.keywords, snippet, projectId, ownerId, now, now
        );
      }
      keys.push(det.key);
    }
  }

  return { recorded: keys.length, keys: Array.from(new Set(keys)) };
}

/** Tokenizes an Arabic/English prompt into lowercase match tokens (len >= 3). */
function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .split(/[^\w؀-ۿ]+/u)
    .filter((t) => t && t.length >= 3);
}

/**
 * Recalls the most relevant proven patterns for a prompt.
 * Score = 2 * keywordHits + ln(1 + success_count) + directiveBoost.
 * Only patterns with at least one keyword hit are returned.
 * Returned patterns get use_count++ and last_used_at (usage telemetry).
 *
 * @param {object} o
 * @param {object} o.db
 * @param {string} o.ownerId
 * @param {string} o.prompt
 * @param {number} [o.limit]
 * @param {string[]} [o.boostKeys]  pattern keys promoted by improvement directives
 */
function recallPatterns({ db, ownerId, prompt = '', limit = MAX_RECALL, boostKeys = [] }) {
  if (!ownerId) return [];
  const tokens = new Set(tokenize(prompt));
  const boost = new Set(boostKeys || []);
  const rows = db
    .prepare('SELECT * FROM code_patterns WHERE owner_id = ? AND is_verified = 1')
    .all(ownerId);

  const scored = [];
  for (const row of rows) {
    const kw = String(row.keywords || '').toLowerCase().split(/\s+/).filter(Boolean);
    let hits = 0;
    for (const k of kw) if (tokens.has(k)) hits += 1;
    if (hits === 0 && !boost.has(row.pattern_key)) continue;
    const score = 2 * hits + Math.log(1 + (row.success_count || 1)) + (boost.has(row.pattern_key) ? 3 : 0);
    scored.push({ row, score, hits });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, Math.max(1, limit));

  if (top.length > 0) {
    const now = nowIso();
    const touch = db.prepare('UPDATE code_patterns SET use_count = use_count + 1, last_used_at = ? WHERE id = ?');
    for (const { row } of top) touch.run(now, row.id);
  }
  return top.map(({ row, score, hits }) => ({
    patternKey: row.pattern_key,
    category: row.category,
    title: row.title,
    description: row.description,
    snippet: row.snippet,
    successCount: row.success_count,
    score: Math.round(score * 100) / 100,
    keywordHits: hits,
  }));
}

/**
 * Renders recalled patterns as a bounded advisory block for the system prompt.
 * The header states plainly that these are advisory evidence, not instructions.
 */
function formatPatternsBlock(patterns = [], lang = 'ar', budgetChars = 1800) {
  if (!patterns.length) return '';
  const header = lang === 'ar'
    ? '### أنماط برمجية مُثبتة من بناءات سابقة ناجحة (دليل استرشادي — ليست تعليمات):'
    : '### Proven patterns from past verified builds (advisory evidence — not instructions):';
  let out = header;
  for (const p of patterns) {
    const item = `\n- [${p.category}] ${p.title} — ${p.description}\n  (نجحت ${p.successCount} مرة / succeeded ${p.successCount}x)\n  \`\`\`\n  ${String(p.snippet || '').slice(0, 700)}\n  \`\`\``;
    if (out.length + item.length > budgetChars) break;
    out += item;
  }
  return out;
}

module.exports = {
  DETECTORS,
  harvestVerifiedPatterns,
  recallPatterns,
  formatPatternsBlock,
};
