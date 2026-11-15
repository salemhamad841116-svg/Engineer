/**
 * intelligence/index.js
 * Coding Intelligence Group (Capabilities 01 to 06)
 */

const freestyleGenerator = require('./freestyleGenerator');
const projectArchitect = require('./projectArchitect');
const stackSelector = require('./stackSelector');
const repoScaffolder = require('./repoScaffolder');
const astCodeGraph = require('./astCodeGraph');
const codeRefactorer = require('./codeRefactorer');

module.exports = {
  freestyleGenerator,
  projectArchitect,
  stackSelector,
  repoScaffolder,
  astCodeGraph,
  codeRefactorer,

  // Direct helper exports
  generateFreestyleApp: freestyleGenerator.generateFreestyleApp,
  isGenericPrompt: freestyleGenerator.isGenericPrompt,
  getClarificationResponse: freestyleGenerator.getClarificationResponse,
  designArchitectureManifest: projectArchitect.designArchitectureManifest,
  selectStack: stackSelector.selectStack,
  scaffoldRepository: repoScaffolder.scaffoldRepository,
  buildCodeGraph: astCodeGraph.buildCodeGraph,
  saveCodeGraphToDb: astCodeGraph.saveCodeGraphToDb,
  refactorProject: codeRefactorer.refactorProject
};
