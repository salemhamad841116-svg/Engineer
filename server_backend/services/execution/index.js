/**
 * execution/index.js
 * Smart Execution Group (Capabilities 07 to 12)
 */

const runtimeProvisioner = require('./runtimeProvisioner');
const dependencyResolver = require('./dependencyResolver');
const backgroundJobQueue = require('./backgroundJobQueue');
const parallelWorkspaces = require('./parallelWorkspaces');
const surgicalPatchEngine = require('./surgicalPatchEngine');
const runtimeDebugger = require('./runtimeDebugger');

module.exports = {
  runtimeProvisioner,
  dependencyResolver,
  backgroundJobQueue,
  parallelWorkspaces,
  surgicalPatchEngine,
  runtimeDebugger,

  // Direct class & helper exports
  RuntimeProvisioner: runtimeProvisioner.RuntimeProvisioner,
  provisionRuntime: runtimeProvisioner.provisionRuntime,
  startRuntime: runtimeProvisioner.startRuntime,
  stopRuntime: runtimeProvisioner.stopRuntime,
  getRuntimeHealth: runtimeProvisioner.getRuntimeHealth,

  resolveDependencies: dependencyResolver.resolveDependencies,
  extractImportsFromFiles: dependencyResolver.extractImportsFromFiles,

  BackgroundJobQueue: backgroundJobQueue.BackgroundJobQueue,

  ParallelWorkspaces: parallelWorkspaces.ParallelWorkspaces,

  applySurgicalPatch: surgicalPatchEngine.applySurgicalPatch,
  findSymbolTarget: surgicalPatchEngine.findSymbolTarget,

  diagnoseRuntimeError: runtimeDebugger.diagnoseRuntimeError,
  classifyError: runtimeDebugger.classifyError,
  ERROR_TAXONOMY: runtimeDebugger.ERROR_TAXONOMY
};
