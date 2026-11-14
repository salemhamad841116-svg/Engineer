// ==============================================================================
// ENGINEER — ADVANCED CODE INTELLIGENCE ENGINE (Phase 2)
// AST Parsing, Symbol Indexing, Dependency Graph, Semantic Search & Impact Analysis
// Identifies all affected callers and call sites before committing changes.
// ==============================================================================

import { ProjectFile } from '../../types/platform';

export interface CodeSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'variable' | 'component' | 'api_endpoint' | 'type';
  filePath: string;
  line: number;
  exported: boolean;
  signature?: string;
  docComment?: string;
  parameters?: string[];
  returnType?: string;
}

export interface DependencyNode {
  filePath: string;
  imports: {
    source: string;
    resolvedPath?: string;
    importedSymbols: string[];
    isDefault: boolean;
  }[];
  exports: string[];
  dependsOn: string[];
  dependedOnBy: string[];
}

export interface DependencyGraph {
  nodes: Record<string, DependencyNode>;
  totalFiles: number;
  cyclesDetected: string[][];
}

export interface ImpactAnalysisResult {
  targetSymbol: string;
  definitionFile: string;
  definitionLine: number;
  totalCallSites: number;
  affectedFiles: string[];
  callSites: {
    filePath: string;
    line: number;
    snippet: string;
    contextScope: string;
  }[];
  breakingChangesRisk: 'none' | 'low' | 'medium' | 'high';
  riskExplanation: string;
  recommendedActions: string[];
  safeToProceed: boolean;
}

// -----------------------------------------------------------------------------
// 1. AST & Symbol Parser (ES6 / TypeScript / React / Node.js)
// -----------------------------------------------------------------------------

export function parseSymbolsInFile(filePath: string, content: string): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    const trimmed = line.trim();

    // 1. Exported or regular functions: e.g. function getUserById(id: string)
    const fnMatch = trimmed.match(/^(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)(?:\s*:\s*([^{]+))?/);
    if (fnMatch) {
      const isExported = trimmed.startsWith('export');
      symbols.push({
        name: fnMatch[1],
        kind: 'function',
        filePath,
        line: lineNum,
        exported: isExported,
        parameters: fnMatch[2].split(',').map((p) => p.trim()).filter(Boolean),
        returnType: fnMatch[3]?.trim(),
        signature: `${fnMatch[1]}(${fnMatch[2]})`,
      });
      return;
    }

    // 2. React Components / Arrow functions: e.g. export const UserProfile = ({ user }: Props) =>
    const arrowMatch = trimmed.match(/^(?:export\s+)?const\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*([^=]+))?\s*=>/);
    if (arrowMatch) {
      const isExported = trimmed.startsWith('export');
      const isComponent = /^[A-Z]/.test(arrowMatch[1]);
      symbols.push({
        name: arrowMatch[1],
        kind: isComponent ? 'component' : 'function',
        filePath,
        line: lineNum,
        exported: isExported,
        parameters: arrowMatch[2].split(',').map((p) => p.trim()).filter(Boolean),
        returnType: arrowMatch[3]?.trim(),
        signature: `${arrowMatch[1]}(${arrowMatch[2]})`,
      });
      return;
    }

    // 3. Classes: e.g. export class PaymentService
    const classMatch = trimmed.match(/^(?:export\s+)?class\s+([a-zA-Z0-9_$]+)(?:\s+extends\s+[a-zA-Z0-9_$]+)?/);
    if (classMatch) {
      symbols.push({
        name: classMatch[1],
        kind: 'class',
        filePath,
        line: lineNum,
        exported: trimmed.startsWith('export'),
        signature: `class ${classMatch[1]}`,
      });
      return;
    }

    // 4. Interfaces & Types: e.g. export interface UserAccount
    const typeMatch = trimmed.match(/^(?:export\s+)?(?:interface|type)\s+([a-zA-Z0-9_$]+)/);
    if (typeMatch) {
      symbols.push({
        name: typeMatch[1],
        kind: 'interface',
        filePath,
        line: lineNum,
        exported: trimmed.startsWith('export'),
        signature: typeMatch[0],
      });
      return;
    }

    // 5. REST API routes in Express/Fastify: e.g. app.get('/api/users/:id', ...
    const apiMatch = trimmed.match(/(?:app|router)\.(get|post|put|delete|patch)\(\s*['"`]([^'"`]+)['"`]/i);
    if (apiMatch) {
      symbols.push({
        name: `${apiMatch[1].toUpperCase()} ${apiMatch[2]}`,
        kind: 'api_endpoint',
        filePath,
        line: lineNum,
        exported: true,
        signature: `${apiMatch[1].toUpperCase()} ${apiMatch[2]}`,
      });
    }
  });

  return symbols;
}

// -----------------------------------------------------------------------------
// 2. Dependency Graph Generator
// -----------------------------------------------------------------------------

export function buildProjectDependencyGraph(files: ProjectFile[]): DependencyGraph {
  const nodes: Record<string, DependencyNode> = {};
  const normalizedFileMap: Record<string, string> = {};

  for (const f of files) {
    const cleanPath = f.path.replace(/^\/+/, '');
    normalizedFileMap[cleanPath] = cleanPath;
    normalizedFileMap[f.name] = cleanPath;
  }

  // Initialize nodes
  for (const f of files) {
    const cleanPath = f.path.replace(/^\/+/, '');
    nodes[cleanPath] = {
      filePath: cleanPath,
      imports: [],
      exports: [],
      dependsOn: [],
      dependedOnBy: [],
    };
  }

  // Parse imports and exports in each file
  for (const f of files) {
    const cleanPath = f.path.replace(/^\/+/, '');
    const node = nodes[cleanPath];
    if (!node) continue;

    const lines = f.content.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();

      // Extract ES imports: import { A, B } from './path'
      const importMatch = trimmed.match(/^import\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+)|\*\s+as\s+([a-zA-Z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/);
      if (importMatch) {
        const namedSymbols = importMatch[1] ? importMatch[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]) : [];
        const defaultSymbol = importMatch[2] || importMatch[3];
        const sourcePath = importMatch[4];

        // Resolve local path relative to current file
        const resolvedPath = resolveRelativePath(cleanPath, sourcePath, normalizedFileMap);
        node.imports.push({
          source: sourcePath,
          resolvedPath,
          importedSymbols: defaultSymbol ? [defaultSymbol, ...namedSymbols] : namedSymbols,
          isDefault: Boolean(defaultSymbol),
        });

        if (resolvedPath && nodes[resolvedPath]) {
          if (!node.dependsOn.includes(resolvedPath)) {
            node.dependsOn.push(resolvedPath);
          }
          if (!nodes[resolvedPath].dependedOnBy.includes(cleanPath)) {
            nodes[resolvedPath].dependedOnBy.push(cleanPath);
          }
        }
      }

      // Extract exports
      const exportMatch = trimmed.match(/^export\s+(?:default\s+)?(?:const|function|class|interface|type)?\s*([a-zA-Z0-9_$]+)/);
      if (exportMatch && exportMatch[1] && !node.exports.includes(exportMatch[1])) {
        node.exports.push(exportMatch[1]);
      }
    }
  }

  return {
    nodes,
    totalFiles: files.length,
    cyclesDetected: detectDependencyCycles(nodes),
  };
}

function resolveRelativePath(currentFile: string, importPath: string, fileMap: Record<string, string>): string | undefined {
  if (!importPath.startsWith('.')) return undefined; // External package like 'react'

  const currentDirParts = currentFile.split('/').slice(0, -1);
  const targetParts = importPath.split('/');

  for (const part of targetParts) {
    if (part === '.') continue;
    if (part === '..') {
      currentDirParts.pop();
    } else {
      currentDirParts.push(part);
    }
  }

  const resolvedBase = currentDirParts.join('/');
  const candidates = [
    resolvedBase,
    `${resolvedBase}.ts`,
    `${resolvedBase}.tsx`,
    `${resolvedBase}.js`,
    `${resolvedBase}.jsx`,
    `${resolvedBase}/index.ts`,
    `${resolvedBase}/index.js`,
  ];

  for (const cand of candidates) {
    if (fileMap[cand]) return fileMap[cand];
  }

  return undefined;
}

function detectDependencyCycles(nodes: Record<string, DependencyNode>): string[][] {
  const cycles: string[][] = [];
  const visited: Record<string, boolean> = {};
  const recStack: Record<string, boolean> = {};

  function dfs(curr: string, path: string[]) {
    visited[curr] = true;
    recStack[curr] = true;
    path.push(curr);

    const neighbors = nodes[curr]?.dependsOn || [];
    for (const neighbor of neighbors) {
      if (!visited[neighbor]) {
        dfs(neighbor, [...path]);
      } else if (recStack[neighbor]) {
        const cycleStartIndex = path.indexOf(neighbor);
        if (cycleStartIndex !== -1) {
          cycles.push(path.slice(cycleStartIndex));
        }
      }
    }

    recStack[curr] = false;
  }

  for (const file of Object.keys(nodes)) {
    if (!visited[file]) {
      dfs(file, []);
    }
  }

  return cycles;
}

// -----------------------------------------------------------------------------
// 3. Impact Analysis Engine (Identifies Call Sites & Breaking Risks)
// -----------------------------------------------------------------------------

export function calculateSymbolImpact(
  targetSymbol: string,
  definitionFile: string,
  projectFiles: ProjectFile[]
): ImpactAnalysisResult {
  const cleanDefPath = definitionFile.replace(/^\/+/, '');
  const defFile = projectFiles.find((f) => f.path.replace(/^\/+/, '') === cleanDefPath || f.name === cleanDefPath);

  let defLine = 1;
  if (defFile) {
    const lines = defFile.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(targetSymbol) && /(?:function|const|class|interface|type)\s+/.test(lines[i])) {
        defLine = i + 1;
        break;
      }
    }
  }

  const callSites: ImpactAnalysisResult['callSites'] = [];
  const affectedFilesSet = new Set<string>();

  // Regex to detect calls, instantiations, or symbol usages
  const symbolRegex = new RegExp(`\\b${escapeRegExp(targetSymbol)}\\b`);

  for (const file of projectFiles) {
    const cleanPath = file.path.replace(/^\/+/, '');
    const lines = file.content.split('\n');

    let currentScope = 'Global / Module Scope';
    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const lineNum = i + 1;

      // Track enclosing scope
      const scopeMatch = lineText.match(/(?:function|const|class)\s+([a-zA-Z0-9_$]+)/);
      if (scopeMatch) currentScope = scopeMatch[1];

      // Ignore the definition line itself in the definition file
      if (cleanPath === cleanDefPath && lineNum === defLine) continue;

      if (symbolRegex.test(lineText)) {
        // Exclude import statements from direct call sites, but record affected file
        const isImportLine = lineText.trim().startsWith('import ') || lineText.includes('require(');
        affectedFilesSet.add(cleanPath);

        if (!isImportLine) {
          callSites.push({
            filePath: cleanPath,
            line: lineNum,
            snippet: lineText.trim(),
            contextScope: currentScope,
          });
        }
      }
    }
  }

  const totalCallSites = callSites.length;
  const affectedFiles = Array.from(affectedFilesSet);

  let breakingChangesRisk: ImpactAnalysisResult['breakingChangesRisk'] = 'low';
  let riskExplanation = 'الرمز محلي أو قليل الاستخدام والتعديل منخفض الخطورة.';
  const recommendedActions: string[] = [];

  if (totalCallSites > 10 || affectedFiles.length > 3) {
    breakingChangesRisk = 'high';
    riskExplanation = `تغيير واجهة هذا الرمز ذو تأثير مرتفع (${totalCallSites} استدعاء عبر ${affectedFiles.length} ملفات). قد يسبب أخطاء وقت التشغيل إذا تغيرت المعاملات أو بنية البيانات.`;
    recommendedActions.push('تحديث معاملات الدالة تدريجياً مع دعم التوافق العكسي (Backward Compatibility).');
    recommendedActions.push('إجراء تعديل متزامن لكافة الاستدعاءات المتأثرة المدرجة في تقرير التأثير.');
    recommendedActions.push('تشغيل جناح اختبارات الانحدار (Regression Tests) بعد التعديل مباشرة.');
  } else if (totalCallSites > 0) {
    breakingChangesRisk = 'medium';
    riskExplanation = `يوجد ${totalCallSites} استدعاء في ${affectedFiles.length} ملفات يجب فحصها وتحديثها لضمان التوافق.`;
    recommendedActions.push('تحديث الاستدعاءات المتأثرة بالتزامن مع تعديل الدالة.');
  } else {
    recommendedActions.push('تعديل آمن: لا توجد استدعاءات خارجية متأثرة.');
  }

  return {
    targetSymbol,
    definitionFile: cleanDefPath,
    definitionLine: defLine,
    totalCallSites,
    affectedFiles,
    callSites,
    breakingChangesRisk,
    riskExplanation,
    recommendedActions,
    safeToProceed: breakingChangesRisk !== 'high',
  };
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
