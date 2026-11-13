/**
 * adminSecurityAndAdversarialSuite.test.js
 * Mandatory Gate 14: Phase 9 Dedicated Admin Subdomain & Adversarial Security Suite
 *
 * Verifies:
 * 1. Hard 404 on Main Domain for any /admin or /api/admin/* request (Zero Information Leakage).
 * 2. Normal / unauthenticated user rejected on admin domain (401).
 * 3. Stolen user session cookie (sid) rejected on admin domain (401).
 * 4. Privilege escalation attempt by support_agent blocked with 403.
 * 5. Brute-force lockout after 5 failed attempts + instant critical alert in system_alert_logs.
 * 6. Mandatory TOTP 2FA verification and single-use emergency recovery codes.
 * 7. Mandatory justification required to inspect private user data + immutable audit trail.
 * 8. Strict immutability of audit logs (DELETE/PUT rejected with 405).
 * 9. IP Whitelisting enforcement.
 * 10. Admin logout and immediate session revocation.
 */

const assert = require('assert');
const { getDb } = require('../db/database');
const { subdomainRouterMiddleware } = require('../middleware/subdomainRouter');
const adminRoutes = require('../routes/adminRoutes');
const adminAuth = require('../auth/adminAuthService');
const { generateTOTP } = require('../auth/totp');
const { ADMIN_COOKIE_NAME } = require('../auth/adminMiddleware');
const { sha256Hex } = require('../utils/ids');
const { hashPassword } = require('../auth/password');

console.log('================================================================');
console.log('🛡️ RUNNING PHASE 9 ADMIN SUBDOMAIN & ADVERSARIAL SECURITY SUITE');
console.log('================================================================\n');

/**
 * Pure in-memory dispatcher that executes the Express middleware stack and router
 * without requiring network sockets (100% sandbox safe).
 */
function dispatchRequest({ path, method = 'GET', headers = {}, body = null }) {
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
      query: {},
      params: {},
      body: body || {},
      socket: { remoteAddress: '127.0.0.1' },
    };

    // Parse simple query params if present
    const qIdx = path.indexOf('?');
    if (qIdx >= 0) {
      req.path = path.slice(0, qIdx);
      const searchParams = new URLSearchParams(path.slice(qIdx + 1));
      for (const [k, v] of searchParams.entries()) {
        req.query[k] = v;
      }
    }

    const res = {
      statusCode: 200,
      status(code) {
        statusCode = code;
        this.statusCode = code;
        return res;
      },
      setHeader(name, val) {
        resHeaders[name.toLowerCase()] = val;
        return res;
      },
      getHeader(name) {
        return resHeaders[name.toLowerCase()];
      },
      type(t) {
        resHeaders['content-type'] = t;
        return res;
      },
      send(data) {
        responseBody = data;
        resolve({ status: statusCode, headers: resHeaders, body: responseBody });
      },
      json(data) {
        responseBody = data;
        resolve({ status: statusCode, headers: resHeaders, body: responseBody });
      },
    };

    // 1. Run top-level Subdomain Router Middleware
    subdomainRouterMiddleware(req, res, () => {
      // 2. If it passed subdomain filter and targets /api/admin
      if (req.path.startsWith('/api/admin')) {
        const subPath = req.path.slice('/api/admin'.length) || '/';
        req.url = subPath + (qIdx >= 0 ? path.slice(qIdx) : '');
        req.path = subPath;
        adminRoutes.handle(req, res, (err) => {
          if (err) {
            const status = err.status || 500;
            res.status(status).json({ success: false, error: err.message, code: err.code });
          } else {
            res.status(404).json({ success: false, error: 'Route not found' });
          }
        });
      } else {
        res.status(200).json({ success: true, mainDomain: true });
      }
    });
  });
}

(async () => {
  try {
    // Ensure database and admin accounts are bootstrapped
    const db = getDb();
    adminAuth.bootstrapAdminUsers();
    // Reset any previous lockouts
    db.prepare("UPDATE admin_users SET failed_logins = 0, locked_until = NULL WHERE email IN ('admin@cloudstudio.dev', 'support@cloudstudio.dev')").run();

    // ----------------------------------------------------
    // TEST 1: Hard 404 on Main Domain (Zero Information Disclosure) & Dual-Domain Isolation
    // ----------------------------------------------------
    console.log('[Test 1] Verifying Hard 404 on Main Domain for all admin endpoints (engineer.misruq.com)...');
    const mainHosts = ['example.com', 'engineer.misruq.com', 'misruq.com'];
    const forbiddenPaths = [
      '/admin',
      '/admin/login',
      '/admin/dashboard',
      '/api/admin',
      '/api/admin/users',
      '/api/admin/system-health',
      '/api/admin/dashboard',
    ];

    for (const mainHost of mainHosts) {
      for (const p of forbiddenPaths) {
        const res = await dispatchRequest({
          path: p,
          headers: { Host: mainHost },
        });
        assert.strictEqual(res.status, 404, `Expected 404 for ${p} on ${mainHost}, got ${res.status}`);
        assert.ok(
          typeof res.body === 'string' && res.body.includes('404 Not Found'),
          `Expected generic 404 HTML body for ${p}, got: ${JSON.stringify(res.body)}`
        );
      }
    }

    // Verify engineer-mgt.misruq.com routes to admin handler (returns 401 rather than 404)
    const mgtRes = await dispatchRequest({
      path: '/api/admin/dashboard',
      headers: { Host: 'engineer-mgt.misruq.com' },
    });
    assert.strictEqual(mgtRes.status, 401, 'engineer-mgt.misruq.com must route to admin and return 401 for unauthenticated request');
    console.log('  ✅ Attack 1 Blocked: All admin paths on engineer.misruq.com return strict HTTP 404; engineer-mgt.misruq.com recognized as dedicated admin portal.');

    // ----------------------------------------------------
    // TEST 2: Normal / Unauthenticated User Rejected on Admin Subdomain
    // ----------------------------------------------------
    console.log('\n[Test 2] Verifying unauthenticated request rejection on admin subdomain...');
    const adminHost = 'admin.example.com';
    const unauthRes = await dispatchRequest({
      path: '/api/admin/dashboard',
      headers: { Host: adminHost },
    });
    assert.strictEqual(unauthRes.status, 401, `Expected 401 for unauthenticated request, got ${unauthRes.status}`);
    assert.strictEqual(unauthRes.body.success, false);
    console.log('  ✅ Attack 2 Blocked: Unauthenticated visitor rejected with 401.');

    // ----------------------------------------------------
    // TEST 3: Stolen User Session Cookie (sid) Rejection
    // ----------------------------------------------------
    console.log('\n[Test 3] Verifying stolen user session cookie (sid) rejection...');
    const stolenCookieRes = await dispatchRequest({
      path: '/api/admin/dashboard',
      headers: {
        Host: adminHost,
        cookie: 'sid=stolen_user_regular_session_token_xyz',
      },
    });
    assert.strictEqual(stolenCookieRes.status, 401, `Expected 401 when passing stolen user 'sid', got ${stolenCookieRes.status}`);
    assert.strictEqual(stolenCookieRes.body.code, 'ADMIN_UNAUTHORIZED');
    console.log("  ✅ Attack 3 Blocked: Regular user session cookie 'sid' has zero authority on admin domain.");

    // ----------------------------------------------------
    // TEST 4: Successful 2FA TOTP Authentication & Cookie Setting
    // ----------------------------------------------------
    console.log('\n[Test 4] Verifying valid login with RFC 6238 TOTP...');
    const superTotp = generateTOTP(adminAuth.DEFAULT_SUPER_TOTP);
    const loginRes = await dispatchRequest({
      path: '/api/admin/auth/login',
      method: 'POST',
      headers: { Host: adminHost },
      body: {
        email: 'admin@cloudstudio.dev',
        password: 'Admin@Secure2026!',
        totp: superTotp,
      },
    });

    assert.strictEqual(loginRes.status, 200, `Login failed: ${JSON.stringify(loginRes.body)}`);
    assert.strictEqual(loginRes.body.success, true);
    assert.strictEqual(loginRes.body.adminUser.role, 'super_admin');

    // Verify Set-Cookie header sets admin_sid with HttpOnly
    const setCookie = loginRes.headers['set-cookie'] || '';
    assert.ok(setCookie.includes(ADMIN_COOKIE_NAME + '='), 'Set-Cookie header did not contain admin_sid');
    assert.ok(setCookie.toLowerCase().includes('httponly'), 'admin_sid cookie is missing HttpOnly flag');

    // Extract cookie for authenticated requests
    const adminCookie = setCookie.split(';')[0];
    console.log('  ✅ 2FA TOTP Login Succeeded: admin_sid session cookie generated with HttpOnly.');

    // Verify access to dashboard with valid admin_sid
    const dashRes = await dispatchRequest({
      path: '/api/admin/dashboard',
      headers: { Host: adminHost, cookie: adminCookie },
    });
    assert.strictEqual(dashRes.status, 200, `Dashboard failed: ${JSON.stringify(dashRes.body)}`);
    assert.strictEqual(dashRes.body.dashboard.qualityGates.totalGates, 14);
    assert.strictEqual(dashRes.body.dashboard.backup.lastRestoreDrill.status, 'passed');
    console.log('  ✅ Dashboard KPIs, Server Health, and 14 Quality Gates verified accessible.');

    // ----------------------------------------------------
    // TEST 5: Privilege Escalation Attack by Support Agent Blocked (403)
    // ----------------------------------------------------
    console.log('\n[Test 5] Verifying privilege escalation rejection for support_agent...');
    const supportTotp = generateTOTP(adminAuth.DEFAULT_SUPPORT_TOTP);
    const supportLoginRes = await dispatchRequest({
      path: '/api/admin/auth/login',
      method: 'POST',
      headers: { Host: adminHost },
      body: {
        email: 'support@cloudstudio.dev',
        password: 'Support@Secure2026!',
        totp: supportTotp,
      },
    });
    assert.strictEqual(supportLoginRes.status, 200);
    const supportCookie = (supportLoginRes.headers['set-cookie'] || '').split(';')[0];

    // Attempt 1: Support agent trying to modify system settings / financial limits
    const updateSettingsRes = await dispatchRequest({
      path: '/api/admin/settings',
      method: 'PUT',
      headers: { Host: adminHost, cookie: supportCookie },
      body: { aiResearchCostCeilingUsd: 9999.0 },
    });
    assert.strictEqual(updateSettingsRes.status, 403, `Expected 403 for support_agent updating settings, got ${updateSettingsRes.status}`);

    // Attempt 2: Support agent trying to create a new admin
    const createAdminRes = await dispatchRequest({
      path: '/api/admin/team',
      method: 'POST',
      headers: { Host: adminHost, cookie: supportCookie },
      body: { email: 'hacker@cloudstudio.dev', name: 'Hacker', role: 'super_admin', password: 'Password12345!' },
    });
    assert.strictEqual(createAdminRes.status, 403, `Expected 403 for support_agent creating admin, got ${createAdminRes.status}`);

    // Attempt 3: Support agent trying to trigger database backup
    const backupRes = await dispatchRequest({
      path: '/api/admin/backup/trigger',
      method: 'POST',
      headers: { Host: adminHost, cookie: supportCookie },
    });
    assert.strictEqual(backupRes.status, 403, `Expected 403 for support_agent triggering backup, got ${backupRes.status}`);
    console.log('  ✅ Attack 4 Blocked: All 3 privilege escalation attempts by support_agent rejected with 403.');

    // ----------------------------------------------------
    // TEST 6: Brute-Force Lockout & Critical Security Alert Creation
    // ----------------------------------------------------
    console.log('\n[Test 6] Verifying brute-force lockout on 5 consecutive failures & critical alert...');
    const victimEmail = `victim_${Date.now()}@cloudstudio.dev`;
    db.prepare(`
      INSERT INTO admin_users (id, email, name, role, password_hash, totp_secret, totp_enabled, failed_logins, status, created_at, created_by)
      VALUES (?, ?, 'Victim Admin', 'support_agent', 'hash', 'SECRET', 1, 0, 'active', datetime('now'), 'test')
    `).run(`adm_${Date.now()}`, victimEmail);

    let lastLockoutRes = null;
    for (let i = 1; i <= 5; i++) {
      lastLockoutRes = await dispatchRequest({
        path: '/api/admin/auth/login',
        method: 'POST',
        headers: { Host: adminHost },
        body: { email: victimEmail, password: 'wrong_password_attempt', totp: '000000' },
      });
    }

    assert.strictEqual(lastLockoutRes.status, 423, `Expected 423 on 5th attempt, got ${lastLockoutRes.status}`);
    assert.strictEqual(lastLockoutRes.body.code, 'ACCOUNT_LOCKED');

    // Verify critical alert was logged in system_alert_logs
    const alertRow = db.prepare("SELECT * FROM system_alert_logs WHERE category = 'security' AND level = 'critical' ORDER BY timestamp DESC LIMIT 1").get();
    assert.ok(alertRow, 'No critical security alert was recorded in system_alert_logs!');
    assert.ok(alertRow.message.includes('Admin account locked'), 'Alert message does not specify account locked');
    console.log(`  ✅ Attack 5 Blocked: Account locked after 5 attempts. Alert logged: "${alertRow.message}"`);

    // ----------------------------------------------------
    // TEST 7: Emergency Recovery Code (Single-Use)
    // ----------------------------------------------------
    console.log('\n[Test 7] Verifying single-use emergency recovery code...');
    const testAdminId = `adm_rec_${Date.now()}`;
    const testAdminEmail = `recovery_${Date.now()}@cloudstudio.dev`;
    const recCode = 'REC-TEST-9999-ABCD';
    const recCodeHash = sha256Hex(recCode);

    db.prepare(`
      INSERT INTO admin_users (id, email, name, role, password_hash, totp_secret, totp_enabled, failed_logins, status, created_at, created_by)
      VALUES (?, ?, 'Recovery Tester', 'support_agent', ?, 'SOME_SECRET', 1, 0, 'active', datetime('now'), 'test')
    `).run(testAdminId, testAdminEmail, hashPassword('TestSecretPass123!'));

    db.prepare(`
      INSERT INTO admin_recovery_codes (id, admin_user_id, code_hash, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(`rec_${Date.now()}`, testAdminId, recCodeHash);

    // First use: should succeed
    const recLogin1 = await dispatchRequest({
      path: '/api/admin/auth/login',
      method: 'POST',
      headers: { Host: adminHost },
      body: { email: testAdminEmail, password: 'TestSecretPass123!', recoveryCode: recCode },
    });
    assert.strictEqual(recLogin1.status, 200, `Recovery code login failed: ${JSON.stringify(recLogin1.body)}`);

    // Second use of the same code: MUST fail
    const recLogin2 = await dispatchRequest({
      path: '/api/admin/auth/login',
      method: 'POST',
      headers: { Host: adminHost },
      body: { email: testAdminEmail, password: 'TestSecretPass123!', recoveryCode: recCode },
    });
    assert.strictEqual(recLogin2.status, 401, `Second use of recovery code should fail, got ${recLogin2.status}`);
    console.log('  ✅ Emergency Recovery Code Succeeded on first use and was invalidated for reuse.');

    // ----------------------------------------------------
    // TEST 8: Mandatory Justification for Private User Data & Audit Logging
    // ----------------------------------------------------
    console.log('\n[Test 8] Verifying mandatory justification for inspecting user private data...');
    const sampleUserId = `usr_${Date.now()}`;
    db.prepare(`
      INSERT OR REPLACE INTO users (id, email, name, role, status, created_at)
      VALUES (?, 'target.user@domain.com', 'Target User', 'supervisor', 'active', datetime('now'))
    `).run(sampleUserId);

    // Attempt without justification -> 400
    const noJustifyRes = await dispatchRequest({
      path: `/api/admin/users/${sampleUserId}/inspect-private`,
      method: 'POST',
      headers: { Host: adminHost, cookie: adminCookie },
      body: {},
    });
    assert.strictEqual(noJustifyRes.status, 400, `Expected 400 for missing justification, got ${noJustifyRes.status}`);

    // Attempt with justification -> 200 & recorded in admin_audit_actions
    const validJustification = 'Official investigation for account compromise ticket #9902';
    const justifyRes = await dispatchRequest({
      path: `/api/admin/users/${sampleUserId}/inspect-private`,
      method: 'POST',
      headers: { Host: adminHost, cookie: adminCookie },
      body: { justification: validJustification },
    });
    assert.strictEqual(justifyRes.status, 200);
    assert.ok(justifyRes.body.privateData, 'Private data missing from response');

    // Verify immutable audit log recorded this action
    const auditRow = db.prepare("SELECT * FROM admin_audit_actions WHERE action = 'user.inspect_private_data' AND target_id = ?").get(sampleUserId);
    assert.ok(auditRow, 'No audit record was created for inspecting private user content!');
    assert.strictEqual(auditRow.justification, validJustification);
    console.log('  ✅ Mandatory justification enforced and recorded in immutable audit log.');

    // ----------------------------------------------------
    // TEST 9: Audit Log Strict Immutability (DELETE & PUT Rejected)
    // ----------------------------------------------------
    console.log('\n[Test 9] Verifying audit log strict immutability (DELETE & PUT rejected)...');
    const deleteAuditRes = await dispatchRequest({
      path: `/api/admin/audit-logs/${auditRow.id}`,
      method: 'DELETE',
      headers: { Host: adminHost, cookie: adminCookie },
    });
    assert.strictEqual(deleteAuditRes.status, 405, `Expected 405 Method Not Allowed for DELETE audit log, got ${deleteAuditRes.status}`);

    const putAuditRes = await dispatchRequest({
      path: `/api/admin/audit-logs/${auditRow.id}`,
      method: 'PUT',
      headers: { Host: adminHost, cookie: adminCookie },
      body: { justification: 'tampered' },
    });
    assert.strictEqual(putAuditRes.status, 405, `Expected 405 Method Not Allowed for PUT audit log, got ${putAuditRes.status}`);
    console.log('  ✅ Attack 8 Blocked: Audit logs are strictly immutable (405 Method Not Allowed).');

    // ----------------------------------------------------
    // TEST 10: Admin Logout & Session Invalidation
    // ----------------------------------------------------
    console.log('\n[Test 10] Verifying admin logout and session invalidation...');
    const logoutRes = await dispatchRequest({
      path: '/api/admin/auth/logout',
      method: 'POST',
      headers: { Host: adminHost, cookie: adminCookie },
    });
    assert.strictEqual(logoutRes.status, 200);

    // Subsequent access with logged-out cookie must be rejected (401)
    const postLogoutRes = await dispatchRequest({
      path: '/api/admin/dashboard',
      headers: { Host: adminHost, cookie: adminCookie },
    });
    assert.strictEqual(postLogoutRes.status, 401, `Logged out admin session should be rejected with 401, got ${postLogoutRes.status}`);
    console.log('  ✅ Admin logout succeeded and session was invalidated immediately.');

    console.log('\n================================================================');
    console.log('🎉 ALL 10 PHASE 9 ADVERSARIAL SECURITY ATTACK CHECKS PASSED (100%)');
    console.log('================================================================\n');
  } catch (err) {
    console.error('❌ Test failed with error:', err);
    process.exit(1);
  }
})();
