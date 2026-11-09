/**
 * externalTokenRoutes.js
 * Phase 13: Delegated Ingestion Token Management Routes
 *
 * Allows external ingestion systems authenticated with a valid Service API Key
 * to issue short-lived (30-60m TTL) per-user delegated tokens and revoke them.
 */

const express = require('express');
const { get } = require('../db/database');
const {
  requireServiceKeyBasicAuth,
  issueDelegatedToken,
  revokeDelegatedToken,
  recordServiceAudit,
  clientIp,
} = require('../auth/serviceKeyAuth');

const router = express.Router();

// Enforce Service Key basic auth (network origin check + service key validation + rate limit)
router.use(requireServiceKeyBasicAuth('books:crud'));

/**
 * POST /api/external/tokens/delegated
 * Issues a per-user short-lived delegated token (TTL 30–60 minutes, default 45 min).
 */
router.post('/delegated', (req, res) => {
  const ip = clientIp(req);
  const { userId, ttlMinutes = 45, scopes = ['books:crud'] } = req.body || {};

  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return res.status(400).json({
      error: {
        code: 'USER_ID_REQUIRED',
        message: 'userId is required to issue a delegated token.',
        status: 400,
      },
    });
  }

  const cleanUserId = userId.trim();
  const user = get('SELECT id, status, name, email, role FROM users WHERE id = ?', cleanUserId);
  if (!user) {
    return res.status(404).json({
      error: {
        code: 'USER_NOT_FOUND',
        message: `User identity "${cleanUserId}" does not exist in the platform.`,
        status: 404,
      },
    });
  }

  if (user.status === 'disabled') {
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
