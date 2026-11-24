/**
 * quickImageToolbarGate.test.cjs
 * Phase-1 Acceptance Gate A — Quick Image Toolbar Mini (official annex).
 *
 * Boots the real platform (mock image provider, temp DB, ephemeral port),
 * drives the dev-only harness page (/toolbar-harness.html) in headless
 * Chromium, and verifies the frozen Phase-1 scope:
 *
 *   - exactly 5 toolbar actions (controls toggle, variant, save preset, pin,
 *     download) in a collapsible floating bar;
 *   - the bar never occludes the image (bounding-box intersection = 0);
 *   - per-action debounce lock: rapid repeat clicks fire exactly once;
 *   - download offers original PNG + optimized WebP via native anchors;
 *   - 0 page reloads, 0 console errors, 0 page errors;
 *   - 0 bytes of mask/SAM/segment/inpaint resources requested.
 *
 * The full 10-layer toolbar (SAM, inpainting, outpainting, live text,
 * version tree, brand vault, 300 DPI export) is Phase 2+ reference material
 * and is intentionally absent here.
 *
 * Exit codes: 0 = all checks passed, 1 = gate failed, 2 = environment
 * prerequisite missing (honest UNVERIFIED — never a fake pass).
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const PORT = 4100 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
function findChromium() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const standard = [
    '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ].find((p) => fs.existsSync(p));
  if (standard) return standard;

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
const CHROMIUM = findChromium();

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
}

function loadChromium() {
  const candidates = ['playwright-core', 'playwright'];
  for (const mod of candidates) {
    try {
      // eslint-disable-next-line global-require
      return require(mod).chromium;
    } catch (_) { /* try next */ }
  }
  return null;
}

async function waitForServer(url, timeoutMs = 60000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch (_) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

(async () => {
  console.log('================================================================');
  console.log('PHASE-1 GATE A: QUICK IMAGE TOOLBAR MINI — BROWSER SUITE');
  console.log('================================================================');

  const chromium = loadChromium();
  if (!chromium || !CHROMIUM) {
    console.error('UNVERIFIED: playwright-core/playwright or a Chromium binary is not available.');
    process.exit(2);
  }

  const dbFile = path.join(os.tmpdir(), `toolbar_gate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.db`);
  const server = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      E2E_TEST_MODE: '1',
      WORKSPACE_AUTH_BYPASS: '1',
      IMAGE_PROVIDER_MOCK: '1',
      DB_PATH: dbFile,
      PORT: String(PORT),
      DISABLE_HMR: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const serverLog = [];
  server.stdout.on('data', (d) => serverLog.push(String(d)));
  server.stderr.on('data', (d) => serverLog.push(String(d)));

  let browser = null;
  try {
    const up = await waitForServer(`${BASE}/api/auth/me`);
    if (!up) throw new Error(`server did not start:\n${serverLog.join('').slice(-2000)}`);

    browser = await chromium.launch({
      executablePath: CHROMIUM,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });

    const consoleErrors = [];
    const pageErrors = [];
    const requests = [];
    let navigations = 0;
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    page.on('request', (r) => requests.push(r.url()));
    page.on('response', (r) => { if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url()}`); });
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) navigations += 1; });

    await page.goto(`${BASE}/toolbar-harness.html`, { waitUntil: 'networkidle' });
    navigations = 0; // count reloads only after the initial load

    await page.waitForSelector('[data-testid="canvas-empty"]', { timeout: 15000 });
    check('empty state renders before generation (no toolbar)', await page.locator('[data-testid="quick-image-toolbar"]').count() === 0);

    await page.click('[data-testid="generate-button"]');
    await page.waitForSelector('[data-testid="canvas-image"]', { timeout: 30000 });
    await page.waitForSelector('[data-testid="quick-image-toolbar"]', { timeout: 10000 });
    await page.waitForFunction(() => {
      const img = document.querySelector('[data-testid="canvas-image"]');
      return img && img.naturalWidth > 0;
    }, { timeout: 15000 });
    check('image generated and loaded (naturalWidth > 0)', true);

    const actionCount = await page.locator('[data-qtb-action="true"]').count();
    check('exactly 5 toolbar actions visible', actionCount === 5, `count=${actionCount}`);
    check('collapse handle present', await page.locator('[data-testid="qtb-collapse"]').count() === 1);

    const occlusion = await page.evaluate(() => {
      const tb = document.querySelector('[data-testid="quick-image-toolbar"]').getBoundingClientRect();
      const img = document.querySelector('[data-testid="canvas-image"]').getBoundingClientRect();
      const x = Math.max(0, Math.min(tb.right, img.right) - Math.max(tb.left, img.left));
      const y = Math.max(0, Math.min(tb.bottom, img.bottom) - Math.max(tb.top, img.top));
      return x * y;
    });
    check('toolbar never occludes the image (intersection = 0px)', occlusion === 0, `overlap=${occlusion}px^2`);

    await page.click('[data-testid="qtb-collapse"]');
    await page.waitForSelector('[data-testid="quick-image-toolbar"][data-collapsed="true"]');
    check('collapsed bar hides all 5 actions', await page.locator('[data-qtb-action="true"]').count() === 0);
    await page.click('[data-testid="qtb-collapse"]');
    await page.waitForSelector('[data-testid="quick-image-toolbar"][data-collapsed="false"]');
    check('expand restores the 5 actions', await page.locator('[data-qtb-action="true"]').count() === 5);

    const genBefore = requests.filter((u) => u.includes('/api/studio/generate')).length;
    for (let i = 0; i < 5; i += 1) { await page.click('[data-testid="qtb-variant"]', { force: true }); }
    await page.waitForTimeout(2500);
    const genAfter = requests.filter((u) => u.includes('/api/studio/generate')).length;
    check('debounce: 5 rapid variant clicks = 1 generate request', genAfter - genBefore === 1, `delta=${genAfter - genBefore}`);

    await page.waitForFunction(() => {
      const img = document.querySelector('[data-testid="canvas-image"]');
      return img && img.naturalWidth > 0;
    }, { timeout: 15000 });

    for (let i = 0; i < 4; i += 1) { await page.click('[data-testid="qtb-pin"]', { force: true }); }
    check('debounce: 4 rapid pin clicks = 1 toggle (pinned)', (await page.getAttribute('[data-testid="qtb-pin"]', 'aria-pressed')) === 'true');
    await page.waitForTimeout(600);
    await page.click('[data-testid="qtb-pin"]');
    check('distinct pin click after debounce window works', (await page.getAttribute('[data-testid="qtb-pin"]', 'aria-pressed')) === 'false');

    check('controls bar visible by default', await page.locator('[data-testid="controls-bar"]').count() === 1);
    await page.click('[data-testid="qtb-controls"]');
    check('controls toggle hides controls bar', await page.locator('[data-testid="controls-bar"]').count() === 0);
    await page.waitForTimeout(500);
    await page.click('[data-testid="qtb-controls"]');
    check('controls toggle restores controls bar', await page.locator('[data-testid="controls-bar"]').count() === 1);

    await page.click('[data-testid="qtb-pin"]');
    check('pin toggles aria-pressed=true', (await page.getAttribute('[data-testid="qtb-pin"]', 'aria-pressed')) === 'true');

    const presetBefore = requests.filter((u) => u.includes('/api/studio/presets/custom')).length;
    await page.click('[data-testid="qtb-save-preset"]');
    await page.waitForTimeout(60); // inside the 400ms debounce window
    await page.click('[data-testid="qtb-save-preset"]', { force: true }).catch(() => {});
    await page.waitForSelector('[data-testid="qtb-save-preset"][aria-label="Preset saved"]', { timeout: 10000 });
    const presetAfter = requests.filter((u) => u.includes('/api/studio/presets/custom')).length;
    check('save preset: double click = 1 POST + saved state', presetAfter - presetBefore === 1, `posts=${presetAfter - presetBefore}`);

    await page.click('[data-testid="qtb-download"]');
    await page.waitForSelector('[data-testid="qtb-download-menu"]');
    const pngHref = await page.getAttribute('[data-testid="qtb-download-png"]', 'href');
    const webpHref = await page.getAttribute('[data-testid="qtb-download-webp"]', 'href');
    check('download menu offers PNG original', /\/api\/studio\/assets\/[^/]+\/file$/.test(pngHref || ''), pngHref);
    check('download menu offers WebP optimized', /\/api\/studio\/assets\/[^/]+\/file\?format=webp$/.test(webpHref || ''), webpHref);
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 10000 }),
      page.click('[data-testid="qtb-download-webp"]'),
    ]);
    check('WebP download starts via native anchor (no navigation)', (await download.failure()) === null, download.suggestedFilename());

    const samRequests = requests.filter((u) => /sam|segment|mask|rembg|onnx|inpaint/i.test(u));
    check('0 requests for mask/SAM/segment/inpaint resources', samRequests.length === 0, samRequests.join(', ') || 'none');
    check('0 page reloads after initial load', navigations === 0, `navigations=${navigations}`);
    check('0 console errors', consoleErrors.length === 0, consoleErrors.join(' | ') || 'none');
    check('0 page errors', pageErrors.length === 0, pageErrors.join(' | ') || 'none');
  } finally {
    if (browser) await browser.close();
    server.kill('SIGTERM');
    for (const f of [dbFile, `${dbFile}-wal`, `${dbFile}-shm`]) {
      try { if (fs.existsSync(f)) fs.unlinkSync(f); } catch (_) { /* ignore */ }
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nQUICK IMAGE TOOLBAR GATE A: ${results.length - failed.length}/${results.length} PASSED`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('GATE ERROR', e); process.exit(1); });
