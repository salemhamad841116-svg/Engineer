/**
 * externalTokenRoutes.js
 * Phase 13: Delegated Ingestion Token Management Routes
 *
 * Allows external ingestion systems authenticated with a valid Service API Key
 * to issue short-lived (30-60m TTL) per-user delegated tokens ONLY with verified proof
 * of user login from the unified login/SSO system (active session token or assertion).
 */

const express = require('express');
const { get } = require('../db/database');
const { resolveSession } = require('../auth/authService');
const {
  requireServiceKeyBasicAuth,
  issueDelegatedToken,
  revokeDelegatedToken,
  recordServiceAudit,
  recordSecurityIncident,
  clientIp,
} = require('../auth/serviceKeyAuth');

const router = express.Router();

// Enforce Service Key basic auth (network origin check + service key validation + rate limit)
router.use(requireServiceKeyBasicAuth('books:crud'));

/**
 * POST /api/external/tokens/delegated
 * Issues a per-user short-lived delegated token (TTL 30–60 minutes, default 45 min).
 * Strictly requires proof of active user login from unified login/SSO.
 */
router.post('/delegated', (req, res) => {
  const ip = clientIp(req);
  const { ttlMinutes = 45, scopes = ['books:crud'] } = req.body || {};
  const claimedUserId = req.body?.userId ? String(req.body.userId).trim() : null;

  // 1. Extract login proof (Active Session Token or SSO Assertion)
  const rawSessionProof =
    req.headers['x-user-session-token'] ||
    req.headers['x-sso-token'] ||
    req.headers['x-session-token'] ||
    req.body?.sessionToken ||
    req.body?.session_token ||
    req.body?.ssoAssertion ||
    req.body?.loginProof ||
    (req.headers['authorization']?.startsWith('Bearer ') &&
     !req.headers['authorization'].startsWith('Bearer sk_') &&
     !req.headers['authorization'].startsWith('Bearer dit_')
      ? req.headers['authorization'].slice(7).trim()
      : null);

  if (!rawSessionProof) {
    recordSecurityIncident({
      category: 'security',
      message: `Delegated token issuance rejected: Missing user login proof / active SSO session for claimed user [${claimedUserId || 'unspecified'}].`,
      details: { claimedUserId, ip, endpoint: req.originalUrl || req.url },
      tenantId: claimedUserId || null,
    });
    recordServiceAudit({
      serviceKeyId: req.serviceKey.id,
      action: 'auth.delegated_token_rejected_no_login_proof',
      userId: claimedUserId || null,
      endpoint: req.originalUrl || req.url,
      statusCode: 401,
      ip,
      detail: { reason: 'Missing X-User-Session-Token or SSO assertion proof' },
    });
    return res.status(401).json({
      error: {
        code: 'LOGIN_PROOF_REQUIRED',
        message: 'Delegated token issuance strictly requires proof of active user login from the unified login/SSO system (X-User-Session-Token header or sessionToken).',
        status: 401,
      },
    });
  }

  // 2. Validate session proof with authService
  let sessionData;
  try {
    sessionData = resolveSession(rawSessionProof);
  } catch (err) {
    recordSecurityIncident({
      category: 'security',
      message: `Delegated token issuance rejected: User has no active authenticated session or session expired (${err.code}).`,
      details: { error: err.message, code: err.code, ip, claimedUserId },
      tenantId: claimedUserId || null,
    });
    recordServiceAudit({
      serviceKeyId: req.serviceKey.id,
      action: 'auth.delegated_token_rejected_invalid_session',
      userId: claimedUserId || null,
      endpoint: req.originalUrl || req.url,
      statusCode: 401,
      ip,
      detail: { code: err.code, error: err.message },
    });
    return res.status(401).json({
      error: {
        code: 'SESSION_INVALID',
        message: `Proof of user login is invalid or expired: ${err.message}`,
        status: 401,
      },
    });
  }

  const authenticatedUser = sessionData.user;
  const verifiedUserId = authenticatedUser.id;

  // 3. Anti-Spoofing: If client claimed a userId in body, it MUST match the authenticated user!
  if (claimedUserId && claimedUserId !== verifiedUserId) {
    recordSecurityIncident({
      category: 'security',
      message: `Delegated token issuance attack blocked: Claimed userId [${claimedUserId}] does not match authenticated session user [${verifiedUserId}].`,
      details: { claimedUserId, sessionUserId: verifiedUserId, ip },
      tenantId: verifiedUserId,
    });
    recordServiceAudit({
      serviceKeyId: req.serviceKey.id,
      action: 'auth.delegated_token_identity_mismatch',
      userId: verifiedUserId,
      endpoint: req.originalUrl || req.url,
      statusCode: 403,
      ip,
      detail: { claimedUserId, authenticatedUserId: verifiedUserId },
    });
    return res.status(403).json({
      error: {
        code: 'IDENTITY_MISMATCH',
        message: 'Claimed userId does not match the active authenticated user from unified login.',
        status: 403,
      },
    });
  }

  // 4. Derive identity strictly from verified session
  const cleanUserId = verifiedUserId;

  if (authenticatedUser.status === 'disabled') {
    return res.status(403).json({
      error: {
        code: 'USER_DISABLED',
        message: 'The requested user account is disabled.',
        status: 403,
      },
    });
  }

  try {
    const result = issueDelegatedToken({
      userId: cleanUserId,
      serviceKeyId: req.serviceKey.id,
      ttlMinutes,
      scopes,
    });

    recordServiceAudit({
      serviceKeyId: req.serviceKey.id,
      action: 'auth.issued_delegated_token',
      userId: cleanUserId,
      endpoint: req.originalUrl || req.url,
      statusCode: 201,
      ip,
      detail: { tokenId: result.id, ttlSeconds: result.ttlSeconds, expiresAt: result.expiresAt },
    });

    return res.status(201).json({
      success: true,
      delegatedToken: result.token,
      token: result.token,
      id: result.id,
      tokenPrefix: result.tokenPrefix,
      userId: result.userId,
      userName: authenticatedUser.name,
      userEmail: authenticatedUser.email,
      expiresAt: result.expiresAt,
      ttlSeconds: result.ttlSeconds,
      ttlMinutes: Math.round(result.ttlSeconds / 60),
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: {
        code: 'TOKEN_ISSUANCE_FAILED',
        message: err.message,
        status: err.status || 500,
      },
    });
  }
});

/**
 * POST /api/external/tokens/:id/revoke
 * Immediately revokes a delegated token (< 60s / 0ms).
 */
router.post('/:id/revoke', (req, res) => {
  const ip = clientIp(req);
  const { id } = req.params;

  try {
    const result = revokeDelegatedToken(id);

    recordServiceAudit({
      serviceKeyId: req.serviceKey.id,
      action: 'auth.revoked_delegated_token',
      endpoint: req.originalUrl || req.url,
      statusCode: 200,
      ip,
      detail: { tokenId: id },
    });

    return res.json({
      success: true,
      revoked: true,
      id,
    });
  } catch (err) {
    return res.status(err.status || 500).json({
      error: {
        code: 'REVOCATION_FAILED',
        message: err.message,
        status: err.status || 500,
      },
    });
  }
});

module.exports = router;
