/**
 * Image provider layer — Phase 1 (Smart Studio).
 *
 * Selected by env: IMAGE_PROVIDER=gemini | openai-compatible
 * Defaults: gemini when GEMINI_API_KEY exists (owner decision 2026-11-20:
 * Gemini only during development), else the existing OpenAI-compatible
 * MEDIA_IMAGE_* contract. Unconfigured => honest BLOCKED, never a fake image.
 *
 * FAL_KEY (Flux inpainting) plugs in here later without touching callers.
 */

const GEMINI_MODEL = () => process.env.IMAGE_GEMINI_MODEL || 'gemini-2.5-flash-image';
const ASPECTS = new Set(['1:1', '16:9', '9:16', '4:3', '3:4']);

export function studioImageProviderStatus() {
  const forced = (process.env.IMAGE_PROVIDER || '').toLowerCase();
  if (process.env.IMAGE_PROVIDER_MOCK === '1') return { provider: 'mock', status: 'READY' };
  if (process.env.GEMINI_API_KEY) return { provider: 'gemini', status: 'READY', model: GEMINI_MODEL() };
  if (process.env.MEDIA_IMAGE_BASE_URL && process.env.MEDIA_IMAGE_API_KEY && process.env.MEDIA_IMAGE_MODEL) {
    return { provider: 'openai-compatible', status: 'READY', model: process.env.MEDIA_IMAGE_MODEL };
  }
  return { provider: forced || 'none', status: 'BLOCKED', reason: 'no image provider configured (set GEMINI_API_KEY or MEDIA_IMAGE_*)' };
}

async function generateViaGemini({ prompt, aspect, fetchImpl, reference = null }) {
  const model = GEMINI_MODEL();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  // Multimodal: the reference image (product/style anchor) precedes the brief.
  const reqParts = [];
  if (reference?.b64 && reference?.mime) {
    reqParts.push({ inlineData: { mimeType: reference.mime, data: reference.b64 } });
  }
  reqParts.push({ text: `${prompt}\n\nAspect ratio: ${aspect}.` });
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({
      contents: [{ parts: reqParts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }),
  });
  if (!res.ok) return { ok: false, error: `gemini HTTP ${res.status}` };
  const body = await res.json();
  const parts = body?.candidates?.[0]?.content?.parts || [];
  const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (!img) return { ok: false, error: 'gemini returned no image part' };
  return { ok: true, b64: img.inlineData?.data || img.inline_data?.data, mime: img.inlineData?.mimeType || img.inline_data?.mimeType || 'image/png', provider: 'gemini', model };
}

async function generateViaOpenAiCompat({ prompt, aspect, fetchImpl }) {
  const sizeMap = { '1:1': '1024x1024', '16:9': '1792x1024', '9:16': '1024x1792' };
  const res = await fetchImpl(`${process.env.MEDIA_IMAGE_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${process.env.MEDIA_IMAGE_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.MEDIA_IMAGE_MODEL,
      prompt,
      size: sizeMap[aspect] || '1024x1024',
      response_format: 'b64_json',
    }),
  });
  if (!res.ok) return { ok: false, error: `image-provider HTTP ${res.status}` };
  const body = await res.json();
  const b64 = body?.data?.[0]?.b64_json;
  if (!b64) return { ok: false, error: 'provider returned no image data' };
  return { ok: true, b64, mime: 'image/png', provider: 'openai-compatible', model: process.env.MEDIA_IMAGE_MODEL };
}

/**
 * Generate one image. fetchImpl injectable for tests.
 * @param {object} arg
 * @param {{b64:string, mime:string}} [arg.reference] product/style anchor
 *        passed as multimodal input (Gemini); ignored by the mock provider.
 * @returns {Promise<{ok:boolean, b64?:string, mime?:string, provider?:string, error?:string}>}
 */
export async function generateStudioImage({ prompt, aspect = '1:1', negative = '', reference = null, fetchImpl = fetch }) {
  if (!ASPECTS.has(aspect)) aspect = '1:1';
  const st = studioImageProviderStatus();
  if (st.status === 'BLOCKED') return { ok: false, blocked: true, error: st.reason };

  const fullPrompt = negative ? `${prompt}\n\nAvoid: ${negative}` : prompt;
  if (st.provider === 'mock') {
    // Test hook: deterministic 1x1 PNG, proves the pipeline without a real key.
    return {
      ok: true, provider: 'mock',
      b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      mime: 'image/png',
    };
  }
  if (st.provider === 'gemini') return generateViaGemini({ prompt: fullPrompt, aspect, fetchImpl, reference });
  return generateViaOpenAiCompat({ prompt: fullPrompt, aspect, fetchImpl });
}
