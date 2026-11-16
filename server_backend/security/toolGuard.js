// ==============================================================================
// server_backend/security/toolGuard.js
// The single server-side choke point for EVERY tool execution (agent tool calls and
// HTTP tool endpoints). Prompts are advisory; this module is binding.
//
// Enforcement order for each call:
//   1. tool exists + allowed for the caller's SERVER-DERIVED role and agent mode (constitution POLICY)
//   2. per-request and per-user rate/budget limits
//   3. strict argument validation against the tool's JSON schema (unknown fields rejected)
//   4. destructive tools require a server-issued, single-use HMAC approval token bound to
//      {user, project, tool, argsHash}; client flags like `confirmed:true` are ignored
//   5. handler runs with a timeout; result is secret-redacted, size-capped and framed as
//      UNTRUSTED DATA before it is returned to the model
//   6. allow/deny/error is written to the audit sink
// ==============================================================================
'use strict';

const crypto = require('crypto');
const { POLICY, isToolAllowed, toolsForRole } = require('../services/ai/constitution');

class GuardError extends Error {
  constructor(code, message, httpStatus = 403, extra = {}) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
    this.httpStatus = httpStatus;
    Object.assign(this, extra);
  }
}

// ------------------------------------------------------------------ path confinement
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/**
 * Normalizes a project-relative virtual path and rejects anything that could escape
 * the project or touch hidden/system files. Returns e.g. "js/app.js".
 */
function normalizeProjectPath(raw, limits = POLICY.limits) {
  if (typeof raw !== 'string') throw new GuardError('PATH_INVALID', 'Path must be a string.', 400);
  let p = raw.trim().replace(/\\/g, '/');
  if (!p) throw new GuardError('PATH_INVALID', 'Path is empty.', 400);
  if (p.includes('\0')) throw new GuardError('PATH_INVALID', 'Path contains a NUL byte.', 400);
  if (/^[a-zA-Z]:/.test(p) || p.startsWith('//') || /^[a-z]+:\/\//i.test(p)) {
    throw new GuardError('PATH_TRAVERSAL', 'Absolute or URL paths are not allowed.', 400);
  }
  p = p.replace(/^\.\/+/, '').replace(/^\/+/, '');
  const segments = p.split('/').filter((s) => s.length > 0);
  if (segments.some((s) => s === '..' || s === '.')) throw new GuardError('PATH_TRAVERSAL', 'Path traversal is not allowed.', 400);
  if (segments.some((s) => s.startsWith('.'))) throw new GuardError('PATH_FORBIDDEN', 'Hidden files and directories are not allowed.', 400);
  if (segments.some((s) => !/^[\p{L}\p{N}_\-. ]+$/u.test(s) || WINDOWS_RESERVED.test(s))) {
    throw new GuardError('PATH_INVALID', 'Path contains forbidden characters.', 400);
  }
  if (segments.length === 0) throw new GuardError('PATH_INVALID', 'Path is empty.', 400);
  if (segments.length > limits.maxPathDepth) throw new GuardError('PATH_TOO_DEEP', `Path depth exceeds ${limits.maxPathDepth}.`, 400);
  const normalized = segments.join('/');
  if (normalized.length > limits.maxPathLength) throw new GuardError('PATH_TOO_LONG', `Path exceeds ${limits.maxPathLength} characters.`, 400);
  const dot = normalized.lastIndexOf('.');
  const ext = dot >= 0 ? normalized.slice(dot).toLowerCase() : '';
  if (!limits.allowedExtensions.includes(ext)) {
    throw new GuardError('EXTENSION_FORBIDDEN', `Extension "${ext || '(none)'}" is not allowed. Allowed: ${limits.allowedExtensions.join(', ')}.`, 400);
  }
  return normalized;
}

// ------------------------------------------------------------------ schema validation
/**
 * Dependency-free validator for the JSON-Schema subset used by tool definitions:
 * type (object|string|integer|number|boolean|array), properties, required,
 * additionalProperties:false, enum, minLength, maxLength, minimum, maximum, items, maxItems.
 */
function validateAgainstSchema(value, schema, at = 'arguments') {
  if (!schema) return;
  const t = schema.type;
  const fail = (msg) => {
    throw new GuardError('ARGUMENTS_INVALID', `${at}: ${msg}`, 400);
  };
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail('must be an object');
    const props = schema.properties || {};
    for (const req of schema.required || []) if (!(req in value)) fail(`missing required field "${req}"`);
    for (const key of Object.keys(value)) {
      if (!(key in props)) {
        if (schema.additionalProperties === false) fail(`unknown field "${key}"`);
        continue;
      }
      validateAgainstSchema(value[key], props[key], `${at}.${key}`);
    }
  } else if (t === 'string') {
    if (typeof value !== 'string') fail('must be a string');
    if (schema.minLength != null && value.length < schema.minLength) fail(`shorter than ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) fail(`longer than ${schema.maxLength}`);
  } else if (t === 'integer' || t === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (t === 'integer' && !Number.isInteger(value))) fail(`must be ${t}`);
    if (schema.minimum != null && value < schema.minimum) fail(`below ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) fail(`above ${schema.maximum}`);
  } else if (t === 'boolean') {
    if (typeof value !== 'boolean') fail('must be a boolean');
  } else if (t === 'array') {
    if (!Array.isArray(value)) fail('must be an array');
    if (schema.maxItems != null && value.length > schema.maxItems) fail(`more than ${schema.maxItems} items`);
    if (schema.minItems != null && value.length < schema.minItems) fail(`fewer than ${schema.minItems} items`);
    value.forEach((v, i) => validateAgainstSchema(v, schema.items, `${at}[${i}]`));
  }
  if (schema.enum && !schema.enum.includes(value)) fail(`must be one of ${schema.enum.join(', ')}`);
}

// ------------------------------------------------------------------ redaction + framing
let secretValuesCache = null;
function secretValues() {
  if (secretValuesCache) return secretValuesCache;
  secretValuesCache = Object.entries(process.env)
    .filter(([k, v]) => /(KEY|SECRET|TOKEN|PASSWORD|PASS|CREDENTIAL|PRIVATE)/i.test(k) && typeof v === 'string' && v.length >= 8)
    .map(([, v]) => v);
  return secretValuesCache;
}

function redactSecrets(text) {
  let out = String(text);
  for (const v of secretValues()) {
    if (out.includes(v)) out = out.split(v).join('[REDACTED]');
  }
  // Common credential shapes even if not in env.
  out = out.replace(/\b(sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,})\b/g, '[REDACTED]');
  return out;
}

/** Frames a tool result as untrusted data and neutralizes delimiter / role-marker injection. */
function frameUntrusted(toolName, payload, maxChars = POLICY.limits.maxToolResultChars) {
  let body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  body = redactSecrets(body)
    .replace(/<\/?tool_result[^>]*>/gi, '[tag removed]')
    .replace(/<\|(im_start|im_end|system|endoftext)\|>/gi, '[marker removed]');
  if (body.length > maxChars) body = `${body.slice(0, maxChars)}\n…[truncated ${body.length - maxChars} chars]`;
  return `<tool_result name="${toolName}" trust="untrusted-data">\n${body}\n</tool_result>`;
}

// ------------------------------------------------------------------ approvals
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
    .join(',')}}`;
}
const argsHash = (args) => crypto.createHash('sha256').update(stableStringify(args || {})).digest('hex').slice(0, 32);
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const fromB64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ------------------------------------------------------------------ guard factory
/**
 * @param {{ tools: Record<string, {description:string, parameters:object, handler:(args:object, ctx:object)=>Promise<any>|any, timeoutMs?:number}>,
 *           audit?: (entry:object)=>void, secret?: string, now?: ()=>number }} o
 */
function createToolGuard({ tools, audit, secret, now = () => Date.now() } = {}) {
  if (!tools || typeof tools !== 'object') throw new Error('createToolGuard: tools map required');
  const signingKey = secret || process.env.WORKSPACE_APPROVAL_SECRET || crypto.randomBytes(32).toString('hex');
  const usedNonces = new Map(); // nonce -> expiry
  const userWindows = new Map(); // userId -> timestamps[]
  const auditSink = typeof audit === 'function' ? audit : () => {};

  function record(entry) {
    try {
      auditSink({ at: new Date(now()).toISOString(), ...entry });
    } catch (_) {
      /* audit must never break execution */
    }
  }

  function issueApproval({ userId, projectId, tool, args }) {
    const payload = { u: String(userId), p: String(projectId || ''), t: tool, h: argsHash(args), exp: now() + POLICY.limits.approvalTtlMs, n: crypto.randomBytes(12).toString('hex') };
    const body = b64u(JSON.stringify(payload));
    const sig = b64u(crypto.createHmac('sha256', signingKey).update(body).digest());
    return `${body}.${sig}`;
  }

  function verifyAndConsumeApproval(token, { userId, projectId, tool, args }) {
    if (!token || typeof token !== 'string' || !token.includes('.')) return { ok: false, reason: 'APPROVAL_MISSING' };
    const [body, sig] = token.split('.');
    const expected = b64u(crypto.createHmac('sha256', signingKey).update(body).digest());
    const a = Buffer.from(sig || '');
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'APPROVAL_SIGNATURE_INVALID' };
    let payload;
    try {
      payload = JSON.parse(fromB64u(body).toString('utf8'));
    } catch (_) {
      return { ok: false, reason: 'APPROVAL_MALFORMED' };
    }
    if (payload.exp < now()) return { ok: false, reason: 'APPROVAL_EXPIRED' };
    if (payload.u !== String(userId) || payload.p !== String(projectId || '') || payload.t !== tool || payload.h !== argsHash(args)) {
      return { ok: false, reason: 'APPROVAL_SCOPE_MISMATCH' };
    }
    for (const [n, exp] of usedNonces) if (exp < now()) usedNonces.delete(n);
    if (usedNonces.has(payload.n)) return { ok: false, reason: 'APPROVAL_ALREADY_USED' };
    usedNonces.set(payload.n, payload.exp);
    return { ok: true };
  }

  function checkRate(userId) {
    const windowMs = 60000;
    const t = now();
    const arr = (userWindows.get(userId) || []).filter((x) => t - x < windowMs);
    if (arr.length >= POLICY.limits.maxToolCallsPerMinutePerUser) {
      userWindows.set(userId, arr);
      return false;
    }
    arr.push(t);
    userWindows.set(userId, arr);
    return true;
  }

  /** Tool schemas the model may see for this role+mode (policy-filtered, deny by default). */
  function toolSchemas(role, mode) {
    return toolsForRole(role, mode)
      .filter((name) => tools[name])
      .map((name) => ({ name, description: tools[name].description, parameters: tools[name].parameters }));
  }

  /**
   * Executes one tool call under full enforcement.
   * @param {{name:string, arguments:string|object, id?:string}} call
   * @param {{user:{id:string, role:string}, mode:string, requestId?:string, projectId?:string, approvals?:Record<string,string>, budget?:{calls:number}, signal?:AbortSignal}} ctx
   * @returns {Promise<{ok:boolean, status:'ok'|'denied'|'error'|'approval_required', code?:string, message?:string, result?:any, framed:string, approvalToken?:string}>}
   */
  async function execute(call, ctx) {
    const name = String((call && call.name) || '');
    const user = (ctx && ctx.user) || {};
    const base = { requestId: ctx && ctx.requestId, userId: user.id, role: user.role, mode: ctx && ctx.mode, tool: name, projectId: ctx && ctx.projectId };
    const deny = (code, message, status = 'denied', extra = {}) => {
      record({ ...base, outcome: status, code, message: String(message).slice(0, 200) });
      const out = { ok: false, status, code, message, ...extra };
      out.framed = frameUntrusted(name || 'unknown', { error: code, message, ...(extra.approvalRequired ? { approvalRequired: true } : {}) });
      return out;
    };

    if (!user.id || !user.role) return deny('UNAUTHENTICATED', 'No authenticated user context.');
    const decision = isToolAllowed(name, user.role, ctx.mode);
    if (!decision.allowed) return deny(decision.reason, `Tool "${name}" is not permitted for role ${user.role} in mode ${ctx.mode}.`);
    const def = tools[name];
    if (!def) return deny('TOOL_NOT_REGISTERED', `Tool "${name}" is not registered.`);

    if (ctx.budget) {
      ctx.budget.calls = (ctx.budget.calls || 0) + 1;
      if (ctx.budget.calls > POLICY.limits.maxToolCallsPerRequest) return deny('BUDGET_EXCEEDED', 'Tool-call budget for this request is exhausted.');
    }
    if (!checkRate(String(user.id))) return deny('RATE_LIMITED', 'Too many tool calls; slow down.');

    let args = call.arguments;
    if (typeof args === 'string') {
      try {
        args = args.trim() ? JSON.parse(args) : {};
      } catch (_) {
        return deny('ARGUMENTS_INVALID', 'Tool arguments are not valid JSON.', 'error');
      }
    }
    if (args == null) args = {};
    try {
      validateAgainstSchema(args, def.parameters);
    } catch (e) {
      return deny(e.code || 'ARGUMENTS_INVALID', e.message, 'error');
    }

    if (decision.policy.approval) {
      const token = ctx.approvals && (ctx.approvals[name] || ctx.approvals['*']);
      const check = verifyAndConsumeApproval(token, { userId: user.id, projectId: ctx.projectId, tool: name, args });
      if (!check.ok) {
        const approvalToken = issueApproval({ userId: user.id, projectId: ctx.projectId, tool: name, args });
        return deny('APPROVAL_REQUIRED', `"${name}" is a ${decision.policy.risk} action and needs explicit user approval (${check.reason}).`, 'approval_required', {
          approvalRequired: true,
          approvalToken,
          pendingArgs: args,
        });
      }
    }

    const timeoutMs = def.timeoutMs || 60000;
    let timer;
    try {
      const result = await Promise.race([
        Promise.resolve(def.handler(args, ctx)),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new GuardError('TOOL_TIMEOUT', `Tool "${name}" exceeded ${timeoutMs} ms.`, 504)), timeoutMs);
        }),
      ]);
      record({ ...base, outcome: 'ok', argsHash: argsHash(args) });
      return { ok: true, status: 'ok', result, framed: frameUntrusted(name, result) };
    } catch (e) {
      const code = (e && e.code) || 'TOOL_ERROR';
      const message = redactSecrets((e && e.message) || String(e)).slice(0, 400);
      return deny(code, message, e instanceof GuardError && e.httpStatus === 403 ? 'denied' : 'error');
    } finally {
      clearTimeout(timer);
    }
  }

  return { execute, toolSchemas, issueApproval, verifyAndConsumeApproval };
}

module.exports = {
  GuardError,
  createToolGuard,
  normalizeProjectPath,
  validateAgainstSchema,
  frameUntrusted,
  redactSecrets,
  argsHash,
};
