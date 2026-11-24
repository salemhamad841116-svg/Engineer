// ==============================================================================
// server_backend/tests/quickClarifiersSuite.test.js
// Quick Clarifiers Engine (Annex 7, Phase-1 scope) Verification Suite
// Acceptance gates from the official annex:
//   G1: "build me a perfume store" (ambiguous) -> zero-spend card <15ms, <=3
//       questions, intent_track first with credit cost badges, sector-recommended
//   G2: "dark trading UI for mobile" -> theme+platform already answered appear
//       in suppressed_slots; Brand Kit lock suppresses style/theme and pre-fills
//   G3: swatch_hex / recommended / cost_badge surfaced; 1-Click Skip works;
//       turbo mode bypasses instantly
//   G4: resolve = provably 0 LLM calls + zod-validated JSON + updates the
//       ORIGINAL routing telemetry row (corrected_intent) + enhancer bindings
//   G5: dynamic local-LLM path -> repeat = cache_hit (0 extra LLM calls);
//       >800ms -> circuit_breaker_skipped -> smart defaults
// Plus: HTTP surface (401 / tenant isolation), 100% English codebase gate.
// ==============================================================================
"use strict";

process.env.LLM_PROVIDER = "mock";
process.env.DB_PATH = require("path").join(
  require("os").tmpdir(),
  `clarifier_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.MEDIA_STORAGE_DIR = require("path").join(
  require("os").tmpdir(),
  `clarifier_media_${Date.now()}_${Math.random().toString(36).slice(2)}`
);
delete process.env.GEMINI_API_KEY;
process.env.IMAGE_PROVIDER_MOCK = "1";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { getDb, closeDb } = require("../db/database");

// Arabic fixtures only — engine code stays 100% English.
const MSG_PERFUME_STORE = "ابني لي متجر عطور"; // ambiguous: image? ui? hybrid?
const MSG_DARK_TRADING_MOBILE = "واجهة تداول داكنة للجوال"; // theme+platform answered
const MSG_LIGHT_REALESTATE_WEB = "لوحة عقارات فاتحة للويب"; // theme+platform answered, ui track

async function runClarifierSuite() {
  console.log("================================================================");
  console.log("RUNNING QUICK CLARIFIERS ENGINE (ANNEX 7) VERIFICATION SUITE");
  console.log("================================================================\n");

  const scanner = await import("../../server/studio/clarifier/slotScanner.js");
  const bank = await import("../../server/studio/clarifier/clarifierBank.js");
  const card = await import("../../server/studio/clarifier/clarifierCard.js");
  const compiler = await import("../../server/studio/clarifier/clarifierCompiler.js");
  const store = await import("../../server/studio/clarifier/clarifierStore.js");
  const engine = await import("../../server/studio/clarifier/quickClarifiersEngine.js");
  const telemetry = await import("../../server/studio/routerTelemetry.js");
  const presetStore = await import("../../server/studio/presetStore.js");
  const { studioRoutes } = await import("../../server/studio/studioRoutes.js");

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

  const OWNER = "usr_clr_owner";
  const OTHER = "usr_clr_other";

  const llmSpy = (impl) => {
    const spy = {
      calls: 0,
      async complete(args) {
        spy.calls++;
        return impl(args);
      },
    };
    return spy;
  };
  const validDynamic = () => JSON.stringify({
    questions: [{
      slot: "bottle_material",
      selection_mode: "single",
      question_key_hint: "clarifiers.dynamic.bottle_material",
      options: [
        { value: "crystal", label_hint: "Crystal" },
        { value: "matte_glass", label_hint: "Matte glass" },
      ],
    }],
  });

  /* ============ G1: zero-spend ambiguity card, max 3, <15ms ============ */
  console.log("[G1] Zero-Spend Pre-Flight & Ambiguity Card...");

  await test("G1.1 ambiguous perfume-store request -> bank card, intent_track first, 0 LLM calls", async () => {
    const spy = llmSpy(async () => ({ text: validDynamic() }));
    const t0 = performance.now();
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_PERFUME_STORE,
      intent: null, confidence: 0.62, ambiguous: true,
      verbosityMode: "smart", llm: spy,
    });
    const wall = performance.now() - t0;
    assert.strictEqual(out.bypassed, false, "card must be produced");
    assert.strictEqual(out.card.source, "deterministic_bank");
    assert.ok(out.card.questions.length >= 1 && out.card.questions.length <= 3,
      "max 3 questions (Layer 4)");
    assert.strictEqual(out.card.questions[0].slot, "intent_track",
      "ambiguity question first");
    assert.strictEqual(spy.calls, 0, "zero LLM calls on the bank path");
    assert.ok(out.card.latency_ms < 15, `engine latency ${out.card.latency_ms}ms < 15ms`);
    assert.ok(wall < 100, `wall clock ${wall.toFixed(1)}ms sane`);
    assert.strictEqual(out.card.allow_skip, true, "1-Click Skip always offered");
  });

  await test("G1.2 credit cost badges on the intent question; store sector flags the recommended option", async () => {
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_PERFUME_STORE,
      intent: null, confidence: 0.62, ambiguous: true,
      verbosityMode: "smart", llm: null,
    });
    const q = out.card.questions.find((x) => x.slot === "intent_track");
    const badges = Object.fromEntries(q.options.map((o) => [o.value, o.cost_badge]));
    assert.strictEqual(badges.image_generate, "cost.1_credit");
    assert.strictEqual(badges.ui_generate, "cost.2_credits");
    assert.strictEqual(badges.hybrid_ui_with_assets, "cost.4_credits");
    const rec = q.options.find((o) => o.recommended);
    assert.ok(rec, "a recommended option exists");
    assert.strictEqual(rec.value, "hybrid_ui_with_assets",
      "store sector recommends the full store app (Layer 5)");
  });

  await test("G1.3 session persisted, owner-isolated, status pending", async () => {
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_PERFUME_STORE,
      intent: null, confidence: 0.62, ambiguous: true,
      verbosityMode: "smart", llm: null,
    });
    const row = db.prepare("SELECT * FROM studio_clarifier_sessions WHERE id = ?")
      .get(out.card.clarifier_id);
    assert.ok(row, "session row exists");
    assert.strictEqual(row.owner_id, OWNER);
    assert.strictEqual(row.status, "pending");
    assert.strictEqual(row.source, "deterministic_bank");
    assert.strictEqual(store.getSession(db, OTHER, out.card.clarifier_id), undefined,
      "other tenant cannot see the session");
  });

  await test("G1.4 smart mode + high confidence + complete slots -> silent bypass (high_confidence)", async () => {
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_DARK_TRADING_MOBILE,
      intent: "ui_generate", confidence: 0.93, ambiguous: false,
      verbosityMode: "smart", llm: null,
    });
    assert.strictEqual(out.bypassed, true);
    assert.strictEqual(out.reason, "high_confidence");
    assert.ok(out.defaults && out.defaults.params.aspect_ratio, "smart defaults attached");
    assert.strictEqual(out.defaults.params.theme, "dark", "answered slots flow into defaults");
    assert.strictEqual(out.defaults.params.platform, "mobile");
  });

  /* ====== G2: already-answered suppression + Brand Kit inheritance ====== */
  console.log("[G2] Already-Answered Suppression & Brand Kit...");

  await test("G2.1 'dark trading UI for mobile' -> theme+platform detected, suppressed_slots surface them", async () => {
    const answered = scanner.detectAnsweredSlots(MSG_DARK_TRADING_MOBILE);
    assert.strictEqual(answered.theme, "dark");
    assert.strictEqual(answered.platform, "mobile");
    const spy = llmSpy(async () => ({ text: validDynamic() }));
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_DARK_TRADING_MOBILE,
      intent: "ui_generate", confidence: 0.9, ambiguous: false,
      verbosityMode: "guided", llm: spy,
    });
    assert.strictEqual(out.bypassed, false);
    assert.ok(out.card.suppressed_slots.includes("theme"), "theme suppressed");
    assert.ok(out.card.suppressed_slots.includes("platform"), "platform suppressed");
    assert.ok(!out.card.questions.some((q) => q.slot === "theme"),
      "no theme question rendered for an answered slot");
  });

  await test("G2.2 Brand Kit lock suppresses style+theme and pre-fills preset/palette/seed", async () => {
    const projectId = "prj_clr_brand";
    presetStore.setBrandLock(db, { ownerId: OWNER, projectId, presetId: "commercial_storefront" });
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, projectId, message: MSG_PERFUME_STORE,
      intent: "image_generate", confidence: 0.7, ambiguous: false,
      verbosityMode: "smart", llm: null,
    });
    assert.strictEqual(out.bypassed, false, "critical slots still missing -> card");
    assert.ok(out.card.suppressed_slots.includes("style"), "style suppressed by lock");
    assert.ok(out.card.suppressed_slots.includes("theme"), "theme suppressed by lock");
    assert.ok(!out.card.questions.some((q) => q.slot === "style"),
      "no style question while the brand is locked");
    const inh = card.brandInheritance(
      db.prepare("SELECT * FROM studio_project_brand_lock WHERE project_id = ?").get(projectId));
    assert.strictEqual(inh.autoAnswers.preset_id, "commercial_storefront");
    assert.ok(Array.isArray(inh.autoAnswers.palette) && inh.autoAnswers.palette.length > 0);
    assert.ok(inh.autoAnswers.style_seed, "style seed inherited");
  });

  /* ============ G3: badges contract + 1-Click Skip + turbo ============= */
  console.log("[G3] Badge Contract, 1-Click Skip & Turbo...");

  await test("G3.1 swatch_hex / icon / cost_badge contract holds across the bank registry", async () => {
    const theme = bank.SLOT_REGISTRY.theme;
    for (const opt of theme.options) {
      assert.ok(/^#[0-9A-Fa-f]{6}$/.test(opt.swatch_hex), `valid swatch ${opt.swatch_hex}`);
      assert.ok(opt.cost_badge, "cost badge present");
    }
    for (const slot of ["aspect_ratio", "lighting"]) {
      for (const opt of bank.SLOT_REGISTRY[slot].options) {
        assert.ok(opt.icon, `${slot} option carries an icon key`);
      }
    }
    // Card builder forwards swatch/icon keys unchanged (zod-validated).
    const q = card.buildCard({
      clarifierId: "clr_test", routingLogId: null, stage: "pre_gen",
      source: "deterministic_bank", latencyMs: 1,
      bankSlots: ["aspect_ratio", "lighting"], suppressedSlots: [],
    });
    assert.ok(q.questions[0].options.every((o) => o.icon && o.cost_badge));
  });

  await test("G3.2 1-Click Skip records status skipped and returns recommended smart defaults", async () => {
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_PERFUME_STORE,
      intent: null, confidence: 0.62, ambiguous: true,
      verbosityMode: "smart", llm: null,
    });
    const skipped = engine.skipClarifier(db, {
      ownerId: OWNER, clarifierId: out.card.clarifier_id, message: MSG_PERFUME_STORE,
    });
    assert.strictEqual(skipped.status, "skipped");
    assert.strictEqual(skipped.defaults.intent, "hybrid_ui_with_assets",
      "skip proceeds on the same sector-recommended default the card flagged");
    assert.ok(skipped.defaults.params.aspect_ratio, "smart defaults attached");
    const row = db.prepare("SELECT status FROM studio_clarifier_sessions WHERE id = ?")
      .get(out.card.clarifier_id);
    assert.strictEqual(row.status, "skipped", "skip persisted honestly");
  });

  await test("G3.3 turbo mode bypasses instantly with defaults, 0 LLM", async () => {
    const spy = llmSpy(async () => ({ text: validDynamic() }));
    const t0 = performance.now();
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_PERFUME_STORE,
      intent: null, confidence: 0.62, ambiguous: true,
      verbosityMode: "turbo", llm: spy,
    });
    assert.strictEqual(out.bypassed, true);
    assert.strictEqual(out.reason, "turbo_mode");
    assert.ok(performance.now() - t0 < 15, "turbo is immediate");
    assert.strictEqual(spy.calls, 0);
    assert.ok(out.defaults.params.aspect_ratio && out.defaults.params.style);
  });

  /* ===== G4: resolve compiler — 0 LLM, zod JSON, routing-log sync ====== */
  console.log("[G4] Clicks-to-JSON Compiler & Routing Sync...");

  await test("G4.1 resolve compiles clicks, syncs ORIGINAL routing row, 0 LLM calls", async () => {
    const routingId = telemetry.insertRouting(db, {
      ownerId: OWNER, sessionId: "ses_clr_1", intent: "image_generate",
      confidence: 0.62, provider: "mock", ambiguous: true,
    });
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, routingLogId: routingId, message: MSG_PERFUME_STORE,
      intent: null, confidence: null, ambiguous: null,
      verbosityMode: "smart", llm: null,
    });
    assert.strictEqual(out.card.routing_log_id, routingId,
      "routing ambiguity picked up authoritatively");
    const res = engine.resolveClarifier(db, {
      ownerId: OWNER, clarifierId: out.card.clarifier_id,
      answersPayload: {
        answers: [
          { slot: "intent_track", values: ["ui_generate"] },
          { slot: "aspect_ratio", values: ["9:16"] },
        ],
      },
    });
    assert.strictEqual(res.status, "resolved");
    assert.strictEqual(res.llm_calls, 0, "provably zero LLM calls on resolve");
    assert.strictEqual(res.compiled.intent_override, "ui_generate");
    assert.strictEqual(res.compiled.enhancer_bindings.aspect_ratio, "9:16");
    assert.strictEqual(res.routing_log_synced, true);
    const row = db.prepare("SELECT * FROM studio_routing_telemetry WHERE id = ?").get(routingId);
    assert.strictEqual(row.corrected_intent, "ui_generate",
      "ORIGINAL routing row updated in place — no duplicate");
    assert.strictEqual(row.intent, "image_generate", "original routing kept for audit");
  });

  await test("G4.2 custom text input becomes the literal protected_brand_text binding", async () => {
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_PERFUME_STORE,
      intent: "image_generate", confidence: 0.7, ambiguous: false,
      verbosityMode: "smart", llm: null,
    });
    const res = engine.resolveClarifier(db, {
      ownerId: OWNER, clarifierId: out.card.clarifier_id,
      answersPayload: {
        answers: [{ slot: "protected_text", values: ["yes"] }],
        custom_text_input: "Oud Palace",
      },
    });
    assert.strictEqual(res.compiled.enhancer_bindings.protected_brand_text, "Oud Palace");
  });

  await test("G4.3 protected_text 'no' compiles to an explicit null binding", async () => {
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_PERFUME_STORE,
      intent: "image_generate", confidence: 0.7, ambiguous: false,
      verbosityMode: "smart", llm: null,
    });
    const res = engine.resolveClarifier(db, {
      ownerId: OWNER, clarifierId: out.card.clarifier_id,
      answersPayload: { answers: [{ slot: "protected_text", values: ["no"] }] },
    });
    assert.strictEqual(res.compiled.enhancer_bindings.protected_brand_text, null);
  });

  await test("G4.4 double resolve -> 409; unknown id -> 404 (honest states)", async () => {
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_PERFUME_STORE,
      intent: null, confidence: 0.62, ambiguous: true,
      verbosityMode: "smart", llm: null,
    });
    engine.resolveClarifier(db, {
      ownerId: OWNER, clarifierId: out.card.clarifier_id,
      answersPayload: { answers: [{ slot: "intent_track", values: ["image_generate"] }] },
    });
    assert.throws(() => engine.resolveClarifier(db, {
      ownerId: OWNER, clarifierId: out.card.clarifier_id,
      answersPayload: { answers: [] },
    }), (e) => e.status === 409 && e.code === "CLARIFIER_ALREADY_CLOSED");
    assert.throws(() => engine.resolveClarifier(db, {
      ownerId: OWNER, clarifierId: "clr_missing",
      answersPayload: { answers: [] },
    }), (e) => e.status === 404 && e.code === "CLARIFIER_NOT_FOUND");
    assert.throws(() => engine.skipClarifier(db, {
      ownerId: OWNER, clarifierId: out.card.clarifier_id,
    }), (e) => e.status === 409, "skip on closed session also 409");
  });

  /* ====== G5: dynamic local-LLM, SHA-256 cache, 800ms circuit breaker == */
  console.log("[G5] Dynamic Questioning, Cache & Circuit Breaker...");

  await test("G5.1 guided mode -> dynamic path uses local LLM exactly once (source local_llm)", async () => {
    const spy = llmSpy(async () => ({ text: validDynamic() }));
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_LIGHT_REALESTATE_WEB,
      intent: "ui_generate", confidence: 0.93, ambiguous: false,
      verbosityMode: "guided", llm: spy,
    });
    assert.strictEqual(out.bypassed, false);
    assert.strictEqual(out.card.source, "local_llm");
    assert.strictEqual(spy.calls, 1, "one local call at $0");
    assert.strictEqual(out.card.questions[0].slot, "bottle_material");
    assert.strictEqual(out.card.questions[0].allow_custom_input, true);
    assert.ok(out.card.questions[0].options[0].recommended,
      "first dynamic option recommended");
  });

  await test("G5.2 identical repeat -> cache_hit with ZERO additional LLM calls", async () => {
    const spy = llmSpy(async () => ({ text: validDynamic() }));
    const first = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_LIGHT_REALESTATE_WEB,
      intent: "ui_generate", confidence: 0.93, ambiguous: false,
      verbosityMode: "guided", llm: spy,
    });
    const second = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: MSG_LIGHT_REALESTATE_WEB,
      intent: "ui_generate", confidence: 0.93, ambiguous: false,
      verbosityMode: "guided", llm: spy,
    });
    assert.strictEqual(first.card.source, "cache_hit",
      "G5.1 already populated the cache for this fingerprint");
    assert.strictEqual(second.card.source, "cache_hit");
    assert.strictEqual(spy.calls, 0, "repeat costs nothing");
    const sums = db.prepare("SELECT SUM(hit_count) AS hits FROM studio_clarifier_cache").get();
    assert.ok(sums.hits >= 2, "hit counter increments");
  });

  await test("G5.3 LLM slower than 800ms -> circuit_breaker_skipped, defaults, session timeout_bypassed", async () => {
    const spy = llmSpy(async ({ signal }) => new Promise((resolve, reject) => {
      const t = setTimeout(() => resolve({ text: validDynamic() }), 1500);
      signal.addEventListener("abort", () => { clearTimeout(t); reject(new Error("aborted")); });
    }));
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: "صمم لي تجربة غير تقليدية تماما للجوال",
      intent: "ui_generate", confidence: 0.55, ambiguous: false,
      verbosityMode: "guided", llm: spy,
    });
    assert.strictEqual(out.bypassed, true);
    assert.strictEqual(out.reason, "circuit_breaker_skipped");
    assert.strictEqual(out.source, "circuit_breaker_skipped");
    assert.ok(out.defaults && out.defaults.params.direction, "smart defaults returned");
    const row = db.prepare("SELECT status, source FROM studio_clarifier_sessions WHERE id = ?")
      .get(out.clarifier_id);
    assert.strictEqual(row.status, "timeout_bypassed", "honest bypass recorded");
    assert.strictEqual(row.source, "circuit_breaker_skipped");
  });

  await test("G5.4 invalid LLM JSON -> same honest circuit-breaker outcome", async () => {
    const spy = llmSpy(async () => ({ text: "not json at all" }));
    const out = await engine.evaluateClarifiers(db, {
      ownerId: OWNER, message: "فكرة مختلفة تماما عن كل شيء",
      intent: "ui_generate", confidence: 0.55, ambiguous: false,
      verbosityMode: "guided", llm: spy,
    });
    assert.strictEqual(out.bypassed, true);
    assert.strictEqual(out.reason, "circuit_breaker_skipped");
  });

  /* ============ HTTP surface: auth, flow, tenant isolation ============== */
  console.log("[HTTP] Route Surface & Tenant Isolation...");

  await test("H1 full evaluate->resolve flow over HTTP + 401 + cross-tenant 404 + zod 400", async () => {
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json({ limit: "12mb" }));
    const fakeAuth = (req, res, next) => {
      if (req.headers["x-test-user"]) { req.user = { id: req.headers["x-test-user"] }; return next(); }
      return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    };
    app.use("/api/studio", studioRoutes(db, fakeAuth));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code || "ERR" } }));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const H = { "Content-Type": "application/json", "x-test-user": OWNER };
    try {
      const unauth = await fetch(`${base}/api/studio/clarifiers/evaluate`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: MSG_PERFUME_STORE }),
      });
      assert.strictEqual(unauth.status, 401, "auth enforced");

      const ev = await fetch(`${base}/api/studio/clarifiers/evaluate`, {
        method: "POST", headers: H,
        body: JSON.stringify({
          message: MSG_PERFUME_STORE, confidence: 0.62, ambiguous: true,
        }),
      });
      assert.strictEqual(ev.status, 200);
      const evBody = await ev.json();
      assert.strictEqual(evBody.bypassed, false);
      assert.ok(evBody.card.clarifier_id.startsWith("clr_"));

      const bad = await fetch(`${base}/api/studio/clarifiers/${evBody.card.clarifier_id}/resolve`, {
        method: "POST", headers: H,
        body: JSON.stringify({ answers: [{ slot: "x", values: [] }] }),
      });
      assert.strictEqual(bad.status, 400, "zod violation mapped to 400");
      assert.strictEqual((await bad.json()).error.code, "CLARIFIER_ANSWERS_INVALID");

      const cross = await fetch(`${base}/api/studio/clarifiers/${evBody.card.clarifier_id}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json", "x-test-user": OTHER },
        body: JSON.stringify({ answers: [{ slot: "intent_track", values: ["ui_generate"] }] }),
      });
      assert.strictEqual(cross.status, 404, "tenant isolation on resolve");

      const ok = await fetch(`${base}/api/studio/clarifiers/${evBody.card.clarifier_id}/resolve`, {
        method: "POST", headers: H,
        body: JSON.stringify({ answers: [{ slot: "intent_track", values: ["ui_generate"] }] }),
      });
      assert.strictEqual(ok.status, 200);
      const okBody = await ok.json();
      assert.strictEqual(okBody.status, "resolved");
      assert.strictEqual(okBody.llm_calls, 0);
      assert.strictEqual(okBody.compiled.intent_override, "ui_generate");

      const again = await fetch(`${base}/api/studio/clarifiers/${evBody.card.clarifier_id}/resolve`, {
        method: "POST", headers: H,
        body: JSON.stringify({ answers: [{ slot: "intent_track", values: ["ui_generate"] }] }),
      });
      assert.strictEqual(again.status, 409, "already closed");

      const ev2 = await fetch(`${base}/api/studio/clarifiers/evaluate`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: MSG_PERFUME_STORE, confidence: 0.62, ambiguous: true }),
      });
      const ev2Body = await ev2.json();
      const skip = await fetch(`${base}/api/studio/clarifiers/${ev2Body.card.clarifier_id}/skip`, {
        method: "POST", headers: H, body: JSON.stringify({ message: MSG_PERFUME_STORE }),
      });
      assert.strictEqual(skip.status, 200);
      assert.strictEqual((await skip.json()).status, "skipped");
    } finally {
      server.close();
    }

    // 100% English Codebase gate: engine files (except the i18n lexicon) must
    // contain zero Arabic code points.
    const root = path.join(__dirname, "..", "..", "server", "studio", "clarifier");
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js") && e.name !== "clarifierLexicon.js") files.push(p);
      }
    };
    walk(root);
    assert.ok(files.length >= 8, "engine files present");
    for (const f of files) {
      const src = fs.readFileSync(f, "utf8");
      assert.ok(!/[؀-ۿ]/.test(src), `Arabic code point found in ${path.basename(f)}`);
    }
  });

  console.log("\n================================================================");
  console.log(`QUICK CLARIFIERS ENGINE SUITE: ${passed}/${total} PASSED`);
  console.log("================================================================");
}

runClarifierSuite()
  .then(() => { closeDb(); process.exit(0); })
  .catch((err) => {
    console.error("\nQUICK CLARIFIERS ENGINE SUITE FAILED:", err);
    try { closeDb(); } catch { /* ignore */ }
    process.exit(1);
  });
