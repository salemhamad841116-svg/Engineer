// ==============================================================================
// server_backend/services/agent/improvementEngine.js
// Autonomous Continuous Improvement Engine.
//
// Closes the learning loop across builds:
//   verified builds  → code_patterns (codePatternLibrary)
//   verified fixes   → agent_memory_lessons (agentMemory)
//   evaluations      → engineering_evaluations
//        ↓ recomputeDirectives (deterministic rules, evidence-based)
//   improvement_directives (advisory, tenant-scoped)
//        ↓ buildLearningContext
//   next build's system prompt gets proven patterns + active directives
//
// Everything here is deterministic and auditable: a directive exists only
// while its evidence meets the threshold; when the evidence drops, the
// directive deactivates itself. No silent self-modification.
// ==============================================================================
'use strict';

const crypto = require('crypto');
const { nowIso } = require('../../utils/clock');
const { recallPatterns, formatPatternsBlock } = require('./codePatternLibrary');

const RECURRING_ERROR_MIN_USES = 3;   // lesson recalled 3+ times → directive
const PREFERRED_PATTERN_MIN_SUCCESS = 3; // pattern proven in 3+ builds → directive
const STABILITY_WINDOW = 20;          // last N evaluations examined
const STABILITY_MIN_PASS_RATE = 90;   // below this % → stability watch
const RECOMPUTE_THROTTLE_MS = 10 * 60 * 1000; // at most once per 10 min per owner
const MAX_CONTEXT_CHARS = 2600;

// module-level throttle ledger (per process) — recompute is idempotent anyway
const lastRecomputeAt = new Map();

function newId(prefix) {
  return prefix + '_' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function upsertDirective(db, { key, ownerId, kind, title, body, boostKeys = '', evidence = {}, confidence = 0.5 }) {
  const now = nowIso();
  const existing = db
    .prepare('SELECT id FROM improvement_directives WHERE directive_key = ? AND owner_id = ?')
    .get(key, ownerId);
  if (existing) {
    db.prepare(
      `UPDATE improvement_directives
         SET kind = ?, title = ?, body = ?, boost_keys = ?, evidence_json = ?, confidence = ?, active = 1, updated_at = ?
       WHERE id = ?`
    ).run(kind, title, body, boostKeys, JSON.stringify(evidence), confidence, now, existing.id);
    return existing.id;
  }
  const id = newId('dir');
  db.prepare(
    `INSERT INTO improvement_directives
       (id, directive_key, owner_id, kind, title, body, boost_keys, evidence_json, confidence, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).run(id, key, ownerId, kind, title, body, boostKeys, JSON.stringify(evidence), confidence, now, now);
  return id;
}

function deactivateDirective(db, { key, ownerId }) {
  db.prepare(
    'UPDATE improvement_directives SET active = 0, updated_at = ? WHERE directive_key = ? AND owner_id = ?'
  ).run(nowIso(), key, ownerId);
}

/**
 * Recomputes improvement directives from accumulated evidence (tenant-scoped).
 * Deterministic rules:
 *   1. Lessons recalled RECURRING_ERROR_MIN_USES+ times → recurring_error directive.
 *   2. Patterns proven in PREFERRED_PATTERN_MIN_SUCCESS+ builds → preferred_pattern
 *      directive that BOOSTS that pattern in future recalls (closed loop).
 *   3. Average test pass rate over the last STABILITY_WINDOW evaluations below
 *      STABILITY_MIN_PASS_RATE → stability_watch directive.
 * Directives whose evidence no longer qualifies are deactivated.
 *
 * @returns {{active:number, deactivated:number, kinds:Object}}
 */
function recomputeDirectives({ db, ownerId }) {
  if (!ownerId) return { active: 0, deactivated: 0, kinds: {} };
  let activated = 0;
  let deactivated = 0;
  const kinds = {};

  // ---- Rule 1: recurring errors with proven fixes (from agent memory)
  const recurringLessons = db
    .prepare(
      `SELECT id, error_signature, root_cause, proven_fix, usage_count
         FROM agent_memory_lessons
        WHERE COALESCE(usage_count, 0) >= ?
        ORDER BY usage_count DESC
        LIMIT 5`
    )
    .all(RECURRING_ERROR_MIN_USES);
  const seenRecurring = new Set();
  for (const les of recurringLessons) {
    const key = 'recurring-error:' + les.id;
    seenRecurring.add(key);
    upsertDirective(db, {
      key,
      ownerId,
      kind: 'recurring_error',
      title: 'خطأ متكرر له حل مُثبت',
      body: `إن ظهر خطأ مشابه لـ "${String(les.error_signature).slice(0, 120)}" فالحل المُثبت: ${String(les.proven_fix || les.root_cause || '').slice(0, 300)}`,
      evidence: { lessonId: les.id, usageCount: les.usage_count, signature: String(les.error_signature).slice(0, 160) },
      confidence: Math.min(0.95, 0.6 + 0.05 * (les.usage_count || 0)),
    });
    activated += 1;
    kinds.recurring_error = (kinds.recurring_error || 0) + 1;
  }
  // deactivate stale recurring-error directives
  const staleRecurring = db
    .prepare("SELECT directive_key FROM improvement_directives WHERE owner_id = ? AND kind = 'recurring_error' AND active = 1")
    .all(ownerId);
  for (const row of staleRecurring) {
    if (!seenRecurring.has(row.directive_key)) {
      deactivateDirective(db, { key: row.directive_key, ownerId });
      deactivated += 1;
    }
  }

  // ---- Rule 2: preferred patterns (closed-loop boost)
  const provenPatterns = db
    .prepare(
      `SELECT pattern_key, title, success_count
         FROM code_patterns
        WHERE owner_id = ? AND is_verified = 1 AND success_count >= ?
        ORDER BY success_count DESC
        LIMIT 5`
    )
    .all(ownerId, PREFERRED_PATTERN_MIN_SUCCESS);
  const seenPreferred = new Set();
  for (const pat of provenPatterns) {
    const key = 'preferred-pattern:' + pat.pattern_key;
    seenPreferred.add(key);
    upsertDirective(db, {
      key,
      ownerId,
      kind: 'preferred_pattern',
      title: `نمط مفضّل: ${pat.title}`,
      body: `النمط "${pat.title}" أثبت نجاحه في ${pat.success_count} بناءات مُتحققة — فضّله عند ملاءمته للطلب.`,
      boostKeys: pat.pattern_key,
      evidence: { patternKey: pat.pattern_key, successCount: pat.success_count },
      confidence: Math.min(0.95, 0.55 + 0.08 * (pat.success_count || 0)),
    });
    activated += 1;
    kinds.preferred_pattern = (kinds.preferred_pattern || 0) + 1;
  }
  const stalePreferred = db
    .prepare("SELECT directive_key FROM improvement_directives WHERE owner_id = ? AND kind = 'preferred_pattern' AND active = 1")
    .all(ownerId);
  for (const row of stalePreferred) {
    if (!seenPreferred.has(row.directive_key)) {
      deactivateDirective(db, { key: row.directive_key, ownerId });
      deactivated += 1;
    }
  }

  // ---- Rule 3: stability watch from engineering evaluations
  const evals = db
    .prepare(
      `SELECT test_pass_rate FROM engineering_evaluations
        ORDER BY created_at DESC LIMIT ?`
    )
    .all(STABILITY_WINDOW);
  const stabilityKey = 'global:stability-watch';
  if (evals.length >= 5) {
    const avg = evals.reduce((s, e) => s + (e.test_pass_rate || 0), 0) / evals.length;
    if (avg < STABILITY_MIN_PASS_RATE) {
      upsertDirective(db, {
        key: stabilityKey,
        ownerId,
        kind: 'stability_watch',
        title: 'مراقبة استقرار الجودة',
        body: `متوسط نجاح الاختبارات في آخر ${evals.length} تقييماً ${Math.round(avg)}% (أقل من ${STABILITY_MIN_PASS_RATE}%) — زد صرامة التحقق قبل إعلان الإنجاز.`,
        evidence: { window: evals.length, avgPassRate: Math.round(avg * 100) / 100 },
        confidence: 0.7,
      });
      activated += 1;
      kinds.stability_watch = 1;
    } else {
      const existing = db
        .prepare('SELECT active FROM improvement_directives WHERE directive_key = ? AND owner_id = ?')
        .get(stabilityKey, ownerId);
      if (existing && existing.active) {
        deactivateDirective(db, { key: stabilityKey, ownerId });
        deactivated += 1;
      }
    }
  }

  return { active: activated, deactivated, kinds };
}

/** Throttled recompute — at most once per RECOMPUTE_THROTTLE_MS per owner. */
function maybeRecompute({ db, ownerId, force = false }) {
  const now = Date.now();
  const last = lastRecomputeAt.get(ownerId) || 0;
  if (!force && now - last < RECOMPUTE_THROTTLE_MS) {
    return { skipped: true, reason: 'throttled' };
  }
  lastRecomputeAt.set(ownerId, now);
  return recomputeDirectives({ db, ownerId });
}

/** Active directives for an owner, highest confidence first. */
function activeDirectives({ db, ownerId, limit = 5 }) {
  if (!ownerId) return [];
  return db
    .prepare(
      `SELECT directive_key, kind, title, body, boost_keys, confidence
         FROM improvement_directives
        WHERE owner_id = ? AND active = 1
        ORDER BY confidence DESC, updated_at DESC
        LIMIT ?`
    )
    .all(ownerId, limit)
    .map((d) => ({
      key: d.directive_key,
      kind: d.kind,
      title: d.title,
      body: d.body,
      boostKeys: String(d.boost_keys || '').split(/\s+/).filter(Boolean),
      confidence: d.confidence,
    }));
}

/**
 * The single entry point used by the engineer agent before every build:
 * returns a bounded advisory context block combining proven patterns and
 * active improvement directives. Returns '' when there is nothing useful —
 * an empty learning context is a normal state, never an error.
 */
function buildLearningContext({ db, ownerId, prompt = '', lang = 'ar' }) {
  if (!db || !ownerId) return '';
  const directives = activeDirectives({ db, ownerId });
  const boostKeys = directives.flatMap((d) => d.boostKeys);
  const patterns = recallPatterns({ db, ownerId, prompt, boostKeys });

  let block = '';
  if (directives.length > 0) {
    const header = lang === 'ar'
      ? '### توجيهات تحسين مستمدة من أدلة متراكمة (استرشادية):'
      : '### Improvement directives derived from accumulated evidence (advisory):';
    block += header;
    for (const d of directives) {
      block += `\n- (${Math.round(d.confidence * 100)}%) ${d.body}`;
    }
  }
  const patternsBlock = formatPatternsBlock(patterns, lang, MAX_CONTEXT_CHARS - block.length - 100);
  if (patternsBlock) {
    block += (block ? '\n\n' : '') + patternsBlock;
  }
  return block.slice(0, MAX_CONTEXT_CHARS);
}

/**
 * The single post-build learning hook, called from the orchestration layer
 * (where the deterministic generator and the agent loop converge). Order and
 * discipline:
 *   1. harvest proven patterns — VERIFIED builds only (anti-poisoning),
 *   2. capture a dataset candidate — VERIFIED, non-empty builds only,
 *   3. recompute directives (throttled).
 * Every step is isolated: a learning failure can never break a build.
 *
 * @returns {{patterns:number, patternKeys:string[], datasetCaptured:boolean, directives:object|null}}
 */
function learnFromVerifiedBuild({ db, ownerId, projectId = null, prompt = '', filesModified = [], files = [], verification = null }) {
  const report = { patterns: 0, patternKeys: [], datasetCaptured: false, directives: null };
  if (!db || !ownerId || !Array.isArray(filesModified) || filesModified.length === 0) {
    return report; // a no-op build teaches nothing
  }
  try {
    const { harvestVerifiedPatterns } = require('./codePatternLibrary');
    const { captureBuildExample } = require('./modelImprovementPipeline');
    if (verification && verification.allPassed === true) {
      const harvest = harvestVerifiedPatterns({
        db,
        ownerId,
        projectId,
        files,
        verificationPassed: true,
        modifiedPaths: filesModified,
      });
      report.patterns = harvest.recorded;
      report.patternKeys = harvest.keys;
      const captured = captureBuildExample({
        db,
        projectId,
        ownerId,
        prompt,
        filesModified,
        files,
        verification,
      });
      report.datasetCaptured = captured.captured === true;
    }
  } catch (_) { /* learning capture must never break a build */ }
  try {
    report.directives = maybeRecompute({ db, ownerId });
  } catch (_) { /* directives are advisory; never fatal */ }
  return report;
}

module.exports = {
  recomputeDirectives,
  maybeRecompute,
  activeDirectives,
  buildLearningContext,
  learnFromVerifiedBuild,
  // exported for tests
  RECURRING_ERROR_MIN_USES,
  PREFERRED_PATTERN_MIN_SUCCESS,
  STABILITY_MIN_PASS_RATE,
};
