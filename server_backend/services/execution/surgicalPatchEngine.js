/**
 * surgicalPatchEngine.js
 * Capability 11: Context-Aware File Editing (Smart Execution)
 *
 * Utilizes the AST Code Graph to apply targeted, context-aware surgical patches
 * to specific functions, components, or elements, protecting preexisting code,
 * comments, and features from destruction or corruption.
 */

function findSymbolTarget(files = {}, targetSymbolName = '', codeGraph = null) {
  if (codeGraph && codeGraph.nodes) {
    for (const [filename, node] of Object.entries(codeGraph.nodes)) {
      const match = node.symbols.find(s => s.name === targetSymbolName);
      if (match) return { filename, symbol: match };
    }
  }

  // Fallback scan across files
  for (const [filename, content] of Object.entries(files)) {
    if (typeof content !== 'string') continue;
    if (content.includes(`function ${targetSymbolName}`) ||
        content.includes(`const ${targetSymbolName}`) ||
        content.includes(`id="${targetSymbolName}"`)) {
      return { filename, symbol: { name: targetSymbolName } };
    }
  }

  return null;
}

function applySurgicalPatch(files = {}, targetSymbol = '', newCode = '', codeGraph = null) {
  const updatedFiles = { ...files };
  const target = findSymbolTarget(files, targetSymbol, codeGraph);

  if (!target) {
    // If target not directly found, check if it's a DOM ID replacement in HTML
    if (targetSymbol.startsWith('#') && updatedFiles['index.html']) {
      const id = targetSymbol.slice(1);
      const regex = new RegExp(`(<[^>]+id=["']${id}["'][^>]*>)([\\s\\S]*?)(<\\/[^>]+>)`, 'i');
      if (regex.test(updatedFiles['index.html'])) {
        updatedFiles['index.html'] = updatedFiles['index.html'].replace(regex, `$1${newCode}$3`);
        return {
          success: true,
          patchedFile: 'index.html',
          targetSymbol,
          files: updatedFiles,
          method: 'dom_element_patch'
        };
      }
    }

    return {
      success: false,
      error: `Target symbol "${targetSymbol}" could not be located in codebase`,
      files
    };
  }

  const { filename } = target;
  let fileContent = updatedFiles[filename];

  // Replace function / arrow function body safely
  const funcPattern = new RegExp(`((?:async\\s+)?function\\s+${targetSymbol}\\s*\\([\\s\\S]*?\\)\\s*\\{)([\\s\\S]*?)(\\n\\s*\\})`, 'm');
  const arrowPattern = new RegExp(`((?:const|let)\\s+${targetSymbol}\\s*=\\s*(?:async\\s*)?\\([\\s\\S]*?\\)\\s*=>\\s*\\{)([\\s\\S]*?)(\\n\\s*\\})`, 'm');

  if (funcPattern.test(fileContent)) {
    fileContent = fileContent.replace(funcPattern, `$1\n${newCode}$3`);
  } else if (arrowPattern.test(fileContent)) {
    fileContent = fileContent.replace(arrowPattern, `$1\n${newCode}$3`);
  } else if (fileContent.includes(targetSymbol)) {
    // Append or replace block
    fileContent += `\n/* Surgically Patched Symbol: ${targetSymbol} */\n${newCode}\n`;
  }

  updatedFiles[filename] = fileContent;

  return {
    success: true,
    patchedFile: filename,
    targetSymbol,
    files: updatedFiles,
    method: 'ast_symbol_patch'
  };
}

function surgicalPatch(originalContent = '', targetChunk = '', replacementChunk = '') {
  if (!targetChunk) return originalContent;
  if (originalContent.includes(targetChunk)) {
    return originalContent.replace(targetChunk, replacementChunk);
  }
  return originalContent;
}

function computePatchDiff(originalContent = '', patchedContent = '') {
  const origLines = originalContent.split('\n');
  const patchedLines = patchedContent.split('\n');
  const changedLines = [];

  const maxLen = Math.max(origLines.length, patchedLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (origLines[i] !== patchedLines[i]) {
      changedLines.push({
        line: i + 1,
        before: origLines[i] || '',
        after: patchedLines[i] || ''
      });
    }
  }

  return {
    changedLines,
    totalChanges: changedLines.length,
    originalLinesCount: origLines.length,
    patchedLinesCount: patchedLines.length
  };
}

module.exports = {
  findSymbolTarget,
  applySurgicalPatch,
  surgicalPatch,
  computePatchDiff
};
