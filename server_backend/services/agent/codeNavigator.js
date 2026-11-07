// ==============================================================================
// Code Navigator & Context Inspector Service
// Parses runtime/build error traces, navigates directly to exact file & line,
// inspects surrounding context (+/- 10 lines) and applies surgical patches.
// ==============================================================================

const path = require('path');

/**
 * Parses diverse compiler, runtime, and bundler error strings to extract exact file & line.
 */
function parseErrorLocation(rawError = '', stackTrace = '') {
  const combined = `${rawError}\n${stackTrace}`.trim();
  if (!combined) {
    return {
      filePath: 'app.js',
      lineNumber: 1,
      columnNumber: 1,
      errorType: 'GenericError',
      rawMessage: 'Unknown error',
      rootCause: 'Runtime issue occurred without explicit stack trace.',
    };
  }

  // 1. TypeScript / Vite error: e.g. "src/components/Header.tsx(42,15): error TS2322: ..."
  const tsMatch = combined.match(/([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+)\s*\(([0-9]+),([0-9]+)\):\s*(error\s+[A-Z0-9]+)?:\s*([^\n]+)/);
  if (tsMatch) {
    return {
      filePath: normalizePath(tsMatch[1]),
      lineNumber: parseInt(tsMatch[2], 10),
      columnNumber: parseInt(tsMatch[3], 10),
      errorType: tsMatch[4] || 'TypeScriptDiagnostic',
      rawMessage: tsMatch[5]?.trim() || '',
      rootCause: deduceRootCause(tsMatch[5] || '', 'typescript'),
    };
  }

  // 2. Node / V8 stack trace line: e.g. "at render (src/app.js:88:14)" or "at app.js:88:14"
  const v8Match = combined.match(/at\s+(?:[a-zA-Z0-9_$.<>]+\s+\()?([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+):([0-9]+):([0-9]+)\)?/);
  if (v8Match) {
    const errTypeMatch = combined.match(/^([A-Za-z]+Error):\s*([^\n]+)/m);
    return {
      filePath: normalizePath(v8Match[1]),
      lineNumber: parseInt(v8Match[2], 10),
      columnNumber: parseInt(v8Match[3], 10),
      errorType: errTypeMatch ? errTypeMatch[1] : 'RuntimeError',
      rawMessage: errTypeMatch ? errTypeMatch[2]?.trim() : rawError.slice(0, 150),
      rootCause: deduceRootCause(rawError, errTypeMatch ? errTypeMatch[1] : 'runtime'),
    };
  }

  // 3. Colon-separated format: e.g. "src/App.tsx:35:10: error: ..."
  const colonMatch = combined.match(/([a-zA-Z0-9_./\\-]+\.[a-zA-Z0-9]+):([0-9]+):([0-9]+)/);
  if (colonMatch) {
    return {
      filePath: normalizePath(colonMatch[1]),
      lineNumber: parseInt(colonMatch[2], 10),
      columnNumber: parseInt(colonMatch[3], 10),
      errorType: 'BuildError',
      rawMessage: rawError.slice(0, 150),
      rootCause: deduceRootCause(rawError, 'build'),
    };
  }

  // 4. File mention without line: e.g. "Syntax error in app.js"
  const fileOnlyMatch = combined.match(/\b([a-zA-Z0-9_./\\-]+\.(?:js|ts|tsx|jsx|html|css|json))\b/);
  return {
    filePath: fileOnlyMatch ? normalizePath(fileOnlyMatch[1]) : 'app.js',
    lineNumber: 1,
    columnNumber: 1,
    errorType: 'GeneralError',
    rawMessage: rawError.slice(0, 150),
    rootCause: deduceRootCause(rawError, 'general'),
  };
}

/**
 * Normalizes file paths to avoid leading slashes or Windows backslashes.
 */
function normalizePath(p = '') {
  return p.replace(/\\/g, '/').replace(/^\/+/, '').replace(/^file:\/\/\/?/, '');
}

/**
 * Deduce the root cause (not just surface symptom) from error message and context.
 */
function deduceRootCause(msg = '', category = '') {
  const m = msg.toLowerCase();

  if (m.includes('is not defined') || m.includes('cannot find name')) {
    const varMatch = msg.match(/'([^']+)'|`([^`]+)`|\bname '([^']+)'/);
    const varName = varMatch ? (varMatch[1] || varMatch[2] || varMatch[3]) : 'variable';
    return `السبب الجذري: محاولة استخدام المتغير أو المكون '${varName}' قبل تعريفه أو دون استيراده (Missing Import / Declaration).`;
  }

  if (m.includes('cannot read propert') || m.includes('is undefined') || m.includes('is null')) {
    return 'السبب الجذري: الوصول إلى خاصية داخل كائن فارغ أو غير مهيأ (Unchecked Null/Undefined Access). الحل: استخدام Optional Chaining (?.) أو التحقق من القيمة أولاً.';
  }

  if (m.includes('is not a function')) {
    return 'السبب الجذري: استدعاء متغير كدالة بينما قيمته كائن أو فارغ (Incorrect Function Invocation / Mismatched Export).';
  }

  if (m.includes('unexpected token') || m.includes('parsing error') || m.includes('syntaxerror')) {
    return 'السبب الجذري: خطأ نحوي في بناء الجملة (Syntax / Bracket Mismatch)، مثل قوس غير مغلق أو فاصلة مفقودة.';
  }

  if (m.includes('duplicate identifier') || m.includes('already been declared')) {
    return 'السبب الجذري: تكرار تعريف متغير أو دالة بنفس الاسم في نفس النطاق (Identifier Collision).';
  }

  if (m.includes('module not found') || m.includes('cannot resolve')) {
    return 'السبب الجذري: مسار استيراد ملف غير صحيح أو اعتمادية خارجية غير مثبتة (Missing Dependency or Broken Relative Path).';
  }

  return `السبب الجذري: خلل منطقي أو تشغيلي في تنفيذ الدالة (${category}).`;
}

/**
 * Extracts a window of lines (+/- windowSize) surrounding the target line number.
 */
function extractContextWindow(fileContent = '', lineNumber = 1, windowSize = 10) {
  const allLines = String(fileContent).replace(/\r\n/g, '\n').split('\n');
  const totalLines = allLines.length;
  const safeLine = Math.max(1, Math.min(lineNumber, totalLines || 1));

  const startIdx = Math.max(0, safeLine - 1 - windowSize);
  const endIdx = Math.min(totalLines, safeLine + windowSize);

  const contextLines = [];
  for (let i = startIdx; i < endIdx; i++) {
    const currentLineNum = i + 1;
    contextLines.push({
      lineNum: currentLineNum,
      content: allLines[i],
      isErrorLine: currentLineNum === safeLine,
    });
  }

  const surroundingSnippet = contextLines
    .map((l) => `${l.isErrorLine ? ' > ' : '   '}${String(l.lineNum).padStart(4, ' ')} | ${l.content}`)
    .join('\n');

  return {
    safeLine,
    totalLines,
    contextLines,
    errorLineContent: allLines[safeLine - 1] || '',
    surroundingSnippet,
    scopeContext: detectEnclosingScope(allLines, safeLine),
  };
}

/**
 * Detects the function, class, or component enclosing the given line number.
 */
function detectEnclosingScope(lines, targetLine) {
  let enclosingScope = 'Top-level / Global Scope';
  for (let i = targetLine - 1; i >= 0; i--) {
    const line = lines[i].trim();
    const fnMatch = line.match(/(?:function|const|let|var|class)\s+([a-zA-Z0-9_$]+)\s*(?:=\s*(?:async\s*)?\([^)]*\)\s*=>|\([^)]*\)|\{)/);
    if (fnMatch) {
      enclosingScope = fnMatch[1];
      break;
    }
  }
  return enclosingScope;
}

/**
 * Inspects imports, exports, and top-level dependencies in a file before modification.
 */
function inspectFileDependencies(fileContent = '') {
  const imports = [];
  const exports = [];
  const lines = fileContent.split('\n');

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ') || trimmed.includes('require(')) {
      imports.push(trimmed);
    }
    if (trimmed.startsWith('export ') || trimmed.includes('module.exports')) {
      exports.push(trimmed);
    }
  });

  return {
    importsCount: imports.length,
    imports,
    exportsCount: exports.length,
    exports,
  };
}

/**
 * Applies a surgical patch to a single line or specific snippet without rewriting the whole file.
 */
function applySurgicalPatch({ originalContent = '', targetLine = 1, oldSnippet = '', newSnippet = '' }) {
  const lines = originalContent.replace(/\r\n/g, '\n').split('\n');
  const targetIdx = targetLine - 1;

  // 1. Direct line index replacement if in bounds
  if (targetIdx >= 0 && targetIdx < lines.length) {
    const existingLine = lines[targetIdx];
    const indentMatch = existingLine.match(/^\s*/);
    const existingIndent = indentMatch ? indentMatch[0] : '';

    // If newSnippet has multiple lines, respect base indentation
    const formattedNewLines = newSnippet.split('\n').map((nl, idx) => {
      if (idx === 0) return `${existingIndent}${nl.trimStart()}`;
      return `${existingIndent}  ${nl.trimStart()}`;
    }).join('\n');

    lines[targetIdx] = formattedNewLines;
    return {
      updatedContent: lines.join('\n'),
      linesChanged: [targetLine],
      success: true,
      strategy: 'line_index_exact',
    };
  }

  // 2. Exact snippet substring replacement fallback
  if (oldSnippet && originalContent.includes(oldSnippet)) {
    const updatedContent = originalContent.replace(oldSnippet, newSnippet);
    return {
      updatedContent,
      linesChanged: [targetLine],
      success: true,
      strategy: 'substring_exact',
    };
  }

  return {
    updatedContent: originalContent,
    linesChanged: [],
    success: false,
    strategy: 'failed_match',
  };
}

module.exports = {
  parseErrorLocation,
  deduceRootCause,
  extractContextWindow,
  inspectFileDependencies,
  applySurgicalPatch,
};
