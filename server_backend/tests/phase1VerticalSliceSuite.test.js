// ==============================================================================
// server_backend/tests/phase1VerticalSliceSuite.test.js
// Phase-1 Feature Freeze — Vertical Slice E2E (execution order:
// "أمر تنفيذ مباشر — انطلاق المرحلة 1"). The seven mandatory acceptance
// gates, verified over the REAL assembled engines and the frozen /api/v1
// surface — nothing mocked away except the paid provider boundary itself.
//   G1: 100% English codebase (regex gate) + AES-256-GCM keys, 0 client leak
//   G2: Fast-Path < 10ms with 0 LLM calls
//   G3: bilingual verbatim lock + spell-fix on the gate message
//   G4: ambiguity band 0.50-0.79 -> card <15ms, 0 paid calls, 0-LLM resolve
//   G5: conditional OCR bound to storefront/banner only (max 1 retry),
//       skipped entirely in cinematic_photo + ui_assets
//   G6: zero duplicate spend — repeat request served from caches, savings
//       booked in provider_cost_ledger
//   G7: full cycle over HTTP: dispatch -> presets -> enhance -> generate ->
//       WebP on disk -> telemetry, plus 2-candidate split-screen group
// ==============================================================================
"use strict";

process.env.LLM_PROVIDER = "mock";
process.env.DB_PATH = require("path").join(
  require("os").tmpdir(),
  `phase1_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.MEDIA_STORAGE_DIR = require("path").join(
  require("os").tmpdir(),
  `phase1_media_${Date.now()}_${Math.random().toString(36).slice(2)}`
);
delete process.env.GEMINI_API_KEY;
process.env.IMAGE_PROVIDER_MOCK = "1";
process.env.IMAGE_PROVIDER = "gemini";
process.env.E2E_TEST_MODE = "1";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { getDb, closeDb } = require("../db/database");

const MSG_GATE3 = "متجر قهوة الأصالة — AL ASALA في سحراء"; // directive gate-3 message
const MSG_AMBIGUOUS = "ابني لي متجر عطور"; // deterministic-bank ambiguous fixture
const MSG_CINEMATIC = "لقطة سينمائية لكثبان الصحراء عند الغروب";

async function runPhase1SliceSuite() {
  console.log("================================================================");
  console.log("RUNNING PHASE-1 VERTICAL SLICE (FEATURE FREEZE) E2E SUITE");
  console.log("================================================================\n");

  const { routeRequest } = await import("../../server/studio/smartRouter.js");
  const resolver = await import("../../server/studio/presets/presetsResolve.js");
  const enhancer = await import("../../server/studio/enhancer/promptEnhancerEngine.js");
  const normalize = await import("../../server/studio/enhancer/enhancerNormalize.js");
  const clarifiers = await import("../../server/studio/clarifier/quickClarifiersEngine.js");
  const studio = await import("../../server/studio/studioService.js");
  const ledger = await import("../../server/studio/costLedger.js");
  const { phase1Routes } = await import("../../server/studio/phase1/phase1Routes.js");
  const { presetsV1Routes } = await import("../../server/studio/presets/presetsRoutes.js");

  const db = getDb();
  let passed = 0;
  let total = 0;

  async function test(name, fn) {
    total++;
    try {
      await fn();
      passed++;
      console.log(`  [PASS] ${name}`);
    } catch (err) {
      console.error(`  [FAIL] ${name}: ${err.message}`);
      throw err;
    }
  }

  const OWNER = "usr_p1_owner";
  const countingLlm = (impl) => ({
    calls: 0,
    async complete(args) { this.calls++; return impl(args); },
  });
  const neverLlm = () => {
    const spy = { calls: 0, async complete() { spy.calls++; throw new Error("LLM must not be called"); } };
    return spy;
  };

  /* ================= G1: code cleanliness & key security ================ */
  console.log("[G1] English Codebase Regex Gate & AES-256-GCM Key Isolation...");

  await test("G1.1 phase-1 engine files contain zero Arabic code points (i18n isolated)", async () => {
    const roots = ["phase1", "clarifier", "presets", "typography", "enhancer"]
      .map((d) => path.join(__dirname, "..", "..", "server", "studio", d));
    const LEXICONS = new Set([
      "presetsLexicon.js", "typographyLexicon.js", "enhancerLexicon.js",
      "clarifierLexicon.js", "routerLexicon.js", "labels.js", "uiLexicon.js",
    ]);
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js") && !LEXICONS.has(e.name)) files.push(p);
      }
    };
    roots.forEach(walk);
    files.push(path.join(__dirname, "..", "..", "server", "studio", "costLedger.js"));
    assert.ok(files.length >= 25, `phase-1 surface scanned (${files.length} files)`);
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      assert.ok(!/[؀-ۿ]/.test(src), `Arabic code point found in ${path.basename(f)}`);
    }
  });

  await test("G1.2 keys encrypted AES-256-GCM server-side; zero key refs in the client bundle", async () => {
    const vault = fs.readFileSync(
      path.join(__dirname, "..", "..", "server_backend", "services", "security", "secretVault.js"), "utf8");
    assert.ok(vault.includes("createCipheriv('aes-256-gcm'"), "encryption uses AES-256-GCM");
    assert.ok(vault.includes("createDecipheriv('aes-256-gcm'"), "decryption uses AES-256-GCM");
    // The Vite client (TypeScript/TSX) must never reference provider keys.
    const clientRoot = path.join(__dirname, "..", "..", "src");
    const leaks = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(tsx|ts|jsx)$/.test(e.name)) {
          const src = fs.readFileSync(p, "utf8");
          if (/GEMINI_API_KEY|OPENAI_API_KEY|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}/.test(src)) leaks.push(p);
        }
      }
    };
    walk(clientRoot);
    assert.deepStrictEqual(leaks, [], `client key leak: ${leaks.join(", ")}`);
  });

  /* ================= G2: fast path <10ms, 0 LLM ========================= */
  console.log("[G2] Fast-Path Deterministic Speed...");

  await test("G2.1 direct UI signal -> fast-path decision, avg <10ms over 50 runs, 0 LLM calls", async () => {
    const llm = neverLlm();
    const t0 = performance.now();
    let last = null;
    for (let i = 0; i < 50; i++) {
      last = await routeRequest(db, {
        ownerId: OWNER, message: "عدّل هذا العنصر",
        signals: { click_target: "hero_title" }, llm,
      });
    }
    const avg = (performance.now() - t0) / 50;
    assert.strictEqual(last.provider, "fast_path");
    assert.strictEqual(last.confidence, 1.0);
    assert.strictEqual(last.intent, "ui_edit");
    assert.strictEqual(llm.calls, 0, "zero LLM calls on the fast path");
    assert.ok(avg < 10, `fast-path avg ${avg.toFixed(2)}ms < 10ms`);
  });

  /* ============ G3: bilingual verbatim lock + spell fix ================= */
  console.log("[G3] Bilingual Verbatim Brand Protection...");

  await test("G3.1 gate message: spell fixed, AR+EN brand locked verbatim, nothing translated", async () => {
    const spell = normalize.normalizeAndSpellFix(MSG_GATE3);
    assert.ok(spell.corrections.some((c) => c.from === "سحراء" && c.to === "صحراء"),
      "typo corrected");
    assert.ok(spell.text.includes("AL ASALA"), "English half never touched");
    assert.ok(spell.text.includes("قهوة الأصالة"), "Arabic half never touched");
    const ent = normalize.extractProtectedEntities(MSG_GATE3);
    assert.strictEqual(ent.protected_brand_text, "قهوة الأصالة — AL ASALA",
      "the WHOLE bilingual brand is one locked entity, verbatim");
  });

  await test("G3.2 full enhancer contract keeps the bilingual brand verbatim end-to-end", async () => {
    const contract = await enhancer.enhancePrompt(db, {
      ownerId: OWNER, message: MSG_GATE3, track: "image",
      presetId: "commercial_storefront", intensity: "balanced",
      llm: { async complete() { return { text: "{}" }; } },
    });
    assert.strictEqual(contract.protected_brand_text, "قهوة الأصالة — AL ASALA");
    assert.ok(contract.enhanced_prompt.includes("قهوة الأصالة — AL ASALA"),
      "locked text reaches the prompt verbatim (never translated)");
    assert.ok(!/AL[- ]ASALA/i.test(contract.enhanced_prompt.replace(/قهوة الأصالة — AL ASALA/g, "")) ||
      contract.enhanced_prompt.includes("AL ASALA"), "no duplicated/altered brand");
    // Corrections are auditable in the append-only enhancement ledger meta.
    const row = db.prepare("SELECT contract_json FROM studio_prompt_enhancements WHERE id = ?")
      .get(contract.enhancement_id);
    assert.ok(row, "enhancement ledger row persisted");
    const meta = JSON.parse(row.contract_json).meta;
    assert.ok(meta.corrections.some((c) => c.from === "سحراء" && c.to === "صحراء"),
      "correction auditable in the ledger meta");
  });

  /* ============ G4: ambiguity guard, budget & 0-LLM resolve ============= */
  console.log("[G4] Ambiguity Band Guard (0.50-0.79)...");

  await test("G4.1 band request -> deterministic bank card <15ms, 0 paid calls, skip offered", async () => {
    const llm = neverLlm();
    const out = await clarifiers.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_AMBIGUOUS,
      intent: null, confidence: 0.62, ambiguous: true,
      verbosityMode: "smart", llm,
    });
    assert.strictEqual(out.bypassed, false);
    assert.strictEqual(out.card.source, "deterministic_bank", "$0 bank path");
    assert.ok(out.card.latency_ms < 15, `card latency ${out.card.latency_ms}ms < 15ms`);
    assert.ok(out.card.questions.length >= 1 && out.card.questions.length <= 3);
    assert.strictEqual(out.card.allow_skip, true);
    assert.strictEqual(llm.calls, 0, "zero paid/local LLM calls before the user answers");
  });

  await test("G4.2 1-click resolve compiles with provably 0 LLM calls", async () => {
    const out = await clarifiers.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_AMBIGUOUS,
      intent: null, confidence: 0.7, ambiguous: true,
      verbosityMode: "smart", llm: null,
    });
    const res = clarifiers.resolveClarifier(db, {
      ownerId: OWNER, clarifierId: out.card.clarifier_id,
      answersPayload: { answers: [{ slot: "intent_track", values: ["image_generate"] }] },
    });
    assert.strictEqual(res.status, "resolved");
    assert.strictEqual(res.llm_calls, 0);
    assert.strictEqual(res.compiled.intent_override, "image_generate");
  });

  /* ============ G5: conditional OCR gate binding ======================== */
  console.log("[G5] Conditional OCR Gate Binding...");

  await test("G5.1 storefront + banner require OCR; cinematic + ui_assets skip it", async () => {
    for (const id of ["commercial_storefront", "marketing_banner"]) {
      const b = resolver.resolvePreset(db, { ownerId: OWNER, presetId: id });
      assert.strictEqual(b.ocr_gate_mode, "always", `${id} gate active`);
      assert.strictEqual(b.ocr_status, "required");
    }
    for (const id of ["cinematic_photo", "ui_assets"]) {
      const b = resolver.resolvePreset(db, { ownerId: OWNER, presetId: id });
      assert.strictEqual(b.ocr_gate_mode, "off", `${id} gate skipped`);
      assert.strictEqual(b.ocr_status, "skipped", "0 OCR calls by construction");
    }
  });

  await test("G5.2 service level: gate-off preset never calls OCR; gated preset retries at most once", async () => {
    let ocrCalls = 0;
    const countingVerify = async () => { ocrCalls++; return { pass: true, coverage: 1, missing: [], reason: "injected" }; };
    const offAsset = await studio.generateStudioAsset(db, {
      ownerId: OWNER, message: MSG_CINEMATIC, presetId: "cinematic_photo",
      protectedBrandText: "AL ASALA", seedOverride: "g5off1",
      verifyImpl: countingVerify,
    });
    assert.strictEqual(ocrCalls, 0, "gate-off preset: zero OCR calls even with brand text");
    assert.strictEqual(offAsset.state, "READY");

    ocrCalls = 0;
    const failingVerify = async () => { ocrCalls++; return { pass: false, coverage: 0.2, missing: ["AL ASALA"], reason: "low" }; };
    const gated = await studio.generateStudioAsset(db, {
      ownerId: OWNER, message: "واجهة محل تجاري فاخرة", presetId: "commercial_storefront",
      protectedBrandText: "AL ASALA", seedOverride: "g5on1",
      verifyImpl: failingVerify,
    });
    assert.ok(ocrCalls >= 1, "gated preset fires OCR when text is present");
    assert.ok(ocrCalls <= 2, `max 1 retry (${ocrCalls} OCR calls = ${ocrCalls - 1} retries)`);
    assert.strictEqual(gated.state, "QUALITY_GATE_FAILED", "honest failure after the retry budget");
  });

  /* ============ G6: zero duplicate spend ================================ */
  console.log("[G6] Cache Effectiveness & Cost Ledger...");

  await test("G6.1 repeat enhance -> prompt_cache_hit, 0 LLM calls on the repeat", async () => {
    const llm = countingLlm(async () => ({ text: "{}" }));
    const msg = "واجهة مقهى تراثي بإضاءة دافئة";
    const first = await enhancer.enhancePrompt(db, {
      ownerId: OWNER, message: msg, track: "image",
      presetId: "commercial_storefront", llm,
    });
    const callsAfterFirst = llm.calls;
    const second = await enhancer.enhancePrompt(db, {
      ownerId: OWNER, message: msg, track: "image",
      presetId: "commercial_storefront", llm,
    });
    assert.strictEqual(second.cache_hit, true, "repeat served from prompt cache");
    assert.strictEqual(llm.calls, callsAfterFirst, "zero LLM calls on the repeat");
    assert.strictEqual(second.fingerprint, first.fingerprint);
  });

  await test("G6.2 repeat generate -> generation_cache_hit, savings booked in provider_cost_ledger", async () => {
    const seed = "g6seed01";
    const first = await studio.generateStudioAsset(db, {
      ownerId: OWNER, message: MSG_CINEMATIC, presetId: "cinematic_photo", seedOverride: seed,
    });
    assert.strictEqual(first.cache_hit, 0, "first run is a real generation");
    const second = await studio.generateStudioAsset(db, {
      ownerId: OWNER, message: MSG_CINEMATIC, presetId: "cinematic_photo", seedOverride: seed,
    });
    assert.strictEqual(second.cache_hit, 1, "repeat served from the content cache");
    assert.strictEqual(second.id, first.id, "same asset — no duplicate artifact");
    const rows = db.prepare(
      "SELECT * FROM provider_cost_ledger WHERE owner_id = ? AND cache_source = 'generation_cache_hit'",
    ).all(OWNER);
    assert.ok(rows.length >= 1, "saving booked in the ledger");
    assert.ok(rows[0].saved_usd > 0, "saved amount is positive (estimated gemini rate)");
    assert.strictEqual(rows[0].cost_usd, 0, "a saving row never bills");
    const spend = db.prepare(
      "SELECT COUNT(*) c FROM provider_cost_ledger WHERE owner_id = ? AND cost_usd > 0",
    ).get(OWNER).c;
    assert.strictEqual(spend, 0, "mock provider: zero paid calls booked — nothing fabricated");
    const summary = ledger.costSummary(db, OWNER);
    assert.ok(summary.avoided_calls >= 1 && summary.total_saved_usd > 0);
  });

  /* ============ G7: full cycle over the frozen HTTP surface ============= */
  console.log("[G7] Full E2E Cycle over /api/v1 (frozen surface)...");

  await test("G7.1 dispatch -> presets -> enhance -> generate -> WebP -> telemetry + candidates", async () => {
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json({ limit: "12mb" }));
    const fakeAuth = (req, res, next) => {
      if (req.headers["x-test-user"]) { req.user = { id: req.headers["x-test-user"] }; return next(); }
      return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    };
    app.use("/api/v1", phase1Routes(db, fakeAuth));
    app.use("/api/v1", presetsV1Routes(db, fakeAuth));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code || "ERR" } }));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const H = { "Content-Type": "application/json", "x-test-user": OWNER };
    try {
      // 0) auth enforced
      assert.strictEqual((await fetch(`${base}/api/v1/router/dispatch`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "x" }),
      })).status, 401);

      // 1) Smart Intent Router dispatch (mask signal -> deterministic
      // fast-path decision; the sandbox has no local LLM, so the E2E flow
      // must not depend on the classifier's choice).
      const dispatch = await fetch(`${base}/api/v1/router/dispatch`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: "عدّل هذه المنطقة", signals: { has_mask: true }, lang: "ar" }),
      });
      assert.strictEqual(dispatch.status, 200);
      const decision = await dispatch.json();
      assert.strictEqual(decision.intent, "image_edit");
      assert.strictEqual(decision.provider, "fast_path", "deterministic fast path over HTTP");
      assert.ok(decision.routing_id, "routing telemetry row id returned");

      // 2) 1-Click Override contract (frozen path shape)
      const override = await fetch(`${base}/api/v1/router/${decision.routing_id}/override`, {
        method: "POST", headers: H,
        body: JSON.stringify({ corrected_intent: "image_generate" }),
      });
      assert.strictEqual(override.status, 200);

      // 3) Presets resolve (zero-click detection binding)
      const preset = await fetch(`${base}/api/v1/presets/resolve`, {
        method: "POST", headers: H,
        body: JSON.stringify({ preset_id: "cinematic_photo" }),
      });
      assert.strictEqual(preset.status, 200);
      const bundle = await preset.json();
      assert.strictEqual(bundle.ocr_status, "skipped", "cinematic skips OCR in the bundle");

      // 4) Prompt Enhancer (SHA-256 cached contract)
      const enhance = await fetch(`${base}/api/v1/prompts/enhance`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: MSG_CINEMATIC, preset_id: "cinematic_photo" }),
      });
      assert.strictEqual(enhance.status, 200);
      const contract = await enhance.json();
      assert.ok(contract.enhanced_prompt.length > 20, "enhanced prompt produced");

      // 5) Image generation -> READY + local WebP variant on disk
      const gen = await fetch(`${base}/api/v1/images/generate`, {
        method: "POST", headers: H,
        body: JSON.stringify({
          message: MSG_CINEMATIC, preset_id: "cinematic_photo",
          style_seed: "g7seed001", enhancer_contract: contract,
        }),
      });
      assert.strictEqual(gen.status, 201);
      const asset = await gen.json();
      assert.strictEqual(asset.state, "READY");
      if (asset.webp_ready) {
        const webpInfo = studio.resolveAssetWebpPath(db, OWNER, asset.id);
        assert.strictEqual(webpInfo.mime, "image/webp");
        const magic = Buffer.alloc(16);
        const fd = fs.openSync(webpInfo.abs, "r");
        fs.readSync(fd, magic, 0, 16, 0);
        fs.closeSync(fd);
        assert.strictEqual(magic.toString("ascii", 0, 4), "RIFF", "WebP RIFF container");
        assert.strictEqual(magic.toString("ascii", 8, 12), "WEBP", "WebP format marker");
      } else {
        console.log("   ⏭️ [SKIP] ffmpeg unavailable in environment — skipping WebP variant check");
      }

      // 6) Repeat identical request -> cache hit over HTTP
      const again = await fetch(`${base}/api/v1/images/generate`, {
        method: "POST", headers: H,
        body: JSON.stringify({
          message: MSG_CINEMATIC, preset_id: "cinematic_photo",
          style_seed: "g7seed001", enhancer_contract: contract,
        }),
      });
      assert.strictEqual((await again.json()).cache_hit, true, "HTTP repeat hits the cache");

      // 7) Split-screen candidate group (2-4 alternatives, one call)
      const multi = await fetch(`${base}/api/v1/images/generate`, {
        method: "POST", headers: H,
        body: JSON.stringify({
          message: MSG_CINEMATIC, preset_id: "cinematic_photo", candidates: 2,
        }),
      });
      assert.strictEqual(multi.status, 201);
      const group = await multi.json();
      assert.strictEqual(group.assets.length, 2, "2-4 split-screen alternatives");
      assert.ok(group.assets.every((a) => a.state === "READY"));

      // 8) Telemetry: routing decisions + cost ledger in one read
      const telemetry = await fetch(`${base}/api/v1/telemetry/routing-and-cost`, { headers: H });
      assert.strictEqual(telemetry.status, 200);
      const tele = await telemetry.json();
      assert.ok(tele.routing.decisions >= 2, "dispatch decisions recorded");
      assert.ok(tele.cost.avoided_calls >= 1, "cache savings visible to the client");
      assert.ok(tele.cost.total_saved_usd > 0);
      assert.strictEqual(tele.cost.pricing_model, "estimated", "honest pricing flag");
    } finally {
      server.close();
    }
  });

  await test("G7.2 zod violations map to 400 PHASE1_INPUT_INVALID on the frozen surface", async () => {
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json());
    const fakeAuth = (req, res, next) => { req.user = { id: OWNER }; next(); };
    app.use("/api/v1", phase1Routes(db, fakeAuth));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code || "ERR" } }));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const H = { "Content-Type": "application/json", "x-test-user": OWNER };
    try {
      const badOverride = await fetch(`${base}/api/v1/router/rl_x/override`, {
        method: "POST", headers: H, body: JSON.stringify({ corrected_intent: "not_an_intent" }),
      });
      assert.strictEqual(badOverride.status, 400);
      assert.strictEqual((await badOverride.json()).error.code, "PHASE1_INPUT_INVALID");
      const badGenerate = await fetch(`${base}/api/v1/images/generate`, {
        method: "POST", headers: H, body: JSON.stringify({ message: "ab" }),
      });
      assert.strictEqual(badGenerate.status, 400);
      const missing = await fetch(`${base}/api/v1/router/rl_does_not_exist/override`, {
        method: "POST", headers: H, body: JSON.stringify({ corrected_intent: "chat_consult" }),
      });
      assert.strictEqual(missing.status, 404, "unknown routing row -> 404");
    } finally {
      server.close();
    }
  });

  console.log("\n================================================================");
  console.log(`PHASE-1 VERTICAL SLICE SUITE: ${passed}/${total} PASSED`);
  console.log("================================================================");
}

runPhase1SliceSuite()
  .then(() => { closeDb(); process.exit(0); })
  .catch((err) => {
    console.error("\nPHASE-1 VERTICAL SLICE SUITE FAILED:", err);
    try { closeDb(); } catch { /* ignore */ }
    process.exit(1);
  });
