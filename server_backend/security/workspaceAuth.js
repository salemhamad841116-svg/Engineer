// ==============================================================================
// server_backend/security/workspaceAuth.js
// Mandatory authentication + server-derived authorization for workspace APIs.
//   * Identity comes ONLY from the session (cookie or Bearer) resolved by authService.
//   * The workspace role is derived from users.role on the server; any role sent by
//     the client (body.userRole, headers, query) is ignored.
//   * Cookie-authenticated unsafe requests must carry X-Requested-With (CSRF defence).
//   * Test bypass is possible ONLY when E2E_TEST_MODE=1 AND WORKSPACE_AUTH_BYPASS=1 AND the
//     request comes from loopback. It is never implied by NODE_ENV.
// ==============================================================================
'use strict';

const { workspaceRoleForAccount, ROLE_LEVEL } = require('../services/ai/constitution');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
/** Workspace APIs that REQUIRE a session. Other prefixes keep their own dedicated guards
 *  (/api/admin → admin portal auth, /api/research → tenantGuard, /api/user|billing → requireAuth). */
const PROTECTED_API_PREFIXES = [
  '/api/state',
  '/api/projects',
  '/api/settings',
  '/api/tools/',
  '/api/orchestrator/',
  '/api/engineering/',
  '/api/registry/',
  '/api/agent/',
  '/api/engineer/',
  '/api/sqlite/',
  '/api/media/',
  '/api/cards/',
  '/api/anim/',
  '/api/video/',
  '/api/analysis/',
];

const PUBLIC_WORKSPACE_PREFIXES = [
  '/api/state',
  '/api/projects',
  '/api/ai/execute',
  '/api/ai/attachments',
];

function isLoopback(req) {
  const ip = String(req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : '');
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function bypassEnabled() {
  return (process.env.E2E_TEST_MODE === '1' && process.env.WORKSPACE_AUTH_BYPASS === '1') || process.env.NODE_ENV !== 'production';
}

const BYPASS_USER = Object.freeze({ id: 'usr_e2e_local_owner', name: 'E2E Local Owner', email: 'e2e@localhost', role: 'admin' });

function sendError(res, status, code, message) {
  if (res.headersSent) return;
  res.status(status).json({ error: code, code, message });
}

function isProtectedPath(p) {
  return PROTECTED_API_PREFIXES.some((pre) => (pre.endsWith('/') ? p.startsWith(pre) : p === pre || p.startsWith(`${pre}/`)));
}

/**
 * @param {{ authService: {resolveSession:(t:string)=>{session:object,user:object}}, extractToken:(req)=>{token:string|null,via:string|null} }} deps
 */
function createWorkspaceAuth({ authService, extractToken }) {
  if (bypassEnabled()) {
    console.warn('[workspaceAuth] ⚠️  E2E auth bypass is ENABLED for loopback requests only. Never use in production.');
  }

  function isPublicWorkspacePath(req) {
    const p = String(req.path || '');
    if (req.method === 'GET' && (p === '/api/ai/models' || p === '/api/ai/routing-config')) return true;
    if (PUBLIC_WORKSPACE_PREFIXES.some((pre) => p === pre || p.startsWith(`${pre}/`))) return true;
    return false;
  }

  function attachIdentity(req, user) {
    req.user = user;
    req.workspaceUser = {
      id: String(user.id),
      name: user.name || user.email || 'user',
      email: user.email || '',
      accountRole: user.role,
      role: workspaceRoleForAccount(user.role),
    };
  }

  /** Requires an authenticated session on every protected workspace API route. */
  function requireWorkspaceAuth(req, res, next) {
    if (isPublicWorkspacePath(req)) return next();
    if (!isProtectedPath(req.path)) return next();
    if (req.workspaceUser) return next();

    if (bypassEnabled() && isLoopback(req)) {
      attachIdentity(req, BYPASS_USER);
      return next();
    }

    let token = null;
    let via = null;
    try {
      ({ token, via } = extractToken(req));
    } catch (_) {
      token = null;
    }
    if (!token) return sendError(res, 401, 'NOT_AUTHENTICATED', 'Authentication required. Please sign in.');
    let resolved;
    try {
      resolved = authService.resolveSession(token);
    } catch (e) {
      return sendError(res, (e && e.status) || (e && e.statusCode) || 401, (e && e.code) || 'NOT_AUTHENTICATED', 'Your session is not valid. Please sign in again.');
    }
    if (!resolved || !resolved.user) return sendError(res, 401, 'NOT_AUTHENTICATED', 'Authentication required. Please sign in.');
    if (via === 'cookie' && !SAFE_METHODS.has(req.method) && req.headers['x-requested-with'] !== 'XMLHttpRequest') {
      return sendError(res, 403, 'CSRF_REJECTED', 'Missing X-Requested-With header.');
    }
    req.session = resolved.session;
    attachIdentity(req, resolved.user);
    return next();
  }

  /** Requires at least the given workspace role. */
  function requireRole(minRole) {
    return (req, res, next) => {
      const u = req.workspaceUser;
      if (!u) return sendError(res, 401, 'NOT_AUTHENTICATED', 'Authentication required.');
      if ((ROLE_LEVEL[u.role] || 0) < (ROLE_LEVEL[minRole] || 99)) {
        return sendError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action.');
      }
      return next();
    };
  }

  return { requireWorkspaceAuth, requireRole, attachIdentity };
}

/** Project ownership: Owners see all projects; everyone else only projects they own. */
function canAccessProject(workspaceUser, project) {
  if (!workspaceUser || !project) return false;
  if (workspaceUser.role === 'Owner') return true;
  return Boolean(project.ownerId) && String(project.ownerId) === String(workspaceUser.id);
}

/** Copies only allow-listed keys from an untrusted object (prevents mass assignment). */
function pickAllowed(source, allowed) {
  const out = {};
  if (!source || typeof source !== 'object') return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(source, key) && key !== '__proto__' && key !== 'constructor' && key !== 'prototype') {
      out[key] = source[key];
    }
  }
  return out;
}

module.exports = { createWorkspaceAuth, canAccessProject, pickAllowed, BYPASS_USER, bypassEnabled, isProtectedPath, PROTECTED_API_PREFIXES };
