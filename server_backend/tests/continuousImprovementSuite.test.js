/**
 * continuousImprovementSuite.test.js
 * Verification of the Continuous Improvement Engine (Phase CI):
 *   Code Learning Memory (codePatternLibrary)
 *   Autonomous Continuous Improvement Engine (improvementEngine)
 *   Model Improvement Pipeline (modelImprovementPipeline)
 *
 * Proves honest behavior throughout:
 *   - nothing is codified from unverified code (anti-poisoning),
 *   - directives are evidence-bound (appear with evidence, vanish without it),
 *   - the dataset captures only proven builds and exports only APPROVED entries,
 *   - secrets are redacted, and tenants are strictly isolated.
 */
process.env.LLM_PROVIDER = 'mock';
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `ciengine_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.DATA_DIR = require('path').join(require('os').tmpdir(), `ciengine_data_${Date.now()}_${Math.random().toString(36).slice(2)}`);

const assert = require('node:assert');
const { getDb, closeDb } = require('../db/database');

console.log('================================================================');
console.log('🔁 RUNNING CONTINUOUS IMPROVEMENT ENGINE VERIFICATION SUITE');
console.log('================================================================\n');

const OWNER = 'usr_ci_main';
const OWNER_B = 'usr_ci_other';

const GOOD_HTML = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head><meta charset="UTF-8"><title>مهامي</title>
<style>
:root { --bg: #0b0d17; --fg: #ffffff; --accent: #00e676; --muted: #8899aa; --card: #12172a; }
@media (max-width: 600px) { .list { padding: 8px; } }
@media (max-width: 400px) { .list { padding: 4px; } }
</style></head>
<body>
<form id="add-form">
  <input id="task-input" required placeholder="أضف مهمة" />
  <button type="submit">إضافة</button>
</form>
<ul id="task-list" class="list"></ul>
<script>
const store = {
  load() { return JSON.parse(localStorage.getItem('tasks') || '[]'); },
  save(items) { localStorage.setItem('tasks', JSON.stringify(items)); }
};
let items = store.load();
function renderList() {
  const ul = document.getElementById('task-list');
  ul.innerHTML = items.map((t, i) => '<li>' + t + ' <button data-del="' + i + '">حذف</button></li>').join('');
}
document.getElementById('add-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = document.getElementById('task-input').value.trim();
  if (!v) return;
  items.push(v);
  store.save(items);
  renderList();
});
document.getElementById('task-list').addEventListener('click', (e) => {
  const i = e.target.dataset.del;
  if (i !== undefined) { items.splice(Number(i), 1); store.save(items); renderList(); }
});
renderList();
</script>
</body></html>`;

const FILES = [{ path: 'index.html', content: GOOD_HTML }];

(async () => {
  const db = getDb();
  const { harvestVerifiedPatterns, recallPatterns, formatPatternsBlock } = require('../services/agent/codePatternLibrary');
  const { recomputeDirectives, activeDirectives, buildLearningContext } = require('../services/agent/improvementEngine');
  const { captureBuildExample, captureFixExample, listEntries, approveEntries, exportApprovedDataset, pipelineStats, redactSecrets } = require('../services/agent/modelImprovementPipeline');

  // ------------------------------------------------ 1. Migration 031
  console.log('▶️ [Test 01] Migration 031 creates the three engine tables...');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('code_patterns','improvement_directives','improvement_dataset_entries')").all().map((r) => r.name);
  assert.deepStrictEqual(tables.sort(), ['code_patterns', 'improvement_dataset_entries', 'improvement_directives'], 'all three tables must exist');
  console.log('   ✅ code_patterns + improvement_directives + improvement_dataset_entries present.');

  // ------------------------------------------------ 2. Anti-poisoning
  console.log('▶️ [Test 02] Anti-poisoning: unverified builds are never codified...');
  const refused = harvestVerifiedPatterns({ db, ownerId: OWNER, files: FILES, verificationPassed: false });
  assert.strictEqual(refused.recorded, 0);
  assert.ok(/verification/i.test(refused.reason), 'refusal reason must be honest');
  const countAfterRefusal = db.prepare('SELECT COUNT(*) AS c FROM code_patterns WHERE owner_id = ?').get(OWNER).c;
  assert.strictEqual(countAfterRefusal, 0, 'nothing may be stored from a failed build');
  console.log('   ✅ Failed-verification build recorded zero patterns.');

  // ------------------------------------------------ 3. Harvest from verified build
  console.log('▶️ [Test 03] Harvest stores proven patterns from a passing build...');
  const first = harvestVerifiedPatterns({ db, ownerId: OWNER, projectId: 'prj_ci_1', files: FILES, verificationPassed: true, modifiedPaths: ['index.html'] });
  assert.ok(first.recorded >= 5, `expected >=5 patterns from the fixture, got ${first.recorded}`);
  assert.ok(first.keys.includes('rtl-arabic-layout'));
  assert.ok(first.keys.includes('localstorage-persistence'));
  assert.ok(first.keys.includes('form-with-validation'));
  assert.ok(first.keys.includes('responsive-media-queries'));
  assert.ok(first.keys.includes('crud-list-rendering'));
  assert.ok(first.keys.includes('theme-css-variables'));
  const rtl = db.prepare('SELECT * FROM code_patterns WHERE owner_id = ? AND pattern_key = ?').get(OWNER, 'rtl-arabic-layout');
  assert.ok(rtl.snippet.includes('dir="rtl"'), 'snippet must be the REAL proven code slice');
  assert.strictEqual(rtl.is_verified, 1);
  console.log(`   ✅ ${first.recorded} patterns harvested with real code slices.`);

  // ------------------------------------------------ 4. Re-harvest increments, never duplicates
  console.log('▶️ [Test 04] Re-harvest increments success_count without duplicating rows...');
  harvestVerifiedPatterns({ db, ownerId: OWNER, projectId: 'prj_ci_2', files: FILES, verificationPassed: true });
  harvestVerifiedPatterns({ db, ownerId: OWNER, projectId: 'prj_ci_3', files: FILES, verificationPassed: true });
  const rtlAfter = db.prepare('SELECT success_count FROM code_patterns WHERE owner_id = ? AND pattern_key = ?').get(OWNER, 'rtl-arabic-layout');
  assert.strictEqual(rtlAfter.success_count, 3, 'three verified builds → success_count 3');
  const rowCount = db.prepare("SELECT COUNT(*) AS c FROM code_patterns WHERE owner_id = ? AND pattern_key = 'rtl-arabic-layout'").get(OWNER).c;
  assert.strictEqual(rowCount, 1, 'pattern must stay a single row (UPSERT)');
  console.log('   ✅ success_count=3, single row per pattern key.');

  // ------------------------------------------------ 5. Recall ranks by relevance
  console.log('▶️ [Test 05] Recall ranks the keyword-relevant pattern first and tracks usage...');
  const recalled = recallPatterns({ db, ownerId: OWNER, prompt: 'ابني لي واجهة عربية فيها قائمة مهام مع حفظ البيانات' });
  assert.ok(recalled.length > 0, 'must recall at least one pattern');
  assert.ok(['rtl-arabic-layout', 'crud-list-rendering', 'localstorage-persistence'].includes(recalled[0].patternKey), `unexpected top pattern: ${recalled[0].patternKey}`);
  assert.ok(recalled[0].keywordHits >= 1);
  const used = db.prepare('SELECT use_count, last_used_at FROM code_patterns WHERE owner_id = ? AND pattern_key = ?').get(OWNER, recalled[0].patternKey);
  assert.ok(used.use_count >= 1 && used.last_used_at, 'usage telemetry must be recorded');
  console.log(`   ✅ Top recall: ${recalled[0].patternKey} (hits=${recalled[0].keywordHits}).`);

  // ------------------------------------------------ 6. Learning context block
  console.log('▶️ [Test 06] buildLearningContext renders a bounded advisory block (and stays empty when nothing matches)...');
  const ctx = buildLearningContext({ db, ownerId: OWNER, prompt: 'أريد تصميم واجهة عربية بألوان داكنة', lang: 'ar' });
  assert.ok(ctx.includes('أنماط برمجية مُثبتة') || ctx.includes('توجيهات تحسين'), 'context must carry the advisory header');
  assert.ok(ctx.length <= 2600, 'context must stay bounded');
  const emptyCtx = buildLearningContext({ db, ownerId: 'usr_ci_fresh', prompt: 'hello world quantum physics', lang: 'en' });
  assert.strictEqual(emptyCtx, '', 'no evidence → empty context (never fabricated)');
  console.log('   ✅ Context renders for evidence, stays honestly empty without it.');

  // ------------------------------------------------ 7. Directives from evidence
  console.log('▶️ [Test 07] recomputeDirectives creates evidence-bound directives...');
  // evidence: lesson recalled 3+ times (recurring error)
  // migration 031 guarantees usage_count exists (latent-defect repair)
  const lessonCols = db.prepare("PRAGMA table_info('agent_memory_lessons')").all().map((c) => c.name);
  assert.ok(lessonCols.includes('usage_count'), 'migration 031 must guarantee usage_count');
  db.prepare(
    `INSERT INTO agent_memory_lessons (id, scope, project_id, error_signature, root_cause, verified_solution, confidence_score, created_at)
     VALUES ('les_ci_1', 'general', NULL, 'TypeError: cannot read properties of undefined', 'وصول لخاصية قبل التهيئة', 'تحقق من القيمة قبل الوصول', 1.0, datetime('now'))`
  ).run();
  db.prepare("UPDATE agent_memory_lessons SET usage_count = 4 WHERE id = 'les_ci_1'").run();
  const report = recomputeDirectives({ db, ownerId: OWNER });
  assert.ok(report.kinds.preferred_pattern >= 1, 'success_count=3 patterns → preferred_pattern directive');
  assert.ok(report.kinds.recurring_error >= 1, 'lesson with usage_count>=3 → recurring_error directive');
  const dirs = activeDirectives({ db, ownerId: OWNER });
  const prefDir = dirs.find((d) => d.kind === 'preferred_pattern');
  assert.ok(prefDir && prefDir.boostKeys.length > 0, 'preferred_pattern directive must carry boost keys');
  console.log(`   ✅ Directives active: ${JSON.stringify(report.kinds)}.`);

  // ------------------------------------------------ 8. Directives vanish without evidence
  console.log('▶️ [Test 08] A directive deactivates itself when its evidence drops...');
  const OWNER_TEMP = 'usr_ci_temp';
  harvestVerifiedPatterns({ db, ownerId: OWNER_TEMP, files: FILES, verificationPassed: true });
  harvestVerifiedPatterns({ db, ownerId: OWNER_TEMP, files: FILES, verificationPassed: true });
  harvestVerifiedPatterns({ db, ownerId: OWNER_TEMP, files: FILES, verificationPassed: true });
  recomputeDirectives({ db, ownerId: OWNER_TEMP });
  let tempDirs = activeDirectives({ db, ownerId: OWNER_TEMP });
  assert.ok(tempDirs.some((d) => d.kind === 'preferred_pattern'), 'directive must appear with evidence');
  db.prepare('DELETE FROM code_patterns WHERE owner_id = ?').run(OWNER_TEMP);
  recomputeDirectives({ db, ownerId: OWNER_TEMP });
  tempDirs = activeDirectives({ db, ownerId: OWNER_TEMP });
  assert.ok(!tempDirs.some((d) => d.kind === 'preferred_pattern'), 'directive must deactivate when evidence is gone');
  console.log('   ✅ Evidence gone → directive deactivated (no zombie rules).');

  // ------------------------------------------------ 9. Closed loop: boost changes recall
  console.log('▶️ [Test 09] Closed loop: directive boost promotes a proven pattern into recall...');
  const noBoost = recallPatterns({ db, ownerId: OWNER, prompt: 'طقس اليوم جميل جداً' });
  assert.ok(!noBoost.some((p) => p.patternKey === 'theme-css-variables'), 'irrelevant prompt must not surface the theme pattern');
  const boosted = recallPatterns({ db, ownerId: OWNER, prompt: 'طقس اليوم جميل جداً', boostKeys: ['theme-css-variables'] });
  assert.ok(boosted.some((p) => p.patternKey === 'theme-css-variables'), 'directive boost must promote the proven pattern');
  console.log('   ✅ Boost promotes proven pattern; un-boosted recall stays honest.');

  // ------------------------------------------------ 10. Dataset capture discipline
  console.log('▶️ [Test 10] Dataset captures ONLY proven, non-empty builds...');
  const failing = captureBuildExample({ db, ownerId: OWNER, prompt: 'x', filesModified: ['index.html'], files: FILES, verification: { allPassed: false } });
  assert.strictEqual(failing.captured, false);
  const noop = captureBuildExample({ db, ownerId: OWNER, prompt: 'x', filesModified: [], files: FILES, verification: { allPassed: true } });
  assert.strictEqual(noop.captured, false);
  const good = captureBuildExample({
    db, ownerId: OWNER, projectId: 'prj_ci_1', prompt: 'ابني تطبيق مهام عربي',
    filesModified: ['index.html'], files: FILES,
    verification: { allPassed: true, testResults: [{ passed: true }, { passed: true }, { passed: false }] },
  });
  assert.strictEqual(good.captured, true);
  assert.strictEqual(good.qualityScore, 0.67, 'quality score must be the honest pass ratio');
  const stats = pipelineStats({ db, ownerId: OWNER });
  assert.strictEqual(stats.builds, 1);
  assert.strictEqual(stats.pending, 1);
  console.log('   ✅ Failing/no-op refused; proven build captured with quality 0.67.');

  // ------------------------------------------------ 11. Export: approved-only, valid JSONL, redacted
  console.log('▶️ [Test 11] Export releases APPROVED entries only, as redacted JSONL...');
  const secretFile = [{ path: 'app.js', content: 'const apiKey = "sk-abcdefghij1234567890abcdef";\nconsole.log(apiKey);' }];
  const withSecret = captureBuildExample({
    db, ownerId: OWNER, projectId: 'prj_ci_1', prompt: 'استخدم المفتاح sk-abcdefghij1234567890abcdef هنا',
    filesModified: ['app.js'], files: secretFile,
    verification: { allPassed: true, testResults: [{ passed: true }] },
  });
  assert.strictEqual(withSecret.captured, true);
  let exported = exportApprovedDataset({ db, ownerId: OWNER });
  assert.strictEqual(exported.count, 0, 'nothing approved yet → nothing exported');
  approveEntries({ db, ownerId: OWNER, ids: [good.id, withSecret.id] });
  exported = exportApprovedDataset({ db, ownerId: OWNER });
  assert.strictEqual(exported.count, 2);
  const lines = exported.jsonl.split('\n').filter(Boolean);
  for (const line of lines) {
    const obj = JSON.parse(line);
    assert.ok(obj.instruction !== undefined && obj.output !== undefined && obj.meta && obj.meta.source === 'engineer-platform');
  }
  assert.ok(!exported.jsonl.includes('sk-abcdefghij'), 'secrets must be redacted before export');
  assert.ok(exported.jsonl.includes('<REDACTED>'));
  console.log('   ✅ 2 approved entries exported; secrets redacted; JSONL valid.');

  // ------------------------------------------------ 12. Tenant isolation
  console.log('▶️ [Test 12] Tenant isolation: no cross-owner visibility or approval...');
  const foreign = captureBuildExample({
    db, ownerId: OWNER_B, projectId: 'prj_ci_b', prompt: 'مشروع سري للغاية',
    filesModified: ['index.html'], files: FILES,
    verification: { allPassed: true, testResults: [{ passed: true }] },
  });
  assert.strictEqual(foreign.captured, true);
  const aSees = listEntries({ db, ownerId: OWNER, approved: null }).filter((e) => e.id === foreign.id);
  assert.strictEqual(aSees.length, 0, 'owner A must never list owner B entries');
  const crossApprove = approveEntries({ db, ownerId: OWNER, ids: [foreign.id] });
  assert.strictEqual(crossApprove.approved, 0, 'cross-tenant approval must be a no-op');
  const aExport = exportApprovedDataset({ db, ownerId: OWNER });
  assert.ok(!aExport.jsonl.includes('مشروع سري للغاية'), 'owner B content must never leak into owner A export');
  const bPatterns = db.prepare('SELECT COUNT(*) AS c FROM code_patterns WHERE owner_id = ?').get(OWNER_B).c;
  assert.strictEqual(bPatterns, 0, 'patterns are tenant-scoped as well');
  console.log('   ✅ Zero cross-tenant reads, approvals, exports, or patterns.');

  // ------------------------------------------------ 13. Verified fix capture
  console.log('▶️ [Test 13] Verified fixes become training candidates; empty fixes refused...');
  const fix = captureFixExample({
    db, ownerId: OWNER, projectId: 'prj_ci_1',
    errorSignature: 'ReferenceError: renderList is not defined',
    rootCause: 'استدعاء الدالة قبل تعريفها',
    provenFix: 'نقل تعريف renderList قبل أول استدعاء',
    codeBefore: 'renderList();\nfunction renderList() {}',
    codeAfter: 'function renderList() {}\nrenderList();',
  });
  assert.strictEqual(fix.captured, true);
  const fixRow = db.prepare("SELECT kind, quality_score, approved FROM improvement_dataset_entries WHERE id = ?").get(fix.id);
  assert.strictEqual(fixRow.kind, 'verified_fix');
  assert.strictEqual(fixRow.quality_score, 1.0);
  assert.strictEqual(fixRow.approved, 0, 'fix still needs human approval before export');
  const emptyFix = captureFixExample({ db, ownerId: OWNER, errorSignature: 'x', provenFix: '', codeAfter: '' });
  assert.strictEqual(emptyFix.captured, false, 'empty fix teaches nothing — refused');
  assert.ok(redactSecrets('token = "xoxb-1234567890-abcdefghij"').includes('<REDACTED>'));
  console.log('   ✅ Fix captured as pending candidate; empty fix refused; redaction works.');

  console.log('\n================================================================');
  console.log('🎉 CONTINUOUS IMPROVEMENT ENGINE SUITE — ALL 13 TESTS PASSED');
  console.log('================================================================');
  closeDb();
  process.exit(0);
})().catch((err) => {
  console.error('\n❌ SUITE FAILED:', err);
  try { closeDb(); } catch (_) {}
  process.exit(1);
});
