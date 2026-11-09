/**
 * paymentWebhookRoutes.js
 * Phase 14: Payment Gateway Webhooks Receiver
 *
 * Implements:
 * - POST /api/webhooks/stripe
 *
 * Enforces:
 * - Strict HMAC-SHA256 signature verification against raw request buffer.
 * - Idempotent event processing.
 * - Server-side entitlements derivation.
 */

const express = require('express');
const { processWebhookEvent } = require('../services/payments/subscriptionService');

const router = express.Router();

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket?.remoteAddress) || '127.0.0.1';
}

/**
 * POST /api/webhooks/stripe
 * Receives and validates signed Stripe webhook events.
 */
router.post('/stripe', async (req, res) => {
  const ip = getClientIp(req);
  const signatureHeader = req.headers['stripe-signature'];

  // Prefer raw body buffer captured by express.json verify callback
  let rawBody = req.rawBody;
  if (!rawBody && req.body) {
    if (Buffer.isBuffer(req.body)) {
      rawBody = req.body;
    } else if (typeof req.body === 'string') {
      rawBody = Buffer.from(req.body, 'utf8');
    } else {
      rawBody = Buffer.from(JSON.stringify(req.body), 'utf8');
    }
  }

  try {
    const result = await processWebhookEvent({
      rawBody,
      signatureHeader,
      ip,
    });

    res.status(200).json({ received: true, ...result });
  } catch (err) {
    const status = err.statusCode || err.status || 400;
    res.status(status).json({
      error: {
        code: err.code || 'WEBHOOK_ERROR',
        message: err.message,
        status,
      },
    });
  }
});

module.exports = router;
