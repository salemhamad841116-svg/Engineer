// ==============================================================================
// server_backend/services/agent/buildRiskService.js
// Predictive AI — estimates the probability that the CURRENT build/edit request
// will fail BEFORE spending steps on it.
//
// Method honesty: this is a transparent heuristic scorer, not a trained model.
// Every point of the score is traceable to a named factor with its weight, and
// the output is a probability RANGE with an explanation — never a fake-precise
// number. As real outcome data accumulates (verified vs failed versions), the
// same factors can be calibrated without changing this contract.
// ==============================================================================
'use strict';

const { POLICY } = require('../ai/constitution');

const BANDS = {
  LOW: { min: 0, max: 34, labelAr: 'منخفضة', labelEn: 'low', probability: '5–15%' },
  MEDIUM: { min: 35, max: 64, labelAr: 'متوسطة', labelEn: 'medium', probability: '20–45%' },
  HIGH: { min: 65, max: 100, labelAr: 'مرتفعة', labelEn: 'high', probability: '50–80%' },
};

/**
 * Factors (each: { key, weight, active, detail }). Weights are documented and
 * summed only when active; the score normalizes to 0..100.
 */
function computeFactors({ project, prompt = '', db = null }) {
  const files = (project && Array.isArray(project.files) ? project.files : []);
  const totalBytes = files.reduce((sum, f) => sum + String(f.content || '').length, 0);
  const factors = [];
  const push = (key, weight, active, detail) => factors.push({ key, weight, active: !!active, detail });

  // 1. Vague prompt → high ambiguity risk (the agent must guess).
  const words = String(prompt).trim().split(/\s+/).filter(Boolean).length;
  push('vague_prompt', 25, words > 0 && words < 6,
    `الطلب ${words} كلمات فقط — الغموض يرفع احتمال بناء شيء مختلف عن المقصود / prompt is only ${words} words`);

  // 2. Project size pressure vs hard limits.
  const filePressure = files.length / (POLICY.limits.maxFiles || 60);
  push('file_limit_pressure', 20, filePressure > 0.8,
    `${files.length}/${POLICY.limits.maxFiles} ملف — الاقتراب من الحد الأقصى يرفع فشل أدوات الكتابة / approaching file limit`);
  const bytePressure = totalBytes / (POLICY.limits.maxProjectBytes || 2 * 1024 * 1024);
  push('byte_limit_pressure', 15, bytePressure > 0.8,
    `${Math.round(totalBytes / 1024)}KB من ${Math.round((POLICY.limits.maxProjectBytes || 0) / 1024)}KB / approaching project byte limit`);

  // 3. Historical failures of THIS project (real outcome data).
  let failedVersions = 0;
  let totalVersions = 0;
  if (db && project && project.id) {
    try {
      const row = db.prepare(
        "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM app_project_versions WHERE project_id = ?"
      ).get(String(project.id));
      totalVersions = row && row.total ? row.total : 0;
      failedVersions = row && row.failed ? row.failed : 0;
    } catch (_) { /* history unavailable — factor stays inactive, honestly */ }
  }
  push('recent_failures', 25, failedVersions > 0,
    `${failedVersions} إصدار سابق فشل من أصل ${totalVersions} لهذا المشروع / ${failedVersions}/${totalVersions} prior versions failed`);

  // 4. Cross-file blast radius (shared files with many dependents break more).
  push('large_edit_surface', 15, files.length > 25,
    `${files.length} ملفاً — التعديلات متعددة الملفات أعلى مخاطرة / many files raise multi-file edit risk`);

  return { factors, fileCount: files.length, totalBytes, failedVersions, totalVersions, words };
}

/**
 * @returns {object} { band, labelAr, labelEn, probability, score, factors, mitigations, basis }
 */
function assessBuildRisk({ project, prompt = '', db = null }) {
  const { factors } = computeFactors({ project, prompt, db });
  const active = factors.filter((f) => f.active);
  const score = Math.min(100, active.reduce((sum, f) => sum + f.weight, 0));
  const band = score >= BANDS.HIGH.min ? 'HIGH' : score >= BANDS.MEDIUM.min ? 'MEDIUM' : 'LOW';
  const b = BANDS[band];

  const mitigations = [];
  if (active.some((f) => f.key === 'vague_prompt')) {
    mitigations.push({ factor: 'vague_prompt', actionAr: 'اسأل المستخدم سؤال توضيح واحد محدد (ask_user) قبل البناء بدل التخمين.', actionEn: 'Ask one concrete clarifying question (ask_user) before building instead of guessing.' });
  }
  if (active.some((f) => f.key === 'file_limit_pressure' || f.key === 'byte_limit_pressure')) {
    mitigations.push({ factor: 'limits', actionAr: 'ادمج الملفات الصغيرة أو احذف المهمل قبل إضافة ملفات جديدة.', actionEn: 'Merge small files or prune dead ones before adding new files.' });
  }
  if (active.some((f) => f.key === 'recent_failures')) {
    mitigations.push({ factor: 'recent_failures', actionAr: 'ابدأ بإعادة إنتاج الفشل السابق بفحص واحد صغير قبل أي تعديل جديد.', actionEn: 'Reproduce the previous failure with one small check before any new edit.' });
  }
  if (active.some((f) => f.key === 'large_edit_surface')) {
    mitigations.push({ factor: 'large_edit_surface', actionAr: 'استخدم الفهرس الدلالي (search_code/list_dependents) لحصر التعديل في الملفات المتأثرة فقط.', actionEn: 'Use the semantic index (search_code/list_dependents) to confine edits to impacted files only.' });
  }

  return {
    basis: 'transparent-heuristic (weighted named factors; range not point estimate)',
    band,
    labelAr: b.labelAr,
    labelEn: b.labelEn,
    probability: b.probability,
    score,
    factors: factors.map((f) => ({ key: f.key, weight: f.weight, active: f.active, detail: f.detail })),
    mitigations,
  };
}

module.exports = { assessBuildRisk, computeFactors, BANDS };
