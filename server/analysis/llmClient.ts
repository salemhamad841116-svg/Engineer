/**
 * OpenAI-compatible LLM client for the Engineer platform gateway.
 *
 * Works with every provider documented in the platform .env contract:
 *   LLM_PROVIDER=ollama   LLM_BASE_URL=http://127.0.0.1:11434/v1
 *   LLM_PROVIDER=vllm     LLM_BASE_URL=http://localhost:8000/v1
 *   LLM_PROVIDER=gemini   LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
 *   LLM_PROVIDER=openai   LLM_BASE_URL=https://api.openai.com/v1
 *
 * All of them expose the same /chat/completions contract.
 *
 * Security (platform constitution):
 * - The API key is read from env at call time and NEVER logged or returned.
 * - Untrusted content (decompiled code may contain adversarial strings) is
 *   wrapped in XML tags and the system prompt forbids treating it as
 *   instructions. Tool calling is NOT requested — text in, text out.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmConfig {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string | null;
}

const DEFAULTS: Record<string, { baseUrl: string; model: string }> = {
  ollama: { baseUrl: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
  vllm: { baseUrl: "http://localhost:8000/v1", model: "Qwen/Qwen2.5-32B-Instruct-AWQ" },
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash" },
  openai: { baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
};

export function loadLlmConfig(env: NodeJS.ProcessEnv = process.env): LlmConfig {
  const provider = (env.LLM_PROVIDER ?? "ollama").toLowerCase();
  const fallback = DEFAULTS[provider] ?? DEFAULTS.ollama;
  return {
    provider,
    baseUrl: (env.LLM_BASE_URL ?? fallback.baseUrl).replace(/\/$/, ""),
    model: env.LLM_MODEL ?? fallback.model,
    apiKey: env.LLM_API_KEY ?? null,
  };
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface ChatResult {
  ok: boolean;
  content: string | null;
  error: string | null;
  model: string;
  provider: string;
}

export async function chat(
  messages: ChatMessage[],
  config: LlmConfig = loadLlmConfig(),
  opts: ChatOptions = {},
): Promise<ChatResult> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["Authorization"] = `Bearer ${config.apiKey}`;

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 1200,
        stream: false,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
    });
    if (!res.ok) {
      return { ok: false, content: null, error: `LLM HTTP ${res.status}`, model: config.model, provider: config.provider };
    }
    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content ?? null;
    if (content === null) {
      return { ok: false, content: null, error: "empty LLM response", model: config.model, provider: config.provider };
    }
    return { ok: true, content, error: null, model: config.model, provider: config.provider };
  } catch (err) {
    return {
      ok: false, content: null,
      error: err instanceof Error ? err.message : String(err),
      model: config.model, provider: config.provider,
    };
  }
}

/** Wrap untrusted binary-derived text so the model treats it as DATA only. */
export function isolateUntrusted(tag: string, content: string): string {
  // Neutralize closing-tag escape attempts from inside the content.
  const sanitized = content.replaceAll(`</${tag}>`, `<\\/${tag}>`);
  return `<${tag}>\n${sanitized}\n</${tag}>`;
}
