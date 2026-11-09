/**
 * billingRoutes.js
 * Phase 14: User Billing & Subscription Endpoints
 *
 * Implements:
 * - GET /api/billing/plans (Public / Auth)
 * - GET /api/billing/subscription (Authenticated User)
 * - POST /api/billing/checkout-session (Stripe Hosted Checkout)
 * - POST /api/billing/portal-session (Stripe Customer Portal)
 */

const express = require('express');
const { requireAuth } = require('../auth/middleware');
const { tenantGuard } = require('../auth/tenantGuard');
const {
  getSubscriptionPlans,
  getUserSubscription,
  createCheckoutSession,
  createCustomerPortalSession,
} = require('../services/payments/subscriptionService');

const router = express.Router();

/**
 * GET /api/billing/plans
 * Returns active subscription plans with pricing in AED/USD and daily points allocation.
 */
router.get('/plans', (_req, res, next) => {
  try {
    const plans = getSubscriptionPlans();
    res.json({ success: true, plans });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/billing/subscription
 * Returns the authenticated user's current subscription, status, and renewal information.
 */
router.get('/subscription', requireAuth(), tenantGuard, (req, res, next) => {
  try {
    const subscription = getUserSubscription(req.user.id);
    res.json({ success: true, subscription });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/checkout-session
 * Initiates a Stripe Hosted Checkout session for upgrading to a paid tier.
 */
router.post('/checkout-session', requireAuth(), tenantGuard, async (req, res, next) => {
  try {
    const { planId, successUrl, cancelUrl } = req.body || {};
    const session = await createCheckoutSession({
      userId: req.user.id,
      planId,
      successUrl,
      cancelUrl,
    });
    res.json({ success: true, session });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/billing/portal-session
 * Creates a Stripe Customer Portal session URL for card and billing management.
 */
router.post('/portal-session', requireAuth(), tenantGuard, async (req, res, next) => {
  try {
    const { returnUrl } = req.body || {};
    const session = await createCustomerPortalSession({
      userId: req.user.id,
      returnUrl,
    });
    res.json({ success: true, session });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
