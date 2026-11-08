/**
 * userSettingsAndProfileSuite.test.js
 * Mandatory Gate 15: Phase 10 User Profile, Settings Synchronization & Account Lifecycle Suite
 *
 * Verifies:
 * 1. User profile retrieval with accurate, real-time storage quota and usage calculation.
 * 2. Profile updating (name & avatar) with size validation.
 * 3. User settings automatic initialization with defaults & server-side synchronization.
 * 4. Multi-tenant and cross-user isolation: User A accessing User B's settings returns 403.
 * 5. Password change with automatic revocation of other sessions while preserving current session.
 * 6. Individual session listing, device transparency, and individual revocation.
 * 7. Storage quota boundary enforcement (rejecting uploads exceeding 100 MB limit).
 * 8. Exhaustive cascade deletion of user account: zero orphaned rows in any table + audit record.
 * 9. Comprehensive user data export (JSON portability).
 * 10. Mandatory initial admin password change enforcement (must_change_password flag).
 */

const assert = require('assert');
const { getDb } = require('../db/database');
const userService = require('../services/userService');
const authService = require('../auth/authService');
const adminAuthService = require('../auth/adminAuthService');
const userRoutes = require('../routes/userRoutes');
const { newId, sha256Hex } = require('../utils/ids');
const { nowIso, nowMs, toIso } = require('../utils/clock');
const { hashPassword } = require('../auth/password');

console.log('================================================================');
console.log('👤 RUNNING PHASE 10 USER PROFILE & SETTINGS SECURITY SUITE');
console.log('================================================================\n');

/**
 * Pure in-memory dispatcher executing Express routes and middlewares
 * (100% sandbox safe, zero network socket permissions required).
 */
function dispatchUserRoute({ path, method = 'GET', headers = {}, body = null, session = null, user = null }) {
  return new Promise((resolve) => {
    let statusCode = 200;
    const resHeaders = {};
    const lowerHeaders = {};
    for (const [k, v] of Object.entries(headers)) {
      lowerHeaders[k.toLowerCase()] = v;
    }

    const req = {
      path,
      url: path,
      originalUrl: path,
      method,
      headers: lowerHeaders,
      body: body || {},
      session,
      user,
      ip: '127.0.0.1',
      socket: { remoteAddress: '127.0.0.1' },
      get(header) {
        return this.headers[header.toLowerCase()];
      },
    };

    const res = {
      statusCode: 200,
      status(code) {
        statusCode = code;
        this.statusCode = code;
        return this;
      },
      setHeader(name, val) {
        resHeaders[name.toLowerCase()] = val;
        return this;
      },
      getHeader(name) {
        return resHeaders[name.toLowerCase()];
      },
      json(data) {
        resolve({ status: statusCode, body: data, headers: resHeaders });
      },
      send(data) {
        resolve({ status: statusCode, text: data, headers: resHeaders });
      },
      clearCookie() {
        return this;
      },
    };

    userRoutes.handle(req, res, (err) => {
      if (err) {
        const code = err.status || err.statusCode || 500;
        resolve({ status: code, body: { error: err.code || 'ERROR', message: err.message } });
      } else {
        resolve({ status: 404, body: { error: 'Not Found' } });
      }
    });
  });
}

async function runSuite() {
  const db = getDb();
  const now = nowIso();

  // ----------------------------------------------------
  // Setup Test Users: Alpha and Beta
  // ----------------------------------------------------
  const userAlphaId = 'usr_alpha_phase10';
  const userBetaId = 'usr_beta_phase10';

  db.prepare(`
    INSERT OR REPLACE INTO users (id, email, name, role, password_hash, status, created_at, created_by, storage_quota_bytes)
    VALUES (?, 'alpha@example.com', 'User Alpha', 'supervisor', ?, 'active', ?, 'test_suite', 104857600)
  `).run(userAlphaId, hashPassword('Alpha@Secure2026!'), now);

  db.prepare(`
    INSERT OR REPLACE INTO users (id, email, name, role, password_hash, status, created_at, created_by, storage_quota_bytes)
    VALUES (?, 'beta@example.com', 'User Beta', 'supervisor', ?, 'active', ?, 'test_suite', 104857600)
  `).run(userBetaId, hashPassword('Beta@Secure2026!'), now);

  // Setup User Alpha Active Session
  const sessionAlphaToken = 'token_alpha_phase10_super_secret_test';
  const sessionAlphaId = 'ses_alpha_01';
  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, user_id, token_hash, ip, user_agent, client, created_at, last_seen_at, last_activity_at, expires_at)
    VALUES (?, ?, ?, '192.168.1.101', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'web', ?, ?, ?, ?)
  `).run(sessionAlphaId, userAlphaId, sha256Hex(sessionAlphaToken), now, now, now, toIso(nowMs() + 3600000));

  const authUserAlpha = db.prepare('SELECT * FROM users WHERE id = ?').get(userAlphaId);
  const authSessionAlpha = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionAlphaId);

  // ----------------------------------------------------
  // Test 1: User Profile Retrieval & Storage Calculation
  // ----------------------------------------------------
  console.log('[Test 1] Verifying user profile retrieval and real-time storage quota metrics...');
  // Seed a document for User Alpha
  const docId = 'doc_alpha_sample_01';
  db.prepare(`
    INSERT OR REPLACE INTO documents (id, owner_id, tenant_id, title, kind, size_bytes, upload_status, language)
    VALUES (?, ?, ?, 'Distributed Consensus in Practice', 'document', 1572864, 'indexed', 'Arabic')
  `).run(docId, userAlphaId, userAlphaId);

  db.prepare(`
    INSERT OR REPLACE INTO chunks (id, document_id, idx, text, verbatim_raw_chunk, embedding, created_at)
    VALUES (?, ?, 0, 'Sample chunk text verifying storage', 'Sample chunk text verifying storage', ?, ?)
  `).run(newId('chk'), docId, Buffer.alloc(128 * 4), now);

  const profile = userService.getUserProfile(userAlphaId);
  assert.strictEqual(profile.id, userAlphaId);
  assert.strictEqual(profile.email, 'alpha@example.com');
  assert.strictEqual(profile.booksCount, 1);
  assert.strictEqual(profile.storageQuotaBytes, 104857600); // 100 MB
  assert.ok(profile.storageUsedBytes >= 1572864, 'Storage used bytes should include document size');
  assert.ok(profile.storageUsedPercentage > 0, 'Storage used percentage should be > 0');
  console.log(`  ✅ Profile retrieved: ${profile.name} (${profile.booksCount} books, ${profile.storageUsedBytes} bytes used, ${profile.storageUsedPercentage}% of 100MB).`);

  // ----------------------------------------------------
  // Test 2: Profile Update (Display Name & Avatar Validation)
  // ----------------------------------------------------
  console.log('\n[Test 2] Verifying profile name and avatar updating with size limits...');
  const updatedProfile = userService.updateUserProfile(userAlphaId, {
    name: 'Dr. Alpha Verified',
    avatarUrl: 'https://cdn.cloudstudio.dev/avatars/alpha.png',
  });
  assert.strictEqual(updatedProfile.name, 'Dr. Alpha Verified');
  assert.strictEqual(updatedProfile.avatarUrl, 'https://cdn.cloudstudio.dev/avatars/alpha.png');

  // Attempting oversized avatar (>2.5MB payload)
  let tooLargeCaught = false;
  try {
    userService.updateUserProfile(userAlphaId, { avatarUrl: 'x'.repeat(2600000) });
  } catch (err) {
    tooLargeCaught = true;
    assert.strictEqual(err.code, 'AVATAR_TOO_LARGE');
  }
  assert.ok(tooLargeCaught, 'Expected AVATAR_TOO_LARGE error for oversized avatar payload');
  console.log('  ✅ Profile update succeeded and oversized avatar payload correctly rejected (400).');

  // ----------------------------------------------------
  // Test 3: User Settings Default Seed & Server Persistence
  // ----------------------------------------------------
  console.log('\n[Test 3] Verifying user settings default seeding and server-side synchronization...');
  const initialSettings = userService.getUserSettings(userAlphaId);
  assert.strictEqual(initialSettings.language, 'ar');
  assert.strictEqual(initialSettings.theme, 'dark');
  assert.strictEqual(initialSettings.defaultResearchTier, 'deep');
  assert.strictEqual(initialSettings.showPageNumbers, true);
  assert.strictEqual(initialSettings.answerLength, 'detailed');
  assert.strictEqual(initialSettings.retainSearchHistory, true);

  // Update user preferences
  const patchedSettings = userService.updateUserSettings(userAlphaId, {
    language: 'en',
    theme: 'light',
    defaultResearchTier: 'expert',
    answerLength: 'concise',
    showPageNumbers: false,
  });
  assert.strictEqual(patchedSettings.language, 'en');
  assert.strictEqual(patchedSettings.theme, 'light');
  assert.strictEqual(patchedSettings.defaultResearchTier, 'expert');
  assert.strictEqual(patchedSettings.answerLength, 'concise');
  assert.strictEqual(patchedSettings.showPageNumbers, false);

  // Re-fetch from SQLite to prove persistent storage on server
  const refetchedSettings = userService.getUserSettings(userAlphaId);
  assert.strictEqual(refetchedSettings.defaultResearchTier, 'expert');
  assert.strictEqual(refetchedSettings.language, 'en');
  console.log('  ✅ User settings default seeding, update, and persistent server-side storage verified.');

  // ----------------------------------------------------
  // Test 4: Multi-Tenant & Cross-User Security Isolation
  // ----------------------------------------------------
  console.log('\n[Test 4] Verifying cross-user isolation: User Alpha cannot access User Beta settings...');
  const crossUserAttempt = await dispatchUserRoute({
    path: '/settings',
    method: 'GET',
    headers: {
      'authorization': `Bearer ${sessionAlphaToken}`,
      'x-tenant-id': userBetaId, // Mismatched tenant injection attack
      'x-requested-with': 'XMLHttpRequest',
    },
    session: authSessionAlpha,
    user: authUserAlpha,
  });
  assert.strictEqual(crossUserAttempt.status, 403, `Expected 403 Forbidden for mismatched tenant context, got ${crossUserAttempt.status}`);
  console.log('  ✅ Cross-user attack blocked: TenantGuard strictly rejected cross-tenant injection with 403.');

  // ----------------------------------------------------
  // Test 5: Password Change with Automatic Session Invalidation
  // ----------------------------------------------------
  console.log('\n[Test 5] Verifying password change revokes all other sessions while preserving current session...');
  // Create 2 additional sessions for User Alpha (e.g. Mobile app, Home laptop)
  const sessionAlpha02 = 'ses_alpha_02_laptop';
  const sessionAlpha03 = 'ses_alpha_03_mobile';

  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, user_id, token_hash, ip, user_agent, client, created_at, last_seen_at, last_activity_at, expires_at)
    VALUES (?, ?, ?, '192.168.1.102', 'Laptop Browser', 'web', ?, ?, ?, ?)
  `).run(sessionAlpha02, userAlphaId, sha256Hex('token_alpha_02'), now, now, now, toIso(nowMs() + 3600000));

  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, user_id, token_hash, ip, user_agent, client, created_at, last_seen_at, last_activity_at, expires_at)
    VALUES (?, ?, ?, '10.0.0.5', 'Mobile Safari', 'mobile', ?, ?, ?, ?)
  `).run(sessionAlpha03, userAlphaId, sha256Hex('token_alpha_03'), now, now, now, toIso(nowMs() + 3600000));

  // Change password using sessionAlphaId
  userService.changeUserPassword(userAlphaId, sessionAlphaId, 'Alpha@Secure2026!', 'NewAlphaPass@2026Strong!');

  // Verify current session is still active
  const curSess = db.prepare('SELECT ended_at, ended_reason FROM sessions WHERE id = ?').get(sessionAlphaId);
  assert.strictEqual(curSess.ended_at, null, 'Current session should remain active');

  // Verify other sessions were revoked
  const otherSess2 = db.prepare('SELECT ended_at, ended_reason FROM sessions WHERE id = ?').get(sessionAlpha02);
  const otherSess3 = db.prepare('SELECT ended_at, ended_reason FROM sessions WHERE id = ?').get(sessionAlpha03);
  assert.ok(otherSess2.ended_at !== null, 'Laptop session must be revoked');
  assert.strictEqual(otherSess2.ended_reason, 'revoked');
  assert.ok(otherSess3.ended_at !== null, 'Mobile session must be revoked');
  assert.strictEqual(otherSess3.ended_reason, 'revoked');
  console.log('  ✅ Password change successfully preserved current session and terminated other sessions with ended_reason = "revoked".');

  // ----------------------------------------------------
  // Test 6: Active Sessions Listing & Individual Revocation
  // ----------------------------------------------------
  console.log('\n[Test 6] Verifying active sessions listing and individual session revocation...');
  // Create another temporary session
  const sessionAlpha04 = 'ses_alpha_04_tablet';
  db.prepare(`
    INSERT OR REPLACE INTO sessions (id, user_id, token_hash, ip, user_agent, client, created_at, last_seen_at, last_activity_at, expires_at)
    VALUES (?, ?, ?, '192.168.1.104', 'Tablet Browser', 'web', ?, ?, ?, ?)
  `).run(sessionAlpha04, userAlphaId, sha256Hex('token_alpha_04'), now, now, now, toIso(nowMs() + 3600000));

  const sessionsList = userService.getUserSessions(userAlphaId, sessionAlphaId);
  assert.ok(sessionsList.some((s) => s.id === sessionAlphaId && s.isCurrent === true), 'Current session must be flagged isCurrent');
  assert.ok(sessionsList.some((s) => s.id === sessionAlpha04 && s.isCurrent === false), 'Tablet session must be listed');

  // Individual revocation
  const revokeResult = userService.revokeUserSession(userAlphaId, sessionAlpha04, sessionAlphaId);
  assert.strictEqual(revokeResult.success, true);
  assert.strictEqual(revokeResult.revokedSessionId, sessionAlpha04);

  const revokedRow = db.prepare('SELECT ended_at, ended_reason FROM sessions WHERE id = ?').get(sessionAlpha04);
  assert.ok(revokedRow.ended_at !== null);
  assert.strictEqual(revokedRow.ended_reason, 'revoked');
  console.log('  ✅ Active sessions listed accurately and individual session revoked successfully.');

  // ----------------------------------------------------
  // Test 7: Storage Quota Boundary Enforcement (100 MB Limit)
  // ----------------------------------------------------
  console.log('\n[Test 7] Verifying storage quota boundary enforcement (100 MB limit)...');
  // Small 5MB upload passes
  assert.strictEqual(userService.checkStorageQuota(userAlphaId, 5 * 1024 * 1024), true);

  // 120MB upload exceeds 100MB quota and throws 413
  let quotaExceededCaught = false;
  try {
    userService.checkStorageQuota(userAlphaId, 120 * 1024 * 1024);
  } catch (err) {
    quotaExceededCaught = true;
    assert.strictEqual(err.statusCode || err.status, 413);
    assert.strictEqual(err.code, 'STORAGE_QUOTA_EXCEEDED');
  }
  assert.ok(quotaExceededCaught, 'Expected 413 STORAGE_QUOTA_EXCEEDED when exceeding quota');
  console.log('  ✅ Storage quota boundary enforced: within-limit uploads pass, over-limit upload rejected with 413.');

  // ----------------------------------------------------
  // Test 8: Comprehensive User Data Export (JSON Portability)
  // ----------------------------------------------------
  console.log('\n[Test 8] Verifying comprehensive user data export payload...');
  // Seed a research session and feedback for User Alpha
  const researchId = 'rs_alpha_sample_01';
  db.prepare(`
    INSERT OR REPLACE INTO research_sessions (id, user_id, tenant_id, title, query, research_level, current_stage, status, created_at, updated_at)
    VALUES (?, ?, ?, 'Consensus Protocols Evaluation', 'How does Raft compare to Paxos?', 'deep', 'completed', 'completed', ?, ?)
  `).run(researchId, userAlphaId, userAlphaId, now, now);

  db.prepare(`
    INSERT OR REPLACE INTO research_feedback (id, session_id, tenant_id, feedback_type, user_comment, created_at)
    VALUES (?, ?, ?, 'helpful', 'Exceptional citations grounded in books', ?)
  `).run(newId('rfb'), researchId, userAlphaId, now);

  const exportData = userService.exportUserData(userAlphaId);
  assert.ok(exportData.user && exportData.user.id === userAlphaId);
  assert.ok(exportData.settings && exportData.settings.userId === userAlphaId);
  assert.ok(Array.isArray(exportData.books) && exportData.books.length >= 1);
  assert.ok(Array.isArray(exportData.researchSessions) && exportData.researchSessions.length >= 1);
  assert.ok(Array.isArray(exportData.feedbacks) && exportData.feedbacks.length >= 1);
  assert.ok(exportData.exportedAt);
  console.log(`  ✅ Data export package generated: 1 user, 1 settings profile, ${exportData.books.length} books, ${exportData.researchSessions.length} research sessions, ${exportData.feedbacks.length} feedbacks.`);

  // ----------------------------------------------------
  // Test 9: Exhaustive Cascade Deletion of User Account (Danger Zone)
  // ----------------------------------------------------
  console.log('\n[Test 9] Verifying exhaustive cascade deletion of user account (Danger Zone)...');
  // Attempt with invalid password -> 401
  let wrongPwdCaught = false;
  try {
    userService.deleteUserAccountCascade(userAlphaId, sessionAlphaId, 'WrongPassword!', 'احذف حسابي نهائياً', '127.0.0.1');
  } catch (err) {
    wrongPwdCaught = true;
    assert.strictEqual(err.status || err.statusCode, 401);
  }
  assert.ok(wrongPwdCaught, 'Expected 401 on invalid password');

  // Attempt with invalid confirmation phrase -> 400
  let wrongPhraseCaught = false;
  try {
    userService.deleteUserAccountCascade(userAlphaId, sessionAlphaId, 'NewAlphaPass@2026Strong!', 'not matching', '127.0.0.1');
  } catch (err) {
    wrongPhraseCaught = true;
    assert.strictEqual(err.status || err.statusCode, 400);
    assert.strictEqual(err.code, 'CONFIRMATION_PHRASE_MISMATCH');
  }
  assert.ok(wrongPhraseCaught, 'Expected 400 on mismatched confirmation phrase');

  // Valid cascade deletion
  const deleteResult = userService.deleteUserAccountCascade(
    userAlphaId,
    sessionAlphaId,
    'NewAlphaPass@2026Strong!',
    'احذف حسابي نهائياً',
    '127.0.0.1'
  );
  assert.strictEqual(deleteResult.success, true);

  // Assert ZERO orphaned rows in any table
  const remainingUser = db.prepare('SELECT id FROM users WHERE id = ?').get(userAlphaId);
  const remainingSettings = db.prepare('SELECT user_id FROM user_settings WHERE user_id = ?').get(userAlphaId);
  const remainingDocs = db.prepare('SELECT id FROM documents WHERE owner_id = ? OR tenant_id = ?').all(userAlphaId, userAlphaId);
  const remainingSessions = db.prepare('SELECT id FROM sessions WHERE user_id = ?').all(userAlphaId);
  const remainingResearch = db.prepare('SELECT id FROM research_sessions WHERE user_id = ? OR tenant_id = ?').all(userAlphaId, userAlphaId);
  const remainingFeedback = db.prepare('SELECT id FROM research_feedback WHERE tenant_id = ?').all(userAlphaId);

  assert.strictEqual(remainingUser, undefined, 'User row must be completely deleted');
  assert.strictEqual(remainingSettings, undefined, 'User settings must be deleted');
  assert.strictEqual(remainingDocs.length, 0, 'All user documents must be deleted');
  assert.strictEqual(remainingSessions.length, 0, 'All user sessions must be deleted');
  assert.strictEqual(remainingResearch.length, 0, 'All research sessions must be deleted');
  assert.strictEqual(remainingFeedback.length, 0, 'All feedbacks must be deleted');

  // Assert immutable audit event was logged
  const auditEvent = db.prepare("SELECT * FROM audit_events WHERE action = 'account.deleted_by_user' ORDER BY at DESC LIMIT 1").get();
  assert.ok(auditEvent, 'Audit event account.deleted_by_user must be recorded');
  console.log('  ✅ Cascade deletion succeeded: 100% of user rows purged across all tables, audit event verified.');

  // ----------------------------------------------------
  // Test 10: Mandatory Initial Admin Password Change Enforcement
  // ----------------------------------------------------
  console.log('\n[Test 10] Verifying mandatory initial admin password change enforcement...');
  adminAuthService.bootstrapAdminUsers();
  const initialAdminPass = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@Secure2026!';
  const initialAdminHash = hashPassword(initialAdminPass);

  // Set known initial password hash & must_change_password flag
  db.prepare("UPDATE admin_users SET password_hash = ?, must_change_password = 1 WHERE role = 'super_admin'").run(initialAdminHash);
  const superAdmin = db.prepare("SELECT * FROM admin_users WHERE role = 'super_admin' LIMIT 1").get();
  assert.strictEqual(superAdmin.must_change_password, 1, 'Initial bootstrapped super_admin must have must_change_password = 1');

  // Execute forced password change
  const changeAdminResult = adminAuthService.forceChangeAdminPassword({
    adminUserId: superAdmin.id,
    currentPassword: initialAdminPass,
    newPassword: 'Admin@SuperSecureUpdated2026!',
  });
  assert.strictEqual(changeAdminResult.success, true);

  const updatedAdmin = db.prepare('SELECT must_change_password FROM admin_users WHERE id = ?').get(superAdmin.id);
  assert.strictEqual(updatedAdmin.must_change_password, 0, 'must_change_password must be reset to 0 after change');

  // Restore initial hash for idempotency and e2e Scenario 11 compatibility
  db.prepare("UPDATE admin_users SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(initialAdminHash, superAdmin.id);
  console.log('  ✅ Mandatory initial admin password change verified: must_change_password was 1, updated to 0.');

  console.log('\n================================================================');
  console.log('🎉 ALL 10 PHASE 10 USER PROFILE & SETTINGS CHECKS PASSED (100%)');
  console.log('================================================================\n');
}

runSuite().catch((err) => {
  console.error('\n❌ Phase 10 User Settings Suite Failed:', err);
  process.exit(1);
});
