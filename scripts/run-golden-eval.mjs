#!/usr/bin/env node
// ==============================================================================
// Golden Evaluation Dataset Runner CLI
// Evaluates research accuracy, grounding rate, and gate pass score.
// ==============================================================================

import { evaluateGoldenDataset } from '../server_backend/services/research/goldenDatasetManager.js';
import { getDb } from '../server_backend/db/database.js';

async function main() {
  console.log('================================================================');
  console.log('🏆 RUNNING GOLDEN EVALUATION DATASET BENCHMARK HARNESS');
  console.log('================================================================\n');

  getDb();
  const report = await evaluateGoldenDataset();

  console.log(`Evaluated ${report.evaluatedCount} benchmark queries across 5 domains + behavioral tests.\n`);
  let idx = 1;
  for (const r of report.results) {
    const status = r.recallAt5 && r.qualityGatePassed ? '✅ PASS' : '⚠️ GAP ';
    console.log(`[${status}] #${idx++} [${r.category.toUpperCase()}] "${r.query}"`);
    console.log(`      المصدر المسترجع: ${r.primaryBook}`);
    console.log(`      Recall@5 Rank: ${r.hitRank} | الاقتباس الحرفي: ${r.verbatimPassRate}% | بوابة الجودة: ${r.qualityGateScore} | زمن البحث: ${r.durationMs}ms\n`);
  }

  console.log('----------------------------------------------------------------');
  console.log('📊 DOMAIN RECALL@5 & QUALITY BREAKDOWN:');
  if (report.overallMetrics.domainBreakdown) {
    for (const [dom, stats] of Object.entries(report.overallMetrics.domainBreakdown)) {
      console.log(`  - [${dom.toUpperCase()}]: Recall@5: ${stats.recallAt5Rate}% (${stats.total} questions) | Gate Pass: ${stats.gatePassRate}%`);
    }
  }
  console.log('----------------------------------------------------------------');
  console.log('📈 OVERALL BENCHMARK METRICS:');
  console.log(`  - Recall@5 Rate:             ${report.overallMetrics.recallAt5Percent}% (Threshold: >= 80%)`);
  console.log(`  - Source Accuracy:           ${report.overallMetrics.sourceAccuracyPercent}%`);
  console.log(`  - Verbatim Grounding Rate:   ${report.overallMetrics.verbatimGroundingPercent}%`);
  console.log(`  - Quality Gate Pass Rate:    ${report.overallMetrics.qualityGatePassRatePercent}%`);
  console.log('----------------------------------------------------------------\n');

  if (report.overallMetrics.recallAt5Percent < 80) {
    console.error(`⛔ Golden Dataset Recall@5 is ${report.overallMetrics.recallAt5Percent}%, below the required 80% threshold.`);
    process.exit(1);
  }

  if (report.overallMetrics.sourceAccuracyPercent < 70) {
    console.error('⛔ Golden Dataset Accuracy is below 70% threshold.');
    process.exit(1);
  }

  console.log('🎉 GOLDEN EVALUATION DATASET HARNESS COMPLETED SUCCESSFULLY!');
}

main().catch((err) => {
  console.error('Fatal Error running golden eval:', err);
  process.exit(1);
});
