// server_backend/routes/userRoutes.js
// Phase 10: User Profile, App Settings, Session Security & Account Lifecycle Routes
const express = require('express');
const router = express.Router();
const { requireAuth } = require('../auth/middleware');
const { tenantGuard } = require('../auth/tenantGuard');
const config = require('../config');
const {
  getUserProfile,
  updateUserProfile,
  getUserSettings,
  updateUserSettings,
  getUserSessions,
  revokeUserSession,
  changeUserPassword,
  getUserActivity,
  exportUserData,
  deleteUserAccountCascade,
} = require('../services/userService');

// All user routes require authenticated user session
router.use(requireAuth());
router.use(tenantGuard);

// Cross-user ID isolation guard
router.use((req, res, next) => {
  const targetUserId = req.query?.userId || req.body?.userId;
  if (targetUserId && targetUserId !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'CROSS_USER_FORBIDDEN',
      message: 'Access denied: You cannot access or modify another user profile or settings.',
      statusCode: 403,
    });
  }
  next();
});

/**
 * GET /api/user/profile
 * Retrieves full user profile, quota, usage metrics, and counts
 */
router.get('/profile', (req, res, next) => {
  try {
    const profile = getUserProfile(req.user.id);
    res.json({ success: true, profile });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/user/profile
 * Updates user display name and avatar
 */
router.put('/profile', (req, res, next) => {
  try {
    const { name, avatarUrl } = req.body || {};
    const updated = updateUserProfile(req.user.id, { name, avatarUrl });
    res.json({ success: true, profile: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/user/settings
 * Retrieves server-persisted user preferences
 */
router.get('/settings', (req, res, next) => {
  try {
    const settings = getUserSettings(req.user.id);
    res.json({ success: true, settings });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/user/settings
 * Upserts user preferences and synchronizes across devices
 */
router.put('/settings', (req, res, next) => {
  try {
    const updated = updateUserSettings(req.user.id, req.body || {});
    res.json({ success: true, settings: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/user/sessions
 * Returns list of active user sessions with device, IP, and last activity
 */
router.get('/sessions', (req, res, next) => {
  try {
    const sessions = getUserSessions(req.user.id, req.session.id);
    res.json({ success: true, sessions });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/user/sessions/:id/revoke
 * Revokes an individual active session
 */
router.post('/sessions/:id/revoke', (req, res, next) => {
  try {
    const result = revokeUserSession(req.user.id, req.params.id, req.session.id);
    if (result.wasCurrent) {
      res.clearCookie(config.cookieName, { path: '/' });
    }
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/user/change-password
 * Changes account password and terminates all other active sessions
 */
router.post('/change-password', (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const result = changeUserPassword(req.user.id, req.session.id, currentPassword, newPassword);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/user/activity
 * Retrieves user's uploaded books, recent searches, and quality feedback
 */
router.get('/activity', (req, res, next) => {
  try {
    const activity = getUserActivity(req.user.id);
    res.json({ success: true, ...activity });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/user/export-data
 * Downloads comprehensive export of account data in JSON format
 */
router.get('/export-data', (req, res, next) => {
  try {
    const data = exportUserData(req.user.id);
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="data_export_${req.user.id}.json"`);
    res.json(data);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/user/delete-account
 * Executes exhaustive cascade deletion of account and all associated resources
 */
router.post('/delete-account', (req, res, next) => {
  try {
    const { password, confirmationPhrase } = req.body || {};
    const result = deleteUserAccountCascade(
      req.user.id,
      req.session.id,
      password,
      confirmationPhrase,
      req.ip
    );
    res.clearCookie(config.cookieName, { path: '/' });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// Phase 12: Launch Pack User Extensions

/**
 * GET /api/user/quota-balance
 * Returns real-time daily quota points balance, tier costs, and UTC reset timer
 */
router.get('/quota-balance', (req, res, next) => {
  try {
    const { getQuotaBalance } = require('../services/quotas/quotaService');
    const balance = getQuotaBalance(req.user.id, req.user);
    res.json({ success: true, balance });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/user/onboarding
 * Updates onboarding tour completion state in user_settings
 */
router.post('/onboarding', (req, res, next) => {
  try {
    const { completed, step } = req.body || {};
    const { getDb } = require('../db/database');
    const db = getDb();
    const isCompleted = completed === false || completed === 0 ? 0 : 1;
    const currentStep = Number.isInteger(step) ? step : 3;
    db.prepare('UPDATE user_settings SET onboarding_completed = ?, onboarding_step = ?, updated_at = ? WHERE user_id = ?')
      .run(isCompleted, currentStep, new Date().toISOString(), req.user.id);
    res.json({ success: true, onboardingCompleted: Boolean(isCompleted), onboardingStep: currentStep });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
