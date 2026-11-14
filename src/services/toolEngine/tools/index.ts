// ==============================================================================
// ENGINEER — CORE TOOLS INITIALIZATION
// Boots and mounts all 6 essential tool suites into Universal Tool Registry
// ==============================================================================

import { registerBrowserTools } from './browserTools';
import { registerCodeIntelligenceTools } from './codeIntelligenceTools';
import { registerDatabaseTools } from './databaseTools';
import { registerFileTools } from './fileTools';
import { registerTerminalTools } from './terminalTools';
import { registerVersionTools } from './versionTools';

let initialized = false;

export function initializeCoreTools(): void {
  if (initialized) return;

  registerFileTools();
  registerTerminalTools();
  registerCodeIntelligenceTools();
  registerDatabaseTools();
  registerBrowserTools();
  registerVersionTools();

  initialized = true;
}
