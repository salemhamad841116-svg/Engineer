/**
 * surgicalEditor.js
 * Surgical AST/Diff Editing for Engineer AI Development Platform
 *
 * Updates specific HTML/CSS/JS components or attributes without resetting the project.
 */

function surgicalEdit({ files = {}, selector = '', instruction = '', replacementHtml = '', updateCss = '' }) {
  const updatedFiles = { ...files };
  const htmlContent = updatedFiles['index.html'] || '';

  if (selector && replacementHtml && htmlContent) {
    // If element matching selector is found, surgically replace it
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      const regex = new RegExp(`(<[^>]+id=["']${id}["'][^>]*>)([\\s\\S]*?)(<\\/[^>]+>)`, 'i');
      if (regex.test(htmlContent)) {
        updatedFiles['index.html'] = htmlContent.replace(regex, `$1${replacementHtml}$3`);
      }
    }
  }

  if (updateCss && updatedFiles['styles.css']) {
    updatedFiles['styles.css'] += `\n/* Surgical Update: ${instruction} */\n${updateCss}\n`;
  }

  return {
    success: true,
    files: updatedFiles,
    instruction
  };
}

function applySurgicalEdit(htmlContent = '', { selector = '', newContent = '' } = {}) {
  if (selector && newContent && htmlContent) {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      const regex = new RegExp(`(<[^>]+id=["']${id}["'][^>]*>)([\\s\\S]*?)(<\\/[^>]+>)`, 'i');
      if (regex.test(htmlContent)) {
        return htmlContent.replace(regex, `$1${newContent}$3`);
      }
    }
  }
  return htmlContent;
}

module.exports = {
  surgicalEdit,
  applySurgicalEdit
};
