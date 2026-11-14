// ==============================================================================
// ENGINEER — CODE INTELLIGENCE SUITE (Core Tool 3)
// AST Parsing, Dependency Graph, Symbol Impact Analysis & Code Search
// ==============================================================================

import {
  buildProjectDependencyGraph,
  calculateSymbolImpact,
  parseSymbolsInFile,
} from '../../engineering/codeIntelligenceEngine';
import {
  ToolExecutionContext,
  UniversalToolDefinition,
  universalToolRegistry,
} from '../universalToolRegistry';

export const codeParseSymbolsTool: UniversalToolDefinition = {
  id: 'code.parse_symbols',
  version: '1.0.0',
  name: 'Parse Code Symbols (AST)',
  category: 'code',
  description: 'Parses functions, classes, interfaces, and API endpoints from a project file using AST analysis.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Relative path of the file to inspect' },
    },
    required: ['filePath'],
  },
  riskLevel: 'safe',
  requiredPermission: 'read',
  timeoutMs: 5000,
  enabled: true,
  handler: async (params: { filePath: string }, context: ToolExecutionContext) => {
    const file = context.project?.files?.find(
      (f: any) => f.path.replace(/^\/+/, '') === params.filePath.replace(/^\/+/, '') || f.name === params.filePath
    );
    if (!file) {
      throw new Error(`File '${params.filePath}' not found in project.`);
    }

    const symbols = parseSymbolsInFile(params.filePath, file.content);
    return { filePath: params.filePath, totalSymbols: symbols.length, symbols };
  },
};

export const codeDependencyGraphTool: UniversalToolDefinition = {
  id: 'code.dependency_graph',
  version: '1.0.0',
  name: 'Build Dependency Graph',
  category: 'code',
  description: 'Analyzes all project files and builds an import/export dependency graph with cycle detection.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  riskLevel: 'safe',
  requiredPermission: 'read',
  timeoutMs: 10000,
  enabled: true,
  handler: async (_params: any, context: ToolExecutionContext) => {
    const files = context.project?.files || [];
    const graph = buildProjectDependencyGraph(files);
    return graph;
  },
};

export const codeSymbolImpactTool: UniversalToolDefinition = {
  id: 'code.symbol_impact',
  version: '1.0.0',
  name: 'Calculate Symbol Impact',
  category: 'code',
  description: 'Identifies all caller sites across all files before modifying an API, function, or component.',
  inputSchema: {
    type: 'object',
    properties: {
      targetSymbol: { type: 'string', description: 'Name of the function, component, or symbol' },
      definitionFile: { type: 'string', description: 'File where the symbol is defined' },
    },
    required: ['targetSymbol', 'definitionFile'],
  },
  riskLevel: 'safe',
  requiredPermission: 'read',
  timeoutMs: 10000,
  enabled: true,
  handler: async (
    params: { targetSymbol: string; definitionFile: string },
    context: ToolExecutionContext
  ) => {
    const files = context.project?.files || [];
    const impact = calculateSymbolImpact(params.targetSymbol, params.definitionFile, files);
    return impact;
  },
};

export function registerCodeIntelligenceTools(): void {
  universalToolRegistry.registerTool(codeParseSymbolsTool);
  universalToolRegistry.registerTool(codeDependencyGraphTool);
  universalToolRegistry.registerTool(codeSymbolImpactTool);
}
