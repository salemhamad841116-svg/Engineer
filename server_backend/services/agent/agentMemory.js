// ==============================================================================
// Persistent Agent Memory & Lesson Learning Service
// Retains verified bug fixes, distinguishes general vs project-specific lessons,
// recalls proven solutions on recurring errors, and strictly prevents false learning.
// ==============================================================================

const crypto = require('crypto');
const { get, run, all } = require('../../db/database');
const { nowIso } = require('../../utils/clock');

/**
 * Normalizes error strings into a clean semantic signature for pattern matching.
 */
function normalizeErrorSignature(rawError = '') {
  return String(rawError)
    .replace(/^[A-Za-z]+Error:\s*/i, '')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[^\s]*/g, '<TIMESTAMP>')
    .replace(/(:\d+:\d+)/g, ':<LINE>:<COL>')
    .replace(/'[^']+'/g, "'<IDENTIFIER>'")
    .replace(/"[^"]+"/g, '"<IDENTIFIER>"')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 250);
}

/**
 * Records a proven lesson into permanent SQLite storage.
 * CRITICAL RULE: Rejects unverified fixes to prevent memory poisoning.
 */
function recordLesson({
  projectId = null,
  scope = 'general',
  techStack = 'universal',
  errorSignature = '',
  rootCause = '',
  provenFix = '',
  codeBefore = '',
  codeAfter = '',
  isVerified = false,
}) {
  // Anti-Poisoning Protection: Never codify an unverified fix as a lesson
  if (!isVerified) {
    console.warn('[agentMemory] ⚠️ Refused to record lesson: fix was not verified by tests.');
    return {
      recorded: false,
      reason: 'Fix must pass all tests and verification before being codified into memory.',
    };
  }

  const cleanSignature = normalizeErrorSignature(errorSignature);
  if (!cleanSignature) {
    return { recorded: false, reason: 'Empty error signature' };
  }

  const now = nowIso();

  // Check if identical signature already exists for this scope & project
  const existing = get(
    `SELECT * FROM agent_memory_lessons 
     WHERE error_signature = ? AND scope = ? AND (project_id = ? OR (project_id IS NULL AND ? IS NULL))`,
    cleanSignature,
    scope,
    projectId,
    projectId
  );

  if (existing) {
    const existingFix = existing.proven_fix || existing.verified_solution || '';
    const isConflict = existingFix && provenFix && existingFix.trim() !== provenFix.trim();

    if (isConflict) {
      // Conflict detection: Never silently overwrite!
      const conflictMsg = `[${now}] تعارض حل: الحل المحفوظ سابقاً ("${existingFix.slice(0, 50)}...") يتعارض مع الحل الوارد الجديد ("${provenFix.slice(0, 50)}...")`;
      run(
        `UPDATE agent_memory_lessons 
         SET has_conflict = 1, conflict_notes = COALESCE(conflict_notes || '\n', '') || ?, updated_at = ? 
         WHERE id = ?`,
        conflictMsg,
        now,
        existing.id
      );

      return {
        recorded: true,
        hasConflict: true,
        conflictRecorded: true,
        lessonId: existing.id,
        reason: 'تم تسجيل تعارض مع حل سابق محفوظ ولم يتم الاستبدال بصمت.',
        existingFix,
        incomingFix: provenFix,
      };
    }

    run(
      `UPDATE agent_memory_lessons 
       SET usage_count = usage_count + 1, code_after = ?, updated_at = ?, last_recalled_at = ? 
       WHERE id = ?`,
      codeAfter,
      now,
      now,
      existing.id
    );
    return {
      recorded: true,
      lessonId: existing.id,
      updated: true,
      hasConflict: false,
      usageCount: existing.usage_count + 1,
    };
  }

  // verified_solution is the legacy NOT NULL column from the original schema;
  // proven_fix is its modern successor. Both are written with the same content
  // so old and new readers stay consistent (schema drift repair, Phase CI).
  const lessonId = 'lsn_' + crypto.randomUUID();
  run(
    `INSERT INTO agent_memory_lessons
     (id, project_id, scope, tech_stack, error_signature, root_cause, verified_solution, proven_fix, code_before, code_after, verification_status, usage_count, has_conflict, is_cold, created_at, updated_at, last_recalled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', 1, 0, 0, ?, ?, ?)`,
    lessonId,
    projectId,
    scope,
    techStack,
    cleanSignature,
    rootCause,
    provenFix,
    provenFix,
    codeBefore,
    codeAfter,
    now,
    now,
    now
  );

  return {
    recorded: true,
    lessonId,
    scope,
    signature: cleanSignature,
    hasConflict: false,
  };
}

/**
 * Assesses lesson age and marks cold if not recalled in 90 days.
 */
function assessLessonFreshness(lesson, baseConfidence) {
  if (!lesson) return null;
  const refTime = new Date(lesson.last_recalled_at || lesson.updated_at || lesson.created_at).getTime();
  const daysSince = (Date.now() - refTime) / (1000 * 60 * 60 * 24);
  const isCold = daysSince > 90 || lesson.is_cold === 1;

  if (isCold) {
    run("UPDATE agent_memory_lessons SET is_cold = 1 WHERE id = ?", lesson.id);
    return {
      isCold: true,
      confidence: 0.4, // Degraded confidence for cold lessons
      lesson: { ...lesson, is_cold: 1 },
    };
  }

  run("UPDATE agent_memory_lessons SET last_recalled_at = ? WHERE id = ?", nowIso(), lesson.id);
  return {
    isCold: false,
    confidence: baseConfidence,
    lesson: { ...lesson, is_cold: 0 },
  };
}

/**
 * Recalls past proven fix matching an incoming error.
 * Prioritizes project-specific lessons first, then general tech lessons.
 */
function recallLesson({ projectId = null, rawError = '', techStack = 'universal' }) {
  const cleanSignature = normalizeErrorSignature(rawError);
  if (!cleanSignature) return null;

  // 1. Exact signature match on project-specific lessons
  if (projectId) {
    const projectLesson = get(
      `SELECT * FROM agent_memory_lessons 
       WHERE project_id = ? AND scope = 'project' AND error_signature = ? AND verification_status = 'verified' 
       ORDER BY usage_count DESC LIMIT 1`,
      projectId,
      cleanSignature
    );
    if (projectLesson) {
      const freshness = assessLessonFreshness(projectLesson, 1.0);
      return {
        matched: true,
        source: 'project_memory',
        confidence: freshness.confidence,
        isCold: freshness.isCold,
        lesson: freshness.lesson,
      };
    }
  }

  // 2. Exact signature match on general lessons
  const generalExact = get(
    `SELECT * FROM agent_memory_lessons 
     WHERE scope = 'general' AND error_signature = ? AND verification_status = 'verified' 
     ORDER BY usage_count DESC LIMIT 1`,
    cleanSignature
  );
  if (generalExact) {
    const freshness = assessLessonFreshness(generalExact, 0.95);
    return {
      matched: true,
      source: 'general_tech_memory',
      confidence: freshness.confidence,
      isCold: freshness.isCold,
      lesson: freshness.lesson,
    };
  }

  // 3. Keyword / Root cause similarity match
  const keywords = cleanSignature.split(' ').filter((w) => w.length > 4 && !w.startsWith('<'));
  for (const kw of keywords) {
    const fuzzy = get(
      `SELECT * FROM agent_memory_lessons 
       WHERE error_signature LIKE ? AND verification_status = 'verified' 
       ORDER BY usage_count DESC LIMIT 1`,
      `%${kw}%`
    );
    if (fuzzy) {
      const freshness = assessLessonFreshness(fuzzy, 0.75);
      return {
        matched: true,
        source: fuzzy.scope === 'project' ? 'project_memory_fuzzy' : 'general_memory_fuzzy',
        confidence: freshness.confidence,
        isCold: freshness.isCold,
        lesson: freshness.lesson,
      };
    }
  }

  return null;
}

/**
 * Lists stored lessons with optional project and scope filter.
 */
function listLessons({ projectId = null, scope = null, limit = 50 } = {}) {
  let query = 'SELECT * FROM agent_memory_lessons WHERE 1=1';
  const params = [];

  if (projectId) {
    query += ' AND (project_id = ? OR scope = "general")';
    params.push(projectId);
  }
  if (scope) {
    query += ' AND scope = ?';
    params.push(scope);
  }

  query += ' ORDER BY usage_count DESC, updated_at DESC LIMIT ?';
  params.push(limit);

  return all(query, ...params);
}

/**
 * Seeds initial general verified lessons for common web/node development pitfalls.
 */
function seedInitialLessons() {
  const count = get('SELECT COUNT(*) as c FROM agent_memory_lessons')?.c || 0;
  if (count > 0) return;

  const seeds = [
    {
      scope: 'general',
      techStack: 'javascript-dom',
      errorSignature: 'Cannot read properties of null (reading <IDENTIFIER>)',
      rootCause: 'DOM element querySelector returned null because the DOM was not loaded yet.',
      provenFix: 'Wrap DOM query logic in document.addEventListener("DOMContentLoaded", () => { ... }) and check if (el) exists.',
      codeBefore: 'const btn = document.getElementById("my-btn"); btn.onclick = ...;',
      codeAfter: 'document.addEventListener("DOMContentLoaded", () => { const btn = document.getElementById("my-btn"); if (btn) btn.onclick = ...; });',
      isVerified: true,
    },
    {
      scope: 'general',
      techStack: 'typescript-react',
      errorSignature: 'Type <IDENTIFIER> is not assignable to type <IDENTIFIER>',
      rootCause: 'Type mismatch between assigned variable and explicit TypeScript interface contract.',
      provenFix: 'Align interface properties or cast with unknown if mapping polymorphic payload.',
      codeBefore: 'const item: UserItem = response.data;',
      codeAfter: 'const item: UserItem = (response.data as unknown) as UserItem;',
      isVerified: true,
    },
    {
      scope: 'general',
      techStack: 'node-json',
      errorSignature: 'Unexpected token in JSON at position <LINE>:<COL>',
      rootCause: 'Attempting to JSON.parse an empty string or malformed HTTP response body.',
      provenFix: 'Safely guard JSON.parse with a try/catch block and provide a fallback default object.',
      codeBefore: 'const data = JSON.parse(str);',
      codeAfter: 'let data = {}; try { data = JSON.parse(str); } catch (_) { data = {}; }',
      isVerified: true,
    },
  ];

  for (const s of seeds) {
    recordLesson(s);
  }
}

// Ensure default seeds exist
try {
  seedInitialLessons();
} catch (_) {}

module.exports = {
  recordLesson,
  recallLesson,
  listLessons,
  normalizeErrorSignature,
  seedInitialLessons,
};
