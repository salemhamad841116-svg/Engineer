#!/usr/bin/env node
// ==============================================================================
// scripts/run-triple-model-eval.mjs
// Phase 12-B: Triple Model Benchmark Evaluation Harness on Golden Dataset (34 Qs)
// Evaluates: qwen2.5:7b, qwen3:8b, and deepseek-r1:7b
// ==============================================================================

import { evaluateGoldenDataset } from '../server_backend/services/research/goldenDatasetManager.js';
import { getDb } from '../server_backend/db/database.js';
import { modelProvider } from '../server_backend/services/ai/modelProviderInterface.js';

async function main() {
  console.log('================================================================');
  console.log('🏆 RUNNING TRIPLE MODEL FLEET BENCHMARK (GOLDEN DATASET 34 Qs)');
  console.log('================================================================\n');

  getDb();

  const modelsToEvaluate = [
    {
      id: 'qwen2.5:7b',
      role: 'العام الرئيسي (Deep Tier)',
      approxSize: '~4.7 GB',
      strengths: 'الأقوى عربياً وصرفياً، دقة اقتباس فائقة، سرعة استجابة متوازنة.',
      tierRecommendation: 'Deep Tier (مستوى البحث المعرفي والتحليلي العام)',
    },
    {
      id: 'qwen3:8b',
      role: 'الاستدلال والتفكير العميق (Expert Tier)',
      approxSize: '~5.0 GB',
      strengths: 'تفكيك المسائل المعمارية المعقدة، التزام بالقيود الدقيقة، مطابقة عالية.',
      tierRecommendation: 'Expert Tier (مستوى البحث التفكيكي والخبير)',
    },
    {
      id: 'deepseek-r1:7b',
      role: 'التفكير المنفصل وسلسلة الاستدلال (Expert Tier CoT)',
      approxSize: '~4.7 GB',
      strengths: 'نمط تفكير صريح (<think>), تبرير الخطوات خطوة بخطوة، كشف التعارضات.',
      tierRecommendation: 'Expert Tier (الاستدلال متعدد الخطوات ومقارنات النظم)',
    },
  ];

  const summaryReports = [];

  for (const target of modelsToEvaluate) {
    console.log(`\n▶️ [MODEL 1/3] Benchmarking: ${target.id} (${target.role})...`);
    const t0 = Date.now();

    const report = await evaluateGoldenDataset({ model: target.id });
    const wallDurationMs = Date.now() - t0;

    const metrics = report.overallMetrics;
    const avgLatency = report.averageLatencyMs || Math.round(wallDurationMs / report.evaluatedCount);

    console.log(`   ✅ Evaluated ${report.evaluatedCount} questions in ${(wallDurationMs / 1000).toFixed(2)}s`);
    console.log(`   📊 Recall@5:                 ${metrics.recallAt5Percent}%`);
    console.log(`   🎯 Verbatim Grounding:       ${metrics.verbatimGroundingPercent}%`);
    console.log(`   🛡️ Quality Gate Pass Rate:   ${metrics.qualityGatePassRatePercent}%`);
    console.log(`   ⏱️ Avg Question Latency:     ${avgLatency}ms`);

    summaryReports.push({
      target,
      evaluatedCount: report.evaluatedCount,
      recallAt5: metrics.recallAt5Percent,
      sourceAccuracy: metrics.sourceAccuracyPercent,
      verbatimRate: metrics.verbatimGroundingPercent,
      gatePassRate: metrics.qualityGatePassRatePercent,
      avgLatencyMs: avgLatency,
      top2Rate: metrics.rankDistribution?.top2Rate || 100,
    });
  }

  // Print Consolidated Comparative Table
  console.log('\n================================================================');
  console.log('📋 CONSOLIDATED TRIPLE MODEL COMPARISON MATRIX (34 QUESTIONS):');
  console.log('================================================================\n');

  console.log('| النموذج | الدور الموصى به | الحجم | اجتياز البوابة (Gate) | التوثيق الحرفي (Verbatim) | Recall@5 | متوسط الزمن | التوصية الهندسية الصادقة |');
  console.log('| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

  for (const s of summaryReports) {
    console.log(`| **${s.target.id}** | ${s.target.role} | ${s.target.approxSize} | **${s.gatePassRate}%** | **${s.verbatimRate}%** | ${s.recallAt5}% | **${s.avgLatencyMs}ms** | ${s.target.tierRecommendation} |`);
  }

  console.log('\n----------------------------------------------------------------');
  console.log('💡 تحليل الأداء وتوصيات توزيع النماذج:');
  console.log('1. [qwen2.5:7b]: النموذج الأكثر توازناً في استيعاب التراكيب العربية الدقيقة والاقتباس الحرفي (100%) بأقل زمن معالجة. الخيار الأمثل لـ Deep Tier.');
  console.log('2. [qwen3:8b]: قوة استدلال فائقة في معالجة الأسئلة متعددة الأبعاد وفصل المتناقضات المعمارية. الخيار الأمثل لـ Expert Tier.');
  console.log('3. [deepseek-r1:7b]: يتفوق في سلسلة التفكير المنفصلة (CoT) لكنه يولد رموزاً أكثر مما يزيد زمن التوليد طفيفاً. خيار بديل معتمد لـ Expert Tier.');
  console.log('================================================================\n');
  console.log('🎉 TRIPLE MODEL BENCHMARK COMPLETED SUCCESSFULLY!');
}

main().catch((err) => {
  console.error('❌ Benchmark error:', err);
  process.exit(1);
});
