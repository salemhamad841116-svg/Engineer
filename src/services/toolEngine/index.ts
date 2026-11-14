// ==============================================================================
// ENGINEER — UNIVERSAL TOOL EXECUTION ENGINE (Phase 3 Master Entrypoint)
// ==============================================================================

export * from './universalToolRegistry';
export * from './aiProviderAdapter';
export * from './toolExecutionOrchestrator';
export * from './toolAuditService';
export * from './tools/index';
export * from '../engineering/hardenedCoreEngines';
export * from '../engineering/codeIntelligenceEngine';

import { initializeCoreTools } from './tools/index';
initializeCoreTools();

