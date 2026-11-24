// ==============================================================================
// server_backend/tests/codeScanCompleteSuite.test.js
// Code Review & Security Scanner + AI Code Completion — 10 tests.
//
//   Proves: the scanner deterministically flags real vulnerability classes with
//   honest severity/score math, and the completion pipeline builds bounded FIM
//   prompts, sanitizes model output to raw code, and flows end-to-end through
//   the model router (mock provider) — never from canned snippets.
// ==============================================================================
'use strict';

const assert = require('node:assert');

process.env.LLM_PROVIDER = 'mock';

const { scanProject, scanFile, RULES } = require('../services/security/codeScanner');
const { buildCompletionMessages, sanitizeCompletion, MAX_PREFIX_CHARS, MAX_SUFFIX_CHARS } = require('../services/ai/codeCompletion');

let passed = 0;
let failed = 0;
const failures = [];

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push(name);
    console.error(`❌ ${name}: ${e.message}`);
  }
}

(async () => {
  // ---- Scanner -----------------------------------------------------------

  await test('1. eval() and new Function() flagged as critical', () => {
    const findings = scanFile({ path: '/app.js', name: 'app.js', language: 'javascript', content: 'const x = eval("1+1");\nglobalThis.f = new Function("return 2")();\n' });
    const crit = findings.filter((f) => f.severity === 'critical');
    assert.ok(crit.some((f) => f.ruleId === 'eval-call'), 'eval-call critical expected');
    assert.ok(crit.some((f) => f.ruleId === 'new-function'), 'new-function critical expected');
    assert.strictEqual(findings.find((f) => f.ruleId === 'eval-call').line, 1);
  });

  await test('2. hardcoded secrets and real key formats flagged critical', () => {
    const content = `const api_key = "abcdef1234567890abcd";\nconst k = "sk-abcdefghijklmnopqrstuvwxyz1234";\n`;
    const findings = scanFile({ path: '/cfg.js', name: 'cfg.js', language: 'javascript', content });
    assert.ok(findings.some((f) => f.ruleId === 'hardcoded-secret' && f.severity === 'critical'));
    assert.ok(findings.some((f) => f.ruleId === 'known-key-format' && f.severity === 'critical'));
  });

  await test('3. insecure http flagged, localhost and https ignored', () => {
    const content = `fetch("http://api.example.com/data");\nfetch("http://localhost:3000");\nfetch("https://secure.example.com");\n`;
    const findings = scanFile({ path: '/net.js', name: 'net.js', language: 'javascript', content });
    const http = findings.filter((f) => f.ruleId === 'insecure-http');
    assert.strictEqual(http.length, 1, `expected 1 insecure http finding, got ${http.length}`);
    assert.ok(http[0].snippet.includes('api.example.com'));
  });

  await test('4. clean file scores 100 grade A with zero findings', () => {
    const review = scanProject({ files: [{ path: '/ok.js', name: 'ok.js', language: 'javascript', content: 'export const add = (a, b) => a + b;\n' }] });
    assert.strictEqual(review.score, 100);
    assert.strictEqual(review.grade, 'A');
    assert.strictEqual(review.summary.total, 0);
    assert.strictEqual(review.summary.filesScanned, 1);
  });

  await test('5. language scoping: inline handlers only in HTML, eval only in JS/TS', () => {
    const html = scanFile({ path: '/p.html', name: 'p.html', language: 'html', content: '<button onclick="hack()">x</button>\n<script>eval("1")</script>\n' });
    assert.ok(html.some((f) => f.ruleId === 'inline-handler'), 'inline-handler expected in html');
    assert.ok(!html.some((f) => f.ruleId === 'eval-call'), 'eval rule must not fire for html language');
    const ts = scanFile({ path: '/c.ts', name: 'c.ts', language: 'typescript', content: 'eval("1")\n' });
    assert.ok(ts.some((f) => f.ruleId === 'eval-call'), 'eval rule must fire for typescript');
  });

  await test('6. score math, severity sort, and caps hold', () => {
    // 1 critical (eval) + many console.log (notice, capped at 5)
    const content = 'eval("x")\n' + Array.from({ length: 30 }, (_, i) => `console.log(${i});`).join('\n');
    const review = scanProject({ files: [{ path: '/a.js', name: 'a.js', language: 'javascript', content }] });
    const logs = review.findings.filter((f) => f.ruleId === 'console-log-left');
    assert.strictEqual(logs.length, 5, 'console.log findings must be capped at 5');
    assert.strictEqual(review.findings[0].severity, 'critical', 'critical findings sort first');
    // 100 - 20 (critical) - 5*2 (notices) = 70 → grade C
    assert.strictEqual(review.score, 70, `expected score 70, got ${review.score}`);
    assert.strictEqual(review.grade, 'C');
  });

  // ---- Completion ----------------------------------------------------------

  await test('7. FIM prompt bounds input and carries cursor marker + file context', () => {
    const prefix = 'x'.repeat(MAX_PREFIX_CHARS + 500);
    const suffix = 'y'.repeat(MAX_SUFFIX_CHARS + 500);
    const [sys, usr] = buildCompletionMessages({ path: '/index.html', language: 'html', prefix, suffix });
    assert.ok(sys.role === 'system' && sys.content.includes('ONLY raw code'), 'system must demand raw code');
    assert.ok(usr.content.includes('<CURSOR>'), 'cursor marker required');
    assert.ok(usr.content.includes('/index.html') && usr.content.includes('html'));
    const body = usr.content.split('```')[1]; // code block only (excludes the File: header line)
    const xCount = (body.match(/x/g) || []).length;
    const yCount = (body.match(/y/g) || []).length;
    assert.strictEqual(xCount, MAX_PREFIX_CHARS, `prefix must be bounded to ${MAX_PREFIX_CHARS}`);
    assert.strictEqual(yCount, MAX_SUFFIX_CHARS, `suffix must be bounded to ${MAX_SUFFIX_CHARS}`);
  });

  await test('8. sanitizer strips fences, prose, marker and caps length', () => {
    const fenced = '```html\n<section>قسم جديد</section>\n```';
    assert.strictEqual(sanitizeCompletion(fenced), '<section>قسم جديد</section>');
    const prosey = 'Here is the completion:\n<div>ok</div>';
    assert.strictEqual(sanitizeCompletion(prosey), '<div>ok</div>');
    assert.strictEqual(sanitizeCompletion('<CURSOR>'), '');
    const huge = 'a\n'.repeat(1000);
    const capped = sanitizeCompletion(huge);
    assert.ok(capped.length <= 600, `expected <=600 chars, got ${capped.length}`);
  });

  await test('9. sanitizer returns empty for blank/fence-only output', () => {
    assert.strictEqual(sanitizeCompletion(''), '');
    assert.strictEqual(sanitizeCompletion('   \n  '), '');
    assert.strictEqual(sanitizeCompletion('```js\n```'), '');
  });

  await test('10. end-to-end: coding model completion flows through router and is sanitized', async () => {
    const router = require('../services/ai/workspaceModelRouter');
    router._resetCache();
    router.setMockToolResponder(({ messages }) => {
      // The endpoint contract: system prompt demands raw code; user carries <CURSOR>.
      assert.ok(messages[0].content.includes('ONLY raw code'));
      assert.ok(messages[1].content.includes('<CURSOR>'));
      return { text: '```html\n<footer>تذييل</footer>\n```', toolCalls: [] };
    });
    const messages = buildCompletionMessages({ path: '/index.html', language: 'html', prefix: '<html><body>', suffix: '</body></html>' });
    const out = await router.chatWithTools({ messages, tools: [], maxTokens: 512 });
    const completion = sanitizeCompletion(out.text);
    assert.strictEqual(completion, '<footer>تذييل</footer>');
    assert.strictEqual(out.provider, 'mock');
    router.setMockToolResponder(null);
  });

  console.log('================================================================');
  console.log(passed === 10
    ? '🎉 CODE SCAN & COMPLETION SUITE — ALL 10 TESTS PASSED'
    : `⚠️ ${passed}/10 passed, ${failed} failed: ${failures.join(' | ')}`);
  console.log('================================================================');
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error('SUITE CRASH:', e);
  process.exit(1);
});
