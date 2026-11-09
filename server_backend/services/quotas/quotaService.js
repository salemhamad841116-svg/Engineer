/**
 * quotaService.js
 * Phase 12 Daily Free Quota with Abuse Protection & Points System
 *
 * Rules:
 * - Free Plan: 10 points / day
 * - Point consumption: Quick = 1 point, Deep = 3 points, Expert = 10 points
 * - Reset strictly at 00:00:00 UTC
 * - Account must have verified email to consume quota (unverified can browse but cannot consume points)
 * - Designed with `plan_id` to allow future paid upgrades (Phase 13) without schema rebuilding
 */

const { get, run, tx } = require('../../db/database');
const { newId } = require('../../utils/ids');
const { nowIso } = require('../../utils/clock');
const config = require('../../config');

const LEVEL_POINTS = {
  quick: 1,
  deep: 3,
  expert: 10,
};

const PLAN_QUOTAS = {
  free: 10,
  demo: 5,
  pro: 100,
  enterprise: 1000,
};

/**
 * Returns current period date 'YYYY-MM-DD' in UTC.
 */
function getTodayUtcDate() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Returns the exact ISO string of the next 00:00:00 UTC.
 */
function getNextUtcMidnightIso() {
  const d = new Date();
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0));
  return next.toISOString();
}

/**
 * Calculates human-readable remaining hours until next UTC midnight reset.
 */
function getRemainingTimeMessage(resetAtIso) {
  const target = new Date(resetAtIso).getTime();
  const diffMs = Math.max(0, target - Date.now());
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours > 0) {
    return `${hours} ساعة و ${minutes} دقيقة (عند 00:00:00 UTC)`;
  }
  return `${minutes} دقيقة (عند 00:00:00 UTC)`;
}

/**
 * Gets or creates the usage_counter row for the given user and today's UTC period.
 */
function getOrCreateUsageCounter(userId, planId = 'free') {
  const today = getTodayUtcDate();
  let row = get('SELECT * FROM usage_counters WHERE user_id = ? AND period_date = ?', userId, today);

  if (!row) {
    const allocated = PLAN_QUOTAS[planId] || config.dailyFreeQuotaPoints || 10;
    const resetAt = getNextUtcMidnightIso();
    const id = newId('usg');
    const now = nowIso();
    try {
      run(
        `INSERT INTO usage_counters (id, user_id, plan_id, period_date, points_allocated, points_used, reset_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
        id, userId, planId, today, allocated, resetAt, now
      );
      row = get('SELECT * FROM usage_counters WHERE id = ?', id);
    } catch (_) {
      // Catch race condition if parallel request inserted first
      row = get('SELECT * FROM usage_counters WHERE user_id = ? AND period_date = ?', userId, today);
    }
  }

  return row;
}

/**
 * Retrieves the current quota balance and costs for a user.
 */
function getQuotaBalance(userId, user) {
  const isDemo = Boolean(
    user && (user.is_demo || user.isDemo || user.planId === 'demo' || user.plan_id === 'demo')
  );
  const planId = (user && (user.plan_id || user.planId)) || (isDemo ? 'demo' : 'free');
  const isVerified = Boolean((user && (user.email_verified === 1 || user.emailVerified === true)) || isDemo);

  const counter = getOrCreateUsageCounter(userId, planId);
  const allocated = counter ? counter.points_allocated : (PLAN_QUOTAS[planId] || 10);
  const used = counter ? counter.points_used : 0;
  const remaining = Math.max(0, allocated - used);
  const resetAt = counter ? counter.reset_at : getNextUtcMidnightIso();

  return {
    allocated,
    used,
    remaining,
    resetAt,
    resetMessage: getRemainingTimeMessage(resetAt),
    emailVerified: isVerified,
    planId,
    levelCosts: LEVEL_POINTS,
  };
}

/**
 * Checks if user can consume the requested research tier and deducts the points atomically.
 * Rejects with 403 if email is unverified (for non-demo users).
 * Rejects with 429 if quota ceiling is exceeded.
 */
function checkAndConsumeQuota({ userId, user, level = 'deep' }) {
  const normalizedLevel = (level || 'deep').toLowerCase();
  const cost = LEVEL_POINTS[normalizedLevel] || LEVEL_POINTS.deep;
  let userRow = user;
  if (!userRow || (userRow.email_verified === undefined && !userRow.isDemo && !userRow.is_demo)) {
    userRow = get('SELECT * FROM users WHERE id = ?', userId);
  }
  const isDemo = Boolean(
    (user && (user.is_demo || user.isDemo || user.planId === 'demo' || user.plan_id === 'demo')) ||
    (userRow && (userRow.is_demo || userRow.isDemo || userRow.planId === 'demo' || userRow.plan_id === 'demo'))
  );
  const planId =
    (user && (user.plan_id || user.planId)) ||
    (userRow && (userRow.plan_id || userRow.planId)) ||
    (isDemo ? 'demo' : 'free');
  const isVerified = Boolean(
    (userRow && (userRow.email_verified === 1 || userRow.emailVerified === true)) ||
    (user && (user.email_verified === 1 || user.emailVerified === true)) ||
    isDemo
  );

  // Constraint 1: Unverified accounts can browse but cannot consume daily quota points
  if (!isVerified) {
    return {
      allowed: false,
      statusCode: 403,
      code: 'EMAIL_NOT_VERIFIED',
      message: 'يرجى تأكيد بريدك الإلكتروني لتفعيل الحصة اليومية (10 نقاط يومياً). تحقق من صندوق الوارد.',
    };
  }

  return tx(() => {
    const counter = getOrCreateUsageCounter(userId, planId);
    const available = counter.points_allocated - counter.points_used;

    if (available < cost) {
      const resetMsg = getRemainingTimeMessage(counter.reset_at);
      return {
        allowed: false,
        statusCode: 429,
        code: 'QUOTA_EXCEEDED',
        cost,
        available,
        resetAt: counter.reset_at,
        message: `لقد استهلكت رصيدك اليومي (${counter.points_used}/${counter.points_allocated} نقطة). يتطلب هذا البحث ${cost} نقاط. تتجدد حصتك خلال ${resetMsg}.`,
      };
    }

    // Atomically deduct points
    run(
      'UPDATE usage_counters SET points_used = points_used + ?, updated_at = ? WHERE id = ?',
      cost,
      nowIso(),
      counter.id
    );

    const updated = get('SELECT * FROM usage_counters WHERE id = ?', counter.id);
    return {
      allowed: true,
      cost,
      allocated: updated.points_allocated,
      used: updated.points_used,
      remaining: updated.points_allocated - updated.points_used,
      resetAt: updated.reset_at,
    };
  });
}

module.exports = {
  LEVEL_POINTS,
  PLAN_QUOTAS,
  getTodayUtcDate,
  getNextUtcMidnightIso,
  getRemainingTimeMessage,
  getOrCreateUsageCounter,
  getQuotaBalance,
  checkAndConsumeQuota,
};
