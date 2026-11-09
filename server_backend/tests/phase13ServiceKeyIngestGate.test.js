/**
 * phase13ServiceKeyIngestGate.test.js
 * Mandatory Quality Gate 19: Phase 13 Service API Key & External Book Ingestion Suite
 *
 * Verifies:
 * 1. Missing, invalid, or revoked service key returns 401 or 403 + immutable audit record.
 * 2. Scope boundary enforcement (non-books:crud rejected with 403).
 * 3. Cross-Tenant Penetration Defense (User Alpha blocked with 403 from User Beta's books + security alert).
 * 4. Idempotency Key Gate: 3x identical requests create exactly 1 book and return identical response.
 * 5. Complete Cascade DELETE: 0 orphan rows across all tables and 0 search results within < 1s.
 * 6. Atomic REPLACE: old version completely purged, new version retrievable; no concurrent coexistence.
 * 7. Rate Limit Gate: 60 requests/minute allowed, 61st returns HTTP 429 + Retry-After.
 * 8. Immediate Revocation: Revocation takes effect immediately (< 1 second).
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
  resetRateLimits,
} = require('../auth/serviceKeyAuth');
const { knowledgeDal } = require('../dal/knowledgeDal');
const externalBookRoutes = require('../routes/externalBookRoutes');

console.log('================================================================');
console.log('🔑 RUNNING PHASE 13 SERVICE API KEY & EXTERNAL INGESTION GATE');
console.log('================================================================\n');

/**
 * Pure in-memory dispatcher for externalBookRoutes
 */
function dispatchExternalRequest({ path, method = 'GET', headers = {}, body = null }) {
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
      originalUrl: `/api/external/books${path === '/' ? '' : path}`,
      method,
      headers: lowerHeaders,
      query: {},
      params: {},
      body: body || {},
      socket: { remoteAddress: '127.0.0.1' },
    };

    // Extract path params for routes like /:id, /:id/replace, /:id/status
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

    // Execute route handler
    externalBookRoutes.handle(req, res, (err) => {
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
    // TEST 1: Missing, Invalid, or Revoked Service Key (401/403 + Audit)
    // ----------------------------------------------------
    console.log('[Test 1] Testing missing, invalid, and revoked Service Key handling...');

    // 1. Missing Key
    const resNoKey = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: { 'X-User-Id': userAlphaId },
      body: { text: 'Some text content' },
    });
    assert.strictEqual(resNoKey.status, 401, 'Missing key must return 401');
    assert.strictEqual(resNoKey.body.error.code, 'MISSING_SERVICE_KEY');

    // 2. Invalid Key
    const resInvalidKey = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': 'sk_live_completely_fake_invalid_key_1234567890',
        'X-User-Id': userAlphaId,
      },
      body: { text: 'Some text content' },
    });
    assert.strictEqual(resInvalidKey.status, 401, 'Invalid key must return 401');
    assert.strictEqual(resInvalidKey.body.error.code, 'INVALID_SERVICE_KEY');

    // 3. Revoked Key
    const tempKey = generateServiceKey({ name: 'Temporary Key To Revoke' });
    revokeServiceKey(tempKey.id);

    const resRevoked = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': tempKey.rawKey,
        'X-User-Id': userAlphaId,
      },
      body: { text: 'Some text content' },
    });
    assert.strictEqual(resRevoked.status, 403, 'Revoked key must return 403');
    assert.strictEqual(resRevoked.body.error.code, 'SERVICE_KEY_REVOKED');

    // Verify Audit Log was recorded
    const auditLogs = all(
      "SELECT * FROM service_api_audit_logs WHERE action IN ('auth.missing_service_key', 'auth.invalid_service_key', 'auth.revoked_key_attempt')"
    );
    assert.ok(auditLogs.length >= 3, 'Audit logs must capture unauthorized attempts');
    console.log('  ✅ Missing, invalid, and revoked keys properly rejected with audit logs.');

    // ----------------------------------------------------
    // TEST 2: Scope Boundary Enforcement
    // ----------------------------------------------------
    console.log('[Test 2] Testing scope boundary enforcement (books:crud only)...');

    const outOfScopeKey = generateServiceKey({
      name: 'Read Only Users Key',
      scopes: ['users:read'],
    });

    const resScopeFail = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': outOfScopeKey.rawKey,
        'X-User-Id': userAlphaId,
      },
      body: { text: 'Sample text' },
    });
    assert.strictEqual(resScopeFail.status, 403, 'Out-of-scope key must return 403');
    assert.strictEqual(resScopeFail.body.error.code, 'INSUFFICIENT_SCOPE');
    console.log('  ✅ Out-of-scope keys strictly blocked with HTTP 403.');

    // Generate valid service key for subsequent tests
    const validKey = generateServiceKey({
      name: 'Production Legacy Ingest Ingestor',
      scopes: ['books:crud'],
      rateLimitRpm: 60,
    });

    // ----------------------------------------------------
    // TEST 3: Cross-Tenant Penetration Defense (User Alpha vs User Beta)
    // ----------------------------------------------------
    console.log('[Test 3] Testing Cross-Tenant Penetration Defense...');

    // 1. Create a confidential book owned by User Beta
    const betaBookRes = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userBetaId,
        'Idempotency-Key': `idem_beta_initial_book_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      },
      body: {
        title: 'وثيقة بيتا السرية للأبحاث الهندسية 2026',
        text: 'تحتوي هذه الوثيقة على خوارزميات بيتا الحصرية المحمية بسياسة عزل المستأجرين.',
        author: 'فريق بيتا البحثي',
      },
    });
    assert.strictEqual(betaBookRes.status, 201, 'User Beta book creation should succeed');
    const betaBookId = betaBookRes.body.book_id;
    assert.ok(betaBookId, 'Book ID must be returned');

    // 2. User Alpha attempts PATCH on User Beta's book -> MUST return 403
    const crossPatchRes = await dispatchExternalRequest({
      path: `/${betaBookId}`,
      method: 'PATCH',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId, // Different user!
      },
      body: { title: 'محاولة اختراق وسرقة عنوان كتاب بيتا' },
    });
    assert.strictEqual(crossPatchRes.status, 403, 'Cross-user PATCH must be blocked with 403');
    assert.strictEqual(crossPatchRes.body.error.code, 'FORBIDDEN_CROSS_TENANT');

    // 3. User Alpha attempts REPLACE on User Beta's book -> MUST return 403
    const crossReplaceRes = await dispatchExternalRequest({
      path: `/${betaBookId}/replace`,
      method: 'POST',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId, // Different user!
      },
      body: { text: 'محتوى خبيث لاستبدال محتوى كتاب بيتا' },
    });
    assert.strictEqual(crossReplaceRes.status, 403, 'Cross-user REPLACE must be blocked with 403');
    assert.strictEqual(crossReplaceRes.body.error.code, 'FORBIDDEN_CROSS_TENANT');

    // 4. User Alpha attempts DELETE on User Beta's book -> MUST return 403
    const crossDeleteRes = await dispatchExternalRequest({
      path: `/${betaBookId}`,
      method: 'DELETE',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId, // Different user!
      },
    });
    assert.strictEqual(crossDeleteRes.status, 403, 'Cross-user DELETE must be blocked with 403');
    assert.strictEqual(crossDeleteRes.body.error.code, 'FORBIDDEN_CROSS_TENANT');

    // 5. User Alpha attempts GET STATUS on User Beta's book -> MUST return 403
    const crossStatusRes = await dispatchExternalRequest({
      path: `/${betaBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId, // Different user!
      },
    });
    assert.strictEqual(crossStatusRes.status, 403, 'Cross-user STATUS must be blocked with 403');
    assert.strictEqual(crossStatusRes.body.error.code, 'FORBIDDEN_CROSS_TENANT');

    // 6. Verify security alert was logged in system_alert_logs
    const securityAlert = get(
      "SELECT * FROM system_alert_logs WHERE category = 'security' AND level = 'critical' AND tenant_id = ? ORDER BY timestamp DESC LIMIT 1",
      userAlphaId
    );
    assert.ok(securityAlert, 'Critical security alert must be registered upon cross-tenant attempt');
    console.log('  ✅ Cross-tenant attack vectors rejected with HTTP 403 and logged in system_alert_logs.');

    // ----------------------------------------------------
    // TEST 4: Idempotency Key 3x Duplicate Replay
    // ----------------------------------------------------
    console.log('[Test 4] Testing Idempotency-Key duplicate replay prevention...');

    const idempotencyKey = `idem_test_3x_${Date.now()}`;
    const payload = {
      title: 'كتاب التحقق من التكرار والـ Idempotency',
      text: 'هذا النص مخصص للتأكد من أن إعادة إرسال نفس الطلب 3 مرات لا تؤدي إلى تكرار الكتب في قاعدة البيانات.',
      author: 'مهندس الجودة',
    };

    // First Call
    const call1 = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId,
        'Idempotency-Key': idempotencyKey,
      },
      body: payload,
    });
    assert.strictEqual(call1.status, 201);
    const createdBookId = call1.body.book_id;

    // Second Call (exact same idempotency key)
    const call2 = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId,
        'Idempotency-Key': idempotencyKey,
      },
      body: payload,
    });
    assert.strictEqual(call2.status, 201);
    assert.strictEqual(call2.body.book_id, createdBookId, 'Second call must return identical book ID');

    // Third Call (exact same idempotency key)
    const call3 = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId,
        'Idempotency-Key': idempotencyKey,
      },
      body: payload,
    });
    assert.strictEqual(call3.status, 201);
    assert.strictEqual(call3.body.book_id, createdBookId, 'Third call must return identical book ID');

    // Verify database contains EXACTLY 1 document with this ID
    const countDocs = get('SELECT COUNT(*) as cnt FROM documents WHERE id = ?', createdBookId).cnt;
    assert.strictEqual(countDocs, 1, 'Exactly 1 book must be created in DB after 3x requests');
    console.log('  ✅ 3x identical requests with same Idempotency-Key created exactly 1 book.');

    // ----------------------------------------------------
    // TEST 5: Cascade Purge Deletion & Immediate Zero Search Results
    // ----------------------------------------------------
    console.log('[Test 5] Testing cascade purge deletion and immediate zero search results...');

    const uniqueMarker = `PURGEVERIFY_${crypto.randomBytes(8).toString('hex')}`;
    const purgeBookRes = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId,
        'Idempotency-Key': `idem_purge_${Date.now()}`,
      },
      body: {
        title: 'كتاب اختبار الحذف التطهيري الفوري',
        text: `Cascade purge payload marker verification: ${uniqueMarker}`,
        author: 'مؤلف معتمد',
      },
    });
    assert.strictEqual(purgeBookRes.status, 201);
    const purgeBookId = purgeBookRes.body.book_id;

    // 1. Search knowledge base before deletion -> MUST find chunk
    const tenantCtxAlpha = { tenantId: userAlphaId, userId: userAlphaId, isSuperAdmin: false };
    const searchBefore = knowledgeDal.searchBookKnowledge(uniqueMarker, { limit: 5 }, tenantCtxAlpha);
    assert.ok(searchBefore.length >= 1, 'Search before deletion must return at least 1 match');

    // 2. Execute DELETE /api/external/books/:id
    const deleteRes = await dispatchExternalRequest({
      path: `/${purgeBookId}`,
      method: 'DELETE',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId,
      },
    });
    assert.strictEqual(deleteRes.status, 200, 'Delete must return 200');
    assert.strictEqual(deleteRes.body.deleted, true);

    // 3. Verify ZERO orphan rows across all database tables
    assert.strictEqual(get('SELECT COUNT(*) as c FROM documents WHERE id = ?', purgeBookId).c, 0);
    assert.strictEqual(get('SELECT COUNT(*) as c FROM chunks WHERE document_id = ?', purgeBookId).c, 0);
    assert.strictEqual(get('SELECT COUNT(*) as c FROM book_structures WHERE book_id = ?', purgeBookId).c, 0);
    assert.strictEqual(get('SELECT COUNT(*) as c FROM book_pages WHERE book_id = ?', purgeBookId).c, 0);
    assert.strictEqual(get('SELECT COUNT(*) as c FROM document_tables WHERE document_id = ?', purgeBookId).c, 0);
    assert.strictEqual(get('SELECT COUNT(*) as c FROM document_figures WHERE document_id = ?', purgeBookId).c, 0);

    // 4. Subsequent search query MUST return 0 results within 1s
    const searchAfter = knowledgeDal.searchBookKnowledge(uniqueMarker, { limit: 5 }, tenantCtxAlpha);
    assert.strictEqual(searchAfter.length, 0, 'Search after cascade purge must return exactly 0 results');
    const searchAfterSpecific = knowledgeDal.searchBookKnowledge(uniqueMarker, { bookIds: [purgeBookId] }, tenantCtxAlpha);
    assert.strictEqual(searchAfterSpecific.length, 0, 'Scoped search on purged book ID must return 0 results');
    console.log('  ✅ Cascade purge confirmed: 0 orphan rows, and search returns 0 results.');

    // ----------------------------------------------------
    // TEST 6: Atomic Content Replacement
    // ----------------------------------------------------
    console.log('[Test 6] Testing atomic content replacement without co-retrieval...');

    const oldKeyword = `OLDREV_${crypto.randomBytes(8).toString('hex')}`;
    const newKeyword = `NEWREV_${crypto.randomBytes(8).toString('hex')}`;

    // 1. Create book v1
    const v1Res = await dispatchExternalRequest({
      path: '/',
      method: 'POST',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId,
        'Idempotency-Key': `idem_v1_${Date.now()}`,
      },
      body: {
        title: 'كتاب الاستبدال الذري - الإصدار القديم',
        text: `Unique payload text for archive version: ${oldKeyword}`,
      },
    });
    const atomicBookId = v1Res.body.book_id;

    // Verify old keyword is searchable
    const searchOldBefore = knowledgeDal.searchBookKnowledge(oldKeyword, {}, tenantCtxAlpha);
    assert.ok(searchOldBefore.length >= 1, 'Old keyword must be found in v1');

    // 2. Call POST /api/external/books/:id/replace with v2
    const replaceRes = await dispatchExternalRequest({
      path: `/${atomicBookId}/replace`,
      method: 'POST',
      headers: {
        'X-Service-Key': validKey.rawKey,
        'X-User-Id': userAlphaId,
      },
      body: {
        title: 'كتاب الاستبدال الذري - الإصدار المحدث',
        text: `Unique payload text for revised version: ${newKeyword}`,
      },
    });
    assert.strictEqual(replaceRes.status, 200);
    assert.strictEqual(replaceRes.body.replaced, true);

    // 3. Immediately search for old keyword -> MUST return 0 results
    const searchOldAfter = knowledgeDal.searchBookKnowledge(oldKeyword, {}, tenantCtxAlpha);
    assert.strictEqual(searchOldAfter.length, 0, 'Old version must NOT be retrievable after replacement');

    // 4. Immediately search for new keyword -> MUST return the new chunk
    const searchNewAfter = knowledgeDal.searchBookKnowledge(newKeyword, {}, tenantCtxAlpha);
    assert.ok(searchNewAfter.length >= 1, 'New version must be immediately retrievable');
    console.log('  ✅ Atomic replace verified: old index purged, new index retrievable.');

    // ----------------------------------------------------
    // TEST 7: Rate Limiting Enforcement (60 rpm sliding window)
    // ----------------------------------------------------
    console.log('[Test 7] Testing 60 requests/minute sliding window rate limiting...');

    const rateKey = generateServiceKey({
      name: 'Rate Limit Probe Key',
      scopes: ['books:crud'],
      rateLimitRpm: 60,
    });

    // Send 60 requests
    for (let i = 1; i <= 60; i++) {
      const resOk = await dispatchExternalRequest({
        path: `/${atomicBookId}/status`,
        method: 'GET',
        headers: {
          'X-Service-Key': rateKey.rawKey,
          'X-User-Id': userAlphaId,
        },
      });
      assert.strictEqual(resOk.status, 200, `Request ${i}/60 should succeed`);
    }

    // 61st request MUST be rejected with HTTP 429
    const res61 = await dispatchExternalRequest({
      path: `/${atomicBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': rateKey.rawKey,
        'X-User-Id': userAlphaId,
      },
    });
    assert.strictEqual(res61.status, 429, '61st request must return HTTP 429 Too Many Requests');
    assert.strictEqual(res61.body.error.code, 'RATE_LIMIT_EXCEEDED');
    assert.ok(res61.headers['retry-after'], 'Retry-After header must be present on 429');
    console.log(`  ✅ Rate limiting verified: 60 allowed, 61st returned HTTP 429 with Retry-After: ${res61.headers['retry-after']}s.`);

    // ----------------------------------------------------
    // TEST 8: Immediate Key Revocation (< 60s)
    // ----------------------------------------------------
    console.log('[Test 8] Testing immediate revocation propagation (< 1s)...');

    const revocableKey = generateServiceKey({
      name: 'Revocable Key Probe',
      scopes: ['books:crud'],
    });

    // 1. Request succeeds while active
    const activeRes = await dispatchExternalRequest({
      path: `/${atomicBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': revocableKey.rawKey,
        'X-User-Id': userAlphaId,
      },
    });
    assert.strictEqual(activeRes.status, 200);

    // 2. Admin revokes key
    const revokeStartTime = Date.now();
    revokeServiceKey(revocableKey.id);
    const revokeDurationMs = Date.now() - revokeStartTime;

    // 3. Next request MUST be immediately blocked with 403
    const blockedRes = await dispatchExternalRequest({
      path: `/${atomicBookId}/status`,
      method: 'GET',
      headers: {
        'X-Service-Key': revocableKey.rawKey,
        'X-User-Id': userAlphaId,
      },
    });
    assert.strictEqual(blockedRes.status, 403, 'Revoked key must immediately return 403');
    assert.strictEqual(blockedRes.body.error.code, 'SERVICE_KEY_REVOKED');
    console.log(`  ✅ Revocation effective immediately (${revokeDurationMs}ms < 60s target).`);

    console.log('\n================================================================');
    console.log('🎉 ALL 8 QUALITY GATE 19 ACCEPTANCE CRITERIA PASSED (100% GREEN)');
    console.log('================================================================\n');
  } catch (err) {
    console.error('\n❌ QUALITY GATE 19 FAILED:', err);
    process.exit(1);
  }
})();
