/**
 * Layer 2 — Deterministic Fast-Path Gate.
 *
 * Pure synchronous logic, zero model calls, sub-10ms by construction:
 * - Pre-flight guardrail (reject empty/invalid input before any credit burn).
 * - Direct-interaction priority: drawn mask -> image_edit, click-to-edit
 *   target -> ui_edit (never pass through the classifier).
 * - High-confidence direct commands (lexicon-driven substring matching).
 */
import { DIRECT_COMMAND_LEXICON } from './i18n/routerLexicon.js';
import { StudioError } from './studioErrors.js';

export const MAX_MESSAGE_LENGTH = 4000;

/** Pre-flight guardrail — throws StudioError(400) before any paid call. */
export function guardMessage(message) {
  if (message === null || message === undefined || typeof message !== 'string') {
    throw new StudioError(400, 'ROUTER_MESSAGE_INVALID', 'Message must be a string.');
  }
  const trimmed = message.trim();
  if (!trimmed) {
    throw new StudioError(400, 'ROUTER_MESSAGE_EMPTY', 'Message is empty.');
  }
  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    throw new StudioError(400, 'ROUTER_MESSAGE_TOO_LONG', `Message exceeds ${MAX_MESSAGE_LENGTH} characters.`);
  }
  // Reject control characters (except whitespace) — garbage in, garbage out.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(trimmed)) {
    throw new StudioError(400, 'ROUTER_MESSAGE_INVALID', 'Message contains invalid control characters.');
  }
  return trimmed;
}

/**
 * Deterministic fast-path. Returns null when nothing decisive matches
 * (the request then continues to the context/LLM layers).
 *
 * @returns {null | { intent: string, confidence: number, via: string,
 *                    direct_command: string|null }}
 */
export function fastPath({ normalized, signals }) {
  const s = signals || {};

  // 1) Direct-interaction priority — mask beats everything.
  if (s.has_mask) {
    return { intent: 'image_edit', confidence: 1.0, via: 'fast_path:mask', direct_command: null };
  }
  if (s.click_target) {
    return { intent: 'ui_edit', confidence: 1.0, via: 'fast_path:click_to_edit', direct_command: null };
  }

  // 2) High-confidence direct commands.
  const text = String(normalized || '').toLowerCase();
  for (const cmd of DIRECT_COMMAND_LEXICON) {
    if (cmd.patterns.some((p) => text.includes(p.toLowerCase()))) {
      return {
        intent: cmd.intent,
        confidence: 1.0,
        via: `fast_path:command:${cmd.id}`,
        direct_command: cmd.id,
      };
    }
  }

  return null;
}
