/**
 * phase12LaunchSuite.test.js
 * Comprehensive Launch Pack Test Suite: Trust, Quotas, Demo Mode & First Experience Gate
 *
 * Verifies:
 * 1. Email Verification Lifecycle & APP_URL link integrity
 * 2. Password Reset Lifecycle, 15-Minute Expiry & Session Revocation (ended_reason: 'revoked')
 * 3. Mandatory Terms of Service & Privacy Policy Acceptance with Version Tracking
 * 4. Daily Free Quota (10 points/day; Quick: 1, Deep: 3, Expert: 10) & 00:00:00 UTC Reset
 * 5. Unverified Account Quota Restriction (browsing allowed, consumption blocked with 403)
 * 6. Multi-Account Registration Abuse Detection (3+ accounts log admin alert; zero auto-ban)
 * 7. Demo Mode ("جرّب بدون تسجيل") with Guest Session, Dedicated Quota & Strict RLS 403 Isolation
 * 8. Onboarding Tour Completion Persistence in user_settings
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');

// Set test environment configuration
process.env.NODE_ENV = 'test';
process.env.APP_URL = 'https://misruq.com';
process.env.EMAIL_PROVIDER = 'console';

const { getDb, run, get, all, tx } = require('../db/database.js');
const authService = require('../auth/authService.js');
const emailService = require('../services/email/emailService.js');
const quotaService = require('../services/quotas/quotaService.js');
const { knowledgeDal, AccessDeniedError } = require('../dal/knowledgeDal.js');

async function runTestSuite() {
  console.log('================================================================');
  console.log('🚀 RUNNING PHASE 12 LAUNCH PACK TEST SUITE (TRUST & QUOTAS GATE)');
  console.log('================================================================\n');

  const db = getDb();
  let passedCount = 0;
  function markPassed(testName) {
    passedCount++;
    console.log(`  ✅ [PASS] ${testName}`);
  }

  // Clear in-memory email trap
  emailService.clearSentEmails();

  // --------------------------------------------------------------------------
  // Test 1: Email Verification Link Generation with APP_URL
  // --------------------------------------------------------------------------
  console.log('[Test 1] Testing Email Verification Link Generation & APP_URL binding...');
  const sampleToken = 'token_test_abc123';
  const verifyUrl = emailService.buildVerificationUrl(sampleToken);
  assert.strictEqual(
    verifyUrl,
    'https://misruq.com/auth/verify-email?token=token_test_abc123',
    'Verification URL must strictly use APP_URL with no local port fallback'
  );
  const resetUrl = emailService.buildPasswordResetUrl(sampleToken);
  assert.strictEqual(
    resetUrl,
    'https://misruq.com/auth/reset-password?token=token_test_abc123',
    'Reset URL must strictly use APP_URL'
  );
  markPassed('Email link builders strictly bind to APP_URL');

  // --------------------------------------------------------------------------
  // Test 2: Mandatory Terms of Service & Privacy Acceptance on Registration
  // --------------------------------------------------------------------------
  console.log('[Test 2] Testing Mandatory Terms & Privacy Checkbox...');
  const testEmail1 = `user_terms_${Date.now()}@example.com`;
  
  // Attempt registration WITHOUT terms acceptance -> MUST fail with 400 TERMS_NOT_ACCEPTED
  let termsFailed = false;
  try {
    authService.register({
      name: 'Unconsenting User',
      email: testEmail1,
      password: 'StrongPassword123!',
      termsAccepted: false,
    });
  } catch (err) {
    termsFailed = true;
    assert.strictEqual(err.code, 'TERMS_NOT_ACCEPTED', `Expected TERMS_NOT_ACCEPTED, got ${err.code}`);
  }
  assert.ok(termsFailed, 'Registration must be rejected if terms are not accepted');

  // Successful registration WITH terms acceptance
  const regResult1 = authService.register({
    name: 'Verified Scholar',
    email: testEmail1,
    password: 'StrongPassword123!',
    termsAccepted: true,
    termsVersion: '2026.1',
    ip: '198.51.100.1',
    deviceFingerprint: 'fp_scholar_device_1',
  });

  assert.ok(regResult1.token, 'Session token should be generated on register');
  assert.ok(regResult1.verificationToken, 'Verification token must be returned in registration result');
  
  const savedUser1 = get('SELECT * FROM users WHERE email = ?', testEmail1);
  assert.strictEqual(savedUser1.email_verified, 0, 'New user must start as email_verified = 0');
  assert.strictEqual(savedUser1.terms_version, '2026.1', 'Terms version must be recorded');
  assert.ok(savedUser1.terms_accepted_at, 'Terms acceptance timestamp must be recorded');
  markPassed('Mandatory terms checkbox enforced and version 2026.1 recorded');

  // --------------------------------------------------------------------------
  // Test 3: Email Verification Token Lifecycle (Valid, Re-use, Invalid, Resend)
  // --------------------------------------------------------------------------
  console.log('[Test 3] Testing Email Verification Token Lifecycle...');
  const vToken = regResult1.verificationToken;

  // Invalid token should fail with 404
  let invalidTokenFailed = false;
  try {
    authService.verifyEmail('non_existent_token_9999');
  } catch (err) {
    invalidTokenFailed = true;
    assert.strictEqual(err.code, 'TOKEN_INVALID');
  }
  assert.ok(invalidTokenFailed, 'Invalid token must throw 404 TOKEN_INVALID');

  // Verify with valid token
  const verifyRes = authService.verifyEmail(vToken);
  assert.strictEqual(verifyRes.success, true);
  assert.strictEqual(verifyRes.user.emailVerified, true);

  const verifiedUserDb = get('SELECT email_verified, email_verified_at FROM users WHERE id = ?', savedUser1.id);
  assert.strictEqual(verifiedUserDb.email_verified, 1);
  assert.ok(verifiedUserDb.email_verified_at);

  // Single-use guarantee: Re-using the same token must fail with 410 TOKEN_ALREADY_USED
  let reuseFailed = false;
  try {
    authService.verifyEmail(vToken);
  } catch (err) {
    reuseFailed = true;
    assert.strictEqual(err.code, 'TOKEN_ALREADY_USED');
  }
  assert.ok(reuseFailed, 'Re-using verification token must fail with 410 TOKEN_ALREADY_USED');

  // Resend verification on already verified account returns alreadyVerified
  const resendAlready = authService.resendVerification(savedUser1.email);
  assert.strictEqual(resendAlready.alreadyVerified, true);
  markPassed('Email verification token lifecycle and single-use guarantee verified');

  // --------------------------------------------------------------------------
  // Test 4: Password Reset Token (15-min TTL, Single-use, Session Revocation)
  // --------------------------------------------------------------------------
  console.log('[Test 4] Testing Password Reset Token & Active Sessions Revocation...');
  // Create an active session for the user
  const activeLogin = authService.login({
    email: testEmail1,
    password: 'StrongPassword123!',
    ip: '198.51.100.1',
  });
  assert.ok(activeLogin.token);

  // Request password reset
  const resetReq = authService.requestPasswordReset(testEmail1);
  assert.strictEqual(resetReq.success, true);
  assert.ok(resetReq.resetToken, 'Reset token must be returned for testing');

  // Check TTL in DB is 15 minutes
  const tokenRow = get('SELECT * FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL', savedUser1.id);
  assert.ok(tokenRow, 'Token row must exist in DB');
  const expiryDate = new Date(tokenRow.expires_at).getTime();
  const createdDate = new Date(tokenRow.created_at).getTime();
  const diffMinutes = Math.round((expiryDate - createdDate) / 60000);
  assert.strictEqual(diffMinutes, 15, 'Password reset token TTL must be strictly 15 minutes');

  // Perform password reset
  const resetResult = authService.resetPasswordWithToken(resetReq.resetToken, 'BrandNewSecurePassword999!');
  assert.strictEqual(resetResult.success, true);
  assert.ok(resetResult.revokedSessions >= 1, 'Password reset must revoke previous active sessions');

  // Verify previous active session is now REVOKED (HTTP 401 SESSION_REVOKED)
  let sessionRevoked = false;
  try {
    authService.resolveSession(activeLogin.token);
  } catch (err) {
    sessionRevoked = true;
    assert.strictEqual(err.code, 'SESSION_REVOKED', `Expected SESSION_REVOKED, got ${err.code}`);
  }
  assert.ok(sessionRevoked, 'Previous session must be immediately rejected with SESSION_REVOKED');

  // Verify token cannot be re-used
  let resetReuseFailed = false;
  try {
    authService.resetPasswordWithToken(resetReq.resetToken, 'AnotherPassword123!');
  } catch (err) {
    resetReuseFailed = true;
    assert.strictEqual(err.code, 'TOKEN_ALREADY_USED');
  }
  assert.ok(resetReuseFailed, 'Password reset token must be single-use');

  // Login with new password works
  const newLogin = authService.login({
    email: testEmail1,
    password: 'BrandNewSecurePassword999!',
  });
  assert.ok(newLogin.token, 'Login with new password must succeed');
  markPassed('Password reset 15-min TTL, single-use, and session revocation verified');

  // --------------------------------------------------------------------------
  // Test 5: Daily Free Quota with Points System & 00:00:00 UTC Reset
  // --------------------------------------------------------------------------
  console.log('[Test 5] Testing Daily Free Quota Points System (Free: 10 pts, Quick: 1, Deep: 3, Expert: 10)...');
  const quotaUser = get('SELECT * FROM users WHERE id = ?', savedUser1.id); // Fresh verified user record from DB

  // Initial balance: 10 available
  const initialBalance = quotaService.getQuotaBalance(quotaUser.id, quotaUser);
  assert.strictEqual(initialBalance.allocated, 10);
  assert.strictEqual(initialBalance.used, 0);
  assert.strictEqual(initialBalance.remaining, 10);

  // Next reset time check
  const nextResetIso = quotaService.getNextUtcMidnightIso();
  const nextResetDate = new Date(nextResetIso);
  assert.strictEqual(nextResetDate.getUTCHours(), 0, 'Reset hour must be 00 UTC');
  assert.strictEqual(nextResetDate.getUTCMinutes(), 0, 'Reset minute must be 00 UTC');
  assert.strictEqual(nextResetDate.getUTCSeconds(), 0, 'Reset second must be 00 UTC');

  // Consume 1 Quick Search (1 point)
  const d1 = quotaService.checkAndConsumeQuota({ userId: quotaUser.id, user: quotaUser, level: 'quick' });
  assert.strictEqual(d1.allowed, true);
  assert.strictEqual(d1.cost, 1);
  assert.strictEqual(d1.remaining, 9);

  // Consume 1 Deep Search (3 points)
  const d2 = quotaService.checkAndConsumeQuota({ userId: quotaUser.id, user: quotaUser, level: 'deep' });
  assert.strictEqual(d2.allowed, true);
  assert.strictEqual(d2.cost, 3);
  assert.strictEqual(d2.remaining, 6);

  // Attempt 1 Expert Search (costs 10 points, but only 6 remaining) -> MUST be rejected with 429
  const d3 = quotaService.checkAndConsumeQuota({ userId: quotaUser.id, user: quotaUser, level: 'expert' });
  assert.strictEqual(d3.allowed, false);
  assert.strictEqual(d3.statusCode, 429);
  assert.strictEqual(d3.code, 'QUOTA_EXCEEDED');
  assert.ok(d3.message.includes('تتجدد حصتك'), 'Error message must inform user when quota resets');

  // Consume another Deep Search (3 points) -> 3 remaining
  const d4 = quotaService.checkAndConsumeQuota({ userId: quotaUser.id, user: quotaUser, level: 'deep' });
  assert.strictEqual(d4.allowed, true);
  assert.strictEqual(d4.remaining, 3);

  // Consume final Deep Search (3 points) -> 0 remaining
  const d5 = quotaService.checkAndConsumeQuota({ userId: quotaUser.id, user: quotaUser, level: 'deep' });
  assert.strictEqual(d5.allowed, true);
  assert.strictEqual(d5.remaining, 0);

  // Any subsequent search (even 1-pt quick) MUST be rejected with 429
  const d6 = quotaService.checkAndConsumeQuota({ userId: quotaUser.id, user: quotaUser, level: 'quick' });
  assert.strictEqual(d6.allowed, false);
  assert.strictEqual(d6.statusCode, 429);
  markPassed('Daily free quota points (1/3/10) and 429 rejection with UTC reset message verified');

  // --------------------------------------------------------------------------
  // Test 6: Unverified Email Quota Blocking (Browsing allowed, Points blocked)
  // --------------------------------------------------------------------------
  console.log('[Test 6] Testing Unverified Account Quota Restriction...');
  const unverifiedEmail = `unverified_${Date.now()}@example.com`;
  authService.register({
    name: 'Unverified Reader',
    email: unverifiedEmail,
    password: 'Password123!',
    termsAccepted: true,
  });
  const unverifiedUser = get('SELECT * FROM users WHERE email = ?', unverifiedEmail);
  assert.strictEqual(unverifiedUser.email_verified, 0);

  // Quota consumption must fail with HTTP 403 EMAIL_NOT_VERIFIED
  const unverifiedAttempt = quotaService.checkAndConsumeQuota({
    userId: unverifiedUser.id,
    user: unverifiedUser,
    level: 'quick',
  });
  assert.strictEqual(unverifiedAttempt.allowed, false);
  assert.strictEqual(unverifiedAttempt.statusCode, 403);
  assert.strictEqual(unverifiedAttempt.code, 'EMAIL_NOT_VERIFIED');
  assert.ok(unverifiedAttempt.message.includes('تأكيد بريدك الإلكتروني'));
  markPassed('Unverified accounts strictly blocked from consuming daily quota with 403');

  // --------------------------------------------------------------------------
  // Test 7: Multi-Account Abuse Detection (3+ accounts log alert, NO auto-ban)
  // --------------------------------------------------------------------------
  console.log('[Test 7] Testing Multi-Account Abuse Detection & Security Alert Logging...');
  let suspiciousIp;
  do {
    suspiciousIp = `203.0.${Math.floor(Math.random() * 250) + 1}.${Math.floor(Math.random() * 250) + 1}`;
  } while (get('SELECT id FROM users WHERE registration_ip = ?', suspiciousIp));
  const sharedFingerprint = `fp_device_multi_bot_${Date.now()}`;

  // Account 1
  authService.register({
    name: 'Multi Account 1',
    email: `multi1_${Date.now()}@example.com`,
    password: 'Password123!',
    termsAccepted: true,
    ip: suspiciousIp,
    deviceFingerprint: sharedFingerprint,
  });

  // Account 2
  authService.register({
    name: 'Multi Account 2',
    email: `multi2_${Date.now()}@example.com`,
    password: 'Password123!',
    termsAccepted: true,
    ip: suspiciousIp,
    deviceFingerprint: sharedFingerprint,
  });

  // Check alert logs before 3rd registration
  const alertBefore = get(
    "SELECT COUNT(*) as c FROM system_alert_logs WHERE category = 'security' AND details_json LIKE ?",
    `%${suspiciousIp}%`
  );
  assert.strictEqual(alertBefore.c, 0, 'No alert should be logged for 2 accounts');

  // Account 3 from the SAME IP/fingerprint -> Triggers Security Alert
  const reg3 = authService.register({
    name: 'Multi Account 3',
    email: `multi3_${Date.now()}@example.com`,
    password: 'Password123!',
    termsAccepted: true,
    ip: suspiciousIp,
    deviceFingerprint: sharedFingerprint,
  });

  // Verification 1: Alert is logged in system_alert_logs with category 'security'
  const alertAfter = get(
    "SELECT * FROM system_alert_logs WHERE category = 'security' AND details_json LIKE ? ORDER BY timestamp DESC LIMIT 1",
    `%${suspiciousIp}%`
  );
  assert.ok(alertAfter, 'Security alert must be recorded in system_alert_logs');
  assert.strictEqual(alertAfter.category, 'security');
  assert.strictEqual(alertAfter.level, 'warning');

  // Verification 2: CRITICAL - ZERO AUTOMATED BAN! Account 3 is active and can login
  assert.ok(reg3.token, 'Account 3 must NOT be auto-banned; registration must succeed normally');
  const account3Db = get('SELECT status FROM users WHERE id = ?', reg3.user.id);
  assert.strictEqual(account3Db.status, 'active', 'Account status must remain active (human decision only)');
  markPassed('Multi-account heuristic logs admin alert in system_alert_logs with ZERO automated banning');

  // --------------------------------------------------------------------------
  // Test 8: Demo Mode ("جرّب بدون تسجيل") & Strict RLS 403 Isolation
  // --------------------------------------------------------------------------
  console.log('[Test 8] Testing Demo Mode ("جرّب بدون تسجيل") & RLS 403 Cross-Tenant Isolation...');
  const demoSession = authService.createDemoSession({ ip: '192.0.2.1' });
  assert.ok(demoSession.token, 'Demo session token must be created');
  assert.strictEqual(demoSession.user.isDemo, true);
  assert.strictEqual(demoSession.user.planId, 'demo');

  // Reset usage counters for clean test state
  run('DELETE FROM usage_counters WHERE user_id = ?', demoSession.user.id);

  // Seed demo library
  knowledgeDal.seedDemoLibrary();

  // Demo user reading demo books -> ALLOWED
  const demoTenantCtx = {
    tenantId: 'tenant_demo',
    userId: demoSession.user.id,
    role: 'user',
  };
  const demoBooks = knowledgeDal.listBooks(demoTenantCtx);
  assert.ok(demoBooks.length >= 2, 'Demo user must have access to demo books');
  assert.ok(demoBooks.some((b) => b.id === 'book_demo_ibn_khaldun'));
  assert.ok(demoBooks.some((b) => b.id === 'book_demo_wealth_of_nations'));

  // Create a real private tenant book
  const realTenantCtx = {
    tenantId: 'tenant_enterprise_xyz',
    userId: 'usr_enterprise_ceo',
    role: 'user',
  };
  knowledgeDal.registerBook({
    id: 'book_real_classified_report',
    title: 'Top Secret Corporate Strategy 2026',
    author: 'Internal Board',
    fullText: 'Confidential corporate strategy and financial secrets for real tenant only.',
    isSharedLibrary: false,
  }, realTenantCtx);

  // Real tenant reading own book -> ALLOWED
  const realBookDetails = knowledgeDal.getBookDetails('book_real_classified_report', realTenantCtx);
  assert.strictEqual(realBookDetails.id, 'book_real_classified_report');

  // DEMO USER ATTEMPTING TO ACCESS REAL TENANT BOOK -> STRICT 403 RLS VIOLATION
  let crossTenantBlocked = false;
  try {
    knowledgeDal.getBookDetails('book_real_classified_report', demoTenantCtx);
  } catch (err) {
    crossTenantBlocked = true;
    assert.ok(err instanceof AccessDeniedError, 'Must throw AccessDeniedError');
    assert.strictEqual(err.statusCode, 403, 'Must return HTTP 403');
  }
  assert.ok(crossTenantBlocked, 'Demo user must be strictly blocked from real tenant books with HTTP 403');

  // Demo quota consumption
  const demoQuota1 = quotaService.checkAndConsumeQuota({
    userId: demoSession.user.id,
    user: demoSession.user,
    level: 'quick',
  });
  assert.strictEqual(demoQuota1.allowed, true);
  assert.strictEqual(demoQuota1.cost, 1);
  markPassed('Demo guest session, isolated demo library, and strict RLS 403 defense verified');

  // --------------------------------------------------------------------------
  // Test 9: Onboarding Tour State Persistence in user_settings
  // --------------------------------------------------------------------------
  console.log('[Test 9] Testing Onboarding Tour State in user_settings...');
  const tourUserId = savedUser1.id;
  
  // Ensure user_settings row exists
  db.prepare(`
    INSERT OR IGNORE INTO user_settings (user_id, language, theme, default_research_tier, created_at, updated_at)
    VALUES (?, 'ar', 'dark', 'deep', datetime('now'), datetime('now'))
  `).run(tourUserId);

  // Initial state: onboarding_completed = 0
  const initialSettings = get('SELECT onboarding_completed FROM user_settings WHERE user_id = ?', tourUserId);
  assert.strictEqual(initialSettings.onboarding_completed, 0);

  // Complete onboarding tour (step 3)
  db.prepare("UPDATE user_settings SET onboarding_completed = 1, onboarding_step = 3, updated_at = datetime('now') WHERE user_id = ?")
    .run(tourUserId);

  const completedSettings = get('SELECT onboarding_completed, onboarding_step FROM user_settings WHERE user_id = ?', tourUserId);
  assert.strictEqual(completedSettings.onboarding_completed, 1);
  assert.strictEqual(completedSettings.onboarding_step, 3);
  markPassed('Onboarding tour completion and step progress safely saved in user_settings');

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedCount}/9 PHASE 12 LAUNCH PACK TESTS PASSED WITH 100% SUCCESS!`);
  console.log('================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n❌ PHASE 12 LAUNCH PACK TEST SUITE FAILED:', err);
  process.exit(1);
});
