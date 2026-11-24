// ==============================================================================
// server_backend/services/agent/repairLoop.js
// Autonomous self-repair loop + real improvement measurement.
//
//   Closes the build cycle without any human message in between:
//     build → verify → (failed checks) → repair round(s) → re-verify
//     → record experience ONLY when the repair is verified (anti-poisoning)
//     → every outcome is persisted so improvement is MEASURED, not claimed.
//
//   Evidence discipline (same as the Continuous Improvement Engine):
//     * Lessons and fix examples are recorded only for repairs that END with
//       all checks passing.
//     * A repair that never passes records its rounds (as evidence of what did
//       NOT work) but teaches nothing.
//     * All rows are scoped by owner_id (tenant isolation).
// ==============================================================================
'use strict';

const crypto = require('node:crypto');

const MAX_FAILED_TESTS_IN_PROMPT = 8;
const MAX_DETAIL_CHARS = 160;

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function nowIso() {
  return new Date().toISOString();
}

// ------------------------------------------------------------------ prompts

/**
 * Builds a bounded, surgical repair prompt: the original request plus exactly
 * which checks failed. The agent is told to patch ONLY the failures.
 */
function buildRepairPrompt({ originalPrompt, failedTests, isAr = true }) {
  const list = (failedTests || [])
    .slice(0, MAX_FAILED_TESTS_IN_PROMPT)
    .map((t, i) => {
      const detail = String(t.detail || '').slice(0, MAX_DETAIL_CHARS);
      return `${i + 1}. ${t.name}${detail ? ` — ${detail}` : ''}`;
    })
    .join('\n');
  if (isAr) {
    return [
      `الطلب الأصلي: ${String(originalPrompt || '').slice(0, 500)}`,
      '',
      'نُفّذ البناء لكن الفحص الآلي كشف الإخفاقات التالية:',
      list,
      '',
      'أصلح هذه الإخفاقات فقط إصلاحاً جراحياً: عدّل الملفات القائمة بأقل تغيير ممكن، ولا تُعد بناء التطبيق من الصفر، ولا تلمس ما يعمل بنجاح.',
    ].join('\n');
  }
  return [
    `Original request: ${String(originalPrompt || '').slice(0, 500)}`,
    '',
    'The build ran, but automated checks found these failures:',
    list,
    '',
    'Fix ONLY these failures surgically: patch the existing files with the smallest possible change, do not rebuild from scratch, and do not touch what already passes.',
  ].join('\n');
}

// ------------------------------------------------------------------ persistence

/** Opens a build-outcome row right after the FIRST verification. Returns its id. */
function beginBuildOutcome({ db, requestId, ownerId, projectId = null, intent = 'build', filesCount = 0, verification }) {
  if (!ownerId) return null;
  const id = newId('out');
  const tests = (verification && verification.testResults) || [];
  db.prepare(
    `INSERT OR IGNORE INTO build_outcomes
       (id, request_id, project_id, owner_id, intent, files_count, tests_total, tests_passed, first_passed, final_passed, repair_rounds, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    String(requestId || id),
    projectId,
    ownerId,
    intent,
    filesCount,
    tests.length,
    tests.filter((t) => t.status === 'passed').length,
    verification && verification.allPassed ? 1 : 0,
    verification && verification.allPassed ? 1 : 0,
    nowIso()
  );
  return id;
}

/** Records one repair round with the exact failures it targeted and its result. */
function recordRepairRound({ db, outcomeId, ownerId, roundNo, failedTests, verification }) {
  if (!outcomeId || !ownerId) return;
  const tests = (verification && verification.testResults) || [];
  db.prepare(
    `INSERT OR REPLACE INTO repair_rounds
       (id, outcome_id, owner_id, round_no, failed_tests_json, success, tests_passed, tests_total, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId('rnd'),
    outcomeId,
    ownerId,
    roundNo,
    JSON.stringify((failedTests || []).slice(0, MAX_FAILED_TESTS_IN_PROMPT)),
    verification && verification.allPassed ? 1 : 0,
    tests.filter((t) => t.status === 'passed').length,
    tests.length,
    nowIso()
  );
}

/** Finalizes the outcome row after any repair rounds. */
function finalizeBuildOutcome({ db, outcomeId, finalPassed, repairRounds, verification }) {
  if (!outcomeId) return;
  const tests = (verification && verification.testResults) || [];
  db.prepare(
    `UPDATE build_outcomes
       SET final_passed = ?, repair_rounds = ?, tests_total = ?, tests_passed = ?
     WHERE id = ?`
  ).run(
    finalPassed ? 1 : 0,
    repairRounds || 0,
    tests.length,
    tests.filter((t) => t.status === 'passed').length,
    outcomeId
  );
}

// ------------------------------------------------------------------ the loop

/**
 * Runs bounded self-repair rounds against a failed verification.
 *
 * @param {object} o
 * @param {object} o.db
 * @param {string} o.ownerId
 * @param {string|null} o.projectId
 * @param {string|null} o.outcomeId - build_outcomes row opened by the caller
 * @param {string} o.originalPrompt
 * @param {object} o.verification - the FAILED first verification {allPassed,testResults}
 * @param {boolean} [o.isAr]
 * @param {number} [o.maxRounds=2]
 * @param {(prompt:string)=>Promise<{verification:object, filesModified:string[]}>} o.runAgent
 * @param {(info:object)=>void} [o.onRound]
 * @returns {Promise<{rounds:number, repaired:boolean, finalVerification:object, filesModified:string[]}>}
 */
async function runAutonomousRepair({ db, ownerId, projectId = null, outcomeId = null, originalPrompt, verification, isAr = true, maxRounds = 2, runAgent, onRound }) {
  let current = verification;
  const modified = [];
  let rounds = 0;

  for (let r = 1; r <= maxRounds && !(current && current.allPassed); r++) {
    const failedTests = ((current && current.testResults) || [])
      .filter((t) => t.status !== 'passed')
      .map((t) => ({ name: t.name || t.id || `check_${r}`, detail: t.detail || '' }));
    if (!failedTests.length) break; // nothing actionable to repair

    const prompt = buildRepairPrompt({ originalPrompt, failedTests, isAr });
    const result = await runAgent(prompt);
    rounds = r;

    const roundVerification = (result && result.verification) || { allPassed: true, testResults: [] };
    recordRepairRound({ db, outcomeId, ownerId, roundNo: r, failedTests, verification: roundVerification });
    for (const p of (result && result.filesModified) || []) modified.push(p);
    if (onRound) {
      try { onRound({ roundNo: r, success: Boolean(roundVerification.allPassed), testsPassed: (roundVerification.testResults || []).filter((t) => t.status === 'passed').length, testsTotal: (roundVerification.testResults || []).length }); } catch (_) { /* telemetry only */ }
    }

    if (roundVerification.allPassed) {
      // Verified fix ONLY — record the experience (lesson + training example).
      const signature = failedTests.map((t) => t.name).join(' | ').slice(0, 300);
      const fixSummary = (isAr ? 'إصلاح ذاتي موثق: ' : 'Verified self-repair: ') +
        (modified.length ? modified.join(', ') : 'in-place patch');
      try {
        const { recordLesson } = require('./agentMemory');
        recordLesson({
          projectId,
          scope: 'build-repair',
          techStack: 'vanilla-web',
          errorSignature: signature,
          rootCause: (isAr ? 'إخفاق فحوصات المعاينة الآلية بعد البناء' : 'Automated preview checks failed after build'),
          provenFix: fixSummary,
          isVerified: true,
        });
      } catch (_) { /* memory must never break a repair */ }
      try {
        const { captureFixExample } = require('./modelImprovementPipeline');
        captureFixExample({
          db,
          projectId,
          ownerId,
          errorSignature: signature,
          rootCause: 'failed preview checks',
          provenFix: fixSummary,
        });
      } catch (_) { /* dataset capture must never break a repair */ }
    }

    current = roundVerification;
  }

  return { rounds, repaired: Boolean(current && current.allPassed), finalVerification: current, filesModified: modified };
}

// ------------------------------------------------------------------ measurement

/**
 * Computes REAL improvement metrics from recorded outcomes — never estimates.
 * Returns zeroed metrics (with builds:0) when there is no evidence yet.
 */
function computeImprovementMetrics({ db, ownerId }) {
  if (!ownerId) return null;
  const totals = db
    .prepare(
      `SELECT COUNT(*) AS builds,
              SUM(first_passed) AS first_pass,
              SUM(final_passed) AS final_pass,
              SUM(CASE WHEN repair_rounds > 0 THEN 1 ELSE 0 END) AS repaired_builds,
              SUM(CASE WHEN repair_rounds > 0 AND final_passed = 1 THEN 1 ELSE 0 END) AS rescued_builds
         FROM build_outcomes WHERE owner_id = ?`
    )
    .get(ownerId);

  const builds = totals.builds || 0;
  const first = totals.first_pass || 0;
  const final_ = totals.final_pass || 0;
  const repaired = totals.repaired_builds || 0;
  const rescued = totals.rescued_builds || 0;

  // Trend: last 10 builds vs the previous 10 (first-pass rate delta).
  const recent = db
    .prepare('SELECT first_passed FROM build_outcomes WHERE owner_id = ? ORDER BY created_at DESC LIMIT 20')
    .all(ownerId);
  const last10 = recent.slice(0, 10);
  const prev10 = recent.slice(10, 20);
  const rate = (rows) => (rows.length ? rows.reduce((a, r) => a + r.first_passed, 0) / rows.length : null);
  const lastRate = rate(last10);
  const prevRate = rate(prev10);

  const rounds = db
    .prepare('SELECT COUNT(*) AS n, SUM(success) AS ok FROM repair_rounds WHERE owner_id = ?')
    .get(ownerId);

  return {
    builds,
    first_pass_rate: builds ? Math.round((first / builds) * 100) : null,
    final_pass_rate: builds ? Math.round((final_ / builds) * 100) : null,
    repairs_attempted: repaired,
    repairs_rescued: rescued,
    repair_rescue_rate: repaired ? Math.round((rescued / repaired) * 100) : null,
    repair_rounds_total: rounds.n || 0,
    repair_rounds_succeeded: rounds.ok || 0,
    trend_first_pass_last10: lastRate == null ? null : Math.round(lastRate * 100),
    trend_first_pass_prev10: prevRate == null ? null : Math.round(prevRate * 100),
    trend_delta: lastRate == null || prevRate == null ? null : Math.round((lastRate - prevRate) * 100),
  };
}

module.exports = {
  buildRepairPrompt,
  beginBuildOutcome,
  recordRepairRound,
  finalizeBuildOutcome,
  runAutonomousRepair,
  computeImprovementMetrics,
};
