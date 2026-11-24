// ==============================================================================
// server_backend/tests/autonomousRepairSuite.test.js
// Autonomous Self-Repair Loop & Real Improvement Measurement — 10 tests.
//
//   Proves the closed cycle: build → verify fails → repair rounds → re-verify
//   → experience recorded ONLY for verified repairs (anti-poisoning)
//   → every outcome persisted → metrics computed from real rows, never claimed.
// ==============================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');

const TEST_DB = path.join(__dirname, 'test_autonomous_repair.db');
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
  try { fs.unlinkSync(f); } catch (_) { /* fresh */ }
}
process.env.DB_PATH = TEST_DB;

const { getDb, closeDb } = require('../db/database');
const {
  buildRepairPrompt,
  beginBuildOutcome,
  finalizeBuildOutcome,
  runAutonomousRepair,
  computeImprovementMetrics,
} = require('../services/agent/repairLoop');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push(`${name}: ${e.message}`);
    console.log(`❌ ${name}\n   ${e.message}`);
  }
}

const FAILED_VERIFICATION = {
  allPassed: false,
  testResults: [
    { id: 't1', name: 'page renders visible content', status: 'failed', detail: 'body is empty' },
    { id: 't2', name: 'form submits', status: 'passed', detail: 'ok' },
  ],
};
const FIXED_VERIFICATION = {
  allPassed: true,
  testResults: [
    { id: 't1', name: 'page renders visible content', status: 'passed', detail: '120 chars visible' },
    { id: 't2', name: 'form submits', status: 'passed', detail: 'ok' },
  ],
};

(async () => {
  const db = getDb();
  console.log('================================================================');
  console.log('🔧 AUTONOMOUS REPAIR LOOP & IMPROVEMENT MEASUREMENT SUITE');
  console.log('================================================================');

  // 1. Migration 032 creates both evidence tables.
  await test('Migration 032: build_outcomes + repair_rounds tables exist', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('build_outcomes','repair_rounds')").all().map((r) => r.name);
    assert.deepStrictEqual(tables.sort(), ['build_outcomes', 'repair_rounds']);
  });

  // 2. Failed verification → one repair round fixes it.
  const ownerA = 'usr_repair_a';
  let outcomeId = null;
  await test('Repair loop: failed build repaired in one round', async () => {
    outcomeId = beginBuildOutcome({ db, requestId: 'req_t2', ownerId: ownerA, projectId: 'proj_a', filesCount: 1, verification: FAILED_VERIFICATION });
    assert.ok(outcomeId, 'outcome opened');
    const result = await runAutonomousRepair({
      db, ownerId: ownerA, projectId: 'proj_a', outcomeId,
      originalPrompt: 'أنشئ تطبيق مهام', verification: FAILED_VERIFICATION,
      runAgent: async () => ({ verification: FIXED_VERIFICATION, filesModified: ['index.html'] }),
    });
    assert.strictEqual(result.rounds, 1);
    assert.strictEqual(result.repaired, true);
    assert.deepStrictEqual(result.filesModified, ['index.html']);
    const round = db.prepare('SELECT * FROM repair_rounds WHERE outcome_id = ?').get(outcomeId);
    assert.strictEqual(round.success, 1);
    assert.strictEqual(round.round_no, 1);
    const failedJson = JSON.parse(round.failed_tests_json);
    assert.strictEqual(failedJson.length, 1);
    assert.strictEqual(failedJson[0].name, 'page renders visible content');
  });

  // 3. Verified repair records a lesson AND a verified_fix dataset entry.
  await test('Verified repair records lesson + fix example (experience saved)', () => {
    const lesson = db.prepare("SELECT * FROM agent_memory_lessons WHERE scope = 'build-repair' AND project_id = 'proj_a'").get();
    assert.ok(lesson, 'lesson recorded');
    assert.ok(lesson.error_signature.includes('page renders visible content'));
    const fix = db.prepare("SELECT * FROM improvement_dataset_entries WHERE kind = 'verified_fix' AND owner_id = ?").get(ownerA);
    assert.ok(fix, 'fix dataset entry captured');
    assert.strictEqual(fix.approved, 0, 'awaits owner approval');
    assert.strictEqual(fix.quality_score, 1.0);
  });

  // 4. Never-passing repair: rounds recorded as failures, NOTHING learned.
  await test('Anti-poisoning: unverified repair teaches nothing', async () => {
    const stillFailing = async () => ({ verification: FAILED_VERIFICATION, filesModified: ['index.html'] });
    const oid = beginBuildOutcome({ db, requestId: 'req_t4', ownerId: ownerA, projectId: 'proj_b', filesCount: 1, verification: FAILED_VERIFICATION });
    const result = await runAutonomousRepair({
      db, ownerId: ownerA, projectId: 'proj_b', outcomeId: oid,
      originalPrompt: 'أنشئ تطبيق', verification: FAILED_VERIFICATION,
      maxRounds: 2, runAgent: stillFailing,
    });
    assert.strictEqual(result.rounds, 2);
    assert.strictEqual(result.repaired, false);
    const rounds = db.prepare('SELECT * FROM repair_rounds WHERE outcome_id = ? ORDER BY round_no').all(oid);
    assert.strictEqual(rounds.length, 2);
    assert.ok(rounds.every((r) => r.success === 0));
    const lesson = db.prepare("SELECT * FROM agent_memory_lessons WHERE scope = 'build-repair' AND project_id = 'proj_b'").get();
    assert.strictEqual(lesson, undefined, 'no lesson from failed repair');
    const fixes = db.prepare("SELECT COUNT(*) AS n FROM improvement_dataset_entries WHERE kind = 'verified_fix' AND owner_id = ?").get(ownerA);
    assert.strictEqual(fixes.n, 1, 'still only the one verified fix from proj_a');
  });

  // 5. No actionable failures → no rounds at all.
  await test('Empty failure list: loop exits without calling the agent', async () => {
    let agentCalls = 0;
    const result = await runAutonomousRepair({
      db, ownerId: ownerA, outcomeId: null, originalPrompt: 'x',
      verification: { allPassed: false, testResults: [] },
      runAgent: async () => { agentCalls++; return { verification: FIXED_VERIFICATION, filesModified: [] }; },
    });
    assert.strictEqual(result.rounds, 0);
    assert.strictEqual(agentCalls, 0);
  });

  // 6. Repair prompt is bounded, names the failures, and instructs surgical edits.
  await test('buildRepairPrompt: bounded, names failures, surgical instruction', () => {
    const manyFailures = Array.from({ length: 20 }, (_, i) => ({ name: `check_${i}`, detail: 'x'.repeat(500) }));
    const prompt = buildRepairPrompt({ originalPrompt: 'أنشئ تطبيق', failedTests: manyFailures, isAr: true });
    assert.ok(prompt.includes('check_0'));
    assert.ok(!prompt.includes('check_19'), 'bounded to 8 failures');
    assert.ok(prompt.includes('إصلاحاً جراحياً'));
    assert.ok(!prompt.includes('x'.repeat(500)), 'details truncated');
  });

  // 7. Outcome lifecycle: first-pass flag + finalize updates final state.
  await test('Outcome lifecycle: first_passed=0 then finalized passed with rounds', () => {
    const oid = beginBuildOutcome({ db, requestId: 'req_t7', ownerId: ownerA, projectId: 'proj_c', filesCount: 1, verification: FAILED_VERIFICATION });
    let row = db.prepare('SELECT * FROM build_outcomes WHERE id = ?').get(oid);
    assert.strictEqual(row.first_passed, 0);
    assert.strictEqual(row.tests_total, 2);
    assert.strictEqual(row.tests_passed, 1);
    finalizeBuildOutcome({ db, outcomeId: oid, finalPassed: true, repairRounds: 2, verification: FIXED_VERIFICATION });
    row = db.prepare('SELECT * FROM build_outcomes WHERE id = ?').get(oid);
    assert.strictEqual(row.final_passed, 1);
    assert.strictEqual(row.repair_rounds, 2);
  });

  // 8. Metrics computed from real rows only.
  await test('computeImprovementMetrics: honest rates from recorded outcomes', () => {
    const ownerM = 'usr_metrics';
    const seed = (reqId, first, final_, rounds) => {
      db.prepare(
        `INSERT INTO build_outcomes (id, request_id, owner_id, intent, files_count, tests_total, tests_passed, first_passed, final_passed, repair_rounds, created_at)
         VALUES (?, ?, ?, 'build', 1, 2, ?, ?, ?, ?, ?)`
      ).run(`out_${reqId}`, reqId, ownerM, final_ ? 2 : 1, first, final_, rounds, new Date().toISOString());
    };
    seed('m1', 1, 1, 0);
    seed('m2', 1, 1, 0);
    seed('m3', 0, 1, 1);
    seed('m4', 0, 0, 2);
    const m = computeImprovementMetrics({ db, ownerId: ownerM });
    assert.strictEqual(m.builds, 4);
    assert.strictEqual(m.first_pass_rate, 50);
    assert.strictEqual(m.final_pass_rate, 75);
    assert.strictEqual(m.repairs_attempted, 2);
    assert.strictEqual(m.repairs_rescued, 1);
    assert.strictEqual(m.repair_rescue_rate, 50);
  });

  // 9. Trend: last-10 vs previous-10 first-pass delta.
  await test('Trend windows: improving first-pass rate shows positive delta', () => {
    const ownerT = 'usr_trend';
    for (let i = 0; i < 20; i++) {
      // i=0 oldest, i=19 newest — oldest 10 fail first-pass, newest 10 pass.
      const first = i >= 10 ? 1 : 0;
      const ts = new Date(Date.now() - (19 - i) * 60000).toISOString();
      db.prepare(
        `INSERT INTO build_outcomes (id, request_id, owner_id, intent, files_count, tests_total, tests_passed, first_passed, final_passed, repair_rounds, created_at)
         VALUES (?, ?, ?, 'build', 1, 1, ?, ?, ?, 0, ?)`
      ).run(`tr_${i}`, `trend_${i}`, ownerT, first, first, first, ts);
    }
    const m = computeImprovementMetrics({ db, ownerId: ownerT });
    assert.strictEqual(m.trend_first_pass_last10, 100);
    assert.strictEqual(m.trend_first_pass_prev10, 0);
    assert.strictEqual(m.trend_delta, 100);
  });

  // 10. Tenant isolation: other owners see nothing but their own rows.
  await test('Tenant isolation: metrics scoped strictly by owner_id', () => {
    const m = computeImprovementMetrics({ db, ownerId: 'usr_stranger' });
    assert.strictEqual(m.builds, 0);
    assert.strictEqual(m.first_pass_rate, null, 'no evidence → null, not a fake 100%');
    const foreign = db.prepare('SELECT COUNT(*) AS n FROM repair_rounds WHERE owner_id = ?').get('usr_stranger');
    assert.strictEqual(foreign.n, 0);
  });

  console.log('================================================================');
  console.log(passed === 10
    ? '🎉 AUTONOMOUS REPAIR SUITE — ALL 10 TESTS PASSED'
    : `⚠️ ${passed}/10 passed, ${failed} failed: ${failures.join(' | ')}`);
  console.log('================================================================');
  closeDb();
  for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    try { fs.unlinkSync(f); } catch (_) { /* cleanup */ }
  }
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('SUITE CRASH:', e);
  process.exit(1);
});
