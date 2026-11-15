/**
 * quality/index.js
 * Quality & Delivery Group (Capabilities 13 to 18)
 */

const acceptanceTestGenerator = require('./acceptanceTestGenerator');
const selfHealingPipeline = require('./selfHealingPipeline');
const livePreviewGate = require('./livePreviewGate');
const dbApiAutoWirer = require('./dbApiAutoWirer');
const versionedSnapshots = require('./versionedSnapshots');
const engineeringEvaluator = require('./engineeringEvaluator');

module.exports = {
  acceptanceTestGenerator,
  selfHealingPipeline,
  livePreviewGate,
  dbApiAutoWirer,
  versionedSnapshots,
  engineeringEvaluator,

  // Direct helper & class exports
  generateAcceptanceTests: acceptanceTestGenerator.generateAcceptanceTests,
  executeAcceptanceTests: acceptanceTestGenerator.executeAcceptanceTests,

  runSelfHealingPipeline: selfHealingPipeline.runSelfHealingPipeline,

  evaluatePreviewReadiness: livePreviewGate.evaluatePreviewReadiness,

  wireDatabaseAndApi: dbApiAutoWirer.wireDatabaseAndApi,
  verifyRoundTripPersistence: dbApiAutoWirer.verifyRoundTripPersistence,

  VersionedSnapshots: versionedSnapshots.VersionedSnapshots,

  calculateImprovementRatio: engineeringEvaluator.calculateImprovementRatio,
  evaluateEngineeringPerformance: engineeringEvaluator.evaluateEngineeringPerformance
};
