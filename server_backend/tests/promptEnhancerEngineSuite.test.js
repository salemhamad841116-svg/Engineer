// ==============================================================================
// server_backend/tests/promptEnhancerEngineSuite.test.js
// Prompt Enhancer Engine (6 layers / 24 features, Phase-1 scope) Suite
// Acceptance groups from the official annex:
//   L1: normalization & spell-fix + dialect mapping + verbatim entity lock + RTL
//   L2: gap-filling + conversational delta merge + cultural grounding +
//       contradiction resolver
//   L3: image-track cinematography + RTL/LTR negative space + precision English
//   L4: preset wrapper merge + intensity weighting + dynamic negative rules
//   L5: provider dialect adapter (gemini/fal) + safety rewrite + variations
//   L6: zod validation + SHA-256 cache (0 LLM) + retry/fallback ladder +
//       retry self-refinement + telemetry
// ==============================================================================
"use strict";

process.env.LLM_PROVIDER = "mock";
process.env.DB_PATH = require("path").join(
  require("os").tmpdir(),
  `enhancer_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.MEDIA_STORAGE_DIR = require("path").join(
  require("os").tmpdir(),
  `enhancer_media_${Date.now()}_${Math.random().toString(36).slice(2)}`
);
delete process.env.GEMINI_API_KEY;
process.env.IMAGE_PROVIDER_MOCK = "1";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { getDb, closeDb } = require("../db/database");
const FX = require("./fixtures/enhancerFixtures.cjs");

async function runEnhancerSuite() {
  console.log("================================================================");
  console.log("✨ RUNNING PROMPT ENHANCER ENGINE (6 LAYERS) VERIFICATION SUITE");
  console.log("================================================================\n");

  const norm = await import("../../server/studio/enhancer/enhancerNormalize.js");
  const ctx = await import("../../server/studio/enhancer/enhancerContext.js");
  const tracks = await import("../../server/studio/enhancer/enhancerTracks.js");
  const presets = await import("../../server/studio/enhancer/enhancerPresets.js");
  const dialects = await import("../../server/studio/enhancer/enhancerDialects.js");
  const schema = await import("../../server/studio/enhancer/enhancerSchema.js");
  const store = await import("../../server/studio/enhancer/enhancerStore.js");
  const engine = await import("../../server/studio/enhancer/promptEnhancerEngine.js");
  const service = await import("../../server/studio/studioService.js");
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

  const OWNER = "usr_enh_owner";
  const OTHER = "usr_enh_other";

  /* ======================= L1: normalization & locking ==================== */
  console.log("[L1] Linguistic Normalization & Entity Locking...");

  await test("P1. Annex acceptance sentence: typo fixed, dialect mapped, RTL, brand locked verbatim", async () => {
    const l1 = norm.runLayer1(FX.acceptanceMessage);
    assert.ok(l1.corrections.some((c) => c.from === FX.typoFrom && c.to === FX.typoTo),
      `spell-fix ${FX.typoFrom} -> ${FX.typoTo}`);
    assert.ok(l1.normalized_message.includes(FX.typoTo), "corrected word in output");
    assert.ok(!l1.normalized_message.includes(FX.typoFrom), "typo eliminated");
    assert.ok(l1.dialect_mapped.some((m) => m.from === FX.dialectFrom), "dialect token mapped");
    assert.strictEqual(l1.direction, "rtl");
    assert.strictEqual(l1.lang, "ar");
    assert.strictEqual(l1.protected_brand_text, FX.acceptanceBrand, "brand locked byte-verbatim");
  });

  await test("P2. Brand heuristic guards: no false positives; hamza/maqsura/marbuta forms unify", async () => {
    assert.strictEqual(norm.runLayer1(FX.genericStore).protected_brand_text, null);
    assert.strictEqual(norm.runLayer1(FX.hybridNoBrand).protected_brand_text, null);
    assert.strictEqual(norm.runLayer1(FX.cityStore).protected_brand_text, null);
    assert.strictEqual(norm.runLayer1(FX.quotedCafe).protected_brand_text, FX.quotedCafeBrand);
    const forms = norm.normalizeArabicForms(FX.hamzaForms);
    assert.ok(!/[أإآٱ]/.test(forms), "hamza carriers unified to bare alef");
    assert.strictEqual(norm.normalizeArabicForms(FX.maqsura), norm.normalizeArabicForms(FX.maqsura).replace(/ى/g, "ي"));
    assert.ok(!/ة/.test(norm.normalizeArabicForms(FX.taMarbuta)), "ta marbuta unified");
  });

  await test("P3. Waw-prefix tolerance: conjunction-prefixed dialect tokens still map", async () => {
    const l1 = norm.runLayer1(FX.acceptanceMessage);
    // The message ends with "and-calm" (waw-prefixed) — must map via prefix rule.
    assert.ok(l1.dialect_mapped.length >= 2, `expected >=2 mappings, got ${l1.dialect_mapped.length}`);
    assert.ok(l1.dialect_mapped.some((m) => m.from.startsWith("و") && m.from.length > 2),
      "waw-prefixed token mapped");
  });

  /* ============ L2: context merging, grounding, contradictions =========== */
  console.log("[L2] Semantic Expansion & Context Merging...");

  await test("P4. Conversational delta merge: night-lighting follow-up keeps brand + desert setting", async () => {
    const first = await engine.enhancePrompt(db, {
      ownerId: OWNER, sessionId: "ses_delta",
      message: FX.acceptanceMessage, presetId: "commercial_storefront",
    });
    assert.ok(first.enhanced_prompt.includes("golden hour") || first.enhanced_prompt.includes("soft diffused"),
      "baseline lighting present");
    const second = await engine.enhancePrompt(db, {
      ownerId: OWNER, sessionId: "ses_delta",
      message: FX.followupNight, presetId: "commercial_storefront",
    });
    assert.ok(/night scene|illuminated signage/i.test(second.enhanced_prompt),
      "night lighting merged");
    assert.ok(second.enhanced_prompt.includes(FX.acceptanceBrand),
      "brand text survives the merge verbatim");
    assert.ok(/desert/i.test(second.enhanced_prompt), "desert setting survives");
    assert.strictEqual(second.protected_brand_text, FX.acceptanceBrand);
  });

  await test("P5. Contradiction resolver: bright sun in dark night resolved coherently + element-add delta", async () => {
    const resolved = ctx.resolveContradictions(FX.contradictory);
    assert.ok(resolved.resolutions.length >= 1, "resolution recorded");
    assert.strictEqual(resolved.flags.time_of_day, "night");
    assert.ok(!resolved.text.includes("شمس"), "conflicting sun cue removed/transformed");
    const contract = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.contradictory,
    });
    assert.ok(/night/i.test(contract.enhanced_prompt), "night setting kept");
    assert.ok(!/bright sun|sunny daylight/i.test(contract.enhanced_prompt),
      "no contradictory sun directive in final prompt");

    // Element-addition delta over a session contract.
    await engine.enhancePrompt(db, {
      ownerId: OWNER, sessionId: "ses_add", message: FX.acceptanceMessage,
    });
    const added = await engine.enhancePrompt(db, {
      ownerId: OWNER, sessionId: "ses_add", message: FX.followupAdd,
    });
    assert.ok(added.enhanced_prompt.includes(FX.acceptanceBrand), "base scene preserved");
    assert.ok(/Additional elements:/i.test(added.enhanced_prompt), "element merged in");
  });

  await test("P6. Cultural & regional grounding follows the request language", async () => {
    const ar = await engine.enhancePrompt(db, { ownerId: OWNER, message: FX.acceptanceMessage, skipCache: true });
    assert.ok(/Arabian Gulf|SAR\/AED|right-to-left/i.test(ar.enhanced_prompt), "Gulf grounding injected");
    const en = await engine.enhancePrompt(db, { ownerId: OWNER, message: FX.englishMessage });
    assert.strictEqual(en.direction, "ltr");
    assert.ok(/international|USD|left-to-right/i.test(en.enhanced_prompt), "international grounding");
  });

  await test("P7. Gap-filling: a three-word request becomes a complete visual spec", async () => {
    const contract = await engine.enhancePrompt(db, { ownerId: OWNER, message: FX.threeWords, skipCache: true });
    assert.ok(contract.enhanced_prompt.length > 300, "spec is complete, not three words");
    assert.ok(/lens/i.test(contract.enhanced_prompt), "lens spec filled");
    assert.ok(/lighting|light/i.test(contract.enhanced_prompt), "lighting spec filled");
    assert.ok(/composition/i.test(contract.enhanced_prompt), "composition spec filled");
  });

  /* ===================== L3: dual-track engineering ====================== */
  console.log("[L3] Dual-Track Visual & UI Engineering...");

  await test("P8. Negative space: right for RTL, left for LTR; image track carries lens+lighting; UI track honestly deferred", async () => {
    const ar = await engine.enhancePrompt(db, { ownerId: OWNER, message: FX.acceptanceMessage, skipCache: true });
    assert.ok(/negative space on the right side/i.test(ar.enhanced_prompt), "RTL -> right negative space");
    const en = await engine.enhancePrompt(db, { ownerId: OWNER, message: FX.englishMessage, skipCache: true });
    assert.ok(/negative space on the left side/i.test(en.enhanced_prompt), "LTR -> left negative space");
    const sf = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, presetId: "commercial_storefront", skipCache: true,
    });
    assert.ok(sf.enhanced_prompt.includes("35mm"), "storefront lens spec");
    const prod = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.threeWords, presetId: "product_studio", skipCache: true,
    });
    assert.ok(prod.enhanced_prompt.includes("85mm"), "product lens spec");
    // UI track: Phase-1 honest envelope (full track ships with Phase 3).
    const ui = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: "dashboard for trading", track: "ui", skipCache: true,
    });
    assert.strictEqual(ui.track, "ui");
    assert.ok(/deferred/i.test(ui.enhanced_prompt), "deferred marker, no fake UI spec");
  });

  /* ================== L4: preset & negative injection ==================== */
  console.log("[L4] Preset, Brand & Negative Rules Injection...");

  await test("P9. Intensity weighting changes the prompt; strong adds boost, subtle drops suffix", async () => {
    const subtle = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, presetId: "commercial_storefront",
      intensity: "subtle", skipCache: true,
    });
    const strong = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, presetId: "commercial_storefront",
      intensity: "strong", skipCache: true,
    });
    assert.notStrictEqual(subtle.enhanced_prompt, strong.enhanced_prompt, "intensity changes output");
    assert.ok(/hero of the shot/i.test(strong.enhanced_prompt), "strong boost merged");
    assert.ok(!/inviting entrance/i.test(subtle.enhanced_prompt), "subtle drops wrapper suffix");
    assert.strictEqual(subtle.preset_intensity, "subtle");
    assert.strictEqual(strong.preset_intensity, "strong");
    // Quick modifiers participate in the request (weighting axis is recorded).
    const w = presets.intensityWeighting("strong");
    assert.ok(w.adds_boost && !w.drops_suffix);
  });

  await test("P10. Dynamic negative rules: per-category + direction-aware + protected-text aware", async () => {
    const commercial = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, presetId: "commercial_storefront", skipCache: true,
    });
    assert.ok(/cluttered right edge/i.test(commercial.negative_prompt), "RTL edge protection");
    assert.ok(/garbled text/i.test(commercial.negative_prompt), "text-distortion rule for signage scenes");
    const photo = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.englishMessage, presetId: "cinematic_photo", skipCache: true,
    });
    assert.ok(/random floating text/i.test(photo.negative_prompt), "no-text scene rule");
    assert.notStrictEqual(commercial.negative_prompt, photo.negative_prompt, "category-specific negatives");
  });

  /* ================== L5: dialect, safety, variations ==================== */
  console.log("[L5] Provider Dialect Adapter, Safety & Variations...");

  await test("P11. Provider dialect: gemini narrative vs fal dense tags; inpaint/outpaint contexts", async () => {
    const gem = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, providerDialect: "gemini", skipCache: true,
    });
    const fal = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, providerDialect: "fal", skipCache: true,
    });
    assert.notStrictEqual(gem.enhanced_prompt, fal.enhanced_prompt, "dialect changes phrasing");
    assert.strictEqual(gem.provider_dialect, "gemini");
    assert.strictEqual(fal.provider_dialect, "fal");
    // Unit-level contexts for Phase-2 editing (adapter contract).
    const inp = dialects.adaptProviderDialect(["a red tent in the desert"], "gemini", "inpaint");
    assert.ok(/masked region only/i.test(inp), "inpaint constraint prefix");
    const outp = dialects.adaptProviderDialect(["a red tent in the desert"], "gemini", "outpaint");
    assert.ok(/Extend the scene beyond the canvas/i.test(outp), "outpaint constraint prefix");
  });

  await test("P12. Variations: 2-4 candidates get genuinely distinct angle/lighting; safety rewrite applied", async () => {
    const c3 = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, candidates: 3, skipCache: true,
    });
    assert.strictEqual(c3.variation_prompts.length, 2, "N-1 variations for N candidates");
    const all = [c3.enhanced_prompt, ...c3.variation_prompts];
    assert.strictEqual(new Set(all).size, 3, "three genuinely distinct prompts");
    const angleLight = c3.variation_prompts.map((v) => v.split(". ")[0]);
    assert.strictEqual(new Set(angleLight).size, 2, "variations differ in angle/lighting treatment");
    assert.ok(/shot|composition/i.test(angleLight[0]), "angle axis present");
    const c4 = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, candidates: 4, skipCache: true,
    });
    assert.strictEqual(c4.variation_prompts.length, 3);
    assert.strictEqual(new Set([c4.enhanced_prompt, ...c4.variation_prompts]).size, 4);
    // Safety rewrite (feature 19): flagged benign word replaced pre-flight.
    const safe = await engine.enhancePrompt(db, { ownerId: OWNER, message: FX.safetyProbe, skipCache: true });
    const row = db.prepare("SELECT contract_json FROM studio_prompt_enhancements WHERE id = ?")
      .get(safe.enhancement_id);
    const meta = JSON.parse(row.contract_json).meta;
    assert.ok(meta.safety_rewrites.length >= 1, "rewrite recorded for audit");
  });

  /* ============ L6: validation, cache, retry, telemetry ================= */
  console.log("[L6] Validation, Caching & Retry Self-Refinement...");

  await test("P13. SHA-256 cache: identical request -> cache_hit:true with ZERO extra LLM calls", async () => {
    let localCalls = 0;
    const llm = {
      local: async () => { localCalls += 1; return JSON.stringify({ scene_details: "warm detailed artisan roastery interior visible through glass", mood: "inviting premium calm", extras: [] }); },
      cloud: async () => { throw new Error("cloud must not be called"); },
    };
    const args = {
      ownerId: OWNER, sessionId: "ses_cache", message: FX.acceptanceMessage,
      presetId: "commercial_storefront", llm,
    };
    const first = await engine.enhancePrompt(db, args);
    const callsAfterFirst = localCalls;
    assert.strictEqual(first.cache_hit, false);
    const second = await engine.enhancePrompt(db, args);
    assert.strictEqual(second.cache_hit, true, "identical fingerprint served from cache");
    assert.strictEqual(second.enhancement_id, first.enhancement_id, "cache returns the stored row");
    assert.strictEqual(localCalls, callsAfterFirst, "ZERO extra LLM calls on cache hit");
    // A changed setting MUST miss the cache.
    const changed = await engine.enhancePrompt(db, { ...args, intensity: "strong" });
    assert.strictEqual(changed.cache_hit, false, "different settings -> different fingerprint");
  });

  await test("P14. Retry/fallback ladder: broken local JSON x2 -> gemini-flash -> zod pass + expansion merged", async () => {
    const calls = [];
    const llm = {
      local: async () => { calls.push("local"); return "this is not json at all"; },
      cloud: async () => {
        calls.push("cloud");
        return JSON.stringify({
          scene_details: "handcrafted brass signage glowing over polished terrazzo floor",
          mood: "warm artisan luxury",
          extras: ["vintage espresso machine"],
        });
      },
    };
    const contract = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, llm, skipCache: true,
    });
    assert.deepStrictEqual(calls, ["local", "local", "cloud"],
      "exactly one local retry, then cloud fallback");
    assert.ok(contract.enhanced_prompt.includes("handcrafted brass signage"),
      "validated expansion merged into the prompt");
    const row = db.prepare("SELECT * FROM studio_prompt_enhancements WHERE id = ?")
      .get(contract.enhancement_id);
    assert.strictEqual(row.engine_provider, "gemini_flash");
    assert.strictEqual(row.fallback_used, 1);
  });

  await test("P15. All LLM hops broken -> honest deterministic continuation, contract still zod-valid", async () => {
    const llm = {
      local: async () => "garbage{{{",
      cloud: async () => "still garbage",
    };
    const contract = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, llm, skipCache: true,
    });
    const valid = schema.validateContract({
      track: contract.track, provider_dialect: contract.provider_dialect,
      direction: contract.direction, protected_brand_text: contract.protected_brand_text,
      preset_id: contract.preset_id, preset_intensity: contract.preset_intensity,
      enhanced_prompt: contract.enhanced_prompt, negative_prompt: contract.negative_prompt,
      variation_prompts: contract.variation_prompts,
      retry_refinement_applied: contract.retry_refinement_applied,
      cache_hit: contract.cache_hit,
    });
    assert.ok(valid.ok, "contract remains valid without any LLM expansion");
    const row = db.prepare("SELECT * FROM studio_prompt_enhancements WHERE id = ?")
      .get(contract.enhancement_id);
    assert.strictEqual(row.engine_provider, "deterministic");
    assert.strictEqual(row.fallback_used, 1, "fallback was attempted and recorded honestly");
  });

  await test("P16. Retry self-refinement: OCR failure -> tightened constraints + retry flag + telemetry row", async () => {
    const base = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, presetId: "commercial_storefront", skipCache: true,
    });
    const refined = engine.refineForRetry(db, {
      ownerId: OWNER, contract: base, gate: "ocr",
      reason: "coverage-below-threshold", missing: [FX.acceptanceBrand],
    });
    assert.strictEqual(refined.retry_refinement_applied, true);
    assert.ok(/maximum contrast/i.test(refined.enhanced_prompt), "contrast constraint added");
    assert.ok(/simplified clean uncluttered background/i.test(refined.enhanced_prompt),
      "background simplification added");
    assert.ok(refined.enhanced_prompt.includes(FX.acceptanceBrand),
      "missing text re-asserted verbatim");
    assert.strictEqual(refined.variation_prompts.length, 0, "single-shot retry, no variations");
    const row = db.prepare("SELECT * FROM studio_prompt_enhancements WHERE id = ?")
      .get(refined.enhancement_id);
    assert.strictEqual(row.retry_refinement_applied, 1, "telemetry row records the refinement");
  });

  await test("P17. Service integration: generation with contract refines OCR retry; variation feeds candidate 2", async () => {
    const contract = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, presetId: "commercial_storefront",
      candidates: 2, styleSeed: "integseed1", skipCache: true,
    });
    // Gate fails once, then passes: the single refinement retry must run.
    let gateCalls = 0;
    const flakyGate = async () => {
      gateCalls += 1;
      return gateCalls === 1
        ? { pass: false, coverage: 0.4, missing: [FX.acceptanceBrand], reason: null }
        : { pass: true, coverage: 1, missing: [], reason: null };
    };
    const asset = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, presetId: "commercial_storefront",
      verifyImpl: flakyGate, skipCache: true,
      enhancerContract: contract, enhancerSessionId: "ses_integ",
    });
    assert.strictEqual(asset.state, "READY");
    assert.strictEqual(asset.attempts, 2, "one refinement retry consumed");
    assert.strictEqual(gateCalls, 2);
    assert.ok(asset.prompt_en.includes(FX.acceptanceBrand), "contract prompt used verbatim");
    assert.ok(/Style seed: integseed1/.test(asset.prompt_en), "seed anchor preserved");
    const retryRow = db.prepare(
      "SELECT * FROM studio_prompt_enhancements WHERE owner_id = ? AND retry_refinement_applied = 1 ORDER BY created_at DESC LIMIT 1",
    ).get(OWNER);
    assert.ok(retryRow, "refinement telemetry row written by the pipeline");
    assert.ok(retryRow.raw_message.startsWith("[retry-refinement:ocr]"));

    // Candidate 2 flows through variation_prompts[0].
    const passGate = async () => ({ pass: true, coverage: 1, missing: [], reason: null });
    const second = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, presetId: "commercial_storefront",
      verifyImpl: passGate, skipCache: true,
      enhancerContract: contract, variationIndex: 1, seedOverride: "integseed2",
    });
    assert.strictEqual(second.state, "READY");
    assert.ok(/wide-angle eye-level shot|three-quarter perspective/i.test(second.prompt_en),
      "candidate 2 uses the variation treatment");
  });

  await test("P18. Pro override + telemetry ledger + HTTP surface + tenant isolation + English gate", async () => {
    // Pro override (feature 24): manual prompt, zero LLM, auditable.
    let llmCalls = 0;
    const spy = { local: async () => { llmCalls += 1; return "{}"; } };
    const manual = "Architectural photography of a quiet desert coffee kiosk at dusk, 35mm, soft haze";
    const override = await engine.enhancePrompt(db, {
      ownerId: OWNER, message: FX.acceptanceMessage, overridePrompt: manual, llm: spy, skipCache: true,
    });
    assert.ok(override.enhanced_prompt.startsWith("Architectural photography"), "override used verbatim");
    assert.strictEqual(llmCalls, 0, "override skips every LLM hop");
    const oRow = db.prepare("SELECT * FROM studio_prompt_enhancements WHERE id = ?").get(override.enhancement_id);
    assert.strictEqual(oRow.override_used, 1);

    // Telemetry ledger: raw vs enhanced + latency + status flags.
    const ledger = store.listEnhancements(db, OWNER, { limit: 200 });
    assert.ok(ledger.length >= 5, "ledger accumulates rows");
    assert.ok(ledger.every((r) => r.owner_id === OWNER), "owner isolation in ledger");
    assert.ok(ledger.every((r) => r.raw_message && r.contract_json), "raw + enhanced recorded");
    assert.strictEqual(store.listEnhancements(db, OTHER, { limit: 200 }).length, 0,
      "other tenant sees nothing");

    // HTTP surface: POST /enhance (contract + legacy keys) + GET /enhance/telemetry + 401.
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
      const unauth = await fetch(`${base}/api/studio/enhance`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: FX.threeWords }) });
      assert.strictEqual(unauth.status, 401, "auth enforced");

      const res = await fetch(`${base}/api/studio/enhance`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: FX.acceptanceMessage, preset_id: "commercial_storefront", candidates: 2 }),
      });
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.protected_brand_text, FX.acceptanceBrand);
      assert.strictEqual(body.direction, "rtl");
      assert.ok(body.enhanced_prompt && body.negative_prompt, "official contract keys");
      assert.ok(body.prompt_en && body.negative && Array.isArray(body.overlay_texts),
        "legacy keys kept for older clients");
      assert.strictEqual(body.variation_prompts.length, 1);

      const tel = await fetch(`${base}/api/studio/enhance/telemetry?limit=10`, { headers: H });
      assert.strictEqual(tel.status, 200);
      const telBody = await tel.json();
      assert.ok(telBody.enhancements.length >= 1, "telemetry over HTTP");
      assert.ok(telBody.enhancements.every((r) => r.raw_message && typeof r.latency_ms === "number"));
    } finally {
      server.close();
    }

    // 100% English Codebase gate: engine files (except the i18n lexicon) must
    // contain zero Arabic code points.
    const root = path.join(__dirname, "..", "..", "server", "studio", "enhancer");
    const files = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith(".js") && e.name !== "enhancerLexicon.js") files.push(p);
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
  console.log(`✅ PROMPT ENHANCER ENGINE SUITE: ${passed}/${total} PASSED`);
  console.log("================================================================");
}

runEnhancerSuite()
  .then(() => { closeDb(); process.exit(0); })
  .catch((err) => {
    console.error("\n❌ PROMPT ENHANCER ENGINE SUITE FAILED:", err);
    try { closeDb(); } catch { /* ignore */ }
    process.exit(1);
  });
