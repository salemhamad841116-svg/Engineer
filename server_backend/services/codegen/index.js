/**
 * codegen/index.js
 * Unified Code Generation & Blueprint Engine for Engineer AI Development Platform
 */

const blueprintRepository = require('./blueprintRepository');
const freestyleGenerator = require('./freestyleGenerator');
const surgicalEditor = require('./surgicalEditor');
const visionToCode = require('./visionToCode');
const autoPackageInstaller = require('./autoPackageInstaller');
const autoDatabaseWiring = require('./autoDatabaseWiring');
const urlCloner = require('./urlCloner');

module.exports = {
  // Sub-modules
  blueprintRepository,
  freestyleGenerator,
  surgicalEditor,
  visionToCode,
  autoPackageInstaller,
  autoDatabaseWiring,
  urlCloner,

  // 1. Blueprints Repository
  BLUEPRINTS: blueprintRepository.BLUEPRINTS,
  listBlueprints: blueprintRepository.listBlueprints,
  getBlueprint: blueprintRepository.getBlueprint,
  getBlueprintById: blueprintRepository.getBlueprintById,
  getAllBlueprints: blueprintRepository.getAllBlueprints,
  matchBlueprintForPrompt: blueprintRepository.matchBlueprintForPrompt,

  // 2. Freestyle Full-Stack Generator
  generateFreestyleApp: freestyleGenerator.generateFreestyleApp,
  buildZakatCalculatorFiles: freestyleGenerator.buildZakatCalculatorFiles,

  // 3. Surgical AST/Diff Editing
  surgicalEdit: surgicalEditor.surgicalEdit,
  applySurgicalEdit: surgicalEditor.applySurgicalEdit,

  // 4. Vision-to-Code Engine
  synthesizeFromVision: visionToCode.synthesizeFromVision,

  // 5. Auto-Package Installer
  detectAndInjectPackages: autoPackageInstaller.detectAndInjectPackages,
  PACKAGE_REGISTRY: autoPackageInstaller.PACKAGE_REGISTRY,

  // 6. Auto-Database & Persistence Wiring
  wireDatabaseAndPersistence: autoDatabaseWiring.wireDatabaseAndPersistence,
  generateWiringScript: autoDatabaseWiring.generateWiringScript,

  // 7. URL-to-App Cloning
  cloneFromUrl: urlCloner.cloneFromUrl
};
