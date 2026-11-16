// ==============================================================================
// server_backend/services/agent/previewRunner.js
// Real runtime verification of a compiled preview document.
//   * Browser mode: headless Chromium (playwright-core) with ALL network requests blocked,
//     captures page errors / console errors and executes agent-declared interaction checks.
//   * Static mode (Chromium not installed): JS syntax check + id-existence checks only, and
//     the result is explicitly labelled mode:"static-only" — never reported as browser-tested.
// ==============================================================================
'use strict';

let browserPromise = null;
let idleTimer = null;
let chromiumUnavailableReason = null;

function loadPlaywright() {
  try {
    // eslint-disable-next-line global-require
    return require('playwright-core');
  } catch (_) {
    try {
      // eslint-disable-next-line global-require
      return require('playwright');
    } catch (e) {
      return null;
    }
  }
}

async function getBrowser() {
  if (process.env.PREVIEW_RUNNER_MODE === 'static') return null;
  if (chromiumUnavailableReason) return null;
  if (!browserPromise) {
    const pw = loadPlaywright();
    if (!pw || !pw.chromium) {
      chromiumUnavailableReason = 'playwright-core is not installed';
      return null;
    }
    browserPromise = pw.chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }).catch((e) => {
      chromiumUnavailableReason = String((e && e.message) || e).split('\n')[0].slice(0, 200);
      browserPromise = null;
      return null;
    });
  }
  const b = await browserPromise;
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    closeBrowser().catch(() => {});
  }, 120000);
  if (idleTimer.unref) idleTimer.unref();
  return b;
}

async function closeBrowser() {
  const p = browserPromise;
  browserPromise = null;
  if (p) {
    const b = await p;
    if (b) await b.close().catch(() => {});
  }
}

function extractInlineScripts(doc) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(doc))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
    if (type && !/^(text\/javascript|application\/javascript)$/i.test(type[1])) continue;
    out.push(m[2] || '');
  }
  return out;
}

function staticSyntaxIssues(doc) {
  const issues = [];
  extractInlineScripts(doc).forEach((src, i) => {
    if (!src.trim()) return;
    try {
      // eslint-disable-next-line no-new-func
      new Function(src);
    } catch (e) {
      issues.push(`script #${i}: ${e.name}: ${e.message}`);
    }
  });
  return issues;
}

function describeCheck(c) {
  return `${c.action}${c.selector ? ` ${c.selector}` : ''}${c.value != null ? ` = "${String(c.value).slice(0, 40)}"` : ''}${c.text != null ? ` ~ "${String(c.text).slice(0, 40)}"` : ''}${c.min != null ? ` ≥ ${c.min}` : ''}`;
}

async function runStatic(html, checks, reason) {
  const syntax = staticSyntaxIssues(html);
  const results = checks.map((c) => {
    if (c.action === 'exists' && /^#[A-Za-z][\w-]*$/.test(c.selector || '')) {
      const id = c.selector.slice(1);
      const found = new RegExp(`\\bid=["']${id}["']`).test(html);
      return { check: describeCheck(c), passed: found, detail: found ? 'id present in markup (static)' : 'id not found in markup' };
    }
    return { check: describeCheck(c), passed: null, detail: 'skipped: needs a browser' };
  });
  const failed = results.filter((r) => r.passed === false).length + syntax.length;
  return {
    mode: 'static-only',
    browserUnavailableReason: reason,
    passed: failed === 0,
    pageErrors: syntax,
    consoleErrors: [],
    results,
    summary: `${results.filter((r) => r.passed === true).length} passed, ${failed} failed, ${results.filter((r) => r.passed === null).length} skipped (static analysis only — not executed in a browser)`,
  };
}

/**
 * @param {string} html compiled preview document
 * @param {Array<{action:string, selector?:string, value?:string, text?:string, min?:number, key?:string}>} checks
 * @param {{timeoutMs?: number}} [opts]
 */
async function runPreviewChecks(html, checks = [], opts = {}) {
  const timeoutMs = opts.timeoutMs || 20000;
  const browser = await getBrowser();
  if (!browser) return runStatic(html, checks, chromiumUnavailableReason || 'browser disabled');

  const context = await browser.newContext({ javaScriptEnabled: true, viewport: { width: 1280, height: 860 }, offline: true });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(String((e && e.message) || e).slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 300));
  });
  // Block every network request: generated apps must be self-contained.
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('data:') || url.startsWith('about:')) return route.continue();
    return route.abort();
  });
  const results = [];
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: timeoutMs });
    await page.waitForTimeout(250);
    const bodyText = (await page.evaluate(() => (document.body ? document.body.innerText : ''))).trim();
    results.push({ check: 'page renders visible content', passed: bodyText.length > 0, detail: bodyText ? `${bodyText.length} chars visible` : 'body is empty' });

    for (const c of checks) {
      const label = describeCheck(c);
      try {
        const loc = c.selector ? page.locator(c.selector).first() : null;
        if (c.action === 'exists') {
          const n = await page.locator(c.selector).count();
          results.push({ check: label, passed: n > 0, detail: `${n} match(es)` });
        } else if (c.action === 'click') {
          await loc.click({ timeout: 3000 });
          await page.waitForTimeout(150);
          results.push({ check: label, passed: true, detail: 'clicked' });
        } else if (c.action === 'fill') {
          await loc.fill(String(c.value ?? ''), { timeout: 3000 });
          results.push({ check: label, passed: true, detail: 'filled' });
        } else if (c.action === 'press') {
          await loc.press(String(c.key || 'Enter'), { timeout: 3000 });
          await page.waitForTimeout(150);
          results.push({ check: label, passed: true, detail: 'pressed' });
        } else if (c.action === 'select') {
          await loc.selectOption(String(c.value ?? ''), { timeout: 3000 });
          results.push({ check: label, passed: true, detail: 'selected' });
        } else if (c.action === 'expect_text') {
          const target = c.selector ? page.locator(c.selector) : page.locator('body');
          const texts = await target.allInnerTexts();
          const joined = texts.join('\n');
          const ok = joined.includes(String(c.text ?? ''));
          results.push({ check: label, passed: ok, detail: ok ? 'text found' : `text not found in: "${joined.slice(0, 120)}"` });
        } else if (c.action === 'expect_count') {
          const n = await page.locator(c.selector).count();
          const ok = n >= Number(c.min ?? 1);
          results.push({ check: label, passed: ok, detail: `${n} element(s)` });
        } else if (c.action === 'reload_persists') {
          // Re-render the same document with the captured storage to prove persistence.
          const snapshot = await page.evaluate(() => {
            const o = {};
            try {
              for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                o[k] = localStorage.getItem(k);
              }
            } catch (_) {
              /* ignore */
            }
            return o;
          });
          const seeded = html.replace(/var local = makeStore\((\{[\s\S]*?\}), 'local'\);/, () => `var local = makeStore(${JSON.stringify(snapshot).replace(/</g, '\\u003c')}, 'local');`);
          await page.setContent(seeded, { waitUntil: 'load', timeout: timeoutMs });
          await page.waitForTimeout(200);
          const joined = (await page.locator(c.selector || 'body').allInnerTexts()).join('\n');
          const ok = c.text == null ? Object.keys(snapshot).length > 0 : joined.includes(String(c.text));
          results.push({ check: label, passed: ok, detail: ok ? 'state survived reload' : 'state lost after reload' });
        } else {
          results.push({ check: label, passed: false, detail: `unknown action ${c.action}` });
        }
      } catch (e) {
        results.push({ check: label, passed: false, detail: String((e && e.message) || e).split('\n')[0].slice(0, 200) });
      }
    }
  } catch (e) {
    pageErrors.push(`load failed: ${String((e && e.message) || e).split('\n')[0].slice(0, 200)}`);
  } finally {
    await context.close().catch(() => {});
  }
  const failed = results.filter((r) => !r.passed).length + pageErrors.length;
  return {
    mode: 'browser',
    passed: failed === 0,
    pageErrors: pageErrors.slice(0, 10),
    consoleErrors: consoleErrors.slice(0, 10),
    results,
    summary: `${results.filter((r) => r.passed).length} passed, ${failed} failed (headless Chromium, network blocked)`,
  };
}

module.exports = { runPreviewChecks, closeBrowser, staticSyntaxIssues };
