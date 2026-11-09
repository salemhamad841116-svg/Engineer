/**
 * subscriptionService.js
 * Phase 14: Subscription & Entitlement Management Service
 *
 * Enforces the Golden Rule of Payments:
 * - Entitlements are derived server-side exclusively from signed Stripe Webhook events.
 * - Idempotency guaranteed: Each webhook event processed exactly once via payment_webhook_events.
 * - Payment grace period: 3-day grace period on invoice.payment_failed (no instant ban).
 * - Real-time quota synchronization with usage_counters and quotaService.
 */

const { get, all, run, tx } = require('../../db/database');
const { newId } = require('../../utils/ids');
const { nowIso, nowMs } = require('../../utils/clock');
const { AppError } = require('../../utils/errors');
const config = require('../../config');
const { getPaymentProvider } = require('./paymentProvider');

/**
 * Retrieves all active subscription plans from the database.
 */
function getSubscriptionPlans() {
  const rows = all('SELECT * FROM subscription_plans WHERE is_active = 1 ORDER BY price_cents ASC');
  return rows.map((r) => ({
    id: r.id,
    nameAr: r.name_ar,
    nameEn: r.name_en,
    dailyPoints: r.daily_points,
    priceCents: r.price_cents,
    priceFormatted: (r.price_cents / 100).toFixed(2),
    currency: r.currency.toUpperCase(),
    stripePriceId: r.stripe_price_id,
    features: JSON.parse(r.features_json || '[]'),
  }));
}

/**
 * Retrieves a plan by ID.
 */
function getPlanById(planId) {
  const row = get('SELECT * FROM subscription_plans WHERE id = ?', planId);
  if (!row) return null;
  return {
    id: row.id,
    nameAr: row.name_ar,
    nameEn: row.name_en,
    dailyPoints: row.daily_points,
    priceCents: row.price_cents,
    priceFormatted: (row.price_cents / 100).toFixed(2),
    currency: row.currency.toUpperCase(),
    stripePriceId: row.stripe_price_id,
    features: JSON.parse(row.features_json || '[]'),
    isActive: Boolean(row.is_active),
  };
}

/**
 * Updates a plan (used by Super Admin).
 */
function updatePlan(planId, updates = {}) {
  const existing = get('SELECT * FROM subscription_plans WHERE id = ?', planId);
  if (!existing) throw new AppError(404, 'PLAN_NOT_FOUND', `Plan [${planId}] does not exist.`);

  const priceCents = updates.priceCents !== undefined ? Number(updates.priceCents) : existing.price_cents;
  const currency = updates.currency ? String(updates.currency).toLowerCase() : existing.currency;
  const dailyPoints = updates.dailyPoints !== undefined ? Number(updates.dailyPoints) : existing.daily_points;
  const featuresJson = updates.features ? JSON.stringify(updates.features) : existing.features_json;
  const isActive = updates.isActive !== undefined ? (updates.isActive ? 1 : 0) : existing.is_active;

  run(
    `UPDATE subscription_plans
     SET price_cents = ?, currency = ?, daily_points = ?, features_json = ?, is_active = ?, updated_at = ?
     WHERE id = ?`,
    priceCents,
    currency,
    dailyPoints,
    featuresJson,
    isActive,
    nowIso(),
    planId
  );

  return getPlanById(planId);
}

/**
 * Retrieves the active subscription for a user.
 */
function getUserSubscription(userId) {
  const row = get(
    `SELECT s.*, p.name_ar as plan_name_ar, p.name_en as plan_name_en, p.daily_points, p.price_cents, p.currency
     FROM subscriptions s
     JOIN subscription_plans p ON s.plan_id = p.id
     WHERE s.user_id = ?
     ORDER BY s.created_at DESC
     LIMIT 1`,
    userId
  );

  if (!row) {
    const freePlan = getPlanById('free');
    return {
      id: null,
      userId,
      planId: 'free',
      status: 'active',
      planNameAr: freePlan ? freePlan.nameAr : 'الخطة الأساسية المجانية',
      planNameEn: freePlan ? freePlan.nameEn : 'Free Starter',
      dailyPoints: freePlan ? freePlan.dailyPoints : 10,
      priceFormatted: '0.00',
      currency: 'AED',
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      isTrial: false,
      isGracePeriod: false,
      stripeCustomerId: null,
    };
  }

  const now = new Date();
  const isGracePeriod = row.status === 'past_due' && row.grace_period_end && new Date(row.grace_period_end) > now;
  const isTrial = row.status === 'trialing' || (row.trial_end && new Date(row.trial_end) > now);

  return {
    id: row.id,
    userId: row.user_id,
    planId: row.plan_id,
    status: row.status,
    planNameAr: row.plan_name_ar,
    planNameEn: row.plan_name_en,
    dailyPoints: row.daily_points,
    priceFormatted: (row.price_cents / 100).toFixed(2),
    currency: row.currency ? row.currency.toUpperCase() : 'AED',
    currentPeriodStart: row.current_period_start,
    currentPeriodEnd: row.current_period_end,
    cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    canceledAt: row.canceled_at,
    isTrial,
    trialEnd: row.trial_end,
    isGracePeriod,
    gracePeriodEnd: row.grace_period_end,
    stripeCustomerId: row.stripe_customer_id,
    stripeSubscriptionId: row.stripe_subscription_id,
  };
}

/**
 * Derives the active entitlement plan for quota & rate calculations.
 */
function getEffectiveUserPlanId(userId) {
  const sub = getUserSubscription(userId);
  if (!sub.id) return 'free';

  // Active or trialing -> full plan entitlement
  if (sub.status === 'active' || sub.status === 'trialing') {
    return sub.planId;
  }

  // past_due during grace period -> retains plan entitlement
  if (sub.status === 'past_due' && sub.isGracePeriod) {
    return sub.planId;
  }

  // Any other status (canceled, unpaid, expired grace) -> free fallback
  return 'free';
}

/**
 * Synchronizes today's usage counter allocated points with user's new plan.
 */
function syncTodayQuotaAllocation(userId, planId) {
  const plan = getPlanById(planId) || getPlanById('free');
  const points = plan ? plan.dailyPoints : 10;
  const today = new Date().toISOString().slice(0, 10);

  const counter = get('SELECT * FROM usage_counters WHERE user_id = ? AND period_date = ?', userId, today);
  if (counter) {
    run(
      'UPDATE usage_counters SET plan_id = ?, points_allocated = ?, updated_at = ? WHERE id = ?',
      planId,
      points,
      nowIso(),
      counter.id
    );
  }

  // Also sync users.plan_id column
  run('UPDATE users SET plan_id = ? WHERE id = ?', planId, userId);
}

/**
 * Creates a Stripe Checkout Session for upgrading a user subscription.
 */
async function createCheckoutSession({ userId, planId, successUrl, cancelUrl }) {
  const plan = getPlanById(planId);
  if (!plan || plan.id === 'free') {
    throw new AppError(400, 'INVALID_PLAN', 'Please select a paid plan to checkout.');
  }

  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User account not found.');

  const provider = getPaymentProvider();

  // Find or create Stripe customer
  let sub = get('SELECT stripe_customer_id FROM subscriptions WHERE user_id = ? LIMIT 1', userId);
  let customerId = sub ? sub.stripe_customer_id : null;

  if (!customerId) {
    const custRes = await provider.createCustomer({
      userId,
      email: user.email,
      name: user.name,
    });
    customerId = custRes.customerId;
  }

  const session = await provider.createCheckoutSession({
    customerId,
    plan,
    userId,
    successUrl: successUrl || '/?payment=success',
    cancelUrl: cancelUrl || '/?payment=cancelled',
    trialDays: plan.id === 'pro' ? config.trialPeriodDays : 0,
  });

  // Record audit log
  run(
    `INSERT INTO payment_audit_logs (id, user_id, subscription_id, provider, action, amount_cents, currency, status, ip, created_at, detail_json)
     VALUES (?, ?, NULL, ?, 'checkout.session_created', ?, ?, 'pending', '127.0.0.1', ?, ?)`,
    newId('pal'),
    userId,
    provider.name,
    plan.priceCents,
    plan.currency.toLowerCase(),
    nowIso(),
    JSON.stringify({ sessionId: session.sessionId, planId })
  );

  return session;
}

/**
 * Creates a Stripe Customer Portal Session for self-service billing management.
 */
async function createCustomerPortalSession({ userId, returnUrl }) {
  const sub = get('SELECT stripe_customer_id FROM subscriptions WHERE user_id = ? LIMIT 1', userId);
  if (!sub || !sub.stripe_customer_id) {
    throw new AppError(400, 'NO_BILLING_ACCOUNT', 'No active billing account found. Please subscribe first.');
  }

  const provider = getPaymentProvider();
  const session = await provider.createCustomerPortalSession({
    customerId: sub.stripe_customer_id,
    returnUrl: returnUrl || '/',
  });

  return session;
}

/**
 * Records a critical payment alert in system_alert_logs.
 */
function recordPaymentAlert({ category = 'security', message, details = {}, userId = null }) {
  try {
    const id = newId('alt');
    const now = nowIso();
    const safeCategory = ['memory', 'disk', 'health', 'security', 'backup', 'general'].includes(category)
      ? category
      : 'security';
    run(
      `INSERT INTO system_alert_logs (id, timestamp, level, category, message, details_json, tenant_id)
       VALUES (?, ?, 'critical', ?, ?, ?, ?)`,
      id,
      now,
      safeCategory,
      message,
      JSON.stringify({ ...details, userId, timestamp: now }),
      userId
    );
  } catch (err) {
    console.error('Failed to record payment alert:', err);
  }
}

/**
 * Core Webhook Event Processing Engine.
 * - Enforces HMAC signature verification.
 * - Enforces idempotency via payment_webhook_events table.
 * - Derives entitlements strictly server-side.
 */
async function processWebhookEvent({ rawBody, signatureHeader, ip = '127.0.0.1' }) {
  const provider = getPaymentProvider();

  // 1. Signature Verification
  let event;
  try {
    event = provider.constructWebhookEvent(rawBody, signatureHeader);
  } catch (sigErr) {
    recordPaymentAlert({
      category: 'security',
      message: `Forged or invalid payment webhook rejected: ${sigErr.message}`,
      details: { ip, code: sigErr.code, error: sigErr.message },
    });
    throw new AppError(400, sigErr.code || 'WEBHOOK_SIGNATURE_INVALID', sigErr.message);
  }

  if (!event || !event.id || !event.type) {
    throw new AppError(400, 'MALFORMED_WEBHOOK', 'Webhook event must contain id and type.');
  }

  // 2. Idempotency Check: Each webhook event processed exactly once
  const existingEvent = get('SELECT * FROM payment_webhook_events WHERE id = ?', event.id);
  if (existingEvent) {
    return {
      status: 'duplicate',
      message: `Event [${event.id}] already processed idempotently.`,
      eventId: event.id,
      eventType: event.type,
    };
  }

  // Record raw event in payment_webhook_events
  run(
    `INSERT INTO payment_webhook_events (id, provider, event_type, payload_json, processed_at, status)
     VALUES (?, ?, ?, ?, ?, 'processed')`,
    event.id,
    provider.name,
    event.type,
    JSON.stringify(event),
    nowIso()
  );

  const obj = event.data?.object || {};

  // 3. Process Event Types
  return tx(() => {
    switch (event.type) {
      case 'checkout.session.completed': {
        const metadata = obj.metadata || {};
        const userId = metadata.userId || obj.client_reference_id;
        const planId = metadata.planId || 'pro';
        const customerId = obj.customer;
        const subscriptionId = obj.subscription || `sub_cs_${event.id}`;

        if (userId) {
          const subId = newId('sub');
          const now = nowIso();
          const periodEnd = new Date(Date.now() + 30 * 24 * 3600000).toISOString();
          const trialEnd = metadata.trialDays ? new Date(Date.now() + Number(metadata.trialDays) * 24 * 3600000).toISOString() : null;

          run(
            `INSERT INTO subscriptions (
               id, user_id, stripe_customer_id, stripe_subscription_id, plan_id, status,
               current_period_start, current_period_end, trial_start, trial_end, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            subId,
            userId,
            customerId,
            subscriptionId,
            planId,
            trialEnd ? 'trialing' : 'active',
            now,
            periodEnd,
            trialEnd ? now : null,
            trialEnd,
            now,
            now
          );

          syncTodayQuotaAllocation(userId, planId);

          run(
            `INSERT INTO payment_audit_logs (id, user_id, subscription_id, provider, action, amount_cents, currency, status, ip, created_at, detail_json)
             VALUES (?, ?, ?, ?, 'checkout.completed', ?, 'aed', 'active', ?, ?, ?)`,
            newId('pal'),
            userId,
            subId,
            provider.name,
            obj.amount_total || 0,
            ip,
            now,
            JSON.stringify({ eventId: event.id, planId, customerId })
          );
        }
        break;
      }

      case 'customer.subscription.updated': {
        const stripeSubId = obj.id;
        const status = obj.status || 'active';
        const cancelAtPeriodEnd = obj.cancel_at_period_end ? 1 : 0;
        const periodStart = obj.current_period_start ? new Date(obj.current_period_start * 1000).toISOString() : nowIso();
        const periodEnd = obj.current_period_end ? new Date(obj.current_period_end * 1000).toISOString() : null;
        const planId = obj.metadata?.planId || (obj.items?.data?.[0]?.price?.lookup_key) || null;

        const subRow = get('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?', stripeSubId);
        if (subRow) {
          const effectivePlanId = planId || subRow.plan_id;
          run(
            `UPDATE subscriptions
             SET status = ?, cancel_at_period_end = ?, plan_id = ?, current_period_start = ?, current_period_end = ?, updated_at = ?
             WHERE id = ?`,
            status,
            cancelAtPeriodEnd,
            effectivePlanId,
            periodStart,
            periodEnd,
            nowIso(),
            subRow.id
          );

          if (status === 'active' || status === 'trialing') {
            syncTodayQuotaAllocation(subRow.user_id, effectivePlanId);
          }

          run(
            `INSERT INTO payment_audit_logs (id, user_id, subscription_id, provider, action, amount_cents, currency, status, ip, created_at, detail_json)
             VALUES (?, ?, ?, ?, 'subscription.updated', 0, 'aed', ?, ?, ?, ?)`,
            newId('pal'),
            subRow.user_id,
            subRow.id,
            provider.name,
            status,
            ip,
            nowIso(),
            JSON.stringify({ eventId: event.id, status, cancelAtPeriodEnd, effectivePlanId })
          );
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const stripeSubId = obj.id;
        const subRow = get('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?', stripeSubId);
        if (subRow) {
          const now = nowIso();
          run(
            `UPDATE subscriptions
             SET status = 'canceled', canceled_at = ?, updated_at = ?
             WHERE id = ?`,
            now,
            now,
            subRow.id
          );

          // Downgrade user entitlements back to free
          syncTodayQuotaAllocation(subRow.user_id, 'free');

          run(
            `INSERT INTO payment_audit_logs (id, user_id, subscription_id, provider, action, amount_cents, currency, status, ip, created_at, detail_json)
             VALUES (?, ?, ?, ?, 'subscription.deleted_downgraded_to_free', 0, 'aed', 'canceled', ?, ?, ?)`,
            newId('pal'),
            subRow.user_id,
            subRow.id,
            provider.name,
            ip,
            now,
            JSON.stringify({ eventId: event.id, previousPlan: subRow.plan_id })
          );
        }
        break;
      }

      case 'invoice.payment_failed': {
        const stripeSubId = obj.subscription;
        const customerId = obj.customer;
        const subRow = get(
          'SELECT * FROM subscriptions WHERE stripe_subscription_id = ? OR stripe_customer_id = ?',
          stripeSubId,
          customerId
        );

        if (subRow) {
          const now = nowIso();
          const graceEnd = new Date(Date.now() + (config.paymentGracePeriodDays || 3) * 24 * 3600000).toISOString();

          run(
            `UPDATE subscriptions
             SET status = 'past_due', grace_period_end = ?, updated_at = ?
             WHERE id = ?`,
            graceEnd,
            now,
            subRow.id
          );

          recordPaymentAlert({
            category: 'payment',
            message: `Invoice payment failed for user [${subRow.user_id}]. Grace period active until ${graceEnd}.`,
            details: { subscriptionId: subRow.id, customerId, graceEnd },
            userId: subRow.user_id,
          });

          run(
            `INSERT INTO payment_audit_logs (id, user_id, subscription_id, provider, action, amount_cents, currency, status, ip, created_at, detail_json)
             VALUES (?, ?, ?, ?, 'invoice.payment_failed_grace_started', ?, 'aed', 'past_due', ?, ?, ?)`,
            newId('pal'),
            subRow.user_id,
            subRow.id,
            provider.name,
            obj.amount_due || 0,
            ip,
            now,
            JSON.stringify({ eventId: event.id, graceEnd })
          );
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const stripeSubId = obj.subscription;
        const subRow = get('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?', stripeSubId);
        if (subRow) {
          const now = nowIso();
          run(
            `UPDATE subscriptions
             SET status = 'active', grace_period_end = NULL, updated_at = ?
             WHERE id = ?`,
            now,
            subRow.id
          );

          syncTodayQuotaAllocation(subRow.user_id, subRow.plan_id);

          run(
            `INSERT INTO payment_audit_logs (id, user_id, subscription_id, provider, action, amount_cents, currency, status, ip, created_at, detail_json)
             VALUES (?, ?, ?, ?, 'invoice.payment_succeeded', ?, 'aed', 'active', ?, ?, ?)`,
            newId('pal'),
            subRow.user_id,
            subRow.id,
            provider.name,
            obj.amount_paid || 0,
            ip,
            now,
            JSON.stringify({ eventId: event.id })
          );
        }
        break;
      }

      default:
        // Ignore unhandled event types without error
        break;
    }

    return {
      status: 'success',
      eventId: event.id,
      eventType: event.type,
      processedAt: nowIso(),
    };
  });
}

module.exports = {
  getSubscriptionPlans,
  getPlanById,
  updatePlan,
  getUserSubscription,
  getEffectiveUserPlanId,
  syncTodayQuotaAllocation,
  createCheckoutSession,
  createCustomerPortalSession,
  processWebhookEvent,
  recordPaymentAlert,
};
