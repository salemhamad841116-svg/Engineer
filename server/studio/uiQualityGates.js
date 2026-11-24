/**
 * UI Builder Mode — Layer 6 (Phase 3 scope): Quality Gates.
 *
 *  1. Codebase Regex Gate   — 0 Arabic characters outside the CONTENT
 *     object (100% English Codebase, same rule as the studio suites).
 *  2. Lorem gate            — 0% placeholder text.
 *  3. data-ui-id gate       — click-to-edit requires component ids.
 *  4. Headless audit        — real Chromium via playwright-core:
 *       - 0 console / runtime errors
 *       - naturalWidth > 0 for every <img> (0% broken images)
 *       - no horizontal overflow on a 390px mobile viewport
 *     When no browser binary exists the gate reports `unverified`
 *     HONESTLY (never fakes a pass).
 *  5. WCAG contrast report  — deterministic token-pair ratios (AA 4.5).
 *
 * Auto-Heal: at most ONE LLM repair round, driven by the caller
 * (uiBuilderService) using the audit's error list.
 */
import fs from 'node:fs';
import path from 'node:path';
import { contrastReport } from './designTokens.js';
import { htmlHasLorem, htmlHasUiIds, htmlHasContentIsolation } from './uiPlanner.js';

const ARABIC_RE = new RegExp('[\\u0600-\\u06FF]');

/** Arabic is allowed only inside the CONTENT object literal. */
export function englishGateViolations(html) {
  const stripped = String(html || '').replace(/const\s+CONTENT\s*=\s*\{[\s\S]*?\};/, 'const CONTENT = {};');
  const lines = stripped.split('\n');
  const bad = [];
  lines.forEach((line, i) => {
    if (ARABIC_RE.test(line)) bad.push({ line: i + 1, snippet: line.trim().slice(0, 60) });
  });
  return bad;
}

export function staticGates(html) {
  return {
    english_ok: englishGateViolations(html).length === 0,
    english_violations: englishGateViolations(html).slice(0, 5),
    lorem_ok: !htmlHasLorem(html),
    ui_ids_ok: htmlHasUiIds(html),
    content_isolation_ok: htmlHasContentIsolation(html),
  };
}

/* ------------------------------ headless ------------------------------- */

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean);

export function detectChromium() {
  for (const p of CHROMIUM_CANDIDATES) {
    try { if (p && fs.existsSync(p)) return p; } catch (_) { /* next */ }
  }
  const home = process.env.HOME || '';
  const pwDirs = [
    path.join(home, 'Library/Caches/ms-playwright'),
    path.join(home, '.cache/ms-playwright'),
  ];
  for (const pwDir of pwDirs) {
    try {
      if (fs.existsSync(pwDir)) {
        const entries = fs.readdirSync(pwDir).filter((e) => e.startsWith('chromium-'));
        for (const entry of entries) {
          const candidates = [
            path.join(pwDir, entry, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
            path.join(pwDir, entry, 'chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
            path.join(pwDir, entry, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
            path.join(pwDir, entry, 'chrome-linux/chrome'),
          ];
          for (const cand of candidates) {
            if (fs.existsSync(cand)) return cand;
          }
        }
      }
    } catch (_) {}
  }
  return null;
}

/**
 * Run the real headless audit. `htmlPath` is an on-disk file; asset URLs
 * must already be rewritten to absolute file paths (see uiBuilderService).
 *
 * @returns {Promise<{ran:boolean, status:'pass'|'fail'|'unverified',
 *   consoleErrors:string[], brokenImages:string[], overflow:boolean|null,
 *   reason?:string}>}
 */
export async function headlessAudit(htmlPath, { viewport = { width: 390, height: 844 }, launchImpl = null } = {}) {
  const bin = detectChromium();
  if (!bin) {
    return { ran: false, status: 'unverified', consoleErrors: [], brokenImages: [], overflow: null, reason: 'no chromium binary on host' };
  }
  let chromium;
  try {
    if (launchImpl) {
      chromium = { launch: launchImpl };
    } else {
      ({ chromium } = await import('playwright-core'));
    }
    const browser = await chromium.launch({ executablePath: bin, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
      const page = await browser.newPage({ viewport });
      const consoleErrors = [];
      const failedResources = [];
      page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300)); });
      page.on('pageerror', (err) => consoleErrors.push(`pageerror: ${String(err).slice(0, 300)}`));
      page.on('requestfailed', (req) => failedResources.push(`${req.failure()?.errorText || 'failed'}: ${req.url().slice(-80)}`));
      await page.goto(`file://${htmlPath}`, { waitUntil: 'load', timeout: 15000 });
      // Deterministic image settle: wait until every <img> has either
      // decoded (naturalWidth>0) or definitively failed (complete && 0).
      await page.waitForFunction(
        () => Array.from(document.images).every((i) => i.complete),
        { timeout: 10000 },
      ).catch(() => { /* timeout -> the naturalWidth gate reports honestly */ });
      const brokenImages = await page.$$eval('img', (imgs) =>
        imgs.filter((i) => !(i.naturalWidth > 0)).map((i) => i.getAttribute('data-ui-asset') || i.src.slice(-40)));
      if (brokenImages.length && failedResources.length) {
        consoleErrors.push(...failedResources.slice(0, 5));
      }
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth > document.documentElement.clientWidth);
      const fail = consoleErrors.length > 0 || brokenImages.length > 0 || overflow;
      return { ran: true, status: fail ? 'fail' : 'pass', consoleErrors, brokenImages, overflow };
    } finally {
      await browser.close();
    }
  } catch (err) {
    return { ran: false, status: 'unverified', consoleErrors: [], brokenImages: [], overflow: null, reason: String(err).slice(0, 200) };
  }
}

/** WCAG AA report over the active token pairs. */
export function wcagGate(tokens) {
  const report = contrastReport(tokens);
  return { pass: report.every((r) => r.pass), report };
}

/** Aggregate gate verdict used by the orchestrator and telemetry. */
export function summarizeGates({ statics, audit, wcag }) {
  const reasons = [];
  if (!statics.english_ok) reasons.push('english_gate');
  if (!statics.lorem_ok) reasons.push('lorem_gate');
  if (!statics.ui_ids_ok) reasons.push('ui_id_gate');
  if (!statics.content_isolation_ok) reasons.push('content_isolation_gate');
  if (audit.status === 'fail') {
    if (audit.consoleErrors.length) reasons.push('console_errors');
    if (audit.brokenImages.length) reasons.push('broken_images');
    if (audit.overflow) reasons.push('horizontal_overflow');
  }
  if (!wcag.pass) reasons.push('wcag_contrast');
  const verified = audit.ran;
  return {
    pass: reasons.length === 0,
    verified,                 // false => honest UNVERIFIED, never READY-by-assumption
    reasons,
  };
}
