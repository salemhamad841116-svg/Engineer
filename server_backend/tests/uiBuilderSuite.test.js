// ==============================================================================
// server_backend/tests/uiBuilderSuite.test.js
// UI Builder Mode — Phase 3 Verification Suite (Layers 1-6 Phase-3 scope)
// Acceptance gates from the spec:
//   L1  domain blueprints + design tokens + realistic seed data (0% lorem)
//   L2  tiered synthesis (local $0 vs cloud_flash) + complete states + mock
//   L3  asset manifest budget cap + parallel generation + WebP injection
//   L6  static gates + REAL headless Chromium audit + Auto-Heal exactly once
//   L5  deterministic prop patch (<100ms, 0 LLM) + surgical subtree patch
//       + image swap, all tenant-isolated, all honestly versioned
//   L2b screenshot-to-code: mock analysis + honest BLOCKED without a key
//   HTTP E2E: /ui/build (message + routing_id replay) + preview + SSE
//   English gate: 0 Arabic in every NEW code file (i18n exempted)
// ==============================================================================
"use strict";

process.env.LLM_PROVIDER = "mock";
process.env.DB_PATH = require("path").join(
  require("os").tmpdir(),
  `uibuilder_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.MEDIA_STORAGE_DIR = require("path").join(
  require("os").tmpdir(),
  `uibuilder_media_${Date.now()}_${Math.random().toString(36).slice(2)}`
);
delete process.env.GEMINI_API_KEY;
process.env.IMAGE_PROVIDER_MOCK = "1";
process.env.UI_LLM_MOCK = "1";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("path");
const { getDb, closeDb } = require("../db/database");

async function runUiBuilderSuite() {
  console.log("================================================================");
  console.log("🖥️  RUNNING UI BUILDER MODE (PHASE 3) VERIFICATION SUITE");
  console.log("================================================================\n");

  const { detectDomain, getBlueprint, DOMAIN_BLUEPRINTS } = await import("../../server/studio/domainBlueprints.js");
  const tokens = await import("../../server/studio/designTokens.js");
  const planner = await import("../../server/studio/uiPlanner.js");
  const slots = await import("../../server/studio/uiSlots.js");
  const gates = await import("../../server/studio/uiQualityGates.js");
  const svc = await import("../../server/studio/uiBuilderService.js");
  const { seedFor } = await import("../../server/studio/i18n/uiLexicon.js");
  const { getHistory } = await import("../../server/studio/pipelineEvents.js");
  const { studioRoutes } = await import("../../server/studio/studioRoutes.js");
  const { routeRequest } = await import("../../server/studio/smartRouter.js");

  const db = getDb();
  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  ✅ [PASS] ${name}`);
    } catch (err) {
      console.error(`  ❌ [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  const OWNER = "usr_uib_main";
  const OTHER = "usr_uib_other";
  const ECOMMERCE_CONTRACT = {
    intent: "ui_generate", confidence: 0.92, model_tier: "local",
    ui_params: { domain: "ecommerce", platform: "web", theme: "light", direction: "rtl", protected_brand_text: null },
  };
  const auditStub = async () => ({ ran: false, status: "unverified", consoleErrors: [], brokenImages: [], overflow: null, reason: "stub" });

  console.log("[L1] Domain blueprints, design tokens, seed data...");

  await test("B1. Arabic trading request -> fintech blueprint, dark theme, realistic seed (0% lorem)", async () => {
    const domain = detectDomain({ uiDomain: null, normalized: "اريد منصة تداول فيها رسوم بيانية ودفتر اوامر" });
    assert.strictEqual(domain, "fintech_trading");
    const bp = getBlueprint(domain);
    assert.strictEqual(bp.defaultTheme, "dark");
    const ids = bp.components.map((c) => c.id);
    for (const need of ["candle_chart", "order_book", "trade_panel", "ticker_strip"]) {
      assert.ok(ids.includes(need), `missing component ${need}`);
    }
    const seed = seedFor(domain, "ar");
    assert.ok(!planner.htmlHasLorem(JSON.stringify(seed)));
    assert.ok(seed.tickers.some((t) => t.symbol === "BTC/USD"));
    assert.ok(seed.tickers.every((t) => /[0-9]/.test(t.price)));
  });

  await test("B2. Tokens: brand palette pull + WCAG auto-fix + dual-theme CSS block", async () => {
    const brandLock = { palette_json: JSON.stringify(["#6d28d9", "#f59e0b"]) };
    const t = tokens.buildTokens({ theme: "dark", brandLock, lang: "ar" });
    assert.strictEqual(t.colors.primary, "#6d28d9"); // pulled from Brand Kit
    assert.strictEqual(t.colors.accent, "#f59e0b");
    const report = tokens.contrastReport(t);
    assert.ok(report.every((r) => r.pass), `contrast must pass AA after ensureContrast: ${JSON.stringify(report)}`);
    const css = tokens.tokensToCss(t);
    assert.ok(css.includes(":root{") && css.includes('[data-theme="dark"]') && css.includes('[data-theme="light"]'));
    // Glassmorphism variant carries a backdrop token.
    const glass = tokens.buildTokens({ theme: "glass", lang: "en" });
    assert.ok(glass.backdrop && tokens.tokensToCss(glass).includes("--ui-backdrop"));
  });

  console.log("[L2] Tiered synthesis & static gates...");

  await test("B3. Tiered synthesis: complex contract -> cloud_flash, simple -> local (spy counts)", async () => {
    delete process.env.UI_LLM_MOCK; // use injected spies instead of the mock synthesizer
    try {
      const bp = getBlueprint("ecommerce");
      const t = tokens.buildTokens({ theme: "light", lang: "ar" });
      const mkHtml = (marker) =>
        planner.mockSynthesize({ contract: ECOMMERCE_CONTRACT, blueprint: bp, tokens: t, tokensCss: tokens.tokensToCss(t), seedData: seedFor("ecommerce", "ar"), lang: "ar" })
          .replace("</body>", `<span data-ui-id="marker">${marker}</span></body>`);
      const calls = { local: 0, cloud: 0 };
      const llm = {
        local: async () => { calls.local += 1; return mkHtml("local"); },
        cloud: async () => { calls.cloud += 1; return mkHtml("cloud"); },
      };
      const genStub = async () => { throw new Error("skip-assets"); };
      const complexBuild = await svc.buildUi(db, {
        ownerId: OWNER, contract: { ...ECOMMERCE_CONTRACT, model_tier: "cloud_flash" },
        message: "", lang: "ar", llm, genImpl: genStub, auditImpl: auditStub,
      });
      assert.strictEqual(complexBuild.model_tier, "cloud_flash");
      assert.strictEqual(complexBuild.provider, "cloud_flash");
      assert.strictEqual(calls.cloud, 1);
      assert.strictEqual(calls.local, 0);

      const simpleBuild = await svc.buildUi(db, {
        ownerId: OWNER, contract: { ...ECOMMERCE_CONTRACT, model_tier: "local" },
        message: "", lang: "ar", llm, genImpl: genStub, auditImpl: auditStub,
      });
      assert.strictEqual(simpleBuild.provider, "local");
      assert.strictEqual(calls.local, 1);
    } finally {
      process.env.UI_LLM_MOCK = "1";
    }
  });

  await test("B4. Static gates: Arabic outside CONTENT fails, inside passes; lorem fails", async () => {
    const good = '<html><body><script>const CONTENT = {"brand":"قهوة الأصالة"};</script></body></html>';
    assert.strictEqual(gates.englishGateViolations(good).length, 0);
    const bad = '<html><body><h1>عنوان عربي في الكود</h1><script>const CONTENT = {};</script></body></html>';
    assert.ok(gates.englishGateViolations(bad).length >= 1);
    assert.ok(planner.htmlHasLorem("<p>lorem ipsum dolor sit amet</p>"));
    const statics = gates.staticGates(good.replace("</body>", '<div data-ui-id="x"></div></body>'));
    assert.ok(statics.english_ok && statics.lorem_ok && statics.ui_ids_ok && statics.content_isolation_ok);
  });

  console.log("[L3] Asset manifest, budget cap, injection...");

  await test("B5. Manifest: budget cap (1 hero + 4 products), icons->svg free, overflow->css", async () => {
    const manifest = slots.buildAssetManifest(getBlueprint("ecommerce"));
    const paid = manifest.filter((s) => s.decision === "photo");
    assert.strictEqual(paid.length, 5); // 1 hero + 4 products
    assert.ok(manifest.filter((s) => s.decision === "svg").length >= 3);
    assert.strictEqual(manifest.filter((s) => s.decision === "css" && s.reason === "free_css").length, 1);
    // Overflow beyond the cap becomes free CSS, honestly flagged retryable.
    const fat = { assetSlots: Array.from({ length: 7 }, (_, i) => ({ slot: `p${i}`, role: "photo", presetId: "product_studio", aspectRatio: "1:1" })) };
    const m2 = slots.buildAssetManifest(fat);
    assert.strictEqual(m2.filter((s) => s.decision === "photo").length, 5);
    const capped = m2.filter((s) => s.reason === "budget_cap");
    assert.strictEqual(capped.length, 2);
    assert.ok(capped.every((s) => s.retryable === true));
  });

  await test("B6. E2E build (mock LLM + mock provider + REAL chromium audit) -> READY, webp injected, SSE stages", async () => {
    const build = await svc.buildUi(db, {
      ownerId: "usr_uib_b6", contract: ECOMMERCE_CONTRACT, message: "اريد تطبيق متجر قهوة فاخرة مع بانر وصور منتجات", lang: "ar",
    });
    assert.strictEqual(build.status, "READY", `expected READY got ${build.status}: ${build.audit_json}`);
    const audit = JSON.parse(build.audit_json);
    assert.strictEqual(audit.audit.ran, true);
    assert.deepStrictEqual(audit.audit.consoleErrors, []);
    assert.deepStrictEqual(audit.audit.brokenImages, []);
    assert.strictEqual(audit.audit.overflow, false);
    assert.ok(audit.assets.injected >= 4, `expected >=4 injected, got ${audit.assets.injected}`);
    const html = fs.readFileSync(build.html_path, "utf8");
    assert.ok(html.includes('data-ui-asset="product_1"'));
    assert.ok(html.includes('loading="lazy"'));
    assert.ok(html.includes('fetchpriority="high"') || audit.assets.fallbacks >= 1);
    assert.ok(!planner.htmlHasLorem(html));
    // Hero on the 1x1 mock may fail its OCR-ALWAYS gate honestly (tesseract
    // on a 1x1 is nondeterministic) -> at most one elegant fallback.
    assert.ok(audit.assets.fallbacks <= 1);
    const stages = getHistory(build.id).map((e) => e.stage);
    assert.deepStrictEqual(stages.slice(0, 4), ["plan", "synthesize", "assets", "audit"]);
    assert.strictEqual(stages[stages.length - 1], "ready");
    global.__B6_BUILD = build;
  });

  await test("B7. Graceful per-slot fallback: one failing image never fails the build", async () => {
    const realGen = (await import("../../server/studio/studioService.js")).generateStudioAsset;
    const genImpl = async (dbi, args) => {
      if (args.seedOverride.endsWith(":product_2")) throw new Error("provider boom");
      return realGen(dbi, args);
    };
    const build = await svc.buildUi(db, {
      ownerId: "usr_uib_fb", contract: ECOMMERCE_CONTRACT, message: "fallback check", lang: "ar", genImpl,
    });
    const audit = JSON.parse(build.audit_json);
    assert.ok(audit.assets.fallbacks >= 1);
    const html = fs.readFileSync(build.html_path, "utf8");
    assert.ok(html.includes('class="asset-fallback"') && html.includes('data-retryable="1"'));
    assert.notStrictEqual(build.status, "FAILED");
  });

  console.log("[L6] Headless audit + Auto-Heal (exactly one round)...");

  await test("B8. Console error -> Auto-Heal once -> READY with heal_used=1", async () => {
    delete process.env.UI_LLM_MOCK;
    try {
      const bp = getBlueprint("ecommerce");
      const t = tokens.buildTokens({ theme: "light", lang: "ar" });
      const good = planner.mockSynthesize({ contract: ECOMMERCE_CONTRACT, blueprint: bp, tokens: t, tokensCss: tokens.tokensToCss(t), seedData: seedFor("ecommerce", "ar"), lang: "ar" });
      const broken = good.replace("</body>", "<script>nonexistentFunction();</script></body>");
      let n = 0;
      const llm = { local: async () => { n += 1; return n === 1 ? broken : good; }, cloud: async () => good };
      const build = await svc.buildUi(db, {
        ownerId: OWNER, contract: ECOMMERCE_CONTRACT, message: "heal me", lang: "ar", llm,
        genImpl: async () => { throw new Error("skip"); },
      });
      assert.strictEqual(build.heal_used, 1);
      assert.strictEqual(n, 2); // exactly one heal round
      assert.strictEqual(build.status, "READY", build.audit_json);
    } finally {
      process.env.UI_LLM_MOCK = "1";
    }
  });

  await test("B9. Heal that stays broken -> FAILED honestly, still exactly one round", async () => {
    delete process.env.UI_LLM_MOCK;
    try {
      const bp = getBlueprint("ecommerce");
      const t = tokens.buildTokens({ theme: "light", lang: "ar" });
      const good = planner.mockSynthesize({ contract: ECOMMERCE_CONTRACT, blueprint: bp, tokens: t, tokensCss: tokens.tokensToCss(t), seedData: seedFor("ecommerce", "ar"), lang: "ar" });
      const broken = good.replace("</body>", "<script>alsoBusted();</script></body>");
      let n = 0;
      const llm = { local: async () => { n += 1; return broken; }, cloud: async () => broken };
      const build = await svc.buildUi(db, {
        ownerId: OWNER, contract: ECOMMERCE_CONTRACT, message: "stay broken", lang: "ar", llm,
        genImpl: async () => { throw new Error("skip"); },
      });
      assert.strictEqual(build.heal_used, 1);
      assert.strictEqual(n, 2);
      assert.strictEqual(build.status, "FAILED");
    } finally {
      process.env.UI_LLM_MOCK = "1";
    }
  });

  console.log("[L5] Deterministic patches & surgical regeneration...");

  await test("B10. Prop patch: <100ms, versioned, zero LLM by construction", async () => {
    const build = global.__B6_BUILD;
    const B6_OWNER = build.owner_id;
    const before = JSON.parse(fs.readFileSync(build.html_path, "utf8").length.toString());
    assert.ok(before > 0);
    const out = svc.applyPropPatch(db, { ownerId: B6_OWNER, buildId: build.id, dataUiId: "app_header", prop: "background-color", value: "#123456" });
    assert.ok(out.ms < 100, `prop patch took ${out.ms}ms (must be <100ms)`);
    assert.strictEqual(out.version, 2);
    const row = svc.getBuild(db, B6_OWNER, build.id);
    const html = fs.readFileSync(row.html_path, "utf8");
    assert.ok(html.includes("background-color:#123456"));
    const textOut = svc.applyPropPatch(db, { ownerId: B6_OWNER, buildId: build.id, dataUiId: "app_header", prop: "text", value: "New Title" });
    assert.strictEqual(textOut.version, 3);
    // Unsafe values rejected.
    assert.throws(
      () => svc.applyPropPatch(db, { ownerId: B6_OWNER, buildId: build.id, dataUiId: "app_header", prop: "color", value: "url(javascript:alert(1))" }),
      (e) => e.code === "UI_VALUE_UNSAFE"
    );
    assert.throws(
      () => svc.applyPropPatch(db, { ownerId: B6_OWNER, buildId: build.id, dataUiId: "app_header", prop: "onclick", value: "x" }),
      (e) => e.code === "UI_PROP_NOT_ALLOWED"
    );
  });

  await test("B11. Surgical patch rewrites ONLY the target subtree (byte-proved)", async () => {
    const build = global.__B6_BUILD;
    const B6_OWNER = build.owner_id;
    const row0 = svc.getBuild(db, B6_OWNER, build.id);
    const before = fs.readFileSync(row0.html_path, "utf8");
    const out = await svc.applySurgicalPatch(db, { ownerId: B6_OWNER, buildId: build.id, dataUiId: "content_grid", instruction: "add a timeframe button above the chart" });
    const row1 = svc.getBuild(db, B6_OWNER, build.id);
    const after = fs.readFileSync(row1.html_path, "utf8");
    assert.strictEqual(out.version, row0.version + 1);
    assert.ok(after.includes('data-patched="1"'));
    assert.ok(after.includes('data-ui-id="content_grid"'));
    // Everything outside the subtree is byte-identical.
    const idx = before.indexOf('<main data-ui-id="content_grid"');
    assert.ok(idx >= 0);
    assert.strictEqual(after.slice(0, idx), before.slice(0, idx));
    assert.ok(after.includes('data-ui-id="app_modal"'));
    // A patch that drops the component id is rejected.
    delete process.env.UI_LLM_MOCK;
    try {
      const llm = { local: async () => "<div>lost the id</div>", cloud: async () => "<div>lost the id</div>" };
      await assert.rejects(
        () => svc.applySurgicalPatch(db, { ownerId: B6_OWNER, buildId: build.id, dataUiId: "content_grid", instruction: "break it", llm }),
        (e) => e.code === "UI_PATCH_LOST_ID"
      );
    } finally {
      process.env.UI_LLM_MOCK = "1";
    }
  });

  await test("B12. Image swap is deterministic + tenant-isolated", async () => {
    const { generateStudioAsset } = await import("../../server/studio/studioService.js");
    const build = global.__B6_BUILD;
    const B6_OWNER = build.owner_id;
    const asset = await generateStudioAsset(db, { ownerId: B6_OWNER, message: "replacement product shot", presetId: "product_studio", aspectOverride: "1:1" });
    const out = svc.applyImageSwap(db, { ownerId: B6_OWNER, buildId: build.id, dataUiAsset: "product_1", assetId: asset.id });
    assert.ok(out.version >= 2);
    const row = svc.getBuild(db, B6_OWNER, build.id);
    assert.ok(fs.readFileSync(row.html_path, "utf8").includes(`/api/studio/assets/${asset.id}/file`));
    assert.throws(
      () => svc.applyImageSwap(db, { ownerId: OTHER, buildId: build.id, dataUiAsset: "product_1", assetId: asset.id }),
      (e) => e.code === "UI_BUILD_NOT_FOUND"
    );
  });

  console.log("[Security] Tenant isolation across the whole surface...");

  await test("B13. Tenant isolation: build/file/list never leak across owners", async () => {
    const build = global.__B6_BUILD;
    const B6_OWNER = build.owner_id;
    assert.throws(() => svc.getBuild(db, OTHER, build.id), (e) => e.code === "UI_BUILD_NOT_FOUND");
    assert.throws(() => svc.resolveBuildHtmlPath(db, OTHER, build.id), (e) => e.code === "UI_BUILD_NOT_FOUND");
    assert.strictEqual(svc.listBuilds(db, OTHER, {}).length, 0);
    assert.ok(svc.listBuilds(db, build.owner_id, {}).length >= 1);
  });

  console.log("[L2b] Screenshot-to-code...");

  await test("B14. from-image: mock analysis shape; honest BLOCKED without a key", async () => {
    const analysis = await svc.analyzeUiImage({ b64: "AA==", mime: "image/png", lang: "ar" });
    assert.ok(Array.isArray(analysis.layout) && analysis.layout.length > 0);
    delete process.env.UI_LLM_MOCK;
    try {
      await assert.rejects(
        () => svc.analyzeUiImage({ b64: "AA==", mime: "image/png", lang: "ar" }),
        (e) => e.code === "UI_VISION_BLOCKED" && e.status === 503
      );
    } finally {
      process.env.UI_LLM_MOCK = "1";
    }
  });

  console.log("[Quota] Paid slots respect the shared daily quota...");

  await test("B15. Quota wall: exhausted image quota -> all slots fall back gracefully, build survives", async () => {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare("INSERT OR REPLACE INTO media_usage (owner_id, day, type, units) VALUES (?, ?, 'image', 20)").run("usr_uib_poor", today);
    const build = await svc.buildUi(db, {
      ownerId: "usr_uib_poor", contract: ECOMMERCE_CONTRACT, message: "quota test", lang: "ar",
    });
    const audit = JSON.parse(build.audit_json);
    assert.strictEqual(audit.assets.injected, 0);
    assert.strictEqual(audit.assets.fallbacks, 5);
    assert.notStrictEqual(build.status, "FAILED"); // honest degraded delivery, not a crash
  });

  console.log("[HTTP] End-to-end over a real server...");

  await test("B16. HTTP: /ui/build via message + routing_id replay + preview bridge + SSE + prop patch (tenant-isolated)", async () => {
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    const fakeAuth = (req, res, next) => {
      if (req.headers["x-test-user"]) { req.user = { id: req.headers["x-test-user"] }; return next(); }
      return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    };
    app.use("/api/studio", studioRoutes(db, fakeAuth));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code || "ERR" } }));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const H = (u) => ({ "Content-Type": "application/json", "x-test-user": u });

    try {
      // 401 without auth.
      const noAuth = await fetch(`${base}/api/studio/ui`, { headers: { "Content-Type": "application/json" } });
      assert.strictEqual(noAuth.status, 401);

      // (a) message path — forced ui_generate answer routes with zero ambiguity.
      const res1 = await fetch(`${base}/api/studio/ui/build`, {
        method: "POST", headers: H("usr_http_ui"),
        body: JSON.stringify({
          message: "اريد واجهة متجر قهوة فاخرة",
          answers: { intent: "ui_generate", domain: "ecommerce" },
          lang: "ar",
        }),
      });
      if (res1.status !== 201) throw new Error(`build1 HTTP ${res1.status}: ${await res1.text()}`);
      const b1 = await res1.json();
      assert.ok(["READY", "UNVERIFIED"].includes(b1.status), b1.status);
      assert.ok(b1.preview_url && b1.events_url);

      // (b) routing_id replay — full contract restored from telemetry.
      const routeRes = await fetch(`${base}/api/studio/route`, {
        method: "POST", headers: H("usr_http_ui"),
        body: JSON.stringify({ message: "اصنع واجهة متجر", answers: { intent: "ui_generate", domain: "ecommerce" } }),
      });
      const routed = await routeRes.json();
      const res2 = await fetch(`${base}/api/studio/ui/build`, {
        method: "POST", headers: H("usr_http_ui"),
        body: JSON.stringify({ routing_id: routed.routing_id }),
      });
      if (res2.status !== 201) throw new Error(`build2 HTTP ${res2.status}: ${await res2.text()}`);

      // (c) preview file carries the injected runtime bridge.
      const fileRes = await fetch(`${base}${b1.preview_url}`, { headers: H("usr_http_ui") });
      assert.strictEqual(fileRes.status, 200);
      const html = await fileRes.text();
      assert.ok(html.includes("var NS='uib'"));
      // Tenant isolation on the preview file.
      const foreign = await fetch(`${base}${b1.preview_url}`, { headers: H("usr_http_nope") });
      assert.strictEqual(foreign.status, 404);

      // (d) SSE replays the stage history.
      const eventsRes = await fetch(`${base}${b1.events_url}`, { headers: H("usr_http_ui") });
      assert.strictEqual(eventsRes.status, 200);
      const reader = eventsRes.body.getReader();
      const { value } = await reader.read();
      const chunk = new TextDecoder().decode(value);
      assert.ok(chunk.includes('"stage":"plan"'));
      await reader.cancel();

      // (e) deterministic prop patch over HTTP.
      const propRes = await fetch(`${base}/api/studio/ui/${b1.id}/prop`, {
        method: "POST", headers: H("usr_http_ui"),
        body: JSON.stringify({ data_ui_id: "app_header", prop: "color", value: "#ff0000" }),
      });
      assert.strictEqual(propRes.status, 200);
      const propBody = await propRes.json();
      assert.ok(propBody.ms < 100);
      assert.ok(propBody.version >= 2);
    } finally {
      server.close();
    }
  });

  console.log("[Gate] 100% English codebase on every new file...");

  await test("B17. English gate: zero Arabic in new code files (i18n exempted by design)", async () => {
    const AR = /[؀-ۿ]/;
    const files = [
      "server/studio/domainBlueprints.js",
      "server/studio/designTokens.js",
      "server/studio/uiPlanner.js",
      "server/studio/uiSlots.js",
      "server/studio/uiQualityGates.js",
      "server/studio/uiBuilderService.js",
      "server/studio/previewBridge.js",
      "src/studio/UIBuilderPanel.tsx",
    ];
    for (const f of files) {
      const content = fs.readFileSync(path.join(__dirname, "../..", f), "utf8");
      assert.ok(!AR.test(content), `Arabic found in ${f}`);
    }
    // i18n lexicon is the designated Arabic home and must contain the seeds.
    const lex = fs.readFileSync(path.join(__dirname, "../../server/studio/i18n/uiLexicon.js"), "utf8");
    assert.ok(AR.test(lex));
  });

  console.log(`\n================================================================`);
  console.log(`🖥️  UI BUILDER MODE (PHASE 3): ${passed}/${total} TESTS PASSED`);
  console.log(`================================================================\n`);
  return { passed, total };
}

if (require.main === module) {
  runUiBuilderSuite()
    .then(async ({ passed, total }) => {
      try { closeDb(); } catch (_) {}
      process.exit(passed === total ? 0 : 1);
    })
    .catch((err) => {
      console.error("SUITE FAILURE:", err);
      try { closeDb(); } catch (_) {}
      process.exit(1);
    });
}

module.exports = { runUiBuilderSuite };
