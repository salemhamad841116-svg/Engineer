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

  console.log(`Evaluated ${report.evaluatedCount} benchmark queries.\n`);
  for (const r of report.results) {
    const status = r.hasExpectedBook && r.qualityGatePassed ? '✅ PASS' : '⚠️ WARN';
    console.log(`[${status}] [${r.category.toUpperCase()}] "${r.query.slice(0, 55)}..."`);
    console.log(`      Books: ${r.retrievedBooks.join(', ') || 'None'}`);
    console.log(`      Gate: ${r.qualityGateScore} | Verbatim: ${r.verbatimPassRate}% | Latency: ${r.durationMs}ms\n`);
  }

  console.log('----------------------------------------------------------------');
  console.log('📊 OVERALL METRICS:');
  console.log(`  - Source Accuracy:           ${report.overallMetrics.sourceAccuracyPercent}%`);
  console.log(`  - Verbatim Grounding Rate:   ${report.overallMetrics.verbatimGroundingPercent}%`);
  console.log(`  - Quality Gate Pass Rate:    ${report.overallMetrics.qualityGatePassRatePercent}%`);
  console.log('----------------------------------------------------------------\n');

  if (report.overallMetrics.sourceAccuracyPercent < 60) {
    console.error('⛔ Golden Dataset Accuracy is below 60% threshold.');
    process.exit(1);
  }

  console.log('🎉 GOLDEN EVALUATION DATASET HARNESS COMPLETED SUCCESSFULLY!');
}

main().catch((err) => {
  console.error('Fatal Error running golden eval:', err);
  process.exit(1);
});
