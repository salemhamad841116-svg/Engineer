/**
 * aiFeaturePackSuite.test.js
 * Verification of the AI Feature Pack:
 *   Personalization (10) · Recommendations (3) · Predictive Risk (8)
 *   Vision/Screenshot analysis (7) · Reasoning & Planning (6)
 *
 * Proves honest behavior throughout: explicit user choice beats inference,
 * blocked vision reports BLOCKED (never fabricates), risk is a traceable
 * heuristic, plans version instead of overwrite.
 */
process.env.LLM_PROVIDER = 'mock';
process.env.DB_PATH = require('path').join(require('os').tmpdir(), `aipack_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
process.env.DATA_DIR = require('path').join(require('os').tmpdir(), `aipack_data_${Date.now()}_${Math.random().toString(36).slice(2)}`);

const assert = require('node:assert');
const { getDb, closeDb } = require('../db/database');

console.log('================================================================');
console.log('🧠 RUNNING AI FEATURE PACK VERIFICATION SUITE');
console.log('================================================================\n');

const OWNER = 'usr_pack_test';
const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

(async () => {
  const db = getDb();

  // ------------------------------------------------ 10. Personalization
  console.log('▶️ [Test 01] Personalization: inference from signals...');
  const { inferExpertise, setExplicitExpertise, updateInferredExpertise, getUserExpertise, renderExpertiseSection } = require('../services/agent/personalizationService');
  const beginner = inferExpertise(['ما أعرف شي عن البرمجة', 'ابي تطبيق بسيط', 'اشرح لي بالبسيط']);
  assert.strictEqual(beginner.level, 'beginner', 'Arabic beginner markers must infer beginner');
  const expert = inferExpertise(['I have a CORS issue in my API middleware', 'the JWT refresh flow throws on localhost', 'refactor the SQL query with an ORM dto']);
  assert.strictEqual(expert.level, 'expert', 'dense technical terms must infer expert');
  const neutral = inferExpertise(['ابني لي تطبيق ملاحظات']);
  assert.strictEqual(neutral.level, 'intermediate', 'neutral prompt must default to intermediate');
  console.log('   ✅ Inference: beginner / expert / intermediate classified from real signals.');

  console.log('▶️ [Test 02] Explicit choice ALWAYS beats inference...');
  setExplicitExpertise(db, OWNER, 'expert');
  const afterInfer = updateInferredExpertise(db, OWNER, ['ما أعرف شي', 'مبتدئ تماماً']);
  assert.strictEqual(afterInfer.level, 'expert', 'explicit expert must survive beginner-looking messages');
  assert.strictEqual(afterInfer.source, 'explicit');
  const row = getUserExpertise(db, OWNER);
  assert.strictEqual(row.level, 'expert');
  assert.throws(() => setExplicitExpertise(db, OWNER, 'wizard'), /EXPERTISE_INVALID|Invalid/, 'invalid level must be rejected');
  assert.ok(renderExpertiseSection('beginner', 'ar').includes('مبتدئ'));
  assert.ok(renderExpertiseSection('expert', 'en').includes('expert'));
  console.log('   ✅ Explicit wins; invalid levels rejected; prompt sections render.');

  // ------------------------------------------------ 3. Recommendations
  console.log('▶️ [Test 03] Recommendations: domain classification + honest basis...');
  const { recommendForPrompt, nextStepsForProject, classifyDomain } = require('../services/agent/recommendationService');
  const acc = recommendForPrompt({ prompt: 'أريد تطبيق محاسبة لإدارة الفواتير والقيود', language: 'ar' });
  assert.strictEqual(acc.domain, 'accounting');
  assert.ok(acc.basis.startsWith('domain-keyword-match:'), 'basis must state WHY');
  assert.ok(acc.warnings.length > 0, 'accounting must carry the integer-money warning');
  const unknown = recommendForPrompt({ prompt: 'ab cd ef', language: 'en' });
  assert.strictEqual(unknown.domain, 'generic');
  assert.strictEqual(unknown.confidence, 'low', 'unknown domain must honestly report low confidence');
  console.log('   ✅ Recommendations: accounting detected with basis; unknown → generic/low-confidence.');

  console.log('▶️ [Test 04] Next steps from real project evidence...');
  const noPersistProject = {
    id: 'proj_np',
    files: [
      { path: 'index.html', name: 'index.html', content: '<html><body><form><input id="t"><button>Save</button></form></body></html>' },
      { path: 'app.js', name: 'app.js', content: 'function handleSave() { const v = document.getElementById("t").value; }' },
    ],
  };
  const steps = nextStepsForProject({ db: null, projectId: 'proj_np', project: noPersistProject });
  assert.ok(steps.some((s) => s.key === 'persistence' && s.priority === 'high'), 'forms without localStorage must trigger persistence recommendation');
  assert.ok(steps.every((s) => s.evidence), 'every recommendation must carry its evidence');
  console.log('   ✅ Evidence-based next steps (persistence gap detected).');

  // ------------------------------------------------ 8. Predictive risk
  console.log('▶️ [Test 05] Predictive risk: vague prompt raises the band...');
  const { assessBuildRisk } = require('../services/agent/buildRiskService');
  const vague = assessBuildRisk({ project: { id: 'p1', files: [] }, prompt: 'تطبيق', db: null });
  assert.ok(vague.factors.find((f) => f.key === 'vague_prompt').active, 'one-word prompt must activate vague_prompt');
  assert.ok(vague.mitigations.some((m) => m.factor === 'vague_prompt'), 'mitigation for vagueness must exist');
  const solid = assessBuildRisk({ project: { id: 'p1', files: [{ path: 'index.html', content: '<h1>hi</h1>' }] }, prompt: 'أريد تطبيق ملاحظات بسيط بحفظ محلي وبحث نصي وزر حذف لكل ملاحظة', db: null });
  assert.strictEqual(solid.band, 'LOW', `clear small request must be LOW risk, got ${solid.band} (${solid.score})`);
  assert.ok(solid.probability.includes('%'), 'output is an honest probability RANGE');
  console.log(`   ✅ Risk: vague=${vague.band}(${vague.score}) vs clear=${solid.band}(${solid.score}); ranges + mitigations.`);

  console.log('▶️ [Test 06] Predictive risk uses real failure history...');
  db.prepare("INSERT INTO users (id, email, name, password_hash, role, status, is_legacy_placeholder, created_at) VALUES ('usr_seed_manual', 'seed@test.local', 'Seed', 'x', 'admin', 'active', 1, datetime('now'))").run();
  db.prepare("INSERT INTO app_projects (id, user_id, name, status, created_at, updated_at) VALUES ('proj_hist', 'usr_seed_manual', 'hist', 'completed', datetime('now'), datetime('now'))").run();
  db.prepare("INSERT INTO app_project_versions (id, project_id, version_number, prompt, status, created_at) VALUES ('v1', 'proj_hist', 1, 'x', 'failed', datetime('now'))").run();
  db.prepare("INSERT INTO app_project_versions (id, project_id, version_number, prompt, status, created_at) VALUES ('v2', 'proj_hist', 2, 'x', 'failed', datetime('now'))").run();
  const histRisk = assessBuildRisk({ project: { id: 'proj_hist', files: [] }, prompt: 'أعد بناء الواجهة كاملة مع جميع الميزات السابقة والجديدة', db });
  assert.ok(histRisk.factors.find((f) => f.key === 'recent_failures').active, 'two failed versions must activate history factor');
  assert.ok(histRisk.score > solid.score, 'history of failures must raise the score');
  console.log('   ✅ History factor: real app_project_versions failures feed the score.');

  // ------------------------------------------------ 6. Planning
  console.log('▶️ [Test 07] Planning: persisted, ordered, versioned plans...');
  const { createPlan, getActivePlan, markStep } = require('../services/agent/buildPlanService');
  const plan1 = createPlan({ db, projectId: 'proj_hist', ownerId: OWNER, prompt: 'تطبيق محاسبة', language: 'ar' });
  assert.strictEqual(plan1.domain, 'accounting');
  assert.strictEqual(plan1.steps.length, 5);
  const wiring = plan1.steps.find((s) => s.id.includes('wiring'));
  assert.deepStrictEqual(wiring.dependsOn, ['data', 'ui'], 'wiring must depend on data+ui');
  const plan2 = createPlan({ db, projectId: 'proj_hist', ownerId: OWNER, prompt: 'تطبيق متجر', language: 'ar' });
  assert.strictEqual(plan2.domain, 'commerce');
  const active = getActivePlan({ db, projectId: 'proj_hist' });
  assert.strictEqual(active.id, plan2.id, 'new plan supersedes old as ACTIVE');
  const oldRow = db.prepare("SELECT status FROM build_plans WHERE id = ?").get(plan1.id);
  assert.strictEqual(oldRow.status, 'superseded', 'old plan preserved as superseded, not deleted');
  const marked = markStep({ db, projectId: 'proj_hist', stepId: plan2.steps[0].id, status: 'done' });
  assert.strictEqual(marked.steps[0].status, 'done');
  assert.throws(() => markStep({ db, projectId: 'proj_hist', stepId: 'x', status: 'banana' }), /PLAN_STATUS_INVALID|Invalid/);
  console.log('   ✅ Plans: domain-aware, dependency-ordered, supersede-not-delete, step updates.');

  // ------------------------------------------------ 7. Vision
  console.log('▶️ [Test 08] Vision: strict-JSON parsing + honest fallback...');
  const { analyzeScreenshot, parseIssuesJson } = require('../services/agent/visionService');
  const good = parseIssuesJson('```json\n{"summary":"ok","issues":[{"severity":"critical","type":"overflow","where":"header","detail":"text clipped","suggestion":"reduce font"}],"positives":["clear layout"]}\n```');
  assert.strictEqual(good.issues.length, 1);
  assert.strictEqual(good.issues[0].severity, 'critical');
  const junk = parseIssuesJson('I see a nice page but cannot format JSON');
  assert.strictEqual(junk.summary, 'unstructured-model-output', 'non-JSON output must be honestly flagged, not guessed');
  assert.ok(junk.rawExcerpt.length > 0);
  console.log('   ✅ Vision parsing: JSON honored; junk honestly marked unstructured.');

  console.log('▶️ [Test 09] Vision end-to-end on a real attachment (injected model)...');
  const { saveAttachments } = require('../services/ai/workspaceAttachments');
  const [meta] = saveAttachments(process.env.DATA_DIR, 'proj_vision', [{ name: 'shot.png', dataBase64: PNG_1PX, type: 'image/png' }]);
  const analysis = await analyzeScreenshot({
    projectId: 'proj_vision',
    attachmentId: meta.id,
    visionCall: async () => '{"summary":"dense form","issues":[{"severity":"major","type":"contrast","where":"save button","detail":"low contrast","suggestion":"darken bg"}],"positives":[]}',
    available: () => true,
  });
  assert.strictEqual(analysis.issues[0].where, 'save button');
  await assert.rejects(
    () => analyzeScreenshot({ projectId: 'proj_vision', attachmentId: meta.id, available: () => false }),
    (err) => err.code === 'VISION_UNAVAILABLE' && err.state === 'BLOCKED',
    'no provider → honest BLOCKED, never fabricated analysis'
  );
  await assert.rejects(
    () => analyzeScreenshot({ projectId: 'proj_vision', attachmentId: 'att-missing', available: () => true }),
    (err) => err.code === 'ATTACHMENT_NOT_FOUND'
  );
  console.log('   ✅ Vision E2E: real attachment analyzed; BLOCKED/NOT_FOUND honest.');

  // ------------------------------------------------ Agent integration
  console.log('▶️ [Test 10] Agent integration: new tools through toolGuard, policy enforced...');
  const { createEngineerAgent } = require('../services/agent/engineerAgent');
  const { setMockToolResponder, _resetCache } = require('../services/ai/workspaceModelRouter');
  _resetCache();
  const { createToolGuard } = require('../security/toolGuard');
  const { workspaceTools } = require('../services/agent/workspaceTools');

  const agentProject = { id: 'proj_pack', files: [{ path: 'index.html', name: 'index.html', content: '<form><input id="n"></form>' }] };
  const agent = createEngineerAgent();
  setMockToolResponder(({ messages }) => {
    const toolResults = messages.filter((m) => m.role === 'tool').length;
    if (toolResults === 0) return { text: '', toolCalls: [{ name: 'predict_build_risk', arguments: { prompt: 'أضف سلة مشتريات' } }] };
    if (toolResults === 1) return { text: '', toolCalls: [{ name: 'recommend_options', arguments: { prompt: 'متجر إلكتروني' } }] };
    return { text: 'التقييم: مخاطرة منخفضة، والتوصية متجر بكتالوج وسلة.', toolCalls: [] };
  });
  const result = await agent.run({
    prompt: 'ما مخاطر إضافة سلة مشتريات وما توصيتك؟',
    project: agentProject,
    user: { id: OWNER, role: 'Editor', account: 'standard' },
    mode: 'build',
    db,
  });
  assert.strictEqual(result.status, 'completed');
  const riskCall = result.toolCalls.find((c) => c.name === 'predict_build_risk');
  const recCall = result.toolCalls.find((c) => c.name === 'recommend_options');
  assert.ok(riskCall && riskCall.ok === true, 'predict_build_risk must execute');
  assert.ok(recCall && recCall.ok === true, 'recommend_options must execute');
  assert.strictEqual(result.filesModified.length, 0, 'read-only advisory tools must not modify files');

  // plan_project is a write tool → denied in chat mode by policy
  const guard = createToolGuard({ tools: workspaceTools });
  const denied = await guard.execute(
    { name: 'plan_project', arguments: { prompt: 'خطة' } },
    { user: { id: OWNER, role: 'Editor', account: 'standard' }, mode: 'chat', projectId: agentProject.id, project: agentProject, db }
  );
  assert.notStrictEqual(denied.ok, true, 'plan_project (write) must be denied in chat mode');
  const planned = await guard.execute(
    { name: 'plan_project', arguments: { prompt: 'تطبيق حجز مواعيد' } },
    { user: { id: OWNER, role: 'Editor', account: 'standard' }, mode: 'build', projectId: agentProject.id, project: agentProject, db }
  );
  assert.strictEqual(planned.ok, true, 'plan_project must run in build mode for Editor');
  assert.ok(planned.result && planned.result.planId, 'plan id returned');
  console.log('   ✅ Agent integration: advisory tools read-only in-loop; plan_project policy-enforced.');

  // ------------------------------------------------ Personalization in system prompt
  console.log('▶️ [Test 11] Personalization reaches the actual system prompt...');
  const { buildSystemPrompt, CONSTITUTION_VERSION } = require('../services/ai/constitution');
  const beginnerPrompt = buildSystemPrompt({ mode: 'chat', role: 'Viewer', project: null, language: 'ar', expertise: 'beginner' });
  assert.ok(beginnerPrompt.includes('مبتدئ'), 'beginner section must appear in Arabic prompt');
  const expertPrompt = buildSystemPrompt({ mode: 'build', role: 'Editor', project: null, language: 'en', expertise: 'expert' });
  assert.ok(expertPrompt.includes('technical expert'), 'expert section must appear in English prompt');
  const defaultPrompt = buildSystemPrompt({ mode: 'build', role: 'Editor', project: null, language: 'en', expertise: 'intermediate' });
  assert.ok(!defaultPrompt.includes('Personalization'), 'intermediate adds no section (clean default)');
  assert.ok(CONSTITUTION_VERSION >= '2.2.0');
  console.log('   ✅ System prompt adapts by expertise; constitution v2.2.0.');

  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { require('fs').rmSync(process.env.DB_PATH + suffix, { force: true }); } catch (_) {}
  }

  console.log('\n================================================================');
  console.log('🎉 AI FEATURE PACK SUITE — ALL 11 TESTS PASSED');
  console.log('================================================================');
  process.exit(0);
})().catch((err) => {
  console.error('\n❌ SUITE FAILED:', err);
  process.exit(1);
});
