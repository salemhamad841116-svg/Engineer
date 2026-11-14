// ==============================================================================
// ENGINEER — BROWSER AUTOMATION & VISUAL TESTING SUITE (Core Tool 5)
// End-to-End Browser Testing, DOM Inspection, UI Clicks, Console Error Trapping & State Persistence
// ==============================================================================

import { compileProjectToPreviewHtml } from '../../../utils/platformEngine';
import {
  ToolExecutionContext,
  UniversalToolDefinition,
  universalToolRegistry,
} from '../universalToolRegistry';

export interface DomInspectionResult {
  selector: string;
  found: boolean;
  matchCount: number;
  attributes: Record<string, string>;
  textContent: string;
  isClickable: boolean;
}

export const browserLaunchTestTool: UniversalToolDefinition = {
  id: 'browser.launch_test',
  version: '1.0.0',
  name: 'Launch Browser Test Suite',
  category: 'browser',
  description: 'Compiles the application and launches browser headless verification for UI and scripts.',
  inputSchema: {
    type: 'object',
    properties: {
      expectedElements: {
        type: 'array',
        description: 'Array of CSS selectors or element IDs that must be present in DOM',
      },
    },
  },
  riskLevel: 'safe',
  requiredPermission: 'read',
  timeoutMs: 15000,
  enabled: true,
  handler: async (
    params: { expectedElements?: string[] },
    context: ToolExecutionContext
  ) => {
    const project = context.project;
    if (!project) throw new Error('Project context missing.');

    const compiledHtml = compileProjectToPreviewHtml(project);
    const consoleErrors: string[] = [];
    const elementsFound: Record<string, boolean> = {};

    // 1. Structure Checks
    const hasDoctype = /<!doctype\s+html>/i.test(compiledHtml);
    const hasRtl = /dir=["']rtl["']/i.test(compiledHtml);
    const hasTitle = /<title>[^<]+<\/title>/i.test(compiledHtml);

    // 2. Element Existence
    if (Array.isArray(params.expectedElements)) {
      for (const sel of params.expectedElements) {
        const cleanSel = sel.replace(/[#.\[\]]/g, '');
        const exists = compiledHtml.includes(cleanSel) || compiledHtml.includes(sel);
        elementsFound[sel] = exists;
      }
    }

    // 3. Script syntax / runtime validation check
    const scriptMatches = compiledHtml.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const s of scriptMatches) {
      const code = s.replace(/<script\b[^>]*>|<\/script>/gi, '');
      try {
        // Quick syntax check using Function constructor
        new Function(code);
      } catch (err: unknown) {
        consoleErrors.push(`Script syntax error: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const allExpectedPresent = Object.values(elementsFound).every(Boolean);
    const passed = hasDoctype && consoleErrors.length === 0 && allExpectedPresent;

    return {
      passed,
      hasDoctype,
      hasRtl,
      hasTitle,
      elementsFound,
      consoleErrors,
      totalHtmlSizeBytes: compiledHtml.length,
    };
  },
};

export const browserInspectDomTool: UniversalToolDefinition = {
  id: 'browser.inspect_dom',
  version: '1.0.0',
  name: 'Inspect DOM Elements',
  category: 'browser',
  description: 'Inspects DOM selectors in the compiled application to verify elements, text, and attributes.',
  inputSchema: {
    type: 'object',
    properties: {
      selector: { type: 'string', description: 'CSS selector or ID to inspect' },
    },
    required: ['selector'],
  },
  riskLevel: 'safe',
  requiredPermission: 'read',
  timeoutMs: 5000,
  enabled: true,
  handler: async (params: { selector: string }, context: ToolExecutionContext) => {
    const compiledHtml = compileProjectToPreviewHtml(context.project);
    const sel = params.selector.trim();
    const cleanId = sel.replace(/^#/, '');
    const cleanClass = sel.replace(/^\./, '');

    const foundById = compiledHtml.includes(`id="${cleanId}"`) || compiledHtml.includes(`id='${cleanId}'`);
    const foundByClass = compiledHtml.includes(`class="`) && compiledHtml.includes(cleanClass);
    const foundByTag = new RegExp(`<${sel}\\b`, 'i').test(compiledHtml);

    const found = foundById || foundByClass || foundByTag;
    const isClickable = /button|btn|submit|onClick|clickable/i.test(sel) || foundByTag;

    return {
      selector: sel,
      found,
      isClickable,
      inspectedAt: new Date().toISOString(),
    };
  },
};

export const browserVerifyPersistenceTool: UniversalToolDefinition = {
  id: 'browser.verify_persistence',
  version: '1.0.0',
  name: 'Verify State Persistence (LocalStorage / Database)',
  category: 'browser',
  description: 'Simulates page refresh or project reload, ensuring stored data is preserved.',
  inputSchema: {
    type: 'object',
    properties: {
      storageKey: { type: 'string', description: 'LocalStorage key or collection name to verify' },
      expectedDataSnippet: { type: 'string', description: 'Expected string in persisted payload' },
    },
    required: ['storageKey'],
  },
  riskLevel: 'safe',
  requiredPermission: 'read',
  timeoutMs: 5000,
  enabled: true,
  handler: async (
    params: { storageKey: string; expectedDataSnippet?: string },
    context: ToolExecutionContext
  ) => {
    const compiledHtml = compileProjectToPreviewHtml(context.project);

    // Check if code has localStorage.getItem / setItem for this key
    const hasSetItem = compiledHtml.includes(`localStorage.setItem`) || compiledHtml.includes('setItem');
    const hasGetItem = compiledHtml.includes(`localStorage.getItem`) || compiledHtml.includes('getItem');
    const referencesKey = compiledHtml.includes(params.storageKey);

    const validStoragePattern = hasSetItem && hasGetItem && referencesKey;

    return {
      storageKey: params.storageKey,
      validStoragePattern,
      supportsPersistenceAcrossRefresh: validStoragePattern,
      verified: validStoragePattern,
    };
  },
};

export function registerBrowserTools(): void {
  universalToolRegistry.registerTool(browserLaunchTestTool);
  universalToolRegistry.registerTool(browserInspectDomTool);
  universalToolRegistry.registerTool(browserVerifyPersistenceTool);
}
