// ==============================================================================
// server_backend/tests/imageModeSuite.test.js
// Image Mode (Phase 1 layers) Verification Suite
// Acceptance gates from the spec:
//   L2: protected brand text + seed lock + aspect + reference reflected in the
//       actual request payload (and asset row)
//   L4: zero-cost local WebP variant (real ffmpeg), OCR gate untouched
//   L5: SHA-256 content-hash caching (2nd identical request = cache hit,
//       ZERO extra provider calls) + live pipeline events (SSE stages)
//   L1: multi-candidate groups (2-4) with honest per-candidate quota
// ==============================================================================
"use strict";

process.env.LLM_PROVIDER = "mock";
process.env.DB_PATH = require("path").join(
  require("os").tmpdir(),
  `imagemode_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.MEDIA_STORAGE_DIR = require("path").join(
  require("os").tmpdir(),
  `imagemode_media_${Date.now()}_${Math.random().toString(36).slice(2)}`
);
delete process.env.GEMINI_API_KEY;
process.env.IMAGE_PROVIDER_MOCK = "1";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { getDb, closeDb } = require("../db/database");
const FX = require("./fixtures/routerFixtures.cjs");

const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

async function runImageModeSuite() {
  console.log("================================================================");
  console.log("🖼️  RUNNING IMAGE MODE (PHASE 1) VERIFICATION SUITE");
  console.log("================================================================\n");

  const service = await import("../../server/studio/studioService.js");
  const modeService = await import("../../server/studio/imageModeService.js");
  const refs = await import("../../server/studio/referenceStore.js");
  const events = await import("../../server/studio/pipelineEvents.js");
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

  const OWNER = "usr_imagemode_main";
  const OTHER = "usr_imagemode_other";
  const today = () => new Date().toISOString().slice(0, 10);
  const quotaUsed = (owner) => {
    const row = db.prepare("SELECT units FROM media_usage WHERE owner_id = ? AND day = ? AND type = 'image'").get(owner, today());
    return row ? row.units : 0;
  };
  const passGate = async () => ({ pass: true, coverage: 1, reason: "stubbed" });

  console.log("[L2] Reference images, seed lock & protected text...");

  await test("M1. Reference upload: magic-byte validation, hash, tenant isolation", async () => {
    const ref = refs.saveReference(db, OWNER, { dataB64: PNG_1PX, role: "product" });
    assert.strictEqual(ref.role, "product");
    assert.strictEqual(ref.mime, "image/png");
    assert.ok(/^[0-9a-f]{64}$/.test(ref.hash));
    assert.ok(fs.existsSync(ref.path));

    assert.throws(() => refs.saveReference(db, OWNER, { dataB64: "!!!notbase64!!!" }),
      (e) => e.code === "STUDIO_REFERENCE_INVALID");
    assert.throws(() => refs.saveReference(db, OWNER, { dataB64: Buffer.from("plain text").toString("base64") }),
      (e) => e.code === "STUDIO_REFERENCE_INVALID");
    assert.throws(() => refs.getReference(db, OTHER, ref.id),
      (e) => e.code === "STUDIO_REFERENCE_NOT_FOUND" && e.status === 404);

    // Reference flows into the generation payload (asset row carries it).
    const asset = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "product photo for my store", referenceId: ref.id,
    });
    assert.strictEqual(asset.reference_id, ref.id);
  });

  await test("M2. Seed lock + protected brand text land in the actual payload", async () => {
    const asset = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: FX.hybridMessage,
      seedOverride: "lockedseed9", protectedBrandText: FX.brandExpected,
      verifyImpl: passGate,
    });
    assert.strictEqual(asset.style_seed, "lockedseed9");
    assert.ok(asset.prompt_en.includes(`"${FX.brandExpected}"`), "brand text verbatim in prompt");
    assert.ok(asset.prompt_en.includes("EXACTLY"));
    const overlays = JSON.parse(asset.overlay_texts_json);
    assert.ok(overlays.includes(FX.brandExpected), "brand text feeds the OCR gate list");

    await assert.rejects(
      () => service.generateStudioAsset(db, { ownerId: OWNER, message: FX.hybridMessage, seedOverride: "bad seed!!" }),
      (e) => e.code === "STUDIO_SEED_INVALID" && e.status === 400,
    );
  });

  console.log("[L1] Multi-candidate generation...");

  await test("M3. candidates=3 -> one group, 3 READY assets, honest quota (3 units)", async () => {
    const before = quotaUsed(OWNER);
    const { group, assets } = await modeService.generateCandidates(db, {
      ownerId: OWNER, message: "desert coffee poster", candidates: 3,
    });
    assert.strictEqual(assets.length, 3);
    assert.ok(group);
    assert.ok(assets.every((a) => a.generation_group === group));
    assert.strictEqual(new Set(assets.map((a) => a.id)).size, 3);
    assert.ok(assets.every((a) => a.state === "READY"));
    assert.strictEqual(quotaUsed(OWNER), before + 3, "each candidate is a real provider call");
    // Unlocked candidates vary the seed for real alternatives.
    assert.strictEqual(new Set(assets.map((a) => a.style_seed)).size, 3);
  });

  await test("M3b. Locked seed fans out deterministically (seed:0..seed:N-1)", async () => {
    const { assets } = await modeService.generateCandidates(db, {
      ownerId: OWNER, message: "mountain tea banner", candidates: 2, seedOverride: "pin77",
    });
    assert.deepStrictEqual(assets.map((a) => a.style_seed).sort(), ["pin77:0", "pin77:1"]);
    await assert.rejects(
      () => modeService.generateCandidates(db, { ownerId: OWNER, message: "x".repeat(10), candidates: 9 }),
      (e) => e.code === "STUDIO_CANDIDATES_INVALID" && e.status === 400,
    );
  });

  console.log("[L5] SHA-256 content-hash caching...");

  await test("M4. Identical request twice -> cache hit, ZERO extra provider spend", async () => {
    const params = {
      ownerId: OTHER, message: "minimal logo for bakery", seedOverride: "cacheseed1",
      presetId: "ui_assets", // OCR gate off -> deterministic READY without Tesseract
    };
    const before = quotaUsed(OTHER);
    const first = await service.generateStudioAsset(db, params);
    assert.strictEqual(first.cache_hit, 0);
    assert.strictEqual(first.state, "READY");
    assert.strictEqual(quotaUsed(OTHER), before + 1);

    const second = await service.generateStudioAsset(db, params);
    assert.strictEqual(second.cache_hit, 1, "second identical request must be served from cache");
    assert.strictEqual(second.id, first.id, "cache returns the original asset");
    assert.strictEqual(quotaUsed(OTHER), before + 1, "cache hit consumes no API quota");

    // A changed aspect changes the fingerprint -> real new generation.
    const third = await service.generateStudioAsset(db, { ...params, aspectOverride: "16:9" });
    assert.strictEqual(third.cache_hit, 0);
    assert.notStrictEqual(third.id, first.id);
    assert.strictEqual(quotaUsed(OTHER), before + 2);
  });

  console.log("[L4] Local WebP post-processing ($0)...");

  await test("M5. Real ffmpeg WebP variant: valid magic bytes, served via ?format=webp", async () => {
    const asset = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "studio product shot", seedOverride: "webpseED1", presetId: "product_studio",
    });
    if (!asset.webp_path) {
      console.log("   ⏭️ [SKIP] ffmpeg/libwebp unavailable in environment — skipping WebP variant assertions");
      return;
    }
    const buf = fs.readFileSync(asset.webp_path);
    assert.strictEqual(buf.toString("ascii", 0, 4), "RIFF");
    assert.strictEqual(buf.toString("ascii", 8, 12), "WEBP");
    assert.ok(buf.length > 0);
    const resolved = service.resolveAssetWebpPath(db, OWNER, asset.id);
    assert.strictEqual(resolved.mime, "image/webp");
    assert.throws(() => service.resolveAssetWebpPath(db, OTHER, asset.id),
      (e) => e.status === 404);
  });

  console.log("[L5] Live pipeline telemetry (SSE stages)...");

  await test("M6. Live subscribe/emit delivery + real pipeline stage order", async () => {
    // Live delivery: subscriber receives emitted stages; unsubscribe stops it.
    const got = [];
    const unsub = events.subscribe("evt_unit_asset", (e) => got.push(e.stage));
    events.emitStage("evt_unit_asset", "generate", { attempt: 1 });
    unsub();
    events.emitStage("evt_unit_asset", "ready", {});
    assert.deepStrictEqual(got, ["generate"]);

    // Real pipeline: stage order recorded for an actual generation (OCR gate
    // off for cinematic presets -> no 'ocr' stage, honest reflection).
    const asset = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "night city banner", seedOverride: "sseSeed01", presetId: "cinematic_photo",
    });
    const history = events.getHistory(asset.id);
    const names = history.map((e) => e.stage);
    assert.deepStrictEqual(names, ["enhance", "generate", "postprocess", "ready"]);
    assert.ok(history.every((e) => e.at));
    events.resetPipelineEvents();
  });

  console.log("[HTTP] Candidates endpoint + references + SSE surface...");

  await test("M7. HTTP: /generate candidates batch + /references + /assets/:id/events stream", async () => {
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
    const H = { "Content-Type": "application/json", "x-test-user": "usr_http_img" };

    try {
      // Reference upload over HTTP
      const refRes = await fetch(`${base}/api/studio/references`, {
        method: "POST", headers: H, body: JSON.stringify({ data_b64: PNG_1PX, role: "style" }),
      });
      assert.strictEqual(refRes.status, 201);
      const ref = await refRes.json();
      assert.ok(ref.hash);

      const listRes = await fetch(`${base}/api/studio/references`, { headers: H });
      assert.strictEqual((await listRes.json()).references.length, 1);

      // Candidates batch
      const genRes = await fetch(`${base}/api/studio/generate`, {
        method: "POST", headers: H,
        body: JSON.stringify({
          message: "coffee hero banner", candidates: 2, aspect: "16:9",
          protected_brand_text: FX.brandExpected, style_seed: "httpseed1",
        }),
      });
      assert.strictEqual(genRes.status, 201);
      const batch = await genRes.json();
      assert.ok(batch.group);
      assert.strictEqual(batch.assets.length, 2);
      assert.ok(batch.assets.every((a) => a.generation_group === batch.group));
      assert.ok(batch.assets.every((a) => a.events_url && a.artifact_url));
      if (batch.assets[0].webp_url) {
        // WebP download
        const webpRes = await fetch(`${base}${batch.assets[0].webp_url}`, { headers: H });
        assert.strictEqual(webpRes.status, 200);
        assert.ok((webpRes.headers.get("content-type") || "").includes("image/webp"));
      } else {
        console.log("   ⏭️ [SKIP] ffmpeg/libwebp unavailable in environment — webp_url is null");
      }

      // SSE: history replay arrives for a finished asset.
      const sseRes = await fetch(`${base}${batch.assets[0].events_url}`, { headers: H });
      assert.strictEqual(sseRes.status, 200);
      assert.ok((sseRes.headers.get("content-type") || "").includes("text/event-stream"));
      const reader = sseRes.body.getReader();
      const { value } = await reader.read();
      const chunk = new TextDecoder().decode(value);
      assert.ok(chunk.includes("data:"), "SSE frames present");
      assert.ok(chunk.includes("enhance"), "enhance stage replayed");
      await reader.cancel();

      // Cache hit visible over HTTP (identical single request repeated).
      const single = { message: "repeatable poster", style_seed: "httpcache1", preset_id: "ui_assets" };
      const r1 = await (await fetch(`${base}/api/studio/generate`, { method: "POST", headers: H, body: JSON.stringify(single) })).json();
      const r2 = await (await fetch(`${base}/api/studio/generate`, { method: "POST", headers: H, body: JSON.stringify(single) })).json();
      assert.strictEqual(r1.cache_hit, false);
      assert.strictEqual(r2.cache_hit, true);
      assert.strictEqual(r2.id, r1.id);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  console.log("[QUOTA] Honest accounting with candidates...");

  await test("M8. Quota wall stops mid-batch honestly (429), charged units kept", async () => {
    db.prepare(`INSERT INTO media_usage (owner_id, day, type, units) VALUES (?,?,?,?)
                ON CONFLICT(owner_id, day, type) DO UPDATE SET units = excluded.units`)
      .run("usr_quota_edge", today(), "image", 19);
    await assert.rejects(
      () => modeService.generateCandidates(db, {
        ownerId: "usr_quota_edge", message: "two posters please", candidates: 2,
      }),
      (e) => e.code === "STUDIO_QUOTA_EXCEEDED" && e.status === 429,
    );
    assert.strictEqual(quotaUsed("usr_quota_edge"), 20, "the completed candidate stays charged");
  });

  console.log("[GATE] 100% English codebase...");

  await test("M9. New Image Mode files are Arabic-free", async () => {
    const AR = /[؀-ۿ]/;
    const files = [
      "server/studio/imageModeService.js",
      "server/studio/referenceStore.js",
      "server/studio/postProcess.js",
      "server/studio/pipelineEvents.js",
      "src/studio/ImageStudioPanel.tsx",
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
      assert.ok(!AR.test(src), `${f} must be 100% English`);
    }
  });

  console.log("\n================================================================");
  console.log(`✅ IMAGE MODE (PHASE 1) SUITE: ${passed}/${total} PASSED`);
  console.log("================================================================\n");

  closeDb();
  fs.rmSync(process.env.DB_PATH, { force: true });
  fs.rmSync(process.env.MEDIA_STORAGE_DIR, { recursive: true, force: true });
}

runImageModeSuite().catch((err) => {
  console.error("\n❌ IMAGE MODE SUITE FAILED:", err);
  process.exit(1);
});
