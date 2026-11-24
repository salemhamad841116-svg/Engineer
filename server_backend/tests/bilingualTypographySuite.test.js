// ==============================================================================
// server_backend/tests/bilingualTypographySuite.test.js
// Bilingual In-Image Typography Engine (8th official annex, Phase-1 scope)
// Mandatory acceptance gates from the annex — each verified on ALL THREE
// script cases (Arabic-only, English-only, Mixed AR+EN):
//   G1: mixed line "قهوة الأصالة — AL ASALA EST. 2026" -> script_mode mixed,
//       literal VERBATIM, BiDi round-trip, font pairing from typography_fonts;
//       ChatHSM interior-uppercase casing locked as exact_brand.
//   G2: strategy matrix — short EN mark -> native_generative; long AR /
//       AR+EN mixed / long EN / digit-critical -> deterministic_compositor.
//   G3: OCR gate >= 95% similarity on 3 samples (Arabic sign, English
//       package, bilingual banner) + gibberish detection + ocr_status
//       'skipped' with ZERO OCR calls for text-free assets.
//   G4: simulated OCR failure -> exactly ONE diagnostic retry
//       (retry_count <= 1) -> free fallback_compositor with 100% correct
//       text by construction + clean_plate_url persisted.
// Plus: bilingual policy guardrail (category only, phrase never echoed),
// font vault pairing/reverse-pairing, HTTP surface (401 / tenant isolation /
// zod 400 / honest OCR-unavailable state), English codebase gate.
// ==============================================================================
"use strict";

process.env.LLM_PROVIDER = "mock";
process.env.DB_PATH = require("path").join(
  require("os").tmpdir(),
  `typography_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.MEDIA_STORAGE_DIR = require("path").join(
  require("os").tmpdir(),
  `typography_media_${Date.now()}_${Math.random().toString(36).slice(2)}`
);
delete process.env.GEMINI_API_KEY;
process.env.IMAGE_PROVIDER_MOCK = "1";
process.env.IMAGE_PROVIDER = "gemini";
process.env.E2E_TEST_MODE = "1"; // enables the deterministic ocr_double over HTTP

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { getDb, closeDb } = require("../db/database");

// --- annex fixtures (Arabic allowed in test fixtures only) ---
const TXT_MIXED_SIGN = "قهوة الأصالة — AL ASALA EST. 2026";
const TXT_AR_ONLY = "قهوة مختصة محمصة طازجة";
const TXT_EN_SHORT = "Fresh Roast";
const TXT_EN_LONG = "Specialty coffee roasted fresh every morning for you";
const TXT_EN_PACKAGE = "PREMIUM ARABICA BEANS";
const TXT_BRAND_CAMEL = "ChatHSM";
const TXT_AR_SIGN = "مقهى الضيافة العربية";
const TXT_GIBBERISH = "Xqzwv Kjhgfd";
const TXT_POLICY_EN = "make a knock off version of the swoosh";

async function runBilingualTypographySuite() {
  console.log("================================================================");
  console.log("RUNNING BILINGUAL TYPOGRAPHY ENGINE (ANNEX 8) VERIFICATION SUITE");
  console.log("================================================================\n");

  const analysis = await import("../../server/studio/typography/textAnalysis.js");
  const matrix = await import("../../server/studio/typography/strategyMatrix.js");
  const vault = await import("../../server/studio/typography/fontVault.js");
  const policy = await import("../../server/studio/typography/policyGuard.js");
  const engine = await import("../../server/studio/typography/typographyEngine.js");
  const ocrGate = await import("../../server/studio/typography/ocrGate.js");
  const { typographyV1Routes } = await import("../../server/studio/typography/typographyRoutes.js");

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

  const OWNER = "usr_typo_owner";
  const OTHER = "usr_typo_other";
  let assetSeq = 0;
  function mkAsset(ownerId = OWNER) {
    const id = `ast_typo_${Date.now()}_${assetSeq++}`;
    db.prepare(
      "INSERT INTO studio_assets (id, owner_id, created_at, updated_at) VALUES (?, ?, datetime('now'), datetime('now'))"
    ).run(id, ownerId);
    return id;
  }
  function countingOcr(text) {
    const state = { calls: 0 };
    return {
      state,
      async scan() { state.calls++; return { text, engine: "counting_double" }; },
    };
  }
  function failingOcr(text) {
    const state = { calls: 0 };
    return {
      state,
      async scan() { state.calls++; return { text, engine: "counting_double" }; },
    };
  }

  /* ============ M: migration idempotency + font seeds ================== */
  console.log("[M] Migration 041, Font Vault Seeds & Pairing Chain...");

  await test("M.1 7 system fonts seeded with annex pairing chain", async () => {
    const rows = db.prepare("SELECT * FROM typography_fonts WHERE is_system = 1").all();
    assert.strictEqual(rows.length, 7, "exactly 7 seeded fonts");
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
    assert.strictEqual(byId.ibm_plex_sans_ar.paired_font_id, "inter_sans");
    assert.strictEqual(byId.cairo_display.paired_font_id, "montserrat_bold");
    assert.strictEqual(byId.amiri_heritage.paired_font_id, "playfair_serif");
    assert.strictEqual(byId.ibm_plex_sans_ar.script_support, "bilingual");
    assert.strictEqual(byId.amiri_heritage.style_category, "calligraphy_heritage");
  });

  await test("M.2 migration up() runs twice without error (idempotent)", async () => {
    const { MIGRATIONS } = require("../db/database");
    const mig = MIGRATIONS.find((m) => m.name === "041_bilingual_typography");
    assert.ok(mig, "migration 041 registered");
    mig.up(db);
    const count = db.prepare("SELECT COUNT(*) c FROM typography_fonts WHERE is_system = 1").get().c;
    assert.strictEqual(count, 7, "no duplicate seeds after re-run");
  });

  await test("M.3 vault list: script filter + resolved pairing + reverse pairing", async () => {
    const arFonts = vault.listFonts(db, { script: "ar" });
    assert.ok(arFonts.some((f) => f.id === "amiri_heritage"), "AR filter returns AR fonts");
    assert.ok(arFonts.every((f) => f.script_support === "ar" || f.script_support === "bilingual"));
    const plex = arFonts.find((f) => f.id === "ibm_plex_sans_ar");
    assert.strictEqual(plex.paired_font.id, "inter_sans", "forward pairing resolved");
    const heritage = vault.listFonts(db, { script: "ar", category: "calligraphy_heritage" });
    assert.deepStrictEqual(heritage.map((f) => f.id), ["amiri_heritage"], "category filter");
    const enPair = vault.pickFontPair(db, { script: "en", styleCategory: "modern_sans" });
    assert.strictEqual(enPair.primary.id, "inter_sans");
    assert.strictEqual(enPair.paired.id, "ibm_plex_sans_ar", "reverse pairing resolved");
    const arPair = vault.pickFontPair(db, { script: "ar", styleCategory: "display_bold" });
    assert.strictEqual(arPair.primary.id, "cairo_display");
    assert.strictEqual(arPair.paired.id, "montserrat_bold");
  });

  /* ===== G1: mixed BiDi plan, verbatim entity lock, casing lock ========= */
  console.log("[G1] Mixed BiDi Plan, Verbatim Lock & Brand Casing (3 script cases)...");

  await test("G1.1 mixed sign -> script_mode mixed + literal verbatim + vault pairing", async () => {
    const plan = engine.buildTypographyPlan(db, {
      ownerId: OWNER, payload: { text: TXT_MIXED_SIGN },
    });
    assert.strictEqual(plan.script_mode, "mixed");
    assert.strictEqual(plan.direction, "rtl", "RTL-first bilingual layout");
    assert.strictEqual(plan.layers[0].literal_text, TXT_MIXED_SIGN, "VERBATIM — no reorder/translate");
    assert.ok(plan.layers[0].font_id, "primary font from typography_fonts");
    assert.ok(plan.layers[0].paired_font_id, "paired counterpart resolved from the vault");
    const joined = plan.layers[0].bidi_segments.map((s) => s.text).join("");
    assert.strictEqual(joined, TXT_MIXED_SIGN, "BiDi segments join back byte-for-byte");
    const scripts = new Set(plan.layers[0].bidi_segments.map((s) => s.script));
    assert.ok(scripts.has("ar") && scripts.has("en"), "both AR and EN runs segmented");
  });

  await test("G1.2 ChatHSM interior-uppercase brand casing locked exact_brand", async () => {
    const plan = engine.buildTypographyPlan(db, {
      ownerId: OWNER, payload: { text: TXT_BRAND_CAMEL },
    });
    assert.strictEqual(plan.layers[0].casing_mode, "exact_brand");
    assert.strictEqual(plan.layers[0].literal_text, TXT_BRAND_CAMEL, "never case-transformed");
    assert.strictEqual(analysis.detectCasingMode("SALE"), "upper");
    assert.strictEqual(analysis.detectCasingMode(TXT_AR_ONLY), "plain");
  });

  await test("G1.3 script detection + BiDi round-trip on all three script cases", async () => {
    assert.strictEqual(analysis.detectScript(TXT_AR_ONLY), "ar");
    assert.strictEqual(analysis.detectScript(TXT_EN_PACKAGE), "en");
    assert.strictEqual(analysis.detectScript(TXT_MIXED_SIGN), "mixed");
    for (const t of [TXT_AR_ONLY, TXT_EN_PACKAGE, TXT_MIXED_SIGN]) {
      const joined = analysis.segmentBiDi(t).map((s) => s.text).join("");
      assert.strictEqual(joined, t, `round-trip verbatim: ${t.slice(0, 20)}...`);
    }
  });

  /* ===== G2: bilingual strategy matrix ================================== */
  console.log("[G2] Strategy Matrix: Native vs Deterministic...");

  await test("G2.1 short EN mark -> native_generative with Latin negatives", async () => {
    const d = matrix.decideStrategy(TXT_EN_SHORT);
    assert.strictEqual(d.render_strategy, "native_generative");
    assert.ok(d.reasons.includes("short_english_mark"));
    const plan = engine.buildTypographyPlan(db, {
      ownerId: OWNER, payload: { text: TXT_EN_SHORT },
    });
    assert.strictEqual(plan.render_strategy, "native_generative");
    assert.ok(plan.negative_typography_rules.includes("misspelled English letters"));
    assert.ok(!plan.negative_typography_rules.includes("disconnected Arabic"),
      "no AR negatives for an EN-only plan");
    assert.strictEqual(plan.direction, "ltr");
  });

  await test("G2.2 AR-only / mixed / long EN / digit-critical -> deterministic_compositor", async () => {
    assert.strictEqual(matrix.decideStrategy(TXT_AR_ONLY).render_strategy, "deterministic_compositor");
    assert.ok(matrix.decideStrategy(TXT_AR_ONLY).reasons.includes("connected_arabic_script"));
    assert.strictEqual(matrix.decideStrategy(TXT_MIXED_SIGN).render_strategy, "deterministic_compositor");
    assert.strictEqual(matrix.decideStrategy(TXT_EN_LONG).render_strategy, "deterministic_compositor");
    assert.ok(matrix.decideStrategy(TXT_EN_LONG).reasons.includes("long_english_paragraph"));
    const digitCritical = matrix.decideStrategy("SALE 50%");
    assert.strictEqual(digitCritical.render_strategy, "deterministic_compositor",
      "digits force deterministic even for a 2-word EN mark");
    assert.ok(digitCritical.reasons.includes("digit_critical_content"));
  });

  await test("G2.3 mixed negatives match the annex contract string exactly", async () => {
    const plan = engine.buildTypographyPlan(db, {
      ownerId: OWNER, payload: { text: TXT_MIXED_SIGN },
    });
    assert.strictEqual(
      plan.negative_typography_rules,
      "misspelled English letters, duplicated glyphs, disconnected Arabic characters, missing Arabic dots, random background gibberish"
    );
    const directive = plan.prompt_directives[0];
    assert.strictEqual(directive.provider, "gemini");
    assert.ok(directive.directive.includes(`"${TXT_MIXED_SIGN}"`),
      "literal wrapped in strict double quotes verbatim");
    const fal = matrix.promptDirectiveFor({
      provider: "fal",
      layers: [{ literal_text: TXT_EN_SHORT, layer_role: "headline", script_mode: "en", relative_scale: 1 }],
      materialStyle: "flat_clean",
    });
    assert.ok(fal.startsWith("exact text:"), "compact dialect for fal");
  });

  /* ===== G3: OCR gate on 3 script cases + gibberish + skipped =========== */
  console.log("[G3] OCR Verification Gate: 3 Samples, Gibberish, Skipped...");

  await test("G3.1 Arabic sign -> OCR pass with similarity >= 0.95", async () => {
    const assetId = mkAsset();
    const ocr = countingOcr(TXT_AR_SIGN);
    const res = await ocrGate.verifyTypographyOcr(db, {
      ownerId: OWNER, assetId, ocr,
      layersInput: [{ layer_role: "signage", literal_text: TXT_AR_SIGN }],
    });
    assert.strictEqual(ocr.state.calls, 1, "exactly one OCR scan");
    assert.strictEqual(res.ocr_status, "executed");
    assert.strictEqual(res.layers[0].status, "passed");
    assert.ok(res.layers[0].ocr_similarity_score >= 0.95, "annex acceptance threshold");
    const row = db.prepare("SELECT * FROM image_text_layers WHERE asset_id = ?").get(assetId);
    assert.strictEqual(row.status, "passed");
    assert.strictEqual(row.script_mode, "ar");
  });

  await test("G3.2 English package -> OCR pass with similarity >= 0.95", async () => {
    const assetId = mkAsset();
    const ocr = countingOcr(TXT_EN_PACKAGE);
    const res = await ocrGate.verifyTypographyOcr(db, {
      ownerId: OWNER, assetId, ocr,
      layersInput: [{ layer_role: "headline", literal_text: TXT_EN_PACKAGE }],
    });
    assert.strictEqual(res.layers[0].status, "passed");
    assert.ok(res.layers[0].ocr_similarity_score >= 0.95);
    const row = db.prepare("SELECT * FROM image_text_layers WHERE asset_id = ?").get(assetId);
    assert.strictEqual(row.script_mode, "en");
    assert.strictEqual(row.direction, "ltr");
  });

  await test("G3.3 bilingual banner -> OCR pass on both AR and EN layers", async () => {
    const assetId = mkAsset();
    const ocr = countingOcr(TXT_MIXED_SIGN);
    const res = await ocrGate.verifyTypographyOcr(db, {
      ownerId: OWNER, assetId, ocr,
      layersInput: [
        { layer_role: "headline", literal_text: "قهوة الأصالة" },
        { layer_role: "subheadline", literal_text: "AL ASALA EST. 2026" },
      ],
    });
    assert.strictEqual(res.layers.length, 2);
    assert.ok(res.layers.every((l) => l.status === "passed"), "both layers pass");
    const rows = db.prepare("SELECT * FROM image_text_layers WHERE asset_id = ? ORDER BY layer_role").all(assetId);
    assert.strictEqual(rows.length, 2);
    assert.ok(rows.some((r) => r.script_mode === "ar") && rows.some((r) => r.script_mode === "en"));
  });

  await test("G3.4 hallucinated gibberish tokens detected and diagnosed honestly", async () => {
    const assetId = mkAsset();
    const ocr = countingOcr(`${TXT_EN_SHORT} ${TXT_GIBBERISH}`);
    const res = await ocrGate.verifyTypographyOcr(db, {
      ownerId: OWNER, assetId, ocr,
      layersInput: [{ layer_role: "headline", literal_text: TXT_EN_SHORT }],
    });
    assert.strictEqual(res.hallucinated_text_found, true);
    assert.ok(res.gibberish_tokens.length >= 2, "both gibberish tokens surfaced");
    assert.strictEqual(res.layers[0].status, "retry_scheduled",
      "hallucinated gibberish blocks a clean pass even when the layer text matches");
    const codes = res.layers[0].diagnosis.map((d) => d.code);
    assert.ok(codes.includes("hallucinated_text"));
    assert.ok(!codes.includes("spelling_mismatch") && !codes.includes("partial_text_mismatch"),
      "no false mismatch diagnosis when the layer text itself is perfect");
  });

  await test("G3.5 text-free asset -> ocr_status skipped with ZERO OCR calls", async () => {
    const assetId = mkAsset();
    let calls = 0;
    const ocr = { async scan() { calls++; return { text: "", engine: "spy" }; } };
    const res = await ocrGate.verifyTypographyOcr(db, { ownerId: OWNER, assetId, ocr });
    assert.strictEqual(res.ocr_status, "skipped");
    assert.strictEqual(res.ocr_calls, 0);
    assert.strictEqual(calls, 0, "conditional gate never fires without text");
  });

  await test("G3.6 similarity scoring + gibberish detector units", async () => {
    assert.strictEqual(ocrGate.textSimilarity(TXT_AR_ONLY, TXT_AR_ONLY), 1);
    assert.ok(ocrGate.textSimilarity("Fresh Roast", "F resh Roost") >= 0.5);
    assert.ok(ocrGate.textSimilarity("SALE", "sale", { exactCase: true }) < 1,
      "exact-case mode is case sensitive");
    assert.strictEqual(ocrGate.textSimilarity("SALE", "sale", { exactCase: false }), 1);
    const gib = ocrGate.detectGibberish("Fresh Roast Zqxwv", ["Fresh Roast"]);
    assert.deepStrictEqual(gib, ["zqxwv"]);
  });

  /* ===== G4: max-1-retry budget breaker + fallback recovery ============= */
  console.log("[G4] Diagnostic Retry Breaker & Fallback Recovery (3 script cases)...");

  for (const [label, text] of [["AR", TXT_AR_SIGN], ["EN", TXT_EN_PACKAGE], ["mixed", TXT_MIXED_SIGN]]) {
    await test(`G4.${label} fail -> exactly 1 diagnostic retry -> fallback_compositor + clean plate`, async () => {
      const assetId = mkAsset();
      const bad = failingOcr("garbled wrong text");
      // Pass 1 (native render failed the gate): schedule the diagnostic retry.
      const first = await ocrGate.verifyTypographyOcr(db, {
        ownerId: OWNER, assetId, ocr: bad, cleanPlateUrl: "/cache/clean-plate.png",
        layersInput: [{ layer_role: "headline", literal_text: text }],
      });
      assert.strictEqual(first.layers[0].status, "retry_scheduled");
      assert.strictEqual(first.layers[0].retry_count, 1, "exactly one paid retry");
      assert.ok(first.layers[0].diagnosis.length >= 1, "diagnosis arms the retry");
      // Pass 2 (the paid retry also failed the gate): mandatory FREE recovery.
      const second = await ocrGate.verifyTypographyOcr(db, {
        ownerId: OWNER, assetId, ocr: bad, cleanPlateUrl: "/cache/clean-plate.png",
      });
      assert.strictEqual(second.layers[0].status, "fallback_recovered");
      assert.strictEqual(second.layers[0].render_strategy, "fallback_compositor");
      assert.strictEqual(second.layers[0].ocr_similarity_score, 1.0,
        "100% correct text by construction");
      assert.ok(second.layers[0].retry_count <= 1, "budget breaker: never a third paid attempt");
      const row = db.prepare("SELECT * FROM image_text_layers WHERE asset_id = ?").get(assetId);
      assert.strictEqual(row.status, "fallback_recovered");
      assert.strictEqual(row.retry_count, 1);
      assert.strictEqual(row.clean_plate_url, "/cache/clean-plate.png", "clean plate cached");
      assert.strictEqual(row.ocr_engine_used, "deterministic_local");
    });
  }

  await test("G4.4 OCR engine unavailable -> honest failed_unverified, never a fabricated pass", async () => {
    const assetId = mkAsset();
    const broken = {
      async scan() {
        const { StudioError } = await import("../../server/studio/studioErrors.js");
        throw new StudioError(503, "OCR_LANGUAGE_PACK_MISSING", "ara pack missing");
      },
    };
    const res = await ocrGate.verifyTypographyOcr(db, {
      ownerId: OWNER, assetId, ocr: broken,
      layersInput: [{ layer_role: "signage", literal_text: TXT_AR_SIGN }],
    });
    assert.strictEqual(res.layers[0].status, "failed_unverified");
    assert.strictEqual(res.layers[0].error_code, "OCR_LANGUAGE_PACK_MISSING");
    const row = db.prepare("SELECT * FROM image_text_layers WHERE asset_id = ?").get(assetId);
    assert.strictEqual(row.status, "failed_unverified");
    assert.strictEqual(row.ocr_similarity_score, null, "no fabricated score");
  });

  /* ===== Policy guardrail (bilingual, category-only) ==================== */
  console.log("[P] Bilingual Policy & Trademark Guardrail...");

  await test("P.1 EN denylist rejected with category only; phrase never echoed", async () => {
    let caught = null;
    try { policy.assertTextPolicy(TXT_POLICY_EN); } catch (err) { caught = err; }
    assert.ok(caught, "throws");
    assert.strictEqual(caught.code, "POLICY_TEXT_REJECTED");
    assert.strictEqual(caught.status, 400);
    assert.strictEqual(caught.message.includes("counterfeit_logo"), true, "category reported");
    assert.ok(!caught.message.includes("swoosh") && !caught.message.includes("knock"),
      "matched phrase is never echoed back");
    assert.strictEqual(policy.checkTextPolicy(TXT_EN_SHORT), null, "clean text passes");
  });

  /* ================= HTTP surface: auth, flow, isolation ================ */
  console.log("[HTTP] Route Surface & Tenant Isolation...");

  await test("H1 401 + fonts list + plan + verify-ocr flow + zod 400 + 403/404", async () => {
    const express = (await import("express")).default;
    const app = express();
    app.use(express.json({ limit: "12mb" }));
    const fakeAuth = (req, res, next) => {
      if (req.headers["x-test-user"]) { req.user = { id: req.headers["x-test-user"] }; return next(); }
      return res.status(401).json({ error: { code: "UNAUTHORIZED" } });
    };
    app.use("/api/v1", typographyV1Routes(db, fakeAuth));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => res.status(err.status || 500).json({ error: { code: err.code || "ERR" } }));
    const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}`;
    const H = { "Content-Type": "application/json", "x-test-user": OWNER };
    const HO = { "Content-Type": "application/json", "x-test-user": OTHER };
    try {
      const unauth = await fetch(`${base}/api/v1/typography/fonts`);
      assert.strictEqual(unauth.status, 401, "auth enforced");

      const fonts = await fetch(`${base}/api/v1/typography/fonts?script=ar`, { headers: H });
      assert.strictEqual(fonts.status, 200);
      const fontsBody = await fonts.json();
      assert.ok(fontsBody.fonts.length >= 3, "AR-capable fonts listed");
      assert.ok(fontsBody.policy_message.length > 0, "i18n policy line resolved");

      const assetId = mkAsset();
      const planRes = await fetch(`${base}/api/v1/typography/plan`, {
        method: "POST", headers: H,
        body: JSON.stringify({ text: TXT_MIXED_SIGN, asset_id: assetId }),
      });
      assert.strictEqual(planRes.status, 200);
      const planBody = await planRes.json();
      assert.strictEqual(planBody.plan.script_mode, "mixed");
      assert.strictEqual(planBody.plan.max_paid_retries, 1, "annex budget literal");
      assert.strictEqual(planBody.planned_layer_ids.length, 1, "planned layer persisted");

      const badPlan = await fetch(`${base}/api/v1/typography/plan`, {
        method: "POST", headers: H, body: JSON.stringify({}),
      });
      assert.strictEqual(badPlan.status, 400, "zod violation mapped to 400");
      assert.strictEqual((await badPlan.json()).error.code, "TYPOGRAPHY_INPUT_INVALID");

      const policyPlan = await fetch(`${base}/api/v1/typography/plan`, {
        method: "POST", headers: H, body: JSON.stringify({ text: TXT_POLICY_EN }),
      });
      assert.strictEqual(policyPlan.status, 400);
      assert.strictEqual((await policyPlan.json()).error.code, "POLICY_TEXT_REJECTED");

      // verify-ocr over HTTP with the deterministic double (E2E_TEST_MODE).
      const pass = await fetch(`${base}/api/v1/typography/${assetId}/verify-ocr`, {
        method: "POST", headers: H,
        body: JSON.stringify({ ocr_double: { text: TXT_MIXED_SIGN } }),
      });
      assert.strictEqual(pass.status, 200);
      const passBody = await pass.json();
      assert.strictEqual(passBody.layers[0].status, "passed");

      const missing = await fetch(`${base}/api/v1/typography/ast_nope/verify-ocr`, {
        method: "POST", headers: H, body: JSON.stringify({}),
      });
      assert.strictEqual(missing.status, 404, "unknown asset -> 404");

      const foreignAsset = mkAsset(OTHER);
      const cross = await fetch(`${base}/api/v1/typography/${foreignAsset}/verify-ocr`, {
        method: "POST", headers: H, body: JSON.stringify({}),
      });
      assert.strictEqual(cross.status, 403, "asset never crosses tenants");
    } finally {
      server.close();
    }

    // 100% English Codebase gate: engine files (except the i18n lexicon)
    // must contain zero Arabic code points.
    const root = path.join(__dirname, "..", "..", "server", "studio", "typography");
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js") && e.name !== "typographyLexicon.js") files.push(p);
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
  console.log(`BILINGUAL TYPOGRAPHY ENGINE SUITE: ${passed}/${total} PASSED`);
  console.log("================================================================");
}

runBilingualTypographySuite()
  .then(() => { closeDb(); process.exit(0); })
  .catch((err) => {
    console.error("\nBILINGUAL TYPOGRAPHY ENGINE SUITE FAILED:", err);
    try { closeDb(); } catch { /* ignore */ }
    process.exit(1);
  });
