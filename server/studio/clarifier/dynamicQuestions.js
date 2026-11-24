/**
 * dynamicQuestions.js — Layer 3 (core): Local LLM Dynamic Questioning.
 *
 * For non-traditional requests outside the deterministic bank, a local model
 * (qwen2.5:7b, $0) drafts 1–3 focused questions through a validated JSON
 * channel. Hard 800ms circuit-breaker (Layer 9): on timeout or invalid JSON
 * the engine proceeds with smart defaults — never blocks the client.
 */

import { validateDynamicQuestions } from './clarifierSchema.js';

export const CIRCUIT_BREAKER_MS = 800;

export class CircuitBreakerSkip extends Error {
  constructor(reason) {
    super(reason || 'dynamic questioning exceeded the circuit breaker');
    this.code = 'CIRCUIT_BREAKER_SKIPPED';
  }
}

const SYSTEM_PROMPT = [
  'You are a requirements clarifier for an app-building platform.',
  'Given the user request and the missing information slots, draft focused',
  'multiple-choice questions. Reply with STRICT JSON only — no prose, no',
  'markdown fences. Schema: {"questions":[{"slot":"snake_case","selection_mode":"single|multi",',
  '"options":[{"value":"snake_case","label_hint":"short label"}]}]} — 1 to 3',
  'questions, 2 to 4 options each.',
].join(' ');

export function buildDynamicMessages({ message, missingSlots, intent }) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        request: String(message || '').slice(0, 500),
        intent: intent || 'unknown',
        missing_slots: missingSlots || [],
      }),
    },
  ];
}

/**
 * Run dynamic questioning with the injected local LLM. `llm.complete` must
 * accept ({ messages, signal }) and resolve to { text }. Any timeout, throw,
 * or schema violation raises CircuitBreakerSkip — the engine treats it as a
 * first-class honest outcome, never a crash.
 */
export async function runDynamicQuestions({ llm, message, missingSlots, intent, timeoutMs = CIRCUIT_BREAKER_MS }) {
  if (!llm || typeof llm.complete !== 'function') {
    throw new CircuitBreakerSkip('no local llm available');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const out = await llm.complete({
      messages: buildDynamicMessages({ message, missingSlots, intent }),
      signal: controller.signal,
    });
    const text = String((out && out.text) || '').trim();
    const jsonStart = text.indexOf('{');
    const jsonEnd = text.lastIndexOf('}');
    if (jsonStart < 0 || jsonEnd <= jsonStart) throw new CircuitBreakerSkip('llm returned no json');
    let parsed;
    try {
      parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    } catch {
      throw new CircuitBreakerSkip('llm json parse failed');
    }
    return validateDynamicQuestions(parsed).questions;
  } catch (err) {
    if (err instanceof CircuitBreakerSkip) throw err;
    if (err && (err.name === 'AbortError' || err.code === 'ABORT_ERR')) {
      throw new CircuitBreakerSkip('timeout');
    }
    if (err && err.name === 'ZodError') throw new CircuitBreakerSkip('llm output failed schema validation');
    throw new CircuitBreakerSkip((err && err.message) || 'llm failure');
  } finally {
    clearTimeout(timer);
  }
}
