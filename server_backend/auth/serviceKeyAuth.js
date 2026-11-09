/**
 * serviceKeyAuth.js
 * Phase 13: Service API Key Authentication, Rate Limiting & User Delegation Middleware
 *
 * Implements:
 * 1. X-Service-Key authentication via SHA-256 hash comparison.
 * 2. Scope validation (defaults to books:crud).
 * 3. In-memory sliding window rate limiting (60 requests/minute, 61st returns HTTP 429).
 * 4. Immediate revocation & rotation support (effective within < 1 second).
 * 5. User identity resolution and binding (X-User-Id) strictly bound to tenant context.
 * 6. Audit logging into service_api_audit_logs and security alerts on unauthorized access.
 */

const crypto = require('crypto');
const config = require('../config');
const { get, run, all } = require('../db/database');
const { newId, sha256Hex } = require('../utils/ids');
const { nowIso } = require('../utils/clock');

// In-memory sliding window store: keyId -> Array of timestamps (ms)
const rateLimitWindows = new Map();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket?.remoteAddress) || '127.0.0.1';
}

function checkRateLimit(keyId, limitRpm = 60) {
  const now = Date.now();
  const windowMs = 60000;
  let timestamps = rateLimitWindows.get(keyId);
  if (!timestamps) {
    timestamps = [];
    rateLimitWindows.set(keyId, timestamps);
  }

  // Purge expired timestamps older than 60s
  while (timestamps.length > 0 && timestamps[0] <= now - windowMs) {
    timestamps.shift();
  }

  if (timestamps.length >= limitRpm) {
    const oldest = timestamps[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { allowed: false, retryAfter };
  }

  timestamps.push(now);
  return { allowed: true };
}

function resetRateLimits() {
  rateLimitWindows.clear();
}

/**
 * Records an entry into service_api_audit_logs.
 */
function recordServiceAudit({
  serviceKeyId = null,
  action,
  userId = null,
  bookId = null,
  endpoint,
  statusCode,
  ip,
  detail = null,
}) {
  try {
    const id = newId('saud');
    run(
      `INSERT INTO service_api_audit_logs
        (id, service_key_id, action, user_id, book_id, endpoint, status_code, ip, created_at, detail_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      serviceKeyId,
      action,
      userId,
      bookId,
      endpoint,
      statusCode,
      ip,
      nowIso(),
      detail ? JSON.stringify(detail) : null
    );

    if (serviceKeyId) {
      run('UPDATE service_api_keys SET last_used_at = ? WHERE id = ?', nowIso(), serviceKeyId);
    }
  } catch (err) {
    console.error('Failed to write service audit log:', err.message);
  }
}

/**
 * Records a critical security incident into system_alert_logs.
 */
function recordSecurityIncident({ category = 'security', message, details, tenantId = null }) {
  try {
    const id = newId('alt');
    run(
      `INSERT INTO system_alert_logs
        (id, timestamp, level, category, message, details_json, tenant_id)
       VALUES (?, ?, 'critical', ?, ?, ?, ?)`,
      id,
      nowIso(),
      category,
      message,
      JSON.stringify(details || {}),
      tenantId
    );
  } catch (err) {
    console.error('Failed to log security incident:', err.message);
  }
}

/**
 * Generates a new Service API Key.
 * Plaintext key is returned ONCE. Only SHA-256 hash is stored in DB.
 */
function generateServiceKey({ name, createdBy = null, scopes = ['books:crud'], rateLimitRpm = 60 }) {
  const cleanName = String(name || '').trim();
  if (!cleanName) {
    const err = new Error('Service key name is required.');
    err.status = 400;
    throw err;
  }

  const rawRandom = crypto.randomBytes(32).toString('hex');
  const rawKey = `sk_live_${rawRandom}`;
  const keyPrefix = rawKey.slice(0, 16);
  const keyHash = sha256Hex(rawKey);
  const id = newId('sk');
  const createdAt = nowIso();

  run(
    `INSERT INTO service_api_keys
      (id, name, key_prefix, key_hash, scopes_json, rate_limit_rpm, is_revoked, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    id,
    cleanName,
    keyPrefix,
    keyHash,
    JSON.stringify(scopes),
    rateLimitRpm,
    createdBy,
    createdAt
  );

  return {
    id,
    name: cleanName,
    keyPrefix,
    rawKey, // Must be shown to user ONCE only
    scopes,
    rateLimitRpm,
    createdAt,
  };
}

/**
 * Revokes a service key immediately.
 */
function revokeServiceKey(id) {
  const row = get('SELECT * FROM service_api_keys WHERE id = ?', id);
  if (!row) {
    const err = new Error('Service key not found.');
    err.status = 404;
    throw err;
  }

  const revokedAt = nowIso();
  run('UPDATE service_api_keys SET is_revoked = 1, revoked_at = ? WHERE id = ?', revokedAt, id);
  rateLimitWindows.delete(id);
  return { id, isRevoked: true, revokedAt };
}

/**
 * Rotates a service key: revokes existing key and creates a fresh one.
 */
function rotateServiceKey(id, adminUserId = null) {
  const existing = get('SELECT * FROM service_api_keys WHERE id = ?', id);
  if (!existing) {
    const err = new Error('Service key not found.');
    err.status = 404;
    throw err;
  }

  revokeServiceKey(id);

  let scopes = ['books:crud'];
  try {
    scopes = JSON.parse(existing.scopes_json || '["books:crud"]');
  } catch (_) {}

  return generateServiceKey({
    name: existing.name,
    createdBy: adminUserId || existing.created_by,
    scopes,
    rateLimitRpm: existing.rate_limit_rpm || 60,
  });
}

/**
 * Middleware: Enforces Service API Key authentication, HTTPS, rate limiting, and user delegation.
 */
function requireServiceKeyAuth(requiredScope = 'books:crud') {
  return (req, res, next) => {
    const ip = clientIp(req);
    const endpoint = req.originalUrl || req.url;

    // 1. Enforce HTTPS in production environments
    const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
    if (config.isProd && !isHttps) {
      recordServiceAudit({
        action: 'auth.rejected_insecure_http',
        endpoint,
        statusCode: 403,
        ip,
        detail: { reason: 'HTTPS is strictly required in production' },
      });
      return res.status(403).json({
        error: {
          code: 'HTTPS_REQUIRED',
          message: 'External Service API strictly requires HTTPS connection in production.',
          status: 403,
        },
      });
    }

    // 2. Extract Service Key header
    const rawKey = req.headers['x-service-key'] || req.headers['X-Service-Key'];
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
      recordServiceAudit({
        action: 'auth.missing_service_key',
        endpoint,
        statusCode: 401,
        ip,
      });
      return res.status(401).json({
        error: {
          code: 'MISSING_SERVICE_KEY',
          message: 'X-Service-Key header is missing or empty.',
          status: 401,
        },
      });
    }

    // 3. Hash and lookup key in SQLite
    const hash = sha256Hex(rawKey.trim());
    const serviceKey = get('SELECT * FROM service_api_keys WHERE key_hash = ?', hash);

    if (!serviceKey) {
      recordServiceAudit({
        action: 'auth.invalid_service_key',
        endpoint,
        statusCode: 401,
        ip,
        detail: { attemptedPrefix: rawKey.slice(0, 16) },
      });
      return res.status(401).json({
        error: {
          code: 'INVALID_SERVICE_KEY',
          message: 'Invalid service API key provided.',
          status: 401,
        },
      });
    }

    // 4. Verify revocation status (immediate revocation < 60s)
    if (Number(serviceKey.is_revoked) === 1) {
      recordServiceAudit({
        serviceKeyId: serviceKey.id,
        action: 'auth.revoked_key_attempt',
        endpoint,
        statusCode: 403,
        ip,
      });
      return res.status(403).json({
        error: {
          code: 'SERVICE_KEY_REVOKED',
          message: 'This service API key has been revoked and can no longer be used.',
          status: 403,
        },
      });
    }

    // 5. Verify Scope
    let scopes = [];
    try {
      scopes = JSON.parse(serviceKey.scopes_json || '[]');
    } catch (_) {
      scopes = [];
    }

    if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('*')) {
      recordServiceAudit({
        serviceKeyId: serviceKey.id,
        action: 'auth.insufficient_scope',
        endpoint,
        statusCode: 403,
        ip,
        detail: { required: requiredScope, granted: scopes },
      });
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: `Service key lacks required scope "${requiredScope}".`,
          status: 403,
        },
      });
    }

    // 6. Sliding window rate limiting (60 requests/minute)
    const rateLimitResult = checkRateLimit(serviceKey.id, serviceKey.rate_limit_rpm || 60);
    if (!rateLimitResult.allowed) {
      res.setHeader('Retry-After', String(rateLimitResult.retryAfter));
      recordServiceAudit({
        serviceKeyId: serviceKey.id,
        action: 'rate_limit.exceeded',
        endpoint,
        statusCode: 429,
        ip,
        detail: { retryAfter: rateLimitResult.retryAfter },
      });
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit of ${serviceKey.rate_limit_rpm || 60} requests per minute exceeded.`,
          retryAfter: rateLimitResult.retryAfter,
          status: 429,
        },
      });
    }

    // 7. Resolve Delegated User Identity (Mandatory for Tenant Isolation)
    const requestedUserId = req.headers['x-user-id'] || req.headers['X-User-Id'] || req.body?.user_id || req.body?.userId;
    if (!requestedUserId || typeof requestedUserId !== 'string' || !requestedUserId.trim()) {
      recordServiceAudit({
        serviceKeyId: serviceKey.id,
        action: 'auth.missing_user_identity',
        endpoint,
        statusCode: 400,
        ip,
      });
      return res.status(400).json({
        error: {
          code: 'MISSING_USER_IDENTITY',
          message: 'Delegated user identity (X-User-Id header) is mandatory for tenant-isolated operations.',
          status: 400,
        },
      });
    }

    const cleanUserId = requestedUserId.trim();
    const userRow = get('SELECT id, name, email, role, status FROM users WHERE id = ?', cleanUserId);
    if (!userRow) {
      recordServiceAudit({
        serviceKeyId: serviceKey.id,
        action: 'auth.user_not_found',
        userId: cleanUserId,
        endpoint,
        statusCode: 404,
        ip,
      });
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: `User identity "${cleanUserId}" does not exist in the platform.`,
          status: 404,
        },
      });
    }

    if (userRow.status === 'disabled') {
      recordServiceAudit({
        serviceKeyId: serviceKey.id,
        action: 'auth.user_disabled',
        userId: cleanUserId,
        endpoint,
        statusCode: 403,
        ip,
      });
      return res.status(403).json({
        error: {
          code: 'USER_DISABLED',
          message: 'The requested user account is disabled.',
          status: 403,
        },
      });
    }

    // Attach verified user and tenant context strictly isolated to this user
    req.serviceKey = serviceKey;
    req.user = {
      id: userRow.id,
      name: userRow.name,
      email: userRow.email,
      role: userRow.role || 'user',
    };
    req.tenantContext = {
      tenantId: userRow.id,
      userId: userRow.id,
      role: userRow.role || 'user',
      isSuperAdmin: false, // External service calls NEVER escalate to SuperAdmin
    };

    next();
  };
}

module.exports = {
  requireServiceKeyAuth,
  checkRateLimit,
  resetRateLimits,
  generateServiceKey,
  revokeServiceKey,
  rotateServiceKey,
  recordServiceAudit,
  recordSecurityIncident,
  clientIp,
};
