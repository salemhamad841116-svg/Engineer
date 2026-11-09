/**
 * serviceKeyAuth.js
 * Phase 13: Service API Key Authentication, Rate Limiting & User Delegation Middleware
 *
 * Implements:
 * 1. X-Service-Key authentication via SHA-256 hash comparison.
 * 2. Scope validation (defaults to books:crud).
 * 3. In-memory sliding window rate limiting (60 requests/minute, 61st returns HTTP 429).
 * 4. Immediate revocation & rotation support (effective within < 1 second).
 * 5. Short-lived Delegated Ingestion Tokens (X-Delegated-Token, 30-60 min TTL) deriving identity.
 * 6. Mandatory HMAC request signature (X-Signature, X-Timestamp) in production with 300s anti-replay window.
 * 7. Network binding: loopback & private subnets only (HTTP 403 NETWORK_RESTRICTED).
 * 8. Audit logging into service_api_audit_logs and security alerts on unauthorized access.
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

function isLoopbackOrPrivateIp(ip) {
  if (!ip) return false;
  const clean = String(ip).replace(/^::ffff:/, '').trim();
  if (clean === '127.0.0.1' || clean === '::1' || clean === 'localhost') return true;
  // RFC 1918 private subnets: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  if (/^10\./.test(clean)) return true;
  if (/^192\.168\./.test(clean)) return true;
  if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(clean)) return true;
  // Configurable whitelist
  const whitelist = (process.env.EXTERNAL_INGEST_ALLOWED_IPS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (whitelist.includes(clean)) return true;
  return false;
}

function validateNetworkOrigin(req) {
  if (process.env.EXTERNAL_INGEST_INTERNAL_ONLY === 'false') {
    return { allowed: true };
  }

  const ip = clientIp(req);
  if (!isLoopbackOrPrivateIp(ip)) {
    return {
      allowed: false,
      statusCode: 403,
      code: 'NETWORK_RESTRICTED',
      message: 'External Ingestion API is strictly restricted to internal loopback and authorized private subnets.',
    };
  }
  return { allowed: true };
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
 * Issues a short-lived Delegated Ingestion Token for an authenticated user (TTL: 30-60 min).
 */
function issueDelegatedToken({ userId, serviceKeyId = null, ttlMinutes = 45, scopes = ['books:ingest'] }) {
  const cleanUserId = String(userId || '').trim();
  if (!cleanUserId) {
    const err = new Error('User ID is required to issue a delegated token.');
    err.status = 400;
    throw err;
  }

  const user = get('SELECT id, status FROM users WHERE id = ?', cleanUserId);
  if (!user) {
    const err = new Error(`User "${cleanUserId}" does not exist.`);
    err.status = 404;
    throw err;
  }

  if (user.status === 'disabled') {
    const err = new Error('User account is disabled.');
    err.status = 403;
    throw err;
  }

  // Constrain TTL strictly between 30 and 60 minutes
  const boundedTtlMinutes = Math.min(60, Math.max(30, parseInt(ttlMinutes, 10) || 45));
  const rawRandom = crypto.randomBytes(32).toString('hex');
  const rawToken = `dit_live_${rawRandom}`;
  const tokenPrefix = rawToken.slice(0, 16);
  const tokenHash = sha256Hex(rawToken);
  const id = newId('dit');
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + boundedTtlMinutes * 60 * 1000).toISOString();

  run(
    `INSERT INTO delegated_ingest_tokens
      (id, token_prefix, token_hash, user_id, service_key_id, scopes_json, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    tokenPrefix,
    tokenHash,
    cleanUserId,
    serviceKeyId,
    JSON.stringify(scopes),
    createdAt,
    expiresAt
  );

  return {
    id,
    token: rawToken, // Returned once
    tokenPrefix,
    userId: cleanUserId,
    serviceKeyId,
    scopes,
    createdAt,
    expiresAt,
    ttlSeconds: boundedTtlMinutes * 60,
  };
}

/**
 * Revokes a delegated ingestion token immediately.
 */
function revokeDelegatedToken(id) {
  const row = get('SELECT * FROM delegated_ingest_tokens WHERE id = ?', id);
  if (!row) {
    const err = new Error('Delegated token not found.');
    err.status = 404;
    throw err;
  }
  run('UPDATE delegated_ingest_tokens SET revoked_at = ? WHERE id = ?', nowIso(), id);
  return { revoked: true, id };
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

  run('UPDATE service_api_keys SET is_revoked = 1, revoked_at = ? WHERE id = ?', nowIso(), id);
  return { revoked: true, id };
}

/**
 * Rotates a service key: revokes the old key and generates a replacement.
 */
function rotateServiceKey(id, { rotatedBy = null } = {}) {
  const oldKey = get('SELECT * FROM service_api_keys WHERE id = ?', id);
  if (!oldKey) {
    const err = new Error('Service key not found.');
    err.status = 404;
    throw err;
  }

  revokeServiceKey(id);

  let scopes = ['books:crud'];
  try {
    scopes = JSON.parse(oldKey.scopes_json || '["books:crud"]');
  } catch (_) {}

  const newKey = generateServiceKey({
    name: `${oldKey.name} (Rotated)`,
    createdBy: rotatedBy || oldKey.created_by,
    scopes,
    rateLimitRpm: oldKey.rate_limit_rpm || 60,
  });

  return {
    oldKeyId: id,
    newKey,
  };
}

/**
 * Computes canonical HMAC-SHA256 signature for API requests.
 */
function computeHmacSignature({
  method = 'GET',
  path = '',
  timestamp = '',
  delegatedToken = '',
  body = '',
  secret = '',
}) {
  const canonicalMethod = String(method || 'GET').toUpperCase();
  const canonicalPath = String(path || '').split('?')[0];
  let bodyText = '';
  if (body && typeof body === 'object' && Object.keys(body).length > 0) {
    bodyText = JSON.stringify(body);
  } else if (typeof body === 'string') {
    bodyText = body;
  }
  const bodyHash = sha256Hex(bodyText);
  const canonicalString = `${canonicalMethod}\n${canonicalPath}\n${timestamp}\n${delegatedToken || ''}\n${bodyHash}`;
  const computedHmac = crypto
    .createHmac('sha256', secret)
    .update(canonicalString)
    .digest('hex');
  return `sha256=${computedHmac}`;
}

/**
 * Validates cryptographic HMAC signature and anti-replay timestamp window.
 */
function validateHmacSignature(req, serviceKey, delegatedToken = '') {
  const isHmacRequired =
    process.env.NODE_ENV === 'production' || process.env.EXTERNAL_INGEST_REQUIRE_HMAC === 'true';

  const signatureHeader = req.headers['x-signature'] || req.headers['X-Signature'];
  const timestampHeader = req.headers['x-timestamp'] || req.headers['X-Timestamp'];

  if (!isHmacRequired && !signatureHeader && !timestampHeader) {
    return { valid: true };
  }

  // 1. Validate X-Timestamp
  if (!timestampHeader) {
    return {
      valid: false,
      statusCode: 403,
      code: 'TIMESTAMP_REQUIRED',
      message: 'X-Timestamp header is mandatory for HMAC-protected requests.',
    };
  }

  const clientTime = new Date(timestampHeader).getTime();
  if (isNaN(clientTime)) {
    return {
      valid: false,
      statusCode: 403,
      code: 'INVALID_TIMESTAMP',
      message: 'X-Timestamp must be a valid ISO-8601 date string or timestamp.',
    };
  }

  const now = Date.now();
  const maxDriftMs = 300 * 1000; // 300 seconds (5 minutes) anti-replay window
  if (Math.abs(now - clientTime) > maxDriftMs) {
    return {
      valid: false,
      statusCode: 403,
      code: 'REQUEST_EXPIRED',
      message: 'Request timestamp is older than the allowed 300-second anti-replay window.',
    };
  }

  // 2. Validate X-Signature
  if (!signatureHeader) {
    return {
      valid: false,
      statusCode: 403,
      code: 'SIGNATURE_REQUIRED',
      message: 'X-Signature header is mandatory in production.',
    };
  }

  // 3. Compute expected signature using canonical formula
  const expectedSignature = computeHmacSignature({
    method: req.method,
    path: req.originalUrl || req.url,
    timestamp: timestampHeader,
    delegatedToken: delegatedToken || '',
    body: req.body,
    secret: serviceKey.key_hash,
  });

  const sigBuffer = Buffer.from(String(signatureHeader).trim());
  const expectedBuffer = Buffer.from(expectedSignature);

  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return {
      valid: false,
      statusCode: 403,
      code: 'INVALID_SIGNATURE',
      message: 'Cryptographic signature mismatch.',
    };
  }

  return { valid: true };
}

/**
 * Service Key + Delegated Token Authentication Middleware.
 */
function requireServiceKeyAuth(requiredScope = 'books:crud') {
  return (req, res, next) => {
    const ip = clientIp(req);
    const endpoint = req.originalUrl || req.url;

    // 1. Enforce HTTPS in production
    if (process.env.NODE_ENV === 'production' && req.protocol !== 'https' && !req.secure && req.headers['x-forwarded-proto'] !== 'https') {
      recordSecurityIncident({
        category: 'security',
        message: 'Insecure plaintext HTTP access attempt blocked on external API endpoint.',
        details: { endpoint, ip },
      });
      return res.status(403).json({
        error: {
          code: 'HTTPS_REQUIRED',
          message: 'External API endpoints require an encrypted HTTPS connection in production.',
          status: 403,
        },
      });
    }

    // 2. Validate Network Origin (Loopback / Private Subnets only)
    const netCheck = validateNetworkOrigin(req);
    if (!netCheck.allowed) {
      recordSecurityIncident({
        category: 'security',
        message: `External access rejected from unauthorized IP: ${ip}`,
        details: { ip, endpoint },
      });
      recordServiceAudit({
        action: 'auth.network_restricted',
        endpoint,
        statusCode: netCheck.statusCode,
        ip,
      });
      return res.status(netCheck.statusCode).json({
        error: {
          code: netCheck.code,
          message: netCheck.message,
          status: netCheck.statusCode,
        },
      });
    }

    // 3. Extract Service Key header
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

    // 4. Hash and lookup service key in SQLite
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

    // 5. Verify revocation status (immediate revocation < 60s)
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

    // 6. Verify Scope
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

    // 7. Sliding window rate limiting (60 requests/minute)
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

    // 8. Resolve Delegated User Token (The true cryptographic trust boundary)
    const rawDelegatedToken =
      req.headers['x-delegated-token'] ||
      req.headers['X-Delegated-Token'] ||
      (req.headers['authorization']?.startsWith('Bearer dit_')
        ? req.headers['authorization'].slice(7)
        : null);

    let cleanUserId = null;
    let delegatedTokenRow = null;

    if (rawDelegatedToken && typeof rawDelegatedToken === 'string' && rawDelegatedToken.trim()) {
      const tokenHash = sha256Hex(rawDelegatedToken.trim());
      delegatedTokenRow = get('SELECT * FROM delegated_ingest_tokens WHERE token_hash = ?', tokenHash);

      if (!delegatedTokenRow) {
        recordServiceAudit({
          serviceKeyId: serviceKey.id,
          action: 'auth.invalid_delegated_token',
          endpoint,
          statusCode: 401,
          ip,
        });
        return res.status(401).json({
          error: {
            code: 'DELEGATED_TOKEN_INVALID',
            message: 'Invalid delegated ingestion token provided.',
            status: 401,
          },
        });
      }

      if (delegatedTokenRow.revoked_at) {
        recordServiceAudit({
          serviceKeyId: serviceKey.id,
          action: 'auth.revoked_delegated_token',
          userId: delegatedTokenRow.user_id,
          endpoint,
          statusCode: 403,
          ip,
        });
        return res.status(403).json({
          error: {
            code: 'DELEGATED_TOKEN_REVOKED',
            message: 'This delegated ingestion token has been revoked.',
            status: 403,
          },
        });
      }

      const expiresAtMs = new Date(delegatedTokenRow.expires_at).getTime();
      if (expiresAtMs <= Date.now()) {
        recordServiceAudit({
          serviceKeyId: serviceKey.id,
          action: 'auth.expired_delegated_token',
          userId: delegatedTokenRow.user_id,
          endpoint,
          statusCode: 401,
          ip,
        });
        return res.status(401).json({
          error: {
            code: 'DELEGATED_TOKEN_EXPIRED',
            message: 'Delegated ingestion token has expired (30-60m TTL exceeded). Please re-authenticate.',
            status: 401,
          },
        });
      }

      // Identity is derived directly from the verified token
      cleanUserId = delegatedTokenRow.user_id;

      // Anti-Spoofing: If caller also provided X-User-Id header, it MUST match the token
      const claimedUserId = req.headers['x-user-id'] || req.headers['X-User-Id'];
      if (claimedUserId && String(claimedUserId).trim() !== cleanUserId) {
        recordSecurityIncident({
          category: 'security',
          message: `User spoofing attempt: Claimed user [${claimedUserId}] does not match delegated token owner [${cleanUserId}]`,
          details: { claimedUserId, tokenUserId: cleanUserId, tokenId: delegatedTokenRow.id },
          tenantId: cleanUserId,
        });
        recordServiceAudit({
          serviceKeyId: serviceKey.id,
          action: 'auth.identity_mismatch',
          userId: cleanUserId,
          endpoint,
          statusCode: 403,
          ip,
          detail: { claimedUserId },
        });
        return res.status(403).json({
          error: {
            code: 'IDENTITY_MISMATCH',
            message: 'Claimed user identity does not match the delegated token owner.',
            status: 403,
          },
        });
      }

      // Update token last used
      run('UPDATE delegated_ingest_tokens SET last_used_at = ? WHERE id = ?', nowIso(), delegatedTokenRow.id);
    } else {
      // If delegated token was omitted:
      const requestedUserId =
        req.headers['x-user-id'] || req.headers['X-User-Id'] || req.body?.user_id || req.body?.userId;

      if (!requestedUserId || typeof requestedUserId !== 'string' || !requestedUserId.trim()) {
        recordServiceAudit({
          serviceKeyId: serviceKey.id,
          action: 'auth.missing_delegated_token',
          endpoint,
          statusCode: 401,
          ip,
        });
        return res.status(401).json({
          error: {
            code: 'DELEGATED_TOKEN_REQUIRED',
            message: 'A short-lived delegated token (X-Delegated-Token header) is required to identify the authorized user.',
            status: 401,
          },
        });
      }

      // In production or when REQUIRE_DELEGATED_TOKEN is enforced, reject raw X-User-Id claims
      if (process.env.NODE_ENV === 'production' || process.env.REQUIRE_DELEGATED_TOKEN === 'true') {
        recordServiceAudit({
          serviceKeyId: serviceKey.id,
          action: 'auth.delegated_token_required_in_prod',
          endpoint,
          statusCode: 401,
          ip,
        });
        return res.status(401).json({
          error: {
            code: 'DELEGATED_TOKEN_REQUIRED',
            message: 'Production security policy requires X-Delegated-Token. Raw X-User-Id claims are rejected.',
            status: 401,
          },
        });
      }

      cleanUserId = requestedUserId.trim();
    }

    // 9. Validate HMAC Signature (incorporates delegated token)
    const hmacCheck = validateHmacSignature(req, serviceKey, rawDelegatedToken || '');
    if (!hmacCheck.valid) {
      recordSecurityIncident({
        category: 'security',
        message: `HMAC verification failed: ${hmacCheck.message} (${hmacCheck.code})`,
        details: { endpoint, ip, code: hmacCheck.code },
        tenantId: cleanUserId,
      });
      recordServiceAudit({
        serviceKeyId: serviceKey.id,
        action: 'auth.hmac_failed',
        userId: cleanUserId,
        endpoint,
        statusCode: hmacCheck.statusCode,
        ip,
        detail: { code: hmacCheck.code },
      });
      return res.status(hmacCheck.statusCode).json({
        error: {
          code: hmacCheck.code,
          message: hmacCheck.message,
          status: hmacCheck.statusCode,
        },
      });
    }

    // 10. Verify User in Database
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
    req.delegatedToken = delegatedTokenRow;
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

/**
 * Service Key Only Authentication (for token issuance and non-user-scoped operations).
 */
function requireServiceKeyBasicAuth(requiredScope = 'books:crud') {
  return (req, res, next) => {
    const ip = clientIp(req);
    const endpoint = req.originalUrl || req.url;

    // 1. Enforce HTTPS in production
    if (
      process.env.NODE_ENV === 'production' &&
      req.protocol !== 'https' &&
      !req.secure &&
      req.headers['x-forwarded-proto'] !== 'https'
    ) {
      recordSecurityIncident({
        category: 'security',
        message: 'Insecure plaintext HTTP access attempt blocked on external token endpoint.',
        details: { endpoint, ip },
      });
      return res.status(403).json({
        error: {
          code: 'HTTPS_REQUIRED',
          message: 'External API endpoints require an encrypted HTTPS connection in production.',
          status: 403,
        },
      });
    }

    // 2. Validate Network Origin (Loopback / Private Subnets only)
    const netCheck = validateNetworkOrigin(req);
    if (!netCheck.allowed) {
      recordSecurityIncident({
        category: 'security',
        message: `External token access rejected from unauthorized IP: ${ip}`,
        details: { ip, endpoint },
      });
      return res.status(netCheck.statusCode).json({
        error: {
          code: netCheck.code,
          message: netCheck.message,
          status: netCheck.statusCode,
        },
      });
    }

    // 3. Extract Service Key header
    const rawKey = req.headers['x-service-key'] || req.headers['X-Service-Key'];
    if (!rawKey || typeof rawKey !== 'string' || !rawKey.trim()) {
      return res.status(401).json({
        error: {
          code: 'MISSING_SERVICE_KEY',
          message: 'X-Service-Key header is missing or empty.',
          status: 401,
        },
      });
    }

    const hash = sha256Hex(rawKey.trim());
    const serviceKey = get('SELECT * FROM service_api_keys WHERE key_hash = ?', hash);
    if (!serviceKey) {
      return res.status(401).json({
        error: {
          code: 'INVALID_SERVICE_KEY',
          message: 'Invalid service API key provided.',
          status: 401,
        },
      });
    }

    if (Number(serviceKey.is_revoked) === 1) {
      return res.status(403).json({
        error: {
          code: 'SERVICE_KEY_REVOKED',
          message: 'This service API key has been revoked and can no longer be used.',
          status: 403,
        },
      });
    }

    let scopes = [];
    try {
      scopes = JSON.parse(serviceKey.scopes_json || '[]');
    } catch (_) {
      scopes = [];
    }

    if (requiredScope && !scopes.includes(requiredScope) && !scopes.includes('*')) {
      return res.status(403).json({
        error: {
          code: 'INSUFFICIENT_SCOPE',
          message: `Service key lacks required scope "${requiredScope}".`,
          status: 403,
        },
      });
    }

    const rateLimitResult = checkRateLimit(serviceKey.id, serviceKey.rate_limit_rpm || 60);
    if (!rateLimitResult.allowed) {
      res.setHeader('Retry-After', String(rateLimitResult.retryAfter));
      return res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Rate limit of ${serviceKey.rate_limit_rpm || 60} requests per minute exceeded.`,
          retryAfter: rateLimitResult.retryAfter,
          status: 429,
        },
      });
    }

    const hmacCheck = validateHmacSignature(req, serviceKey, '');
    if (!hmacCheck.valid) {
      return res.status(hmacCheck.statusCode).json({
        error: {
          code: hmacCheck.code,
          message: hmacCheck.message,
          status: hmacCheck.statusCode,
        },
      });
    }

    req.serviceKey = serviceKey;
    next();
  };
}

module.exports = {
  requireServiceKeyAuth,
  requireServiceKeyBasicAuth,
  checkRateLimit,
  resetRateLimits,
  generateServiceKey,
  revokeServiceKey,
  rotateServiceKey,
  issueDelegatedToken,
  revokeDelegatedToken,
  computeHmacSignature,
  validateHmacSignature,
  validateNetworkOrigin,
  isLoopbackOrPrivateIp,
  recordServiceAudit,
  recordSecurityIncident,
  clientIp,
};
