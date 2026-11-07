#!/usr/bin/env node
// ==============================================================================
// Golden Evaluation Dataset Runner CLI
// Evaluates research accuracy, grounding rate, exact rank distribution,
// and quality gate pass score across Batch 1 (Reference) and Batch 2 (Stress).
// ==============================================================================

import { evaluateGoldenDataset } from '../server_backend/services/research/goldenDatasetManager.js';
import { getDb } from '../server_backend/db/database.js';

async function main() {
  const args = process.argv.slice(2);
  let requestedBatch = null;
  for (const a of args) {
    if (a.startsWith('--batch=')) {
      requestedBatch = a.split('=')[1];
    }
  }

  console.log('================================================================');
  console.log('🏆 RUNNING GOLDEN EVALUATION DATASET BENCHMARK HARNESS');
  console.log('================================================================\n');

  getDb();

  // If specific batch requested, run only that batch. Otherwise run Batch 1 and Batch 2.
  if (requestedBatch) {
    await runSingleBatch(requestedBatch);
  } else {
    console.log('▶️ EVALUATING BATCH 1: REFERENCE LIBRARY (24 QUESTIONS)...');
    const report1 = await runSingleBatch(1, false);

    console.log('\n▶️ EVALUATING BATCH 2: STRESS BENCHMARK (10 QUESTIONS TARGETING LIMITATIONS)...');
    const report2 = await runSingleBatch(2, false);

    console.log('================================================================');
    console.log('🌟 CONSOLIDATED BENCHMARK SUMMARY (BATCH 1 + BATCH 2):');
    console.log(`  - Total Benchmarks Evaluated:  ${report1.evaluatedCount + report2.evaluatedCount}`);
    console.log(`  - Batch 1 Recall@5:           ${report1.overallMetrics.recallAt5Percent}%`);
    console.log(`  - Batch 2 Recall@5:           ${report2.overallMetrics.recallAt5Percent}%`);
    const totalRank1 = (report1.overallMetrics.rankDistribution?.rank1Count || 0) + (report2.overallMetrics.rankDistribution?.rank1Count || 0);
    const totalRank2 = (report1.overallMetrics.rankDistribution?.rank2Count || 0) + (report2.overallMetrics.rankDistribution?.rank2Count || 0);
    const totalTop2 = totalRank1 + totalRank2;
    const totalCount = report1.evaluatedCount + report2.evaluatedCount;
    console.log(`  - Overall Top-2 Rank Rate:    ${((totalTop2 / totalCount) * 100).toFixed(1)}% (${totalTop2}/${totalCount} questions at Rank 1 or 2)`);
    console.log('================================================================\n');

    if (report1.overallMetrics.recallAt5Percent < 80 || report2.overallMetrics.recallAt5Percent < 80) {
      console.error('⛔ One or more Golden Dataset batches fell below the required 80% Recall@5 threshold.');
      process.exit(1);
    }
  }

  console.log('🎉 GOLDEN EVALUATION DATASET HARNESS COMPLETED SUCCESSFULLY!');
}

async function runSingleBatch(batchNum, exitOnError = true) {
  const report = await evaluateGoldenDataset({ batch: batchNum });

  console.log(`\n--- [BATCH ${batchNum}] Evaluated ${report.evaluatedCount} questions ---\n`);
  let idx = 1;
  for (const r of report.results) {
    const isSuccess = r.recallAt5 && r.qualityGatePassed;
    const status = isSuccess ? '✅ PASS' : '⚠️ GAP ';
    const rankStr = typeof r.hitRank === 'number' ? `Rank ${r.hitRank}` : r.hitRank;
    const rankBadge = r.hitRank === 1 ? '🥇 Rank 1' : (r.hitRank === 2 ? '🥈 Rank 2' : (r.hitRank <= 5 ? `🥉 ${rankStr}` : `❌ ${rankStr}`));

    console.log(`[${status}] #${idx++} [${r.category.toUpperCase()}] "${r.query}"`);
    if (r.limitationCategory) {
      console.log(`      الحد المستهدف: ${r.limitationCategory}`);
    }
    console.log(`      المصدر المسترجع: ${r.primaryBook}`);
    console.log(`      الترتيب: ${rankBadge} | الشواهد: ${r.citationsCount} | الاقتباس الحرفي: ${r.verbatimPassRate}% | البوابة: ${r.qualityGateScore} | زمن: ${r.durationMs}ms`);
    if (r.mitigationMechanism && r.mitigationMechanism !== 'N/A') {
      console.log(`      آلية التخفيف: ${r.mitigationMechanism}`);
    }
    if (r.analysis) {
      console.log(`      🔍 تحليل الترتيب: ${r.analysis}`);
    }
    console.log('');
  }

  console.log('----------------------------------------------------------------');
  console.log(`📊 BATCH ${batchNum} RANK DISTRIBUTION & PERFORMANCE METRICS:`);
  if (report.overallMetrics.rankDistribution) {
    const rd = report.overallMetrics.rankDistribution;
    console.log(`  - 🥇 Rank 1 Hits:            ${rd.rank1Count} (${((rd.rank1Count / report.evaluatedCount) * 100).toFixed(1)}%)`);
    console.log(`  - 🥈 Rank 2 Hits:            ${rd.rank2Count} (${((rd.rank2Count / report.evaluatedCount) * 100).toFixed(1)}%)`);
    console.log(`  - 🥉 Rank 3-5 Hits:          ${rd.rank3To5Count} (${((rd.rank3To5Count / report.evaluatedCount) * 100).toFixed(1)}%)`);
    console.log(`  - ❌ Missed (> Rank 5):      ${rd.rankMissCount}`);
    console.log(`  - 🎯 Top-2 Rate (Rank 1-2):   ${rd.top2Rate}%`);
  }
  console.log(`  - Recall@5 Rate:             ${report.overallMetrics.recallAt5Percent}% (Threshold: >= 80%)`);
  console.log(`  - Source Accuracy:           ${report.overallMetrics.sourceAccuracyPercent}%`);
  console.log(`  - Verbatim Grounding Rate:   ${report.overallMetrics.verbatimGroundingPercent}%`);
  console.log(`  - Quality Gate Pass Rate:    ${report.overallMetrics.qualityGatePassRatePercent}%`);
  console.log('----------------------------------------------------------------\n');

  if (exitOnError) {
    if (report.overallMetrics.recallAt5Percent < 80) {
      console.error(`⛔ Batch ${batchNum} Recall@5 is ${report.overallMetrics.recallAt5Percent}%, below the required 80% threshold.`);
      process.exit(1);
    }
    if (report.overallMetrics.sourceAccuracyPercent < 70) {
      console.error(`⛔ Batch ${batchNum} Accuracy is below 70% threshold.`);
      process.exit(1);
    }
  }

  return report;
}

main().catch((err) => {
  console.error('Fatal Error running golden eval:', err);
  process.exit(1);
});
