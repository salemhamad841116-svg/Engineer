// ==============================================================================
// server_backend/tests/smartRouterSuite.test.js
// Smart Intent Router (7 Layers) Verification Suite
// Acceptance gates from the spec:
//   1. 100% English codebase (Arabic only in i18n lexicon + fixtures)
//   2. Fast-Path: mask / click-to-edit / direct command < 10ms, ZERO LLM calls
//   3. Brand protection + Arabic typo correction in the routed contract
//   4. Follow-up context: 2nd turn routes to image_edit / ui_edit at $0
//   5. Ambiguity gate: 0.50-0.79 -> quick options, ZERO paid calls
//   6. Fallback & telemetry: broken local JSON -> retry -> cloud_flash, full row
// ==============================================================================
"use strict";

process.env.LLM_PROVIDER = "mock";
process.env.DB_PATH = require("path").join(
  require("os").tmpdir(),
  `smartrouter_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.MEDIA_STORAGE_DIR = require("path").join(
  require("os").tmpdir(),
  `smartrouter_media_${Date.now()}_${Math.random().toString(36).slice(2)}`
);
delete process.env.GEMINI_API_KEY;
process.env.IMAGE_PROVIDER_MOCK = "1";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { getDb, closeDb } = require("../db/database");
const FX = require("./fixtures/routerFixtures.cjs");

async function runSmartRouterSuite() {
  console.log("================================================================");
  console.log("🧭 RUNNING SMART INTENT ROUTER (7 LAYERS) VERIFICATION SUITE");
  console.log("================================================================\n");

  const { routeRequest } = await import("../../server/studio/smartRouter.js");
  const normalize = await import("../../server/studio/routerNormalize.js");
  const contract = await import("../../server/studio/routerContract.js");
  const telemetry = await import("../../server/studio/routerTelemetry.js");
  const { studioRoutes } = await import("../../server/studio/studioRoutes.js");

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

  const OWNER = "usr_router_main";
  const OTHER = "usr_router_other";

  const llmSpy = (localImpl, cloudImpl) => {
    const calls = { local: 0, cloud: 0 };
    return {
      calls,
      local: async (p) => { calls.local += 1; return localImpl ? localImpl(p) : ""; },
      cloud: async (p) => { calls.cloud += 1; return cloudImpl ? cloudImpl(p) : ""; },
    };
  };
  const okLlm = (intent, confidence) => llmSpy(
    () => JSON.stringify({ intent, confidence }),
    () => JSON.stringify({ intent, confidence }),
  );
  const today = () => new Date().toISOString().slice(0, 10);

  console.log("[L2] Guardrail & deterministic fast-path...");

  await test("T1. Guardrail rejects empty/oversize/invalid before any routing (400)", async () => {
    await assert.rejects(
      () => routeRequest(db, { ownerId: OWNER, message: FX.emptyMessage }),
      (err) => err.code === "ROUTER_MESSAGE_EMPTY" && err.status === 400,
    );
    await assert.rejects(
      () => routeRequest(db, { ownerId: OWNER, message: "x".repeat(4001) }),
      (err) => err.code === "ROUTER_MESSAGE_TOO_LONG" && err.status === 400,
    );
    await assert.rejects(
      () => routeRequest(db, { ownerId: OWNER, message: null }),
      (err) => err.code === "ROUTER_MESSAGE_INVALID" && err.status === 400,
    );
    // Guardrail failures must NOT write telemetry (no routing happened).
    assert.strictEqual(telemetry.listRouting(db, OWNER, { limit: 200 }).length, 0);
  });

  await test("T2. Fast-path: drawn mask -> image_edit, <10ms, ZERO LLM calls", async () => {
    const llm = okLlm("chat_consult", 0.99); // must never be called
    const t0 = performance.now();
    const d = await routeRequest(db, {
      ownerId: OWNER, message: FX.maskMessage, signals: { has_mask: true }, llm,
    });
    const ms = performance.now() - t0;
    assert.strictEqual(d.status, "routed");
    assert.strictEqual(d.intent, "image_edit");
    assert.strictEqual(d.confidence, 1.0);
    assert.strictEqual(d.provider, "fast_path");
    assert.ok(ms < 10, `fast-path took ${ms}ms (must be < 10ms)`);
    assert.strictEqual(llm.calls.local, 0);
    assert.strictEqual(llm.calls.cloud, 0);
  });

  await test("T3. Fast-path: click-to-edit -> ui_edit, <10ms, ZERO LLM calls", async () => {
    const llm = okLlm("chat_consult", 0.99);
    const t0 = performance.now();
    const d = await routeRequest(db, {
      ownerId: OWNER, message: FX.maskMessage,
      signals: { click_target: "hero_title" }, llm,
    });
    const ms = performance.now() - t0;
    assert.strictEqual(d.intent, "ui_edit");
    assert.strictEqual(d.confidence, 1.0);
    assert.ok(ms < 10, `click fast-path took ${ms}ms`);
    assert.strictEqual(llm.calls.local + llm.calls.cloud, 0);
  });

  await test("T4. Fast-path: direct commands (remove bg / 4K upscale / export code), <10ms, $0", async () => {
    const cases = [
      [FX.cmdRemoveBg, "image_edit", "remove_bg"],
      [FX.cmdUpscale, "image_edit", "upscale_4k"],
      [FX.cmdExportCode, "ui_edit", "export_code"],
    ];
    for (const [msg, intent, cmd] of cases) {
      const llm = okLlm("chat_consult", 0.99);
      const t0 = performance.now();
      const d = await routeRequest(db, { ownerId: OWNER, message: msg, llm });
      const ms = performance.now() - t0;
      assert.strictEqual(d.intent, intent, msg);
      assert.strictEqual(d.direct_command, cmd, msg);
      assert.strictEqual(d.confidence, 1.0);
      assert.ok(ms < 10, `direct command took ${ms}ms`);
      assert.strictEqual(llm.calls.local + llm.calls.cloud, 0);
      // Local-only commands never require paid quota.
      assert.strictEqual(d.cost_check.required, false);
    }
  });

  console.log("[L1] Normalization & literal entity locking...");

  await test("T5. Brand text locked verbatim + typo corrected end-to-end", async () => {
    const input = normalize.normalizeInput(FX.brandMessage, {});
    assert.strictEqual(input.protected_brand_text, FX.brandExpected);
    assert.ok(input.corrections.some((c) => c.from === FX.typoFrom && c.to === FX.typoTo));
    assert.ok(input.normalized.includes(FX.typoTo));
    assert.ok(!input.normalized.includes(FX.typoFrom));

    // Full pipeline with a stubbed classifier (hybrid, high confidence).
    const llm = okLlm("hybrid_ui_with_assets", 0.94);
    const d = await routeRequest(db, { ownerId: OWNER, message: FX.brandMessage, llm });
    assert.strictEqual(d.status, "routed");
    assert.strictEqual(d.ui_params.protected_brand_text, FX.brandExpected);
    assert.ok(d.asset_tasks.length >= 1);
    // Corrected scene word reaches the English prompt; brand stays literal.
    assert.ok(
      d.asset_tasks.some((t) => t.enhanced_prompt.includes(FX.sceneEn)),
      "enhanced_prompt must contain the corrected scene word",
    );
    assert.ok(
      d.asset_tasks.some((t) => t.enhanced_prompt.includes(`"${FX.brandExpected}"`)),
      "brand text must appear verbatim inside an exact-render instruction",
    );
    // Contract passes the strict schema validator.
    const v = contract.validateRouterOutput(d, {
      validPresetIds: new Set(d.asset_tasks.map((t) => t.preset_id)),
    });
    assert.ok(v.ok, v.errors.join(","));
  });

  console.log("[L3] Context-aware follow-up detection...");

  await test("T6. Follow-up after image -> image_edit; after UI -> ui_edit ($0, no LLM)", async () => {
    const S1 = "sess_img_" + Date.now();
    const S2 = "sess_ui_" + Date.now();
    // Seed session outputs (as earlier routings would have logged).
    telemetry.insertRouting(db, {
      ownerId: OWNER, sessionId: S1, intent: "image_generate", confidence: 0.95,
      provider: "local", latencyMs: 5,
    });
    telemetry.insertRouting(db, {
      ownerId: OWNER, sessionId: S2, intent: "ui_generate", confidence: 0.93,
      provider: "local", latencyMs: 5,
    });

    const llm = okLlm("chat_consult", 0.99); // must never be called
    const d1 = await routeRequest(db, {
      ownerId: OWNER, sessionId: S1, message: FX.followupImage, llm,
    });
    assert.strictEqual(d1.intent, "image_edit");
    assert.strictEqual(d1.provider, "context");

    const d2 = await routeRequest(db, {
      ownerId: OWNER, sessionId: S2, message: FX.followupUi, llm,
    });
    assert.strictEqual(d2.intent, "ui_edit");
    assert.strictEqual(d2.provider, "context");
    assert.strictEqual(llm.calls.local + llm.calls.cloud, 0);
  });

  console.log("[L4] Confidence thresholds & ambiguity gate...");

  await test("T7. Confidence 0.50-0.79 -> quick options, ZERO paid consumption", async () => {
    const llm = okLlm("ui_generate", 0.6);
    const d = await routeRequest(db, { ownerId: OWNER, message: FX.ambiguousMessage, llm });
    assert.strictEqual(d.status, "ambiguous");
    assert.strictEqual(d.confidence, 0.6);
    assert.ok(Array.isArray(d.options) && d.options.length === 2);
    assert.ok(d.options.every((o) => contract.INTENTS.includes(o.intent)));
    assert.ok(d.question && typeof d.question === "string");
    assert.strictEqual(d.cost_check.required, false); // nothing paid was touched
    assert.strictEqual(d.asset_tasks, undefined);     // no execution graph built
    // Telemetry logged as ambiguous.
    const row = telemetry.getRouting(db, OWNER, d.routing_id);
    assert.strictEqual(row.ambiguous, 1);
    // No studio asset was created by routing.
    const assets = db.prepare("SELECT COUNT(*) AS n FROM studio_assets WHERE owner_id = ?").get(OWNER);
    assert.strictEqual(assets.n, 0);
  });

  await test("T7b. User clarification answer forces the route (confidence 1.0)", async () => {
    const llm = okLlm("chat_consult", 0.99);
    const d = await routeRequest(db, {
      ownerId: OWNER, message: FX.ambiguousMessage,
      answers: { intent: "ui_generate" }, llm,
    });
    assert.strictEqual(d.status, "routed");
    assert.strictEqual(d.intent, "ui_generate");
    assert.strictEqual(d.confidence, 1.0);
    assert.strictEqual(d.provider, "user_clarified");
    assert.strictEqual(llm.calls.local + llm.calls.cloud, 0);
  });

  console.log("[L7] Schema validation, fallback chain & telemetry...");

  await test("T8. Broken local JSON -> one retry -> silent cloud_flash fallback", async () => {
    const llm = llmSpy(
      () => "```json\n{broken: true,,}", // invalid JSON twice
      () => JSON.stringify({ intent: "image_generate", confidence: 0.92 }),
    );
    const d = await routeRequest(db, { ownerId: OWNER, message: FX.hybridMessage, llm });
    assert.strictEqual(d.status, "routed");
    assert.strictEqual(d.provider, "cloud_flash");
    assert.strictEqual(d.fallback_used, true);
    assert.strictEqual(llm.calls.local, 2);  // initial + exactly one retry
    assert.strictEqual(llm.calls.cloud, 1);  // single cloud hop — loop capped
    const row = telemetry.getRouting(db, OWNER, d.routing_id);
    assert.strictEqual(row.provider, "cloud_flash");
    assert.strictEqual(row.fallback_used, 1);
    assert.ok(row.latency_ms >= 0);
    assert.ok(row.created_at);
  });

  await test("T9. Schema-invalid intent rejected; both models bad -> honest keyword fallback", async () => {
    const llm = llmSpy(
      () => JSON.stringify({ intent: "fly_to_moon", confidence: 0.99 }),
      () => JSON.stringify({ intent: "teleport", confidence: 0.99 }),
    );
    // Invalid enums are rejected by the strict schema -> full fallback chain.
    const d = await routeRequest(db, { ownerId: OWNER, message: FX.chatMessage, llm });
    assert.strictEqual(d.provider, "keyword_fallback");
    assert.strictEqual(llm.calls.local, 2);
    assert.strictEqual(llm.calls.cloud, 1);
    // A no-signal question lands on chat_consult without burning anything.
    assert.strictEqual(d.intent, "chat_consult");
    assert.strictEqual(d.cost_check.required, false);

    // A build-flavoured message stays confidence-capped -> ambiguity gate.
    const d2 = await routeRequest(db, { ownerId: OWNER, message: FX.ambiguousMessage, llm });
    assert.strictEqual(d2.provider, "keyword_fallback");
    assert.ok(d2.confidence <= 0.79, "offline build confidence must stay capped");
    assert.strictEqual(d2.status, "ambiguous");
  });

  console.log("[L5] Complexity-based model tier...");

  await test("T10. Complex trading UI -> cloud_flash; simple landing -> local", async () => {
    const d1 = await routeRequest(db, {
      ownerId: OWNER, message: FX.complexUi, llm: okLlm("ui_generate", 0.95),
    });
    assert.strictEqual(d1.intent, "ui_generate");
    assert.strictEqual(d1.model_tier, "cloud_flash");
    assert.ok(d1.complexity >= 2);

    const d2 = await routeRequest(db, {
      ownerId: OWNER, message: FX.simpleUi, llm: okLlm("ui_generate", 0.95),
    });
    assert.strictEqual(d2.model_tier, "local");
  });

  console.log("[L7] Telemetry record & 1-click override...");

  await test("T11. Full telemetry row + override flip + tenant isolation", async () => {
    const d = await routeRequest(db, {
      ownerId: OWNER, message: FX.hybridMessage, llm: okLlm("hybrid_ui_with_assets", 0.94),
    });
    const row = telemetry.getRouting(db, OWNER, d.routing_id);
    for (const k of ["id", "owner_id", "intent", "confidence", "provider", "latency_ms", "created_at"]) {
      assert.ok(row[k] !== undefined && row[k] !== null, `telemetry missing ${k}`);
    }
    assert.strictEqual(row.override_clicked, 0);
    assert.strictEqual(row.intent, "hybrid_ui_with_assets");
    assert.strictEqual(row.model_tier, "local"); // coffee store UI is not complex

    const flipped = telemetry.markOverride(db, OWNER, d.routing_id, "ui_generate");
    assert.strictEqual(flipped.override_clicked, 1);
    assert.strictEqual(flipped.corrected_intent, "ui_generate");
    // Tenant isolation: another owner cannot flip or read the row.
    assert.strictEqual(telemetry.markOverride(db, OTHER, d.routing_id, "ui_generate"), null);
    assert.strictEqual(telemetry.getRouting(db, OTHER, d.routing_id), null);
  });

  console.log("[GATE] 100% English codebase...");

  await test("T12. Router code files are Arabic-free; lexicon & fixtures carry the language", async () => {
    const AR = /[؀-ۿ]/;
    const codeFiles = [
      "server/studio/routerContract.js",
      "server/studio/routerNormalize.js",
      "server/studio/routerFastPath.js",
      "server/studio/routerClassifier.js",
      "server/studio/routerEnrich.js",
      "server/studio/routerLlm.js",
      "server/studio/routerTelemetry.js",
      "server/studio/smartRouter.js",
    ];
    for (const f of codeFiles) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      assert.ok(!AR.test(src), `${f} must be 100% English`);
    }
    // Positive controls: language data files DO contain Arabic.
    assert.ok(AR.test(fs.readFileSync(path.join(process.cwd(), "server/studio/i18n/routerLexicon.js"), "utf8")));
    assert.ok(AR.test(fs.readFileSync(path.join(process.cwd(), "server_backend/tests/fixtures/routerFixtures.cjs"), "utf8")));
  });

  console.log("[L7] Pre-flight cost guard...");

  await test("T13. Exhausted daily quota -> cost_check.ok=false + cost_blocked telemetry", async () => {
    db.prepare(`INSERT INTO media_usage (owner_id, day, type, units) VALUES (?,?,?,?)
                ON CONFLICT(owner_id, day, type) DO UPDATE SET units = excluded.units`)
      .run(OTHER, today(), "image", 20); // IMAGE_DAILY_QUOTA = 20
    const d = await routeRequest(db, {
      ownerId: OTHER, message: FX.hybridMessage, llm: okLlm("image_generate", 0.95),
    });
    assert.strictEqual(d.status, "routed");
    assert.strictEqual(d.cost_check.required, true);
    assert.strictEqual(d.cost_check.ok, false);
    assert.strictEqual(d.cost_check.remaining, 0);
    const row = telemetry.getRouting(db, OTHER, d.routing_id);
    assert.strictEqual(row.cost_blocked, 1);
    // But a local-only direct command stays free even with an empty quota.
    const d2 = await routeRequest(db, { ownerId: OTHER, message: FX.cmdRemoveBg, llm: okLlm("x", 0) });
    assert.strictEqual(d2.cost_check.required, false);
  });

  console.log("[HTTP] Full route surface...");

  await test("T14. HTTP: /route contract + /route/override + /route/telemetry (tenant-isolated)", async () => {
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
    const server = await new Promise((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
      // 401 without auth
      const noAuth = await fetch(`${base}/api/studio/route`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: FX.chatMessage }),
      });
      assert.strictEqual(noAuth.status, 401);

      // Mask signal routes deterministically over HTTP.
      const maskRes = await fetch(`${base}/api/studio/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": "usr_http_a" },
        body: JSON.stringify({ message: FX.maskMessage, signals: { has_mask: true } }),
      });
      assert.strictEqual(maskRes.status, 200);
      const maskBody = await maskRes.json();
      assert.strictEqual(maskBody.intent, "image_edit");
      assert.strictEqual(maskBody.mode, "image"); // legacy mapping preserved
      assert.ok(maskBody.routing_id);
      assert.ok(maskBody.override_badge && maskBody.override_badge.prefix);

      // Override flips via HTTP.
      const ovRes = await fetch(`${base}/api/studio/route/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": "usr_http_a" },
        body: JSON.stringify({ routing_id: maskBody.routing_id, corrected_intent: "ui_edit" }),
      });
      assert.strictEqual(ovRes.status, 200);
      assert.strictEqual((await ovRes.json()).routing.override_clicked, true);

      // Telemetry listing is owner-isolated.
      const telA = await (await fetch(`${base}/api/studio/route/telemetry`, {
        headers: { "x-test-user": "usr_http_a" },
      })).json();
      assert.ok(telA.routing.length >= 1);
      const telB = await (await fetch(`${base}/api/studio/route/telemetry`, {
        headers: { "x-test-user": "usr_http_b" },
      })).json();
      assert.strictEqual(telB.routing.length, 0);

      // Guardrail over HTTP -> 400 with honest code.
      const badRes = await fetch(`${base}/api/studio/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user": "usr_http_a" },
        body: JSON.stringify({ message: "" }),
      });
      assert.strictEqual(badRes.status, 400);
      assert.strictEqual((await badRes.json()).error.code, "ROUTER_MESSAGE_EMPTY");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  console.log("\n================================================================");
  console.log(`✅ SMART INTENT ROUTER SUITE: ${passed}/${total} PASSED`);
  console.log("================================================================\n");

  closeDb();
  fs.rmSync(process.env.DB_PATH, { force: true });
  fs.rmSync(process.env.MEDIA_STORAGE_DIR, { recursive: true, force: true });
}

runSmartRouterSuite().catch((err) => {
  console.error("\n❌ SMART INTENT ROUTER SUITE FAILED:", err);
  process.exit(1);
});
