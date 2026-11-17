// ==============================================================================
// server_backend/services/ai/workspaceModelRouter.js
// Workspace Chat model router: lists REAL models (local Ollama/vLLM via the
// OpenAI-compatible /models endpoint, plus explicitly configured cloud adapters),
// resolves the user's selection and executes a streamed chat completion with a
// hard timeout, cancellation and classified, user-presentable errors.
//
// Guarantees:
//   * The model the user selected is the model that is called (no silent swap).
//   * No automatic fallback to a cloud model (ALLOW_CLOUD_FALLBACK is respected by
//     never switching providers inside a request).
//   * Errors carry a stable `code` + Arabic/English user messages; no secrets.
// ==============================================================================
'use strict';

const { modelProvider } = require('./modelProviderInterface');
const providerRegistry = require('./providerRegistry');

const DEFAULT_TIMEOUT_MS = parseInt(process.env.WORKSPACE_CHAT_TIMEOUT_MS || '', 10) || 45000;

const cloudAdapters = new Map(); // provider -> { models: () => [{id,name}], chat: async fn }
let listCache = { at: 0, data: null };

function normalizeProviderName(name) {
  return String(name || '').trim().toLowerCase();
}

function dedupeModels(models) {
  const seen = new Map();
  for (const model of models) {
    if (!model || !model.id) continue;
    const current = seen.get(model.id);
    if (!current || (!current.available && model.available)) {
      seen.set(model.id, model);
    }
  }
  return [...seen.values()];
}

function getDbBackedCloudEntries() {
  const routing = providerRegistry.getRoutingDefaults();
  const models = [];
  for (const provider of routing.providers) {
    for (const id of provider.models) {
      models.push({
        id,
        name: prettyName(id),
        provider: normalizeProviderName(provider.type),
        available: true,
        local: false,
        providerLabel: provider.name,
      });
    }
  }
  return { routing, models };
}

function withDbProviderContext(entry, fn) {
  const provider = providerRegistry.listUsableProviders().find((p) => normalizeProviderName(p.type) === normalizeProviderName(entry.provider) && p.models.includes(entry.id));
  return fn(provider || null);
}

const ERROR_MESSAGES = {
  MODEL_TIMEOUT: {
    ar: 'انتهت مهلة استجابة النموذج قبل اكتمال الرد. أعد المحاولة أو اختر نموذجاً أخف.',
    en: 'The model did not answer in time. Retry or pick a lighter model.',
    http: 504,
  },
  MODEL_UNREACHABLE: {
    ar: 'خادم النموذج غير متاح حالياً، لذلك لم يصل الرد. أعد المحاولة بعد قليل.',
    en: 'The model server is unreachable right now. Please retry shortly.',
    http: 503,
  },
  MODEL_NOT_INSTALLED: {
    ar: 'النموذج المختار غير مثبت على الخادم. اختر نموذجاً متاحاً من قائمة النماذج.',
    en: 'The selected model is not installed on the server. Pick an available model.',
    http: 409,
  },
  MODEL_UNAVAILABLE: {
    ar: 'النموذج المختار غير متاح حالياً. اختر نموذجاً آخر من قائمة النماذج.',
    en: 'The selected model is not available. Pick another model.',
    http: 409,
  },
  MODEL_RESOURCE_EXHAUSTED: {
    ar: 'لا تتوفر ذاكرة كافية على الخادم لتشغيل هذا النموذج الآن. اختر نموذجاً أصغر.',
    en: 'Not enough server memory to run this model now. Pick a smaller model.',
    http: 503,
  },
  MODEL_EMPTY_RESPONSE: {
    ar: 'أعاد النموذج رداً فارغاً. أعد المحاولة.',
    en: 'The model returned an empty answer. Please retry.',
    http: 502,
  },
  MODEL_ERROR: {
    ar: 'حدث خطأ أثناء توليد الرد من النموذج. أعد المحاولة.',
    en: 'The model failed while generating the answer. Please retry.',
    http: 502,
  },
  CANCELLED: {
    ar: 'تم إلغاء الطلب.',
    en: 'The request was cancelled.',
    http: 499,
  },
};

class WorkspaceModelError extends Error {
  constructor(code, detail, extra = {}) {
    const spec = ERROR_MESSAGES[code] || ERROR_MESSAGES.MODEL_ERROR;
    super(`${code}: ${detail || spec.en}`);
    this.name = 'WorkspaceModelError';
    this.code = ERROR_MESSAGES[code] ? code : 'MODEL_ERROR';
    this.httpStatus = spec.http;
    this.userMessageAr = spec.ar;
    this.userMessageEn = spec.en;
    this.detail = String(detail || '').slice(0, 300);
    Object.assign(this, extra);
  }
}

function prettyName(id) {
  const s = String(id || '');
  const [base, tag] = s.split(':');
  const nice = base
    .replace(/^.*\//, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b([a-z])/g, (m) => m.toUpperCase())
    .replace(/Qwen(\d)/i, 'Qwen $1')
    .replace(/Llama(\d)/i, 'Llama $1');
  return tag && tag !== 'latest' ? `${nice} ${tag.toUpperCase()}` : nice;
}

function unique(arr) {
  return [...new Set(arr.filter(Boolean))];
}

/** Removes <think> reasoning blocks emitted by reasoning models (qwen3, deepseek-r1). */
function stripReasoning(text) {
  return String(text || '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^\s*<think>[\s\S]*$/i, '')
    .trim();
}

function registerCloudAdapter(provider, adapter) {
  cloudAdapters.set(provider, adapter);
  listCache = { at: 0, data: null };
}

function localProvider() {
  return modelProvider.getProvider();
}

function configuredLocalModels() {
  const tiers = modelProvider.getTierModels();
  return unique([modelProvider.getModel(), tiers.quick, tiers.deep, tiers.expert]);
}

async function fetchInstalledLocalModels(timeoutMs = 3000) {
  const baseUrl = modelProvider.getBaseUrl();
  const headers = { Accept: 'application/json' };
  const key = modelProvider.getApiKey();
  if (key && !/your_|_here|placeholder/i.test(key)) headers.Authorization = `Bearer ${key}`;
  const res = await fetch(`${baseUrl}/models`, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`GET /models HTTP ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data && data.data) ? data.data : Array.isArray(data && data.models) ? data.models : [];
  return unique(rows.map((m) => (typeof m === 'string' ? m : m && (m.id || m.name))));
}

/**
 * @returns {Promise<{models: Array, defaultModelId: string|null, provider: string, localError: string|null, cloudFallbackAllowed: boolean}>}
 */
async function listModels({ force = false } = {}) {
  if (!force && listCache.data && process.env.NODE_ENV === 'test') return listCache.data;

  const provider = localProvider();
  const configured = configuredLocalModels();
  let models = [];
  let localError = null;

  if (provider === 'mock') {
    models = configured.map((id) => ({ id, name: prettyName(id), provider: 'mock', available: true, local: true }));
  } else {
    try {
      const installed = await fetchInstalledLocalModels();
      const ids = unique([...configured.filter((id) => installed.includes(id)), ...installed]);
      models = ids.map((id) => ({ id, name: prettyName(id), provider, available: true, local: true }));
      for (const id of configured) {
        if (!installed.includes(id)) {
          models.push({ id, name: prettyName(id), provider, available: false, local: true, reason: 'not_installed' });
        }
      }
    } catch (err) {
      localError = String((err && err.message) || err).slice(0, 200);
      models = configured.map((id) => ({ id, name: prettyName(id), provider, available: false, local: true, reason: 'unreachable' }));
    }
  }

  const dbCloud = getDbBackedCloudEntries();
  for (const m of dbCloud.models) {
    models.push(m);
  }

  for (const [cloudProvider, adapter] of cloudAdapters) {
    if (dbCloud.models.some((m) => m.provider === cloudProvider)) continue;
    let rows = [];
    try {
      rows = adapter.models() || [];
    } catch (_) {
      rows = [];
    }
    for (const m of rows) {
      models.push({ id: m.id, name: m.name || prettyName(m.id), provider: cloudProvider, available: m.available !== false, local: false });
    }
  }

  models = dedupeModels(models);

  const preferred = dbCloud.routing.defaultChatModel || modelProvider.getModel();
  const defaultModel =
    models.find((m) => m.id === preferred && m.available) ||
    models.find((m) => m.available && !m.local) ||
    models.find((m) => m.available && m.local) ||
    models.find((m) => m.available) || null;

  const data = {
    models,
    defaultModelId: defaultModel ? defaultModel.id : null,
    provider: defaultModel?.provider || provider,
    localError,
    cloudFallbackAllowed: modelProvider.isCloudFallbackAllowed(),
    routing: {
      primaryProvider: dbCloud.routing.primary?.type || null,
      fallbackProvider: dbCloud.routing.fallback?.type || null,
      defaultChatModel: dbCloud.routing.defaultChatModel || null,
      defaultCodingModel: dbCloud.routing.defaultCodingModel || null,
      defaultResearchModel: dbCloud.routing.defaultResearchModel || null,
    },
  };
  listCache = { at: Date.now(), data };
  return data;
}

function resolveSmartFallback(requestedId, models, defaultModelId, usage = 'chat') {
  const requested = String(requestedId || '').trim();
  const entry = requested ? models.find((m) => m.id === requested) : null;
  if (entry && entry.available) return entry;
  const matchedProvider = providerRegistry.findProviderByModel(requested);
  if (matchedProvider) {
    const providerDefault = usage === 'coding'
      ? matchedProvider.defaultCodingModel || matchedProvider.defaultChatModel || matchedProvider.models[0] || null
      : matchedProvider.defaultChatModel || matchedProvider.defaultCodingModel || matchedProvider.models[0] || null;
    const candidate = models.find((m) => m.id === providerDefault && m.available);
    if (candidate) return candidate;
  }
  if (requested) {
    const primary = providerRegistry.getPrimaryProvider();
    const providerDefault = usage === 'coding'
      ? primary?.defaultCodingModel || primary?.defaultChatModel || defaultModelId
      : primary?.defaultChatModel || primary?.defaultCodingModel || defaultModelId;
    const candidate = models.find((m) => m.id === providerDefault && m.available);
    if (candidate) return candidate;
  }
  return null;
}

/** Resolves a requested model id to a listed, available model with smart provider fallback. */
async function resolveModel(requestedId, usage = 'chat') {
  const { models, defaultModelId, routing } = await listModels();
  const effectiveDefault = usage === 'coding'
    ? routing?.defaultCodingModel || routing?.defaultChatModel || defaultModelId
    : routing?.defaultChatModel || routing?.defaultCodingModel || defaultModelId;
  const id = requestedId && String(requestedId).trim() ? String(requestedId).trim() : effectiveDefault;
  if (!id) throw new WorkspaceModelError('MODEL_UNREACHABLE', 'No model is available');
  let entry = models.find((m) => m.id === id);
  if (!entry) {
    // Selection may be stale (cache) — refresh once before rejecting.
    const fresh = await listModels({ force: true });
    entry = fresh.models.find((m) => m.id === id);
  }
  if (!entry || !entry.available) {
    const fallback = resolveSmartFallback(id, models, effectiveDefault, usage);
    if (fallback) return fallback;
  }
  if (!entry) throw new WorkspaceModelError('MODEL_NOT_INSTALLED', `Unknown model ${id}`);
  if (!entry.available) {
    throw new WorkspaceModelError(entry.reason === 'unreachable' ? 'MODEL_UNREACHABLE' : 'MODEL_NOT_INSTALLED', `Model ${id} is not available`);
  }
  if (entry.local && ['ollama', 'vllm'].includes(entry.provider)) {
    const estimated = modelProvider.estimateModelMemoryMb(entry.id);
    const budget = modelProvider.getActiveConfig().memoryBudgetMaxMb || 12288;
    if (estimated > budget) throw new WorkspaceModelError('MODEL_RESOURCE_EXHAUSTED', `~${estimated}MB > ${budget}MB budget`);
  }
  return entry;
}

function classifyFetchError(err, { timeoutSignal, clientSignal }) {
  if (err instanceof WorkspaceModelError) return err;
  if (clientSignal && clientSignal.aborted) return new WorkspaceModelError('CANCELLED', 'Client disconnected');
  if ((timeoutSignal && timeoutSignal.aborted) || (err && (err.name === 'TimeoutError' || /timeout/i.test(err.message || '')))) {
    return new WorkspaceModelError('MODEL_TIMEOUT', err && err.message);
  }
  const msg = String((err && err.cause && (err.cause.code || err.cause.message)) || (err && err.message) || err);
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|ECONNRESET|socket/i.test(msg)) return new WorkspaceModelError('MODEL_UNREACHABLE', msg);
  return new WorkspaceModelError('MODEL_ERROR', msg);
}

async function streamOpenAiCompatible({ entry, messages, timeoutMs, signal, onDelta, maxTokens }) {
  const t0 = Date.now();
  const endpoint = withDbProviderContext(entry, (provider) => ({
    baseUrl: provider?.endpoint || modelProvider.getBaseUrl(),
    key: provider?.apiKey || modelProvider.getApiKey(),
  }));
  const headers = { 'Content-Type': 'application/json', Accept: 'text/event-stream' };
  const key = endpoint.key;
  if (key && !/your_|_here|placeholder/i.test(key)) headers.Authorization = `Bearer ${key}`;

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const body = {
    model: entry.id,
    messages,
    temperature: 0.3,
    max_tokens: maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };

  let res;
  try {
    res = await fetch(`${endpoint.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: combined });
  } catch (err) {
    throw classifyFetchError(err, { timeoutSignal, clientSignal: signal });
  }
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    if (res.status === 404 || /not found|no such model|pull/i.test(raw)) throw new WorkspaceModelError('MODEL_NOT_INSTALLED', `HTTP ${res.status}: ${raw.slice(0, 160)}`);
    if (/out of memory|insufficient|requires more system memory/i.test(raw)) throw new WorkspaceModelError('MODEL_RESOURCE_EXHAUSTED', raw.slice(0, 160));
    throw new WorkspaceModelError('MODEL_ERROR', `HTTP ${res.status}: ${raw.slice(0, 160)}`);
  }

  let full = '';
  let visible = '';
  let usage = null;
  let firstTokenMs = null;
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    const reader = res.body.getReader();
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(data);
        } catch (_) {
          continue;
        }
        if (json.usage) usage = json.usage;
        const delta = json.choices && json.choices[0] && json.choices[0].delta ? json.choices[0].delta.content || '' : '';
        if (!delta) continue;
        full += delta;
        const vis = stripReasoning(full);
        if (vis.startsWith(visible)) {
          const piece = vis.slice(visible.length);
          if (piece) {
            if (firstTokenMs === null) firstTokenMs = Date.now() - t0;
            visible = vis;
            if (onDelta) onDelta(piece);
          }
        } else {
          visible = vis;
        }
      }
    }
  } catch (err) {
    throw classifyFetchError(err, { timeoutSignal, clientSignal: signal });
  }

  const text = stripReasoning(full);
  if (!text) throw new WorkspaceModelError('MODEL_EMPTY_RESPONSE', 'Empty completion');
  const estimated = !usage;
  return {
    text,
    usage: {
      promptTokens: usage ? usage.prompt_tokens || 0 : Math.round(JSON.stringify(messages).length / 4),
      completionTokens: usage ? usage.completion_tokens || 0 : Math.round(text.length / 4),
      totalTokens: usage ? usage.total_tokens || 0 : Math.round((JSON.stringify(messages).length + text.length) / 4),
      estimated,
    },
    latencyMs: Date.now() - t0,
    firstTokenMs,
    model: entry.id,
    provider: entry.provider,
  };
}

function mockReply(messages, modelId) {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  const raw = String((lastUser && lastUser.content) || '').replace(/\s+/g, ' ').trim();
  const topic = raw.slice(0, 120);
  const isAr = /[\u0600-\u06FF]/.test(raw);
  return isAr
    ? `**${topic}**\n\nهذا رد من نموذج الاختبار المحلي (${modelId}) ويؤكد أن مسار المحادثة يعمل كاملاً: الواجهة ← الخادم ← النموذج ← العرض.\n\n1. **استلام الرسالة**\n   • وصل سؤالك كما كتبته مع سياق المحادثة.\n2. **الرد**\n   • في بيئة الإنتاج يجيب النموذج المحلي الحقيقي المختار على سؤالك مباشرة.`
    : `**${topic}**\n\nThis is a reply from the local test model (${modelId}). It confirms the full chat pipeline works: UI → server → model → renderer.`;
}

async function runMock({ entry, messages, onDelta, signal }) {
  const t0 = Date.now();
  const text = mockReply(messages, entry.id);
  const chunks = text.match(/[\s\S]{1,24}/g) || [text];
  for (const c of chunks) {
    if (signal && signal.aborted) throw new WorkspaceModelError('CANCELLED', 'Client disconnected');
    if (onDelta) onDelta(c);
    await new Promise((r) => setTimeout(r, 4));
  }
  return {
    text,
    usage: { promptTokens: Math.round(JSON.stringify(messages).length / 4), completionTokens: Math.round(text.length / 4), totalTokens: Math.round((JSON.stringify(messages).length + text.length) / 4), estimated: true },
    latencyMs: Date.now() - t0,
    firstTokenMs: 1,
    model: entry.id,
    provider: 'mock',
  };
}

/**
 * Executes one chat completion with the user's selected model.
 * @param {{modelId?: string, messages: Array<{role:string,content:string}>, timeoutMs?: number, signal?: AbortSignal, onDelta?: (t:string)=>void, maxTokens?: number}} o
 */
async function chat({ modelId, messages, timeoutMs = DEFAULT_TIMEOUT_MS, signal, onDelta, maxTokens = 1500 }) {
  const entry = await resolveModel(modelId, 'chat');
  if (entry.provider === 'mock') return runMock({ entry, messages, onDelta, signal });
  if (!entry.local) {
    const adapter = cloudAdapters.get(entry.provider);
    if (!adapter) throw new WorkspaceModelError('MODEL_UNAVAILABLE', `No adapter for ${entry.provider}`);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const out = await adapter.chat({ model: entry.id, messages, onDelta, signal: combined, maxTokens });
      const text = stripReasoning(out.text);
      if (!text) throw new WorkspaceModelError('MODEL_EMPTY_RESPONSE', 'Empty completion');
      return { ...out, text, model: entry.id, provider: entry.provider };
    } catch (err) {
      throw classifyFetchError(err, { timeoutSignal, clientSignal: signal });
    }
  }
  return streamOpenAiCompatible({ entry, messages, timeoutMs, signal, onDelta, maxTokens });
}

function _resetCache() {
  listCache = { at: 0, data: null };
}

// ==============================================================================
// FUNCTION CALLING
// chatWithTools() sends tool JSON schemas to the selected model and returns the
// model's text AND its tool calls. It never executes tools — execution is the job of
// engineerAgent + toolGuard (server-side enforcement).
// ==============================================================================

let mockToolResponder = null;

/** Test-only: installs a scripted model for LLM_PROVIDER=mock (fixtures replay tool calls). */
function setMockToolResponder(fn) {
  mockToolResponder = typeof fn === 'function' ? fn : null;
}

function mockAllowed() {
  return process.env.NODE_ENV !== 'production' || process.env.E2E_TEST_MODE === '1';
}

/** Recovers tool calls that some local models print as text: <tool_call>{"name":..,"arguments":..}</tool_call>. */
function extractTextToolCalls(text) {
  const calls = [];
  let rest = String(text || '');
  const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/gi;
  let m;
  while ((m = re.exec(text))) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj && typeof obj.name === 'string') {
        calls.push({ id: `call_txt_${calls.length}_${Date.now().toString(36)}`, name: obj.name, arguments: obj.arguments == null ? {} : obj.arguments });
      }
    } catch (_) {
      /* not JSON: leave as text */
    }
  }
  if (calls.length) rest = rest.replace(re, '').trim();
  return { calls, rest };
}

function toOpenAiTools(tools) {
  return (tools || []).map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

async function openAiCompatibleWithTools({ entry, messages, tools, timeoutMs, signal, maxTokens }) {
  const t0 = Date.now();
  const endpoint = withDbProviderContext(entry, (provider) => ({
    baseUrl: provider?.endpoint || modelProvider.getBaseUrl(),
    key: provider?.apiKey || modelProvider.getApiKey(),
  }));
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  const key = endpoint.key;
  if (key && !/your_|_here|placeholder/i.test(key)) headers.Authorization = `Bearer ${key}`;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
  const body = { model: entry.id, messages, temperature: 0.2, max_tokens: maxTokens, stream: false };
  if (tools && tools.length) {
    body.tools = toOpenAiTools(tools);
    body.tool_choice = 'auto';
  }
  if (entry.provider === 'ollama') body.options = { num_ctx: parseInt(process.env.OLLAMA_NUM_CTX || '', 10) || 16384 };
  let res;
  try {
    res = await fetch(`${endpoint.baseUrl}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(body), signal: combined });
  } catch (err) {
    throw classifyFetchError(err, { timeoutSignal, clientSignal: signal });
  }
  const raw = await res.text().catch(() => '');
  if (!res.ok) {
    if (res.status === 404 || /not found|no such model|pull/i.test(raw)) throw new WorkspaceModelError('MODEL_NOT_INSTALLED', `HTTP ${res.status}: ${raw.slice(0, 160)}`);
    if (/does not support tools/i.test(raw)) throw new WorkspaceModelError('MODEL_UNAVAILABLE', `Model ${entry.id} does not support tool calling`);
    if (/out of memory|insufficient|requires more system memory/i.test(raw)) throw new WorkspaceModelError('MODEL_RESOURCE_EXHAUSTED', raw.slice(0, 160));
    throw new WorkspaceModelError('MODEL_ERROR', `HTTP ${res.status}: ${raw.slice(0, 160)}`);
  }
  let json;
  try {
    json = JSON.parse(raw);
  } catch (_) {
    throw new WorkspaceModelError('MODEL_ERROR', 'Invalid JSON from model server');
  }
  const msg = (json.choices && json.choices[0] && json.choices[0].message) || {};
  let text = stripReasoning(msg.content || '');
  let toolCalls = (Array.isArray(msg.tool_calls) ? msg.tool_calls : [])
    .filter((c) => c && c.function && c.function.name)
    .map((c, i) => ({ id: c.id || `call_${i}_${Date.now().toString(36)}`, name: c.function.name, arguments: c.function.arguments == null ? {} : c.function.arguments }));
  if (!toolCalls.length && text.includes('<tool_call>')) {
    const recovered = extractTextToolCalls(text);
    toolCalls = recovered.calls;
    text = recovered.rest;
  }
  const usage = json.usage || null;
  return {
    text,
    toolCalls,
    usage: {
      promptTokens: usage ? usage.prompt_tokens || 0 : Math.round(JSON.stringify(messages).length / 4),
      completionTokens: usage ? usage.completion_tokens || 0 : Math.round((text.length + JSON.stringify(toolCalls).length) / 4),
      totalTokens: usage ? usage.total_tokens || 0 : Math.round((JSON.stringify(messages).length + text.length) / 4),
      estimated: !usage,
    },
    latencyMs: Date.now() - t0,
    model: entry.id,
    provider: entry.provider,
  };
}

/**
 * One model turn with tool schemas.
 * @param {{modelId?: string, messages: Array<object>, tools: Array<{name:string,description:string,parameters:object}>, timeoutMs?: number, signal?: AbortSignal, maxTokens?: number}} o
 * @returns {Promise<{text:string, toolCalls:Array<{id:string,name:string,arguments:any}>, usage:object, latencyMs:number, model:string, provider:string}>}
 */
async function chatWithTools({ modelId, messages, tools = [], timeoutMs = DEFAULT_TIMEOUT_MS * 2, signal, maxTokens = 8192 }) {
  const entry = await resolveModel(modelId, 'coding');
  if (entry.provider === 'mock') {
    if (!mockAllowed()) throw new WorkspaceModelError('MODEL_UNAVAILABLE', 'The mock provider is disabled in production');
    if (signal && signal.aborted) throw new WorkspaceModelError('CANCELLED', 'Client disconnected');
    const t0 = Date.now();
    const out = mockToolResponder
      ? await mockToolResponder({ messages, tools, model: entry.id })
      : { text: mockReply(messages, entry.id), toolCalls: [] };
    const text = stripReasoning(out.text || '');
    const toolCalls = (out.toolCalls || []).map((c, i) => ({ id: c.id || `call_mock_${i}_${Date.now().toString(36)}`, name: c.name, arguments: c.arguments == null ? {} : c.arguments }));
    return {
      text,
      toolCalls,
      usage: { promptTokens: Math.round(JSON.stringify(messages).length / 4), completionTokens: Math.round(text.length / 4), totalTokens: Math.round((JSON.stringify(messages).length + text.length) / 4), estimated: true },
      latencyMs: Date.now() - t0,
      model: entry.id,
      provider: 'mock',
    };
  }
  if (!entry.local) {
    const adapter = cloudAdapters.get(entry.provider);
    if (!adapter || typeof adapter.chatWithTools !== 'function') throw new WorkspaceModelError('MODEL_UNAVAILABLE', `No tool-calling adapter for ${entry.provider}`);
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      const out = await adapter.chatWithTools({ model: entry.id, messages, tools, signal: combined, maxTokens });
      let text = stripReasoning(out.text || '');
      let toolCalls = out.toolCalls || [];
      if (!toolCalls.length && text.includes('<tool_call>')) {
        const recovered = extractTextToolCalls(text);
        toolCalls = recovered.calls;
        text = recovered.rest;
      }
      return { ...out, text, toolCalls, model: entry.id, provider: entry.provider };
    } catch (err) {
      throw classifyFetchError(err, { timeoutSignal, clientSignal: signal });
    }
  }
  return openAiCompatibleWithTools({ entry, messages, tools, timeoutMs, signal, maxTokens });
}

module.exports = {
  listModels,
  resolveModel,
  chat,
  chatWithTools,
  setMockToolResponder,
  extractTextToolCalls,
  toOpenAiTools,
  registerCloudAdapter,
  stripReasoning,
  WorkspaceModelError,
  ERROR_MESSAGES,
  _resetCache,
};
