// ==============================================================================
// server_backend/services/agent/buildPlanService.js
// AI Reasoning & Planning — turns a request into an explicit, persisted,
// step-ordered build plan BEFORE code is written.
//
// The plan is deterministic scaffolding (domain decomposition from the
// recommendation engine + universal build phases) that the agent then executes
// and the user can inspect: every step has an id, a goal, dependencies, and a
// status. Plans are versioned — creating a new plan supersedes the old one,
// never silently overwrites it.
// ==============================================================================
'use strict';

const crypto = require('crypto');
const { recommendForPrompt } = require('./recommendationService');

function nowIso() { return new Date().toISOString(); }

const UNIVERSAL_STEPS_AR = [
  { key: 'structure', goal: 'إنشاء هيكل الملفات الأساسي وفق التوصية', dependsOn: [] },
  { key: 'data', goal: 'بناء طبقة البيانات والتخزين (نموذج البيانات + الاستمرارية)', dependsOn: ['structure'] },
  { key: 'ui', goal: 'بناء الواجهة والعناصر التفاعلية بمعرّفات مستقرة', dependsOn: ['structure'] },
  { key: 'wiring', goal: 'ربط الواجهة بالمنطق (معالجات الأحداث + تدفق الحالة)', dependsOn: ['data', 'ui'] },
  { key: 'verify', goal: 'التحقق بالاختبارات من كل سلوك مطلوب في الطلب الأصلي', dependsOn: ['wiring'] },
];
const UNIVERSAL_STEPS_EN = [
  { key: 'structure', goal: 'Create the base file structure per recommendation', dependsOn: [] },
  { key: 'data', goal: 'Build the data & persistence layer (data model + storage)', dependsOn: ['structure'] },
  { key: 'ui', goal: 'Build the UI and interactive elements with stable identifiers', dependsOn: ['structure'] },
  { key: 'wiring', goal: 'Wire UI to logic (event handlers + state flow)', dependsOn: ['data', 'ui'] },
  { key: 'verify', goal: 'Verify every behavior stated in the original request with tests', dependsOn: ['wiring'] },
];

/**
 * Creates and persists a plan. Supersedes any previous ACTIVE plan of the
 * project (status flips to 'superseded' — history is preserved).
 */
function createPlan({ db, projectId, ownerId, prompt = '', language = 'ar' }) {
  if (!db) throw Object.assign(new Error('INDEX_DB_MISSING'), { code: 'PLAN_UNAVAILABLE' });
  const rec = recommendForPrompt({ prompt, language });
  const steps = (language === 'ar' ? UNIVERSAL_STEPS_AR : UNIVERSAL_STEPS_EN).map((s, i) => ({
    id: `step_${i + 1}_${s.key}`,
    ...s,
    status: 'pending',
  }));
  const plan = {
    id: `plan_${crypto.randomUUID().slice(0, 12)}`,
    projectId: String(projectId),
    prompt: String(prompt).slice(0, 500),
    domain: rec.domain,
    recommendation: { features: rec.features, structure: rec.structure, warnings: rec.warnings || [] },
    steps,
    createdAt: nowIso(),
  };
  db.prepare("UPDATE build_plans SET status = 'superseded' WHERE project_id = ? AND status = 'active'").run(String(projectId));
  db.prepare('INSERT INTO build_plans (id, project_id, owner_id, prompt, plan_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(plan.id, String(projectId), String(ownerId), plan.prompt, JSON.stringify(plan), 'active', plan.createdAt);
  return plan;
}

function getActivePlan({ db, projectId }) {
  const row = db.prepare("SELECT plan_json FROM build_plans WHERE project_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1").get(String(projectId));
  return row ? JSON.parse(row.plan_json) : null;
}

/** Marks one step done inside the persisted plan (used as work progresses). */
function markStep({ db, projectId, stepId, status }) {
  if (!['pending', 'in_progress', 'done', 'failed'].includes(status)) {
    throw Object.assign(new Error(`Invalid step status: ${status}`), { code: 'PLAN_STATUS_INVALID' });
  }
  const plan = getActivePlan({ db, projectId });
  if (!plan) return null;
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) return null;
  step.status = status;
  db.prepare('UPDATE build_plans SET plan_json = ? WHERE id = ?').run(JSON.stringify(plan), plan.id);
  return plan;
}

module.exports = { createPlan, getActivePlan, markStep };
