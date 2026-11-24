// ==============================================================================
// server_backend/services/ai/codeCompletion.js
// AI Coding Assistant — real inline code completion (FIM-style).
//
// Honest-by-design contract:
//   * The completion comes from the configured coding model via the workspace
//     model router — NEVER from canned/static snippets.
//   * On any model failure the endpoint FAILS honestly (errorCode + message);
//     it never fabricates a fake "smart" suggestion.
//   * Output is sanitized to raw code only (fences/prose stripped) and bounded.
// ==============================================================================
'use strict';

const MAX_PREFIX_CHARS = 4000;
const MAX_SUFFIX_CHARS = 1000;
const MAX_COMPLETION_CHARS = 600;

const SYSTEM_PROMPT = [
  'You are a precise code-completion engine embedded in an IDE.',
  'Continue the code exactly at the marker <CURSOR>.',
  'Rules:',
  '- Output ONLY raw code that fits at the cursor. No markdown fences, no explanation, no comments about the task.',
  '- Match the file language, indentation and existing style.',
  '- If the file is an Arabic RTL website, keep Arabic copy consistent with the existing content.',
  '- Complete the smallest sensible unit (a line, a block, a closing tag). Do NOT repeat the code that already exists before or after the cursor.',
  '- If no meaningful completion exists, output nothing.',
].join('\n');

/**
 * Builds the chat messages for a fill-in-the-middle completion.
 * Inputs are bounded here so a huge file cannot blow up the prompt.
 */
function buildCompletionMessages({ path, language, prefix, suffix }) {
  const safePrefix = String(prefix || '').slice(-MAX_PREFIX_CHARS);
  const safeSuffix = String(suffix || '').slice(0, MAX_SUFFIX_CHARS);
  const user = [
    `File: ${String(path || 'untitled')} (${String(language || 'text')})`,
    '```',
    safePrefix + '<CURSOR>' + safeSuffix,
    '```',
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

/**
 * Turns raw model output into insertable code.
 * Strips markdown fences/prose wrappers, trims to the cursor boundary,
 * and caps the length. Returns '' when nothing usable remains.
 */
function sanitizeCompletion(raw) {
  let text = String(raw || '');
  if (!text.trim()) return '';

  // Strip a single wrapping fence pair if the model disobeyed.
  const fenced = text.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?```\s*$/);
  if (fenced) text = fenced[1];

  // Drop leading prose line if it clearly is not code ("Here is...", "إليك...").
  text = text.replace(/^(?:Here(?:'s| is)[^\n]*|إليك[^\n]*|التكملة[^\n]*)\n/i, '');

  // Never echo the marker itself.
  text = text.replace(/<CURSOR>/g, '');

  // Trim trailing whitespace-only tail but keep leading indentation of first line.
  text = text.replace(/\s+$/g, '');
  if (!text.trim()) return '';

  if (text.length > MAX_COMPLETION_CHARS) {
    // Cut at the last newline inside the budget to avoid half tokens.
    const cut = text.lastIndexOf('\n', MAX_COMPLETION_CHARS);
    text = text.slice(0, cut > 40 ? cut : MAX_COMPLETION_CHARS);
  }
  return text;
}

module.exports = {
  buildCompletionMessages,
  sanitizeCompletion,
  MAX_PREFIX_CHARS,
  MAX_SUFFIX_CHARS,
  MAX_COMPLETION_CHARS,
};
