/**
 * Default model adapters for the Smart Intent Router (Layers 3/6/7).
 *
 * - Local tier: workspaceModelRouter.chat (Ollama fleet, qwen2.5:7b — $0).
 *   Tool calling is never used; untrusted text is XML-isolated upstream.
 * - Cloud tier: Gemini flash text model, server-side key only (never
 *   logged, never sent to the client). Used ONLY as the fallback hop.
 *
 * Both are injectable in tests; the router never imports network code
 * directly beyond this adapter module.
 */

export const ROUTER_CLOUD_MODEL = process.env.ROUTER_CLOUD_MODEL || 'gemini-2.5-flash';
const ROUTER_TIMEOUT_MS = Number(process.env.ROUTER_LLM_TIMEOUT_MS || 20000);

/** Local classification call through the platform model router (CJS interop). */
export async function defaultLocalLlm({ system, user, maxTokens = 300 }) {
  const mod = await import('../../server_backend/services/ai/workspaceModelRouter.js');
  const router = mod.default || mod;
  const res = await router.chat({
    modelId: null, // workspace default chat model (qwen2.5:7b on the fleet)
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    maxTokens,
    timeoutMs: ROUTER_TIMEOUT_MS,
  });
  return String(res?.text || '');
}

/** Cloud fallback: Gemini flash, JSON-mime output, server-side key only. */
export async function defaultCloudLlm({ system, user, maxTokens = 300 }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    const err = new Error('cloud classifier not configured');
    err.code = 'ROUTER_CLOUD_NOT_CONFIGURED';
    throw err;
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${ROUTER_CLOUD_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: maxTokens,
        responseMimeType: 'application/json',
      },
    }),
    signal: AbortSignal.timeout(ROUTER_TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`cloud classifier HTTP ${res.status}`);
    err.code = 'ROUTER_CLOUD_HTTP';
    throw err;
  }
  const data = await res.json();
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts.map((p) => p?.text || '').join('').trim();
}

/** Bundle used by the orchestrator when no adapters are injected (production). */
export function defaultRouterLlm() {
  return { local: defaultLocalLlm, cloud: defaultCloudLlm };
}
