/**
 * astCodeGraph.js
 * Capability 05: Advanced Code Understanding (Coding Intelligence)
 *
 * Constructs a bidirectional AST & Symbol Dependency Graph across
 * repository files, mapping components, functions, imports, and cross-file
 * dependencies before any surgical edits or refactorings are performed.
 */

const crypto = require('crypto');

function extractSymbolsFromSource(content = '', filename = '') {
  const symbols = [];
  const lines = content.split('\n');

  // Match function declarations: function foo(), const bar = () =>, async function baz()
  const funcRegex = /(?:export\s+)?(?:async\s+)?function\s+([a-zA-Z0-9_$]+)\s*\(/g;
  let match;
  while ((match = funcRegex.exec(content)) !== null) {
    symbols.push({
      name: match[1],
      kind: 'function',
      file: filename,
      isExported: match[0].includes('export')
    });
  }

  // Match arrow functions: const foo = (...) =>
  const arrowRegex = /(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g;
  while ((match = arrowRegex.exec(content)) !== null) {
    symbols.push({
      name: match[1],
      kind: 'arrow_function',
      file: filename,
      isExported: match[0].includes('export')
    });
  }

  // Match Class declarations: class MyClass
  const classRegex = /(?:export\s+)?class\s+([a-zA-Z0-9_$]+)/g;
  while ((match = classRegex.exec(content)) !== null) {
    symbols.push({
      name: match[1],
      kind: 'class',
      file: filename,
      isExported: match[0].includes('export')
    });
  }

  // Match React components: function MyComponent(props), const MyComponent = ...
  const compRegex = /(?:export\s+)?(?:default\s+)?function\s+([A-Z][a-zA-Z0-9_$]+)\s*\(/g;
  while ((match = compRegex.exec(content)) !== null) {
    if (!symbols.some(s => s.name === match[1])) {
      symbols.push({
        name: match[1],
        kind: 'react_component',
        file: filename,
        isExported: match[0].includes('export')
      });
    }
  }

  // Match imports: import { a, b } from './path' or require('./path')
  const imports = [];
  const importRegex = /import\s+(?:\{([^}]+)\}|([a-zA-Z0-9_$]+))\s+from\s+['"]([^'"]+)['"]/g;
  while ((match = importRegex.exec(content)) !== null) {
    const importedItems = match[1] ? match[1].split(',').map(s => s.trim()) : [match[2]];
    imports.push({
      modulePath: match[3],
      importedSymbols: importedItems
    });
  }

  return { symbols, imports, lineCount: lines.length };
}

function buildCodeGraph(files = {}, options = {}) {
  const nodes = {};
  const edges = [];
  let totalSymbols = 0;
  let totalDependencies = 0;

  for (const [filename, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    const { symbols, imports, lineCount } = extractSymbolsFromSource(content, filename);
    totalSymbols += symbols.length;
    totalDependencies += imports.length;

    nodes[filename] = {
      filename,
      symbols,
      imports,
      lineCount,
      hash: crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
    };
  }

  // Build dependency edges
  for (const [filename, node] of Object.entries(nodes)) {
    for (const imp of node.imports) {
      // Find target file in graph
      const target = Object.keys(nodes).find(f => {
        const normImp = imp.modulePath.replace(/^\.\//, '').replace(/\.(ts|tsx|js|jsx)$/, '');
        const normF = f.replace(/\.(ts|tsx|js|jsx)$/, '');
        return normF.endsWith(normImp) || normF === normImp;
      });

      if (target) {
        edges.push({
          source: filename,
          target,
          importedSymbols: imp.importedSymbols
        });
      }
    }
  }

  // Check circular dependencies
  const circularPaths = [];
  for (const e1 of edges) {
    for (const e2 of edges) {
      if (e1.source === e2.target && e1.target === e2.source) {
        const key = [e1.source, e1.target].sort().join('<->');
        if (!circularPaths.includes(key)) {
          circularPaths.push(key);
        }
      }
    }
  }

  const versionHash = crypto.createHash('sha256')
    .update(Object.keys(files).sort().join(',') + totalSymbols)
    .digest('hex');

  return {
    versionHash,
    fileCount: Object.keys(nodes).length,
    symbolsCount: totalSymbols,
    dependenciesCount: totalDependencies,
    nodes,
    edges,
    circularDependencies: circularPaths,
    hasCircularDependency: circularPaths.length > 0,
    generatedAt: new Date().toISOString()
  };
}

function saveCodeGraphToDb(db, projectId, graph) {
  if (!db || !projectId || !graph) return false;
  const id = 'graph_' + projectId + '_' + Date.now();
  const stmt = db.prepare(`
    INSERT INTO project_code_graphs (
      id, project_id, version_hash, graph_json, symbols_count, dependencies_count, file_count, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  stmt.run(
    id,
    projectId,
    graph.versionHash,
    JSON.stringify(graph),
    graph.symbolsCount,
    graph.dependenciesCount,
    graph.fileCount
  );
  return id;
}

module.exports = {
  buildCodeGraph,
  saveCodeGraphToDb,
  extractSymbolsFromSource
};
