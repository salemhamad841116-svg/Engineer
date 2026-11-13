/**
 * adminMiddleware.js
 * Phase 9 Admin Session & RBAC Middleware
 *
 * Implements:
 * 1. Isolated admin_sid cookie extraction.
 * 2. Rejection of stolen or user 'sid' cookies.
 * 3. Dual-tier RBAC protection (super_admin vs support_agent).
 */

const adminAuthService = require('./adminAuthService');
const { AppError } = require('../utils/errors');

const ADMIN_COOKIE_NAME = 'admin_sid';

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function extractAdminToken(req) {
  const auth = req.headers.authorization || '';
  if (/^Bearer /i.test(auth)) {
    return { token: auth.slice(7).trim(), via: 'bearer' };
  }
  const cookies = parseCookies(req.headers.cookie);
  if (cookies[ADMIN_COOKIE_NAME]) {
    return { token: cookies[ADMIN_COOKIE_NAME], via: 'cookie' };
  }
  return { token: null, via: null };
}

function isSecureRequest(req) {
  return req.secure || req.headers['x-forwarded-proto'] === 'https';
}

function setAdminSessionCookie(req, res, token, expiresAt) {
  const parts = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  if (isSecureRequest(req)) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearAdminSessionCookie(req, res) {
  const parts = [
    `${ADMIN_COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
  ];
  if (isSecureRequest(req)) {
    parts.push('Secure');
  }
  res.setHeader('Set-Cookie', parts.join('; '));
}

function requireAdminAuth(options = {}) {
  return (req, res, next) => {
    try {
      const { token } = extractAdminToken(req);
      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'Admin authentication required. No valid admin_sid session found.',
          code: 'ADMIN_UNAUTHORIZED',
        });
      }

      const { session, adminUser } = adminAuthService.resolveAdminSession(token);
      req.adminSession = session;
      req.adminUser = adminUser;
      next();
    } catch (err) {
      const status = err.status || 401;
      return res.status(status).json({
        success: false,
        error: err.message || 'Invalid or expired admin session.',
        code: err.code || 'ADMIN_UNAUTHORIZED',
      });
    }
  };
}

function requireAdminRole(...roles) {
  return (req, res, next) => {
    if (!req.adminUser) {
      return res.status(401).json({
        success: false,
        error: 'Admin authentication required.',
        code: 'ADMIN_UNAUTHORIZED',
      });
    }

    const userRole = req.adminUser.role;
    // super_admin always satisfies any required role; otherwise role must match directly
    const isAuthorized = roles.includes(userRole) || userRole === 'super_admin';

    if (!isAuthorized) {
      return res.status(403).json({
        success: false,
        error: `Permission denied. This operation requires one of: [${roles.join(', ')}]. Current role: ${userRole}.`,
        code: 'ADMIN_FORBIDDEN',
      });
    }

    next();
  };
}

module.exports = {
  ADMIN_COOKIE_NAME,
  extractAdminToken,
  setAdminSessionCookie,
  clearAdminSessionCookie,
  requireAdminAuth,
  requireAdminRole,
};
