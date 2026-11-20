// ==============================================================================
// server_backend/services/agent/semanticParser.js
// Phase A — Semantic Project Index: structural code parser.
//
// Replaces regex/line-based code reading with real AST extraction:
//   - JS/TS/JSX/TSX/MJS/CJS are parsed with the official TypeScript Compiler API
//     (typescript package, pure JS — no native builds, Docker-safe).
//   - HTML files are scanned structurally: inline <script> blocks are parsed with
//     the same TS AST (positions offset-adjusted), elements with id/data-testid
//     become addressable symbols, inline event handlers become edges.
//   - CSS/SCSS/LESS files contribute selector symbols via a balanced-brace scan.
//
// Output contract (consumed by projectIndex.js — the only module with SQL):
//   {
//     language: 'javascript'|'typescript'|'html'|'css'|'json'|'text',
//     symbols: [{ name, kind, signature, parentName, lineStart, lineEnd,
//                 byteStart, byteEnd, exported }],
//     edges:   [{ type, fromFile, specifier, toFile, symbol, line, external }],
//   }
// kinds: function | component | class | method | variable | state | handler |
//        element | selector | route
// edge types: import | includes | dom-handler | calls
// ==============================================================================
'use strict';

const ts = require('typescript');

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const MAX_SIGNATURE = 160;
const MAX_SYMBOL_NAME = 120;

function extOf(relPath) {
  const i = relPath.lastIndexOf('.');
  return i >= 0 ? relPath.slice(i).toLowerCase() : '';
}

function languageFor(relPath) {
  const ext = extOf(relPath);
  if (ext === '.ts' || ext === '.tsx') return 'typescript';
  if (JS_EXTENSIONS.has(ext)) return 'javascript';
  if (ext === '.html' || ext === '.htm') return 'html';
  if (ext === '.css' || ext === '.scss' || ext === '.less') return 'css';
  if (ext === '.json') return 'json';
  return 'text';
}

// ---------------------------------------------------------------------------
// JS/TS family — real AST via the TypeScript Compiler API
// ---------------------------------------------------------------------------

function scriptKindFor(relPath) {
  const ext = extOf(relPath);
  if (ext === '.tsx') return ts.ScriptKind.TSX;
  if (ext === '.jsx') return ts.ScriptKind.JSX;
  if (ext === '.ts') return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function isPascalCase(name) {
  return /^[A-Z][A-Za-z0-9]*$/.test(name);
}

function isHandlerName(name) {
  return /^(handle|on)[A-Z]/.test(name);
}

function clip(text, max) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function positionOf(sf, pos) {
  const lc = sf.getLineAndCharacterOfPosition(pos);
  return { line: lc.line + 1, character: lc.character };
}

/**
 * Parses JS-family source into symbols + edges.
 * @param {string} relPath   project-relative path (used for edge fromFile)
 * @param {string} content   source text
 * @param {number} lineOffset  added to every reported line (for inline HTML scripts)
 * @param {number} byteOffset  added to every reported byte range
 */
function parseJavaScript(relPath, content, lineOffset = 0, byteOffset = 0) {
  const symbols = [];
  const edges = [];
  let sf;
  try {
    sf = ts.createSourceFile(
      relPath,
      content,
      ts.ScriptTarget.ES2022,
      /* setParentNodes */ true,
      scriptKindFor(relPath)
    );
  } catch (_err) {
    // A file that cannot be parsed at all contributes no symbols — honestly empty.
    return { symbols, edges };
  }

  const pushSymbol = (node, name, kind, parentName, extra = {}) => {
    if (!name || name.length > MAX_SYMBOL_NAME) return;
    const start = node.getStart(sf);
    const end = node.getEnd();
    const exported =
      (node.modifiers || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ||
      (extra.exported === true);
    symbols.push({
      name: String(name),
      kind,
      signature: extra.signature || null,
      parentName: parentName || null,
      lineStart: positionOf(sf, start).line + lineOffset,
      lineEnd: positionOf(sf, end).line + 1 + lineOffset,
      byteStart: start + byteOffset,
      byteEnd: end + byteOffset,
      exported: exported ? 1 : 0,
    });
  };

  const functionSignature = (node, name) => {
    const params = (node.parameters || []).map((p) => p.getText(sf)).join(', ');
    const asyncMark = (node.modifiers || []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ? 'async ' : '';
    return clip(`${asyncMark}${name}(${params})`, MAX_SIGNATURE);
  };

  /** True when a function body contains JSX (used with PascalCase → component). */
  function containsJsx(node) {
    let found = false;
    const visit = (n) => {
      if (found) return;
      if (
        n.kind === ts.SyntaxKind.JsxElement ||
        n.kind === ts.SyntaxKind.JsxSelfClosingElement ||
        n.kind === ts.SyntaxKind.JsxFragment
      ) {
        found = true;
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return found;
  }

  const classifyFunction = (name, node) => {
    if (isHandlerName(name)) return 'handler';
    if (isPascalCase(name) && containsJsx(node)) return 'component';
    return 'function';
  };

  const visit = (node, parentName) => {
    // --- imports → edges -------------------------------------------------
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const specifier = node.moduleSpecifier.text;
      edges.push({
        type: 'import',
        fromFile: relPath,
        specifier,
        symbol: null, // module-level edge; named bindings get their own edges below
        line: positionOf(sf, node.getStart(sf)).line + lineOffset,
        external: !specifier.startsWith('.'),
      });
      const named = node.importClause && node.importClause.namedBindings;
      if (named && ts.isNamedImports(named)) {
        for (const el of named.elements) {
          edges.push({
            type: 'import',
            fromFile: relPath,
            specifier,
            symbol: el.name.text,
            line: positionOf(sf, el.getStart(sf)).line + lineOffset,
            external: !specifier.startsWith('.'),
          });
        }
      }
      return; // no deeper descent needed inside an import
    }

    // --- re-exports: export { x } from './y' ------------------------------
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      edges.push({
        type: 'import',
        fromFile: relPath,
        specifier: node.moduleSpecifier.text,
        symbol: null,
        line: positionOf(sf, node.getStart(sf)).line + lineOffset,
        external: !node.moduleSpecifier.text.startsWith('.'),
      });
      return;
    }

    // --- require('...') edges ---------------------------------------------
    if (
      ts.isCallExpression(node) &&
      node.expression.getText(sf) === 'require' &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      const specifier = node.arguments[0].text;
      edges.push({
        type: 'import',
        fromFile: relPath,
        specifier,
        symbol: null,
        line: positionOf(sf, node.getStart(sf)).line + lineOffset,
        external: !specifier.startsWith('.'),
      });
    }

    // --- React state hooks -------------------------------------------------
    if (
      ts.isCallExpression(node) &&
      ts.isVariableDeclaration(node.parent) &&
      /^(useState|useReducer|useRef)$/.test(node.expression.getText(sf))
    ) {
      const decl = node.parent;
      let stateName = decl.name.getText(sf);
      if (ts.isArrayBindingPattern(decl.name) && decl.name.elements.length > 0) {
        const first = decl.name.elements[0];
        if (ts.isBindingElement(first) && ts.isIdentifier(first.name)) stateName = first.name.text;
      }
      pushSymbol(decl, stateName, 'state', parentName, {
        signature: clip(`${node.expression.getText(sf)} → ${stateName}`, MAX_SIGNATURE),
      });
    }

    // --- plain call references (used by list_dependents) -------------------
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sf);
      const simple = callee.split('.').pop();
      if (simple && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(simple)) {
        edges.push({
          type: 'calls',
          fromFile: relPath,
          specifier: null,
          symbol: simple,
          line: positionOf(sf, node.getStart(sf)).line + lineOffset,
          external: false,
        });
      }
    }

    // --- function declarations ---------------------------------------------
    if (ts.isFunctionDeclaration(node) && node.name) {
      const name = node.name.text;
      pushSymbol(node, name, classifyFunction(name, node), parentName, {
        signature: functionSignature(node, name),
      });
      ts.forEachChild(node, (child) => visit(child, name));
      return;
    }

    // --- classes + methods ---------------------------------------------------
    if (ts.isClassDeclaration(node) && node.name) {
      const name = node.name.text;
      pushSymbol(node, name, 'class', parentName, { signature: `class ${name}` });
      ts.forEachChild(node, (child) => visit(child, name));
      return;
    }
    if (ts.isMethodDeclaration(node) && node.name) {
      const name = node.name.getText(sf);
      pushSymbol(node, name, isHandlerName(name) ? 'handler' : 'method', parentName, {
        signature: functionSignature(node, name),
      });
      ts.forEachChild(node, (child) => visit(child, name));
      return;
    }

    // --- variable declarations (const x = …, arrow functions, components) -----
    if (ts.isVariableStatement(node)) {
      const stmtExported = (node.modifiers || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const decl of node.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;
        const init = decl.initializer;
        let kind = 'variable';
        let signature = null;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          kind = classifyFunction(name, init);
          signature = functionSignature(init, name);
        } else if (init && ts.isCallExpression(init) && /^(useState|useReducer|useRef)$/.test(init.expression.getText(sf))) {
          continue; // handled by the CallExpression branch above
        } else if (init) {
          kind = isPascalCase(name) && containsJsx(init) ? 'component' : 'variable';
          signature = clip(`const ${name} = …`, MAX_SIGNATURE);
        }
        pushSymbol(node, name, kind, parentName, { signature, exported: stmtExported });
      }
      // Descend into initializers with each declared name as scope parent.
      for (const decl of node.declarationList.declarations) {
        if (decl.initializer) {
          const childParent = ts.isIdentifier(decl.name) ? decl.name.text : parentName;
          visit(decl.initializer, childParent);
        }
      }
      return;
    }

    ts.forEachChild(node, (child) => visit(child, parentName));
  };

  ts.forEachChild(sf, (child) => visit(child, null));
  return { symbols, edges };
}

// ---------------------------------------------------------------------------
// HTML — structural scan; inline scripts go through the real JS AST
// ---------------------------------------------------------------------------

function parseHtml(relPath, content) {
  const symbols = [];
  const edges = [];
  const lineOfIndex = buildLineIndex(content);

  // 1. Inline <script> blocks → real AST with offset correction
  const scriptBlockRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = scriptBlockRe.exec(content)) !== null) {
    const attrs = m[1] || '';
    const body = m[2] || '';
    const srcMatch = srcMatchOf(attrs);
    if (srcMatch) {
      edges.push({
        type: 'includes',
        fromFile: relPath,
        specifier: srcMatch,
        symbol: null,
        line: lineOfIndex(m.index),
        external: /^https?:\/\//.test(srcMatch),
      });
      continue;
    }
    if (!body.trim()) continue;
    const bodyStart = m.index + m[0].indexOf('>') + 1;
    const lineOffset = lineOfIndex(bodyStart) - 1;
    const inner = parseJavaScript(relPath, body, lineOffset, bodyStart);
    symbols.push(...inner.symbols);
    edges.push(...inner.edges);
  }

  // 2. <link rel="stylesheet" href="..."> → includes edge
  const linkRe = /<link\b[^>]*>/gi;
  while ((m = linkRe.exec(content)) !== null) {
    const href = srcMatchOf(m[0], 'href');
    if (href) {
      edges.push({
        type: 'includes',
        fromFile: relPath,
        specifier: href,
        symbol: null,
        line: lineOfIndex(m.index),
        external: /^https?:\/\//.test(href),
      });
    }
  }

  // 3. Addressable elements: id="..." and data-testid="..." (per-tag scan so a
  //    tag carrying BOTH attributes contributes both symbols)
  const tagRe = /<(?!\/)([a-zA-Z][a-zA-Z0-9-]*)(\s[^<>]*)?>/g;
  while ((m = tagRe.exec(content)) !== null) {
    const tag = m[1];
    const attrs = m[2] || '';
    for (const attr of ['id', 'data-testid']) {
      const am = attrs.match(new RegExp(`(?:^|\\s)${attr}\\s*=\\s*"([^"]+)"`));
      if (!am) continue;
      const ident = am[1];
      symbols.push({
        name: ident,
        kind: 'element',
        signature: clip(`<${tag} ${attr}="${ident}">`, MAX_SIGNATURE),
        parentName: null,
        lineStart: lineOfIndex(m.index),
        lineEnd: lineOfIndex(m.index),
        byteStart: m.index,
        byteEnd: m.index + m[0].length,
        exported: 0,
      });
    }
  }

  // 4. Inline event handlers: onclick="saveNote()" → dom-handler edges
  const handlerRe = /\s(on[a-z]+)="([^"]*)"/gi;
  while ((m = handlerRe.exec(content)) !== null) {
    const body = m[2];
    const callMatch = body.match(/([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/);
    edges.push({
      type: 'dom-handler',
      fromFile: relPath,
      specifier: null,
      symbol: callMatch ? callMatch[1] : clip(body, MAX_SYMBOL_NAME),
      line: lineOfIndex(m.index),
      external: false,
    });
  }

  return { symbols, edges };
}

function srcMatchOf(tagText, attr = 'src') {
  const re = new RegExp(`${attr}\\s*=\\s*"([^"]+)"`, 'i');
  const mm = tagText.match(re);
  return mm ? mm[1] : null;
}

/** Returns a function mapping a byte index → 1-based line number. */
function buildLineIndex(content) {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') starts.push(i + 1);
  }
  return (idx) => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

// ---------------------------------------------------------------------------
// CSS — selector outline via balanced-brace scan (no regex line guessing)
// ---------------------------------------------------------------------------

function parseCss(relPath, content) {
  const symbols = [];
  const lineOfIndex = buildLineIndex(content);
  const noComments = content.replace(/\/\*[\s\S]*?\*\//g, (mm) => ' '.repeat(mm.length));
  let depth = 0;
  let selectorStart = 0;
  let i = 0;
  let inString = null;
  while (i < noComments.length) {
    const ch = noComments[i];
    if (inString) {
      if (ch === inString && noComments[i - 1] !== '\\') inString = null;
    } else if (ch === '"' || ch === "'") {
      inString = ch;
    } else if (ch === '{') {
      if (depth === 0) {
        const raw = noComments.slice(selectorStart, i).trim();
        const selector = raw.split(/[}]/).pop().trim();
        if (raw && !raw.startsWith('@')) {
          const name = clip(raw, MAX_SYMBOL_NAME);
          symbols.push({
            name,
            kind: 'selector',
            signature: name,
            parentName: null,
            lineStart: lineOfIndex(selectorStart),
            lineEnd: lineOfIndex(i),
            byteStart: selectorStart,
            byteEnd: i,
            exported: 0,
          });
        } else if (selector) {
          // @media / @keyframes block — keep scanning inside at depth 1
        }
      }
      depth++;
      selectorStart = i + 1;
    } else if (ch === '}') {
      depth = Math.max(0, depth - 1);
      selectorStart = i + 1;
    }
    i++;
  }
  return { symbols, edges: [] };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parses one project file into symbols + dependency edges.
 * Never throws on malformed input — a broken file yields an empty outline
 * (the agent must be able to index half-written projects mid-edit).
 */
function parseFile(relPath, content) {
  const path = String(relPath || '').replace(/^\/+/, '');
  const text = String(content ?? '');
  const language = languageFor(path);
  try {
    if (language === 'javascript' || language === 'typescript') {
      const { symbols, edges } = parseJavaScript(path, text);
      return { language, symbols, edges };
    }
    if (language === 'html') {
      const { symbols, edges } = parseHtml(path, text);
      return { language, symbols, edges };
    }
    if (language === 'css') {
      const { symbols, edges } = parseCss(path, text);
      return { language, symbols, edges };
    }
  } catch (_err) {
    return { language, symbols: [], edges: [] };
  }
  return { language, symbols: [], edges: [] };
}

module.exports = { parseFile, languageFor };
