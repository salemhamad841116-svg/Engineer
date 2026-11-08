const express = require('express');
const authService = require('./authService');
const { requireAuth, asyncHandler, setSessionCookie, clearSessionCookie } = require('./middleware');
const config = require('../config');

const router = express.Router();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const { name, email, password, client, termsAccepted, termsVersion, deviceFingerprint } = req.body || {};
    const result = authService.register({
      name,
      email,
      password,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      client: client === 'mobile' ? 'mobile' : 'web',
      termsAccepted,
      termsVersion,
      deviceFingerprint,
    });
    setSessionCookie(req, res, result.token, result.expiresAt);
    res.status(201).json({
      success: true,
      user: result.user,
      session: { id: result.sessionId, expiresAt: result.expiresAt },
      policy: {
        heartbeatIntervalSeconds: config.heartbeatIntervalSec,
        offlineAfterSeconds: config.offlineAfterSec,
        awayAfterSeconds: config.awayAfterSec,
        displayTimeZone: config.displayTimeZone,
      },
      verificationToken: result.verificationToken,
      ...(client === 'mobile' ? { token: result.token } : {}),
    });
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password, client } = req.body || {};
    const result = authService.login({
      email,
      password,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      client: client === 'mobile' ? 'mobile' : 'web',
    });
    setSessionCookie(req, res, result.token, result.expiresAt);
    res.json({
      success: true,
      user: result.user,
      session: { id: result.sessionId, expiresAt: result.expiresAt },
      policy: {
        heartbeatIntervalSeconds: config.heartbeatIntervalSec,
        offlineAfterSeconds: config.offlineAfterSec,
        awayAfterSeconds: config.awayAfterSec,
        displayTimeZone: config.displayTimeZone,
      },
      // Bearer token is returned only to native clients that cannot use the httpOnly cookie
      ...(client === 'mobile' ? { token: result.token } : {}),
    });
  })
);

router.post(
  '/logout',
  requireAuth({ passive: true }),
  asyncHandler(async (req, res) => {
    authService.logout(req.session, req.user, clientIp(req));
    clearSessionCookie(req, res);
    res.json({ success: true });
  })
);

router.get(
  '/me',
  requireAuth({ passive: true }),
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      user: authService.publicUser(req.user),
      session: { id: req.session.id, expiresAt: req.session.expires_at },
      policy: {
        heartbeatIntervalSeconds: config.heartbeatIntervalSec,
        offlineAfterSeconds: config.offlineAfterSec,
        awayAfterSeconds: config.awayAfterSec,
        displayTimeZone: config.displayTimeZone,
      },
    });
  })
);

router.post(
  '/heartbeat',
  requireAuth({ passive: true }),
  asyncHandler(async (req, res) => {
    const idle = Boolean(req.body && req.body.idle);
    authService.touchSession(req.session, { activity: !idle });
    res.json({ success: true, serverTime: new Date().toISOString(), idle });
  })
);

router.post(
  '/change-password',
  requireAuth(),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    authService.changePassword(req.user, req.session, currentPassword, newPassword);
    res.json({ success: true });
  })
);

router.get(
  '/invitations/:token',
  asyncHandler(async (req, res) => {
    const { user, row } = authService.getInvitationByToken(req.params.token);
    res.json({
      success: true,
      invitation: { name: user.name, email: user.email, purpose: row.purpose, expiresAt: row.expires_at },
    });
  })
);

router.post(
  '/invitations/:token/accept',
  asyncHandler(async (req, res) => {
    const user = authService.acceptInvitation(req.params.token, (req.body || {}).password);
    res.json({ success: true, user });
  })
);

// --- Phase 12: Launch Pack Endpoints ---

// Email verification (GET from email link or POST via API)
router.get(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const token = req.query.token;
    const result = authService.verifyEmail(token);
    if (req.accepts('html') && !req.xhr) {
      return res.send(`
        <!DOCTYPE html>
        <html lang="ar" dir="rtl">
        <head>
          <meta charset="utf-8">
          <title>تم تأكيد البريد الإلكتروني</title>
          <style>
            body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
            .card { background: #1e293b; padding: 2.5rem; border-radius: 1rem; border: 1px solid #334155; text-align: center; max-width: 480px; }
            h1 { color: #22c55e; margin-bottom: 1rem; }
            p { color: #94a3b8; line-height: 1.6; }
            a { display: inline-block; margin-top: 1.5rem; background: #4f46e5; color: white; padding: 0.75rem 1.5rem; border-radius: 0.5rem; text-decoration: none; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="card">
            <h1>✅ تم تأكيد بريدك الإلكتروني بنجاح!</h1>
            <p>تم تفعيل حصتك اليومية الكاملة (10 نقاط يومياً). يمكنك الآن العودة واستخدام المنصة بكامل قدراتها.</p>
            <a href="/">الانتقال إلى المنصة</a>
          </div>
        </body>
        </html>
      `);
    }
    res.json(result);
  })
);

router.post(
  '/verify-email',
  asyncHandler(async (req, res) => {
    const token = (req.body && req.body.token) || req.query.token;
    const result = authService.verifyEmail(token);
    res.json(result);
  })
);

// Resend verification email
router.post(
  '/resend-verification',
  asyncHandler(async (req, res) => {
    const email = (req.body && req.body.email) || (req.user && req.user.email);
    const result = authService.resendVerification(email);
    res.json(result);
  })
);

// Request password reset link (15-minute expiring link sent to email)
router.post(
  '/forgot-password',
  asyncHandler(async (req, res) => {
    const { email } = req.body || {};
    const result = authService.requestPasswordReset(email);
    res.json(result);
  })
);

// Execute password reset with single-use token (revokes all other active sessions)
router.post(
  '/reset-password',
  asyncHandler(async (req, res) => {
    const { token, password } = req.body || {};
    const result = authService.resetPasswordWithToken(token, password);
    res.json(result);
  })
);

// Demo Mode: Instant guest session with dedicated demo quota & isolated tenant
router.post(
  '/demo-login',
  asyncHandler(async (req, res) => {
    const { client } = req.body || {};
    const result = authService.createDemoSession({
      ip: clientIp(req),
      userAgent: req.headers['user-agent'],
      client: client === 'mobile' ? 'mobile' : 'web',
    });
    setSessionCookie(req, res, result.token, result.expiresAt);
    res.status(200).json({
      success: true,
      user: result.user,
      session: { id: result.sessionId, expiresAt: result.expiresAt },
      isDemo: true,
      policy: {
        heartbeatIntervalSeconds: config.heartbeatIntervalSec,
        offlineAfterSeconds: config.offlineAfterSec,
        awayAfterSeconds: config.awayAfterSec,
        displayTimeZone: config.displayTimeZone,
      },
      ...(client === 'mobile' ? { token: result.token } : {}),
    });
  })
);

module.exports = router;
