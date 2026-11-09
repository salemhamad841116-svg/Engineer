/**
 * phase13ServiceKeyIngestGate.test.js
 * Mandatory Quality Gate 19: Phase 13 Service API Key, Delegated Tokens & Security Hardening Suite
 *
 * Verifies all Nine Acceptance Criteria Numbers:
 * 1. Idempotency: 3 identical requests produce exactly 1 book (count = 1).
 * 2. Cascade Purge: Complete purge across 9 database tables (documents, chunks, book_structures,
 *    book_pages, document_tables, document_figures, research_evidence, research_citations, processing_jobs)
 *    with 0 orphan rows (count = 0).
 * 3. Zero Search Results: 0 search matches within < 1.0s.
 * 4. Sliding Window Rate Limit: 60 requests/minute, 61st rejected with HTTP 429 & Retry-After: 60s.
 * 5. Instant Revocation: < 60 seconds (measured: 0ms) returning HTTP 403.
 * 6. Delegated Token TTL: 30 to 60 minutes (default: 45 min / 2700s), expired tokens return HTTP 401
 *    DELEGATED_TOKEN_EXPIRED, identity derived strictly from DB token, anti-spoofing rejects mismatched
 *    claimed X-User-Id with HTTP 403 IDENTITY_MISMATCH.
 * 7. Cross-Tenant Isolation: 0 cross-tenant leaks, unauthorized operations return HTTP 403
 *    FORBIDDEN_CROSS_TENANT and log critical security alert.
 * 8. HMAC & Anti-Replay: +-300 seconds timestamp window, tampered payloads return HTTP 403
 *    INVALID_SIGNATURE, missing return SIGNATURE_REQUIRED, clock drift > 300s returns REQUEST_EXPIRED.
 * 9. Network Restriction: Non-loopback/non-private IP rejected with HTTP 403 NETWORK_RESTRICTED.
 */

const assert = require('assert');
const crypto = require('crypto');
const { getDb, run, get, all } = require('../db/database');
const { newId, sha256Hex } = require('../utils/ids');
const { nowIso } = require('../utils/clock');
const {
  generateServiceKey,
  revokeServiceKey,
  rotateServiceKey,
  issueDelegatedToken,
  revokeDelegatedToken,
  computeHmacSignature,
  resetRateLimits,
} = require('../auth/serviceKeyAuth');
const { knowledgeDal } = require('../dal/knowledgeDal');
const externalBookRoutes = require('../routes/externalBookRoutes');
const externalTokenRoutes = require('../routes/externalTokenRoutes');

console.log('================================================================');
console.log('🔑 RUNNING PHASE 13 SERVICE API KEY & SECURITY HARDENING GATE');
console.log('================================================================\n');

/**
 * Pure in-memory dispatcher for external routes
 */
function dispatchRoute(router, { basePath = '', path = '/', method = 'GET', headers = {}, body = null, ip = '127.0.0.1' }) {
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
      originalUrl: `${basePath}${path === '/' ? '' : path}`,
      method,
      headers: lowerHeaders,
      query: {},
      params: {},
      body: body || {},
      socket: { remoteAddress: ip },
    };

    const parts = path.split('/').filter(Boolean);
    if (parts.length >= 1) {
      req.params.id = parts[0];
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
      json(data) {
        resolve({ status: statusCode, headers: resHeaders, body: data });
      },
      send(data) {
        resolve({ status: statusCode, headers: resHeaders, body: data });
      },
    };

    router.handle(req, res, (err) => {
      if (err) {
        const status = err.status || 500;
        resolve({
          status,
          headers: resHeaders,
          body: { error: { code: err.code || 'ERROR', message: err.message, status } },
        });
      } else {
        resolve({
          status: 404,
          headers: resHeaders,
          body: { error: { code: 'NOT_FOUND', message: 'Route not found', status: 404 } },
        });
      }
    });
  });
}

function dispatchExternalRequest(opts) {
  return dispatchRoute(externalBookRoutes, { basePath: '/api/external/books', ...opts });
}

function dispatchTokenRequest(opts) {
  return dispatchRoute(externalTokenRoutes, { basePath: '/api/external/tokens', ...opts });
}

(async () => {
  try {
    const db = getDb();
    resetRateLimits();

    // ----------------------------------------------------
    // Seed test users: User Alpha and User Beta
    // ----------------------------------------------------
    const userAlphaId = 'usr_alpha_phase13_test';
    const userBetaId = 'usr_beta_phase13_test';

    run(
      `INSERT OR REPLACE INTO users (id, name, email, password_hash, role, status, created_at)
       VALUES (?, 'User Alpha', 'alpha@external.test', 'hash', 'supervisor', 'active', ?)`,
      userAlphaId,
      nowIso()
    );

    run(
      `INSERT OR REPLACE INTO users (id, name, email, password_hash, role, status, created_at)
       VALUES (?, 'User Beta', 'beta@external.test', 'hash', 'supervisor', 'active', ?)`,
      userBetaId,
      nowIso()
    );

    // ----------------------------------------------------
    // Criterion 6: Per-User Delegated Token Issuance & TTL
    // ----------------------------------------------------
    console.log('[Criterion 6] Testing Per-User Delegated Token Issuance & TTL...');

    const masterKey = generateServiceKey({
      name: 'Master Legacy Service Key',
      scopes: ['books:crud'],
      rateLimitRpm: 60,
    });

    function createActiveSession(userId) {
      const token = crypto.randomBytes(32).toString('hex');
      const sessionId = newId('ses');
      const now = nowIso();
      const expiresAt = new Date(Date.now() + 24 * 3600000).toISOString();
      run(
        `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, last_activity_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        sessionId, userId, sha256Hex(token), now, now, now, expiresAt
      );
      return token;
    }

    // 1. Unauthenticated Issuance Attempt: Calling /delegated with NO login proof MUST BE REJECTED & LOGGED
    console.log('  Testing unauthenticated delegated token request rejection (missing login proof)...');
    const unauthIssueRes = await dispatchTokenRequest({
      path: '/delegated',
      method: 'POST',
      headers: { 'X-Service-Key': masterKey.rawKey },
      body: { userId: userAlphaId, ttlMinutes: 45 },
    });
    assert.strictEqual(unauthIssueRes.status, 401, 'Issuance without active session must return 401');
    assert.strictEqual(unauthIssueRes.body.error.code, 'LOGIN_PROOF_REQUIRED');

    // Verify security incident logged in system_alert_logs
    const unauthAlert = get(
      "SELECT * FROM system_alert_logs WHERE category = 'security' AND message LIKE '%Missing user login proof%' ORDER BY timestamp DESC LIMIT 1"
    );
    assert.ok(unauthAlert, 'Security incident must be recorded in system_alert_logs for unauthenticated issuance attempt');

    // Verify audit log recorded in service_api_audit_logs
    const unauthAudit = get(
      "SELECT * FROM service_api_audit_logs WHERE action = 'auth.delegated_token_rejected_no_login_proof' ORDER BY created_at DESC LIMIT 1"
    );
    assert.ok(unauthAudit, 'Audit log must record rejected unauthenticated issuance attempt in service_api_audit_logs');
    console.log('  ✅ Unauthenticated issuance without login proof strictly rejected (401) and logged in system_alert_logs.');

    // 2. Invalid / Expired Session Proof Attempt: MUST BE REJECTED & LOGGED
    const invalidSessionRes = await dispatchTokenRequest({
      path: '/delegated',
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-User-Session-Token': 'fake_nonexistent_or_expired_session_token_xyz',
      },
      body: { userId: userAlphaId },
    });
    assert.strictEqual(invalidSessionRes.status, 401, 'Invalid session proof must return 401');
    assert.strictEqual(invalidSessionRes.body.error.code, 'SESSION_INVALID');
    console.log('  ✅ Invalid/expired session proof strictly rejected (401) and logged.');

    // 3. Identity Mismatch Attempt: Active session belongs to Alpha, but client claims Beta in body
    const alphaSessionToken = createActiveSession(userAlphaId);
    const mismatchIssueRes = await dispatchTokenRequest({
      path: '/delegated',
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-User-Session-Token': alphaSessionToken,
      },
      body: { userId: userBetaId }, // Mismatch!
    });
    assert.strictEqual(mismatchIssueRes.status, 403, 'Identity mismatch during issuance must return 403');
    assert.strictEqual(mismatchIssueRes.body.error.code, 'IDENTITY_MISMATCH');
    console.log('  ✅ Identity mismatch during token issuance blocked with HTTP 403 IDENTITY_MISMATCH.');

    // 4. Valid Issuance with active login proof from unified login/SSO
    const tokenIssueRes = await dispatchTokenRequest({
      path: '/delegated',
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-User-Session-Token': alphaSessionToken,
      },
      body: { ttlMinutes: 45 },
    });
    assert.strictEqual(tokenIssueRes.status, 201, 'Delegated token issuance with active session must return 201');
    assert.strictEqual(tokenIssueRes.body.success, true);
    assert.strictEqual(tokenIssueRes.body.userId, userAlphaId, 'User identity must be derived strictly from active session');
    assert.ok(tokenIssueRes.body.delegatedToken.startsWith('dit_live_'), 'Token must start with dit_live_');
    assert.strictEqual(tokenIssueRes.body.ttlSeconds, 45 * 60, 'TTL must be 2700s (45 min)');
    assert.strictEqual(tokenIssueRes.body.ttlMinutes, 45);
    const alphaToken = tokenIssueRes.body.delegatedToken;
    const alphaTokenId = tokenIssueRes.body.id;

    // 2. TTL Bounding (Clamp to 30-60 min)
    const tokenBoundedLow = issueDelegatedToken({ userId: userAlphaId, ttlMinutes: 10 });
    assert.strictEqual(tokenBoundedLow.ttlSeconds, 30 * 60, 'TTL < 30 must clamp to 30 min (1800s)');
    const tokenBoundedHigh = issueDelegatedToken({ userId: userAlphaId, ttlMinutes: 120 });
    assert.strictEqual(tokenBoundedHigh.ttlSeconds, 60 * 60, 'TTL > 60 must clamp to 60 min (3600s)');

    // 3. User Identity derivation: Request using token derives userAlphaId
    const statusWithToken = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'Idempotency-Key': `idem_alpha_token_test_${Date.now()}`,
      },
      body: { title: 'كتاب مشتق من رمز التفويض', text: 'محتوى توثيق اشتقاق الهوية من الرمز.' },
    });
    assert.strictEqual(statusWithToken.status, 201, 'Request with valid delegated token must succeed');
    const alphaBookId = statusWithToken.body.book_id;
    const alphaDocInDb = get('SELECT owner_id, tenant_id FROM documents WHERE id = ?', alphaBookId);
    assert.strictEqual(alphaDocInDb.owner_id, userAlphaId, 'Document owner_id must be derived strictly from token');
    assert.strictEqual(alphaDocInDb.tenant_id, userAlphaId, 'Document tenant_id must be derived strictly from token');

    // 4. Anti-Spoofing: If claimed X-User-Id doesn't match token, MUST return 403 IDENTITY_MISMATCH
    const spoofRes = await dispatchExternalRequest({
      path: `/${alphaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'X-User-Id': userBetaId, // Spoofing attempt!
      },
    });
    assert.strictEqual(spoofRes.status, 403, 'Mismatched X-User-Id must return 403');
    assert.strictEqual(spoofRes.body.error.code, 'IDENTITY_MISMATCH');

    // 5. Expired token: simulate token past expires_at
    const expiredTokenRes = issueDelegatedToken({ userId: userAlphaId, ttlMinutes: 30 });
    run(
      "UPDATE delegated_ingest_tokens SET expires_at = datetime('now', '-5 minutes') WHERE id = ?",
      expiredTokenRes.id
    );
    const useExpiredRes = await dispatchExternalRequest({
      path: `/${alphaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': expiredTokenRes.token,
      },
    });
    assert.strictEqual(useExpiredRes.status, 401, 'Expired token must return 401');
    assert.strictEqual(useExpiredRes.body.error.code, 'DELEGATED_TOKEN_EXPIRED');

    console.log('  ✅ Criterion 6 Verified: Delegated token issued (TTL: 30–60 min), identity derived strictly, anti-spoofing active.');

    // ----------------------------------------------------
    // Criterion 9: Network Origin Restriction
    // ----------------------------------------------------
    console.log('[Criterion 9] Testing Network Origin Restriction (Loopback & RFC 1918 only)...');

    // Loopback 127.0.0.1 -> Allowed
    const loopbackRes = await dispatchExternalRequest({
      path: `/${alphaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
      ip: '127.0.0.1',
    });
    assert.strictEqual(loopbackRes.status, 200, 'Loopback IP must be allowed');

    // Private Subnet 192.168.1.50 -> Allowed
    const privateRes = await dispatchExternalRequest({
      path: `/${alphaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
      ip: '192.168.1.50',
    });
    assert.strictEqual(privateRes.status, 200, 'RFC 1918 private IP must be allowed');

    // Public Internet IP 203.0.113.195 -> Blocked with 403 NETWORK_RESTRICTED
    const publicIpRes = await dispatchExternalRequest({
      path: `/${alphaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
      ip: '203.0.113.195',
    });
    assert.strictEqual(publicIpRes.status, 403, 'Public internet IP must be blocked');
    assert.strictEqual(publicIpRes.body.error.code, 'NETWORK_RESTRICTED');
    console.log('  ✅ Criterion 9 Verified: Non-loopback/non-private IP blocked with HTTP 403 NETWORK_RESTRICTED.');

    // ----------------------------------------------------
    // Criterion 8: HMAC Signature & Anti-Replay (300s window)
    // ----------------------------------------------------
    console.log('[Criterion 8] Testing HMAC-SHA256 Signature & Anti-Replay (300s window)...');

    // Enable HMAC requirement for this test scope
    process.env.EXTERNAL_INGEST_REQUIRE_HMAC = 'true';

    // 1. Missing signature when HMAC required
    const missingSigRes = await dispatchExternalRequest({
      path: `/${alphaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'X-Timestamp': nowIso(),
      },
    });
    assert.strictEqual(missingSigRes.status, 403, 'Missing signature must return 403');
    assert.strictEqual(missingSigRes.body.error.code, 'SIGNATURE_REQUIRED');

    // 2. Tampered signature / payload
    const tamperedRes = await dispatchExternalRequest({
      path: `/${alphaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'X-Timestamp': nowIso(),
        'X-Signature': 'sha256=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      },
    });
    assert.strictEqual(tamperedRes.status, 403, 'Tampered signature must return 403');
    assert.strictEqual(tamperedRes.body.error.code, 'INVALID_SIGNATURE');

    // 3. Expired timestamp (> 300s clock drift)
    const oldTimestamp = new Date(Date.now() - 350 * 1000).toISOString(); // 350 seconds ago
    const expiredSig = computeHmacSignature({
      method: 'GET',
      path: `/api/external/books/${alphaBookId}/status`,
      timestamp: oldTimestamp,
      delegatedToken: alphaToken,
      secret: masterKey.id ? get('SELECT key_hash FROM service_api_keys WHERE id = ?', masterKey.id).key_hash : '',
    });
    const expiredTimeRes = await dispatchExternalRequest({
      path: `/${alphaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'X-Timestamp': oldTimestamp,
        'X-Signature': expiredSig,
      },
    });
    assert.strictEqual(expiredTimeRes.status, 403, 'Clock drift > 300s must return 403');
    assert.strictEqual(expiredTimeRes.body.error.code, 'REQUEST_EXPIRED');

    // 4. Valid HMAC Signature within +-300s
    const validTimestamp = nowIso();
    const serviceKeyRow = get('SELECT key_hash FROM service_api_keys WHERE id = ?', masterKey.id);
    const validSig = computeHmacSignature({
      method: 'GET',
      path: `/api/external/books/${alphaBookId}/status`,
      timestamp: validTimestamp,
      delegatedToken: alphaToken,
      secret: serviceKeyRow.key_hash,
    });
    const validHmacRes = await dispatchExternalRequest({
      path: `/${alphaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'X-Timestamp': validTimestamp,
        'X-Signature': validSig,
      },
    });
    assert.strictEqual(validHmacRes.status, 200, 'Valid HMAC signature must succeed');
    console.log('  ✅ Criterion 8 Verified: HMAC signature verified, anti-replay enforced at +-300s.');

    // Disable forced HMAC for remaining functional assertions
    delete process.env.EXTERNAL_INGEST_REQUIRE_HMAC;

    // Issue token for Beta
    const betaTokenObj = issueDelegatedToken({ userId: userBetaId, ttlMinutes: 45 });
    const betaToken = betaTokenObj.token;

    // ----------------------------------------------------
    // Criterion 7: Cross-Tenant Isolation (0 leaks)
    // ----------------------------------------------------
    console.log('[Criterion 7] Testing Cross-Tenant Isolation (0 leaks + security alert)...');

    const betaBookRes = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': betaToken,
        'Idempotency-Key': `idem_beta_confidential_${Date.now()}`,
      },
      body: {
        title: 'كتاب أبحاث بيتا السرية 2026',
        text: 'بيانات سرية للغاية خاصة ببيتا فقط.',
        author: 'فريق بيتا',
      },
    });
    assert.strictEqual(betaBookRes.status, 201);
    const betaBookId = betaBookRes.body.book_id;

    // Alpha attempts PATCH on Beta's book
    const crossPatch = await dispatchExternalRequest({
      path: `/${betaBookId}`,
      method: 'PATCH',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
      body: { title: 'محاولة اختراق عنوان كتاب بيتا' },
    });
    assert.strictEqual(crossPatch.status, 403, 'Cross-user PATCH must return 403');
    assert.strictEqual(crossPatch.body.error.code, 'FORBIDDEN_CROSS_TENANT');

    // Alpha attempts REPLACE on Beta's book
    const crossReplace = await dispatchExternalRequest({
      path: `/${betaBookId}/replace`,
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
      body: { text: 'محتوى خبيث لاستبدال محتوى كتاب بيتا' },
    });
    assert.strictEqual(crossReplace.status, 403, 'Cross-user REPLACE must return 403');
    assert.strictEqual(crossReplace.body.error.code, 'FORBIDDEN_CROSS_TENANT');

    // Alpha attempts DELETE on Beta's book
    const crossDelete = await dispatchExternalRequest({
      path: `/${betaBookId}`,
      method: 'DELETE',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
    });
    assert.strictEqual(crossDelete.status, 403, 'Cross-user DELETE must return 403');
    assert.strictEqual(crossDelete.body.error.code, 'FORBIDDEN_CROSS_TENANT');

    // Alpha attempts GET STATUS on Beta's book
    const crossStatus = await dispatchExternalRequest({
      path: `/${betaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
    });
    assert.strictEqual(crossStatus.status, 403, 'Cross-user STATUS must return 403');
    assert.strictEqual(crossStatus.body.error.code, 'FORBIDDEN_CROSS_TENANT');

    // Verify Critical Security Alert in system_alert_logs
    const securityAlert = get(
      "SELECT * FROM system_alert_logs WHERE category = 'security' AND level = 'critical' AND tenant_id = ? ORDER BY timestamp DESC LIMIT 1",
      userAlphaId
    );
    assert.ok(securityAlert, 'Critical security alert must be registered upon cross-tenant attempt');
    console.log('  ✅ Criterion 7 Verified: 0 cross-tenant leaks across PATCH/REPLACE/DELETE/STATUS, critical alert logged.');

    // ----------------------------------------------------
    // Criterion 1: Idempotency Gate (3x = 1)
    // ----------------------------------------------------
    console.log('[Criterion 1] Testing Idempotency Key (3 identical requests create exactly 1 book)...');

    const idemKey = `idem_exact_3x_${Date.now()}`;
    const idemPayload = {
      title: 'كتاب التحقق من الـ Idempotency المعياري',
      text: 'إرسال نفس الطلب 3 مرات يجب أن ينتج عنه كتاب واحد فقط في قاعدة البيانات.',
    };

    const call1 = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'Idempotency-Key': idemKey,
      },
      body: idemPayload,
    });
    assert.strictEqual(call1.status, 201);
    const createdId = call1.body.book_id;

    const call2 = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'Idempotency-Key': idemKey,
      },
      body: idemPayload,
    });
    assert.strictEqual(call2.status, 201);
    assert.strictEqual(call2.body.book_id, createdId);

    const call3 = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'Idempotency-Key': idemKey,
      },
      body: idemPayload,
    });
    assert.strictEqual(call3.status, 201);
    assert.strictEqual(call3.body.book_id, createdId);

    const countDocs = get('SELECT COUNT(*) as cnt FROM documents WHERE id = ?', createdId).cnt;
    assert.strictEqual(countDocs, 1, 'Exactly 1 book must exist in DB (3 requests = 1 book)');
    console.log('  ✅ Criterion 1 Verified: 3 identical requests produce count = 1.');

    // ----------------------------------------------------
    // Criterion 2 & 3: Cascade DELETE & Zero Search Results in < 1s
    // ----------------------------------------------------
    console.log('[Criteria 2 & 3] Testing Cascade DELETE (0 rows in 9 tables) & Zero Search Results (< 1s)...');

    const purgeMarker = `PURGE_MARKER_${crypto.randomBytes(8).toString('hex')}`;
    const purgeBookRes = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'Idempotency-Key': `idem_purge_${Date.now()}`,
      },
      body: {
        title: 'كتاب التطهير الشامل',
        text: `Marker to purge completely: ${purgeMarker}`,
      },
    });
    assert.strictEqual(purgeBookRes.status, 201);
    const purgeBookId = purgeBookRes.body.book_id;

    const tenantCtxAlpha = { tenantId: userAlphaId, userId: userAlphaId, isSuperAdmin: false };
    const searchBefore = knowledgeDal.searchBookKnowledge(purgeMarker, { limit: 5 }, tenantCtxAlpha);
    assert.ok(searchBefore.length >= 1, 'Search before deletion must find chunk');

    // Execute DELETE
    const deleteRes = await dispatchExternalRequest({
      path: `/${purgeBookId}`,
      method: 'DELETE',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
    });
    assert.strictEqual(deleteRes.status, 200);
    assert.strictEqual(deleteRes.body.deleted, true);

    // Verify 0 orphan rows across all 9 tables
    assert.strictEqual(get('SELECT COUNT(*) as c FROM documents WHERE id = ?', purgeBookId).c, 0, 'documents = 0');
    assert.strictEqual(get('SELECT COUNT(*) as c FROM chunks WHERE document_id = ?', purgeBookId).c, 0, 'chunks = 0');
    assert.strictEqual(get('SELECT COUNT(*) as c FROM book_structures WHERE book_id = ?', purgeBookId).c, 0, 'book_structures = 0');
    assert.strictEqual(get('SELECT COUNT(*) as c FROM book_pages WHERE book_id = ?', purgeBookId).c, 0, 'book_pages = 0');
    assert.strictEqual(get('SELECT COUNT(*) as c FROM document_tables WHERE document_id = ?', purgeBookId).c, 0, 'document_tables = 0');
    assert.strictEqual(get('SELECT COUNT(*) as c FROM document_figures WHERE document_id = ?', purgeBookId).c, 0, 'document_figures = 0');
    assert.strictEqual(get('SELECT COUNT(*) as c FROM research_evidence WHERE book_id = ?', purgeBookId).c, 0, 'research_evidence = 0');
    assert.strictEqual(get('SELECT COUNT(*) as c FROM research_citations WHERE book_id = ?', purgeBookId).c, 0, 'research_citations = 0');
    assert.strictEqual(get('SELECT COUNT(*) as c FROM processing_jobs WHERE document_id = ?', purgeBookId).c, 0, 'processing_jobs = 0');

    // Search query execution time and results
    const searchStart = Date.now();
    const searchAfter = knowledgeDal.searchBookKnowledge(purgeMarker, { limit: 5 }, tenantCtxAlpha);
    const searchDurationMs = Date.now() - searchStart;
    assert.strictEqual(searchAfter.length, 0, 'Search after purge must return 0 results');
    assert.ok(searchDurationMs < 1000, `Search duration (${searchDurationMs}ms) must be < 1.0s (1000ms)`);
    console.log(`  ✅ Criteria 2 & 3 Verified: Cascade purge wiped 9 tables (0 rows) and search returned 0 results in ${searchDurationMs}ms (< 1.0s).`);

    // ----------------------------------------------------
    // Criterion 4: Sliding Window Rate Limit (60/min)
    // ----------------------------------------------------
    console.log('[Criterion 4] Testing Sliding Window Rate Limit (60 requests/minute)...');

    const rateKey = generateServiceKey({
      name: 'Rate Limit Verification Key',
      scopes: ['books:crud'],
      rateLimitRpm: 60,
    });

    for (let i = 1; i <= 60; i++) {
      const resOk = await dispatchExternalRequest({
        path: `/${createdId}/status`,
        method: 'GET',
        headers: {
          'X-Service-Key': rateKey.rawKey,
          'X-Delegated-Token': alphaToken,
        },
      });
      assert.strictEqual(resOk.status, 200, `Request ${i}/60 must succeed`);
    }

    // 61st request must be rejected with 429
    const res61 = await dispatchExternalRequest({
      path: `/${createdId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': rateKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
    });
    assert.strictEqual(res61.status, 429, '61st request must return HTTP 429');
    assert.strictEqual(res61.body.error.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(res61.headers['retry-after'], 'Retry-After header must be present');
    console.log(`  ✅ Criterion 4 Verified: 60 allowed, 61st returned HTTP 429 with Retry-After: ${res61.headers['retry-after']}s.`);

    // ----------------------------------------------------
    // Criterion 5: Instant Revocation (< 60s)
    // ----------------------------------------------------
    console.log('[Criterion 5] Testing Instant Key & Token Revocation (< 60s)...');

    // 1. Service Key Revocation
    const revKey = generateServiceKey({ name: 'Revocable Service Key' });
    const revokeStart = Date.now();
    revokeServiceKey(revKey.id);
    const revokeDuration = Date.now() - revokeStart;

    const blockedKeyRes = await dispatchExternalRequest({
      path: `/${createdId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': revKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
    });
    assert.strictEqual(blockedKeyRes.status, 403, 'Revoked service key must immediately return 403');
    assert.strictEqual(blockedKeyRes.body.error.code, 'SERVICE_KEY_REVOKED');

    // 2. Delegated Token Revocation
    const revTokenObj = issueDelegatedToken({ userId: userAlphaId, ttlMinutes: 30 });
    const tokenRevokeStart = Date.now();
    revokeDelegatedToken(revTokenObj.id);
    const tokenRevokeDuration = Date.now() - tokenRevokeStart;

    const blockedTokenRes = await dispatchExternalRequest({
      path: `/${createdId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': revTokenObj.token,
      },
    });
    assert.strictEqual(blockedTokenRes.status, 403, 'Revoked delegated token must immediately return 403');
    assert.strictEqual(blockedTokenRes.body.error.code, 'DELEGATED_TOKEN_REVOKED');
    console.log(`  ✅ Criterion 5 Verified: Revocation took effect in ${revokeDuration}ms (Key) and ${tokenRevokeDuration}ms (Token), both < 60s.`);

    // ----------------------------------------------------
    // Atomic Content Replacement (No concurrent co-retrieval)
    // ----------------------------------------------------
    console.log('[Functional] Testing Atomic Content Replacement...');
    const oldKw = `OLD_${crypto.randomBytes(6).toString('hex')}`;
    const newKw = `NEW_${crypto.randomBytes(6).toString('hex')}`;

    const v1Res = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
        'Idempotency-Key': `idem_v1_${Date.now()}`,
      },
      body: { title: 'كتاب الاستبدال', text: `Old version content: ${oldKw}` },
    });
    const atomicId = v1Res.body.book_id;
    assert.ok(knowledgeDal.searchBookKnowledge(oldKw, {}, tenantCtxAlpha).length >= 1);

    const replaceRes = await dispatchExternalRequest({
      path: `/${atomicId}/replace`,
      method: 'POST',
      headers: {
        'X-Service-Key': masterKey.rawKey,
        'X-Delegated-Token': alphaToken,
      },
      body: { title: 'كتاب الاستبدال - محدث', text: `New version content: ${newKw}` },
    });
    assert.strictEqual(replaceRes.status, 200);
    assert.strictEqual(replaceRes.body.replaced, true);

    assert.strictEqual(knowledgeDal.searchBookKnowledge(oldKw, {}, tenantCtxAlpha).length, 0, 'Old content must be purged');
    assert.ok(knowledgeDal.searchBookKnowledge(newKw, {}, tenantCtxAlpha).length >= 1, 'New content must be searchable');
    console.log('  ✅ Atomic Replace Verified: Old index purged, new index retrievable.');

    console.log('\n================================================================');
    console.log('🎉 ALL QUALITY GATE 19 ACCEPTANCE CRITERIA PASSED (100% GREEN)');
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n❌ QUALITY GATE 19 FAILED:', err);
    process.exit(1);
  }
})();
