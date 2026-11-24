// ==============================================================================
// server_backend/tests/smartStudioSuite.test.js
// Smart Studio — Phase 1 Verification Suite
// Verifies:
//   1. Smart Intent Router (image / ui / hybrid / chat + Quick Clarifiers)
//   2. Prompt Enhancer (Arabic dialect -> professional English, overlay extraction)
//   3. Smart Presets (cinematic / storefront / product)
//   4. Provider honesty (BLOCKED when unconfigured, never a fake image)
//   5. OCR Typography Gate (real Tesseract, >=0.95 coverage, one emphasis retry)
//   6. Generation orchestration (quota, artifact magic bytes, honest end states)
//   7. Tenant isolation + path traversal protection
//   8. HTTP routes (route / enhance / presets / generate / artifact download)
// ==============================================================================
"use strict";

process.env.LLM_PROVIDER = "mock";
process.env.DB_PATH = require("path").join(
  require("os").tmpdir(),
  `studio_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.MEDIA_STORAGE_DIR = require("path").join(
  require("os").tmpdir(),
  `studio_media_${Date.now()}_${Math.random().toString(36).slice(2)}`
);
delete process.env.GEMINI_API_KEY;
delete process.env.IMAGE_PROVIDER_MOCK;
delete process.env.MEDIA_IMAGE_BASE_URL;
delete process.env.MEDIA_IMAGE_API_KEY;
delete process.env.MEDIA_IMAGE_MODEL;

const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execFileSync } = require("node:child_process");
const { getDb, closeDb } = require("../db/database");

const PNG_1PX_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// ---- Optional real-OCR fixtures (skipped honestly when tools are missing) ----
function pilAvailable() {
  try {
    execFileSync("python3", ["-c", "import PIL"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
function makeTextPng(outPath, text) {
  const script = [
    "import sys",
    "from PIL import Image, ImageDraw, ImageFont",
    "out, text = sys.argv[1], sys.argv[2]",
    "img = Image.new('RGB', (1000, 320), 'white')",
    "d = ImageDraw.Draw(img)",
    "try:",
    "    f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 90)",
    "except Exception:",
    "    f = ImageFont.load_default()",
    "d.text((40, 100), text, font=f, fill='black')",
    "img.save(out)",
  ].join("\n");
  execFileSync("python3", ["-c", script, outPath, text], { stdio: "pipe" });
}

async function runSmartStudioSuite() {
  console.log("================================================================");
  console.log("🎨 RUNNING SMART STUDIO PHASE 1 VERIFICATION SUITE");
  console.log("================================================================\n");

  const router = await import("../../server/studio/intentRouter.js");
  const enhancer = await import("../../server/studio/promptEnhancer.js");
  const presets = await import("../../server/studio/imagePresets.js");
  const providers = await import("../../server/studio/imageProviders.js");
  const gate = await import("../../server/studio/qualityGate.js");
  const service = await import("../../server/studio/studioService.js");
  const { studioRoutes } = await import("../../server/studio/studioRoutes.js");

  const db = getDb();
  let passed = 0;
  let total = 0;
  let skipped = 0;

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
  function skip(name, reason) {
    skipped++;
    console.log(`  ⏭️  [SKIP] ${name} — ${reason}`);
  }

  const tessOk = await gate.tesseractAvailable();
  const pilOk = pilAvailable();
  const ocrFixturesReady = tessOk && pilOk;
  if (!ocrFixturesReady) {
    console.log(`  ⚠️  OCR fixtures unavailable (tesseract=${tessOk}, PIL=${pilOk}) — OCR integration tests will SKIP honestly.\n`);
  }

  // --------------------------------------------------------------------------
  console.log("[A] Smart Intent Router...");
  // --------------------------------------------------------------------------

  await test("A1. Image request (Arabic) -> mode=image, sector=coffee detected", async () => {
    const r = router.classifyIntent("صمم لي شعار لمحل قهوة");
    assert.strictEqual(r.mode, "image");
    assert.strictEqual(r.sector, "coffee");
    assert.ok(r.confidence > 0 && r.confidence <= 1);
  });

  await test("A2. UI request -> mode=ui with platform & theme clarifiers", async () => {
    const r = router.classifyIntent("أريد لوحة تحكم لإدارة المبيعات");
    assert.strictEqual(r.mode, "ui");
    const ids = r.clarifiers.map((c) => c.id);
    assert.ok(ids.includes("platform"), "platform clarifier expected");
    assert.ok(ids.includes("theme"), "theme clarifier expected");
    const platform = r.clarifiers.find((c) => c.id === "platform");
    assert.deepStrictEqual(platform.options.map((o) => o.id), ["web", "mobile"]);
  });

  await test("A3. UI + asset hint -> mode=hybrid", async () => {
    const r = router.classifyIntent("أريد تطبيق متجر إلكتروني مع صور منتجات");
    assert.strictEqual(r.mode, "hybrid");
    assert.ok(r.scores.ui > 0);
  });

  await test("A4. Plain question -> mode=chat, no clarifiers, never burns generation", async () => {
    const r = router.classifyIntent("كيف أضيف مصادقة المستخدمين؟");
    assert.strictEqual(r.mode, "chat");
    assert.strictEqual(r.clarifiers.length, 0);
  });

  await test("A5. Answered clarifiers are suppressed; explicit answers beat detection", async () => {
    const r = router.classifyIntent("أريد لوحة تحكم لإدارة المبيعات", {
      answers: { platform: "mobile", theme: "dark", sector: "trading" },
    });
    assert.strictEqual(r.clarifiers.length, 0, "all answered -> no clarifiers");
    assert.strictEqual(r.platform, "mobile");
    assert.strictEqual(r.theme, "dark");
    assert.strictEqual(r.sector, "trading");
  });

  await test("A6. Platform/theme detection from message text (جوال/داكن)", async () => {
    assert.strictEqual(router.detectPlatform("تطبيق جوال"), "mobile");
    assert.strictEqual(router.detectPlatform("موقع ويب"), "web");
    assert.strictEqual(router.detectTheme("ثيم داكن"), "dark");
    assert.strictEqual(router.detectTheme("تصميم فاتح"), "light");
  });

  // --------------------------------------------------------------------------
  console.log("[B] Prompt Enhancer...");
  // --------------------------------------------------------------------------

  await test("B1. Arabic dialect normalization (ابي/زين/مرة)", async () => {
    const n = enhancer.normalizeArabic("ابي صورة زين مرة");
    assert.ok(n.includes("أريد"), `expected أريد in: ${n}`);
    assert.ok(n.includes("احترافي عالي الجودة"), `expected quality phrase in: ${n}`);
    assert.ok(n.includes("جداً"), `expected جداً in: ${n}`);
  });

  await test("B2. Overlay text extraction («...» quotes + باسم pattern)", async () => {
    const t1 = enhancer.extractOverlayTexts("صورة لواجهة مقهى باسم «قهوة الرياض»");
    assert.ok(t1.includes("قهوة الرياض"), `expected «قهوة الرياض» in ${JSON.stringify(t1)}`);
    const t2 = enhancer.extractOverlayTexts("لافتة محل باسم مخبز الأصالة");
    assert.ok(t2.some((t) => t.includes("مخبز")), `expected باسم-capture in ${JSON.stringify(t2)}`);
  });

  await test("B3. Professional English prompt: preset prefix + sector + EXACT overlay instruction", async () => {
    const built = enhancer.buildProfessionalPrompt({
      message: "صورة واجهة مقهى باسم «RIYADH COFFEE»",
      preset: presets.getPreset("storefront"),
      sector: "coffee",
      theme: "dark",
      platform: "web",
    });
    assert.ok(built.prompt_en.includes("storefront"), "preset prefix must lead");
    assert.ok(built.prompt_en.includes("specialty coffee shop"), "sector must be translated");
    assert.ok(built.prompt_en.includes("EXACTLY"), "overlay EXACT instruction required");
    assert.ok(built.prompt_en.includes('"RIYADH COFFEE"'), "overlay text must be quoted verbatim");
    assert.deepStrictEqual(built.overlay_texts, ["RIYADH COFFEE"]);
    assert.ok(built.negative.length > 0);
  });

  // --------------------------------------------------------------------------
  console.log("[C] Smart Presets...");
  // --------------------------------------------------------------------------

  await test("C1. Registry exposes 6 presets; legacy ids resolve via alias map", async () => {
    const list = presets.listPresets();
    assert.deepStrictEqual(list.map((p) => p.id), [
      "cinematic_photo", "commercial_storefront", "product_studio",
      "ui_assets", "fintech_tech", "marketing_banner",
    ]);
    assert.strictEqual(presets.getPreset("storefront").default_aspect, "16:9");
    assert.strictEqual(presets.getPreset("commercial_storefront").default_aspect, "16:9");
    assert.strictEqual(presets.getPreset("product").default_aspect, "1:1");
    assert.strictEqual(presets.getPreset("nope"), null);
  });

  // --------------------------------------------------------------------------
  console.log("[D] Provider honesty...");
  // --------------------------------------------------------------------------

  await test("D1. Unconfigured provider -> honest BLOCKED, generate refuses", async () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.IMAGE_PROVIDER_MOCK;
    const st = providers.studioImageProviderStatus();
    assert.strictEqual(st.status, "BLOCKED");
    const r = await providers.generateStudioImage({ prompt: "x", fetchImpl: async () => { throw new Error("network must not be called"); } });
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.blocked, true);
  });

  await test("D2. Mock provider -> deterministic valid PNG", async () => {
    process.env.IMAGE_PROVIDER_MOCK = "1";
    const st = providers.studioImageProviderStatus();
    assert.strictEqual(st.status, "READY");
    assert.strictEqual(st.provider, "mock");
    const r = await providers.generateStudioImage({ prompt: "x" });
    assert.strictEqual(r.ok, true);
    const buf = Buffer.from(r.b64, "base64");
    assert.deepStrictEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47], "PNG magic bytes");
    delete process.env.IMAGE_PROVIDER_MOCK;
  });

  await test("D3. Gemini request shape: native generateContent + x-goog-api-key header", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    let seenUrl = null;
    let seenKey = null;
    const fetchImpl = async (url, opts) => {
      seenUrl = url;
      seenKey = opts.headers["x-goog-api-key"];
      return {
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: PNG_1PX_B64, mimeType: "image/png" } }] } }] }),
      };
    };
    const r = await providers.generateStudioImage({ prompt: "p", aspect: "16:9", fetchImpl });
    assert.strictEqual(r.ok, true);
    assert.ok(seenUrl.includes("generativelanguage.googleapis.com"), `url: ${seenUrl}`);
    assert.ok(seenUrl.includes(":generateContent"), `url: ${seenUrl}`);
    assert.strictEqual(seenKey, "test-key-123");
    assert.strictEqual(r.provider, "gemini");
    delete process.env.GEMINI_API_KEY;
  });

  // --------------------------------------------------------------------------
  console.log("[E] OCR Typography Gate...");
  // --------------------------------------------------------------------------

  await test("E1. textCoverage: full / partial / empty-expected cases", async () => {
    const full = gate.textCoverage(["Riyadh Coffee"], "welcome to RIYADH COFFEE shop");
    assert.strictEqual(full.coverage, 1);
    const half = gate.textCoverage(["Riyadh Coffee"], "welcome to riyadh");
    assert.strictEqual(half.coverage, 0.5);
    assert.deepStrictEqual(half.missing, ["coffee"]);
    const none = gate.textCoverage([], "anything");
    assert.strictEqual(none.coverage, 1, "no overlay texts -> trivially satisfied");
  });

  if (ocrFixturesReady) {
    await test("E2. REAL OCR pass: rendered text image -> coverage >= 0.95", async () => {
      const p = path.join(os.tmpdir(), `studio_ok_${Date.now()}.png`);
      makeTextPng(p, "RIYADH COFFEE");
      const r = await gate.verifyImageTexts(p, ["RIYADH COFFEE"]);
      assert.strictEqual(r.pass, true, `expected pass, got coverage=${r.coverage} missing=${JSON.stringify(r.missing)}`);
      assert.ok(r.coverage >= 0.95);
    });

    await test("E3. REAL OCR fail: wrong text -> pass=false, coverage < 0.95", async () => {
      const p = path.join(os.tmpdir(), `studio_bad_${Date.now()}.png`);
      makeTextPng(p, "HELLO WORLD");
      const r = await gate.verifyImageTexts(p, ["RIYADH COFFEE"]);
      assert.strictEqual(r.pass, false);
      assert.ok(r.coverage < 0.95, `coverage=${r.coverage}`);
    });
  } else {
    skip("E2. REAL OCR pass", "tesseract/PIL unavailable");
    skip("E3. REAL OCR fail", "tesseract/PIL unavailable");
  }

  // --------------------------------------------------------------------------
  console.log("[F] Generation orchestration (service)...");
  // --------------------------------------------------------------------------

  await test("F1. Mock generation -> READY, artifact on disk with PNG magic, quota charged 1", async () => {
    process.env.IMAGE_PROVIDER_MOCK = "1";
    const owner = "usr_studio_f1";
    const asset = await service.generateStudioAsset(db, {
      ownerId: owner,
      message: "صورة مشهد سينمائي لشارع الرياض ليلاً",
      presetId: "cinematic",
    });
    assert.strictEqual(asset.state, "READY");
    assert.strictEqual(asset.preset, "cinematic_photo", "legacy id resolves to canonical preset");
    assert.strictEqual(asset.attempts, 1);
    assert.ok(fs.existsSync(asset.artifact_path), "artifact must exist");
    const buf = fs.readFileSync(asset.artifact_path);
    assert.deepStrictEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.strictEqual(asset.artifact_bytes, buf.length);
    const q = service.studioQuota(db, owner);
    assert.strictEqual(q.used, 1);
    delete process.env.IMAGE_PROVIDER_MOCK;
  });

  await test("F2. Tenant isolation: owner B cannot read owner A asset (404)", async () => {
    const ownerA = "usr_studio_f2a";
    const ownerB = "usr_studio_f2b";
    process.env.IMAGE_PROVIDER_MOCK = "1";
    const asset = await service.generateStudioAsset(db, { ownerId: ownerA, message: "صورة بانر إعلاني" });
    delete process.env.IMAGE_PROVIDER_MOCK;
    assert.throws(
      () => service.getAsset(db, ownerB, asset.id),
      (err) => err.code === "STUDIO_ASSET_NOT_FOUND" && err.status === 404
    );
    const listB = service.listAssets(db, ownerB, {});
    assert.strictEqual(listB.length, 0);
  });

  await test("F3. Path traversal in artifact_path -> 403 forbidden", async () => {
    const owner = "usr_studio_f3";
    process.env.IMAGE_PROVIDER_MOCK = "1";
    const asset = await service.generateStudioAsset(db, { ownerId: owner, message: "صورة غلاف كتاب" });
    delete process.env.IMAGE_PROVIDER_MOCK;
    db.prepare("UPDATE studio_assets SET artifact_path = ? WHERE id = ?").run("../../etc/passwd", asset.id);
    assert.throws(
      () => service.resolveAssetPath(db, owner, asset.id),
      (err) => err.code === "STUDIO_PATH_FORBIDDEN" && err.status === 403
    );
  });

  await test("F4. Quota exhaustion -> 429, no generation attempted", async () => {
    const owner = "usr_studio_f4";
    const day = new Date().toISOString().slice(0, 10);
    db.prepare(`INSERT INTO media_usage (owner_id, day, type, units) VALUES (?,?,?,?)
                ON CONFLICT(owner_id, day, type) DO UPDATE SET units = excluded.units`)
      .run(owner, day, "image", 20);
    process.env.IMAGE_PROVIDER_MOCK = "1";
    await assert.rejects(
      service.generateStudioAsset(db, { ownerId: owner, message: "صورة منتج" }),
      (err) => err.code === "STUDIO_QUOTA_EXCEEDED" && err.status === 429
    );
    delete process.env.IMAGE_PROVIDER_MOCK;
    const rows = service.listAssets(db, owner, {});
    assert.strictEqual(rows.length, 0, "quota rejection must not create rows");
  });

  await test("F5. Provider BLOCKED -> 503, no row, no quota charge", async () => {
    const owner = "usr_studio_f5";
    await assert.rejects(
      service.generateStudioAsset(db, { ownerId: owner, message: "صورة منتج" }),
      (err) => err.code === "STUDIO_PROVIDER_BLOCKED" && err.status === 503
    );
    assert.strictEqual(service.listAssets(db, owner, {}).length, 0);
    assert.strictEqual(service.studioQuota(db, owner).used, 0);
  });

  await test("F6. Invalid image bytes from provider -> 502, asset FAILED (never stuck RUNNING)", async () => {
    process.env.GEMINI_API_KEY = "test-key-123";
    const owner = "usr_studio_f6";
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: Buffer.from("not-an-image").toString("base64"), mimeType: "image/png" } }] } }] }),
    });
    await assert.rejects(
      service.generateStudioAsset(db, { ownerId: owner, message: "صورة بانر", fetchImpl }),
      (err) => err.code === "STUDIO_ARTIFACT_INVALID" && err.status === 502
    );
    const rows = service.listAssets(db, owner, {});
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].state, "FAILED", "asset must be FAILED, not stuck RUNNING");
    delete process.env.GEMINI_API_KEY;
  });

  if (ocrFixturesReady) {
    await test("F7. REAL retry orchestration: wrong text -> emphasis retry -> right text -> READY (attempts=2)", async () => {
      const wrongPng = path.join(os.tmpdir(), `studio_wrong_${Date.now()}.png`);
      const rightPng = path.join(os.tmpdir(), `studio_right_${Date.now()}.png`);
      makeTextPng(wrongPng, "HELLO WORLD");
      makeTextPng(rightPng, "RIYADH COFFEE");
      const wrongB64 = fs.readFileSync(wrongPng).toString("base64");
      const rightB64 = fs.readFileSync(rightPng).toString("base64");

      process.env.GEMINI_API_KEY = "test-key-123";
      const owner = "usr_studio_f7";
      let call = 0;
      const prompts = [];
      const fetchImpl = async (url, opts) => {
        call++;
        prompts.push(JSON.parse(opts.body).contents[0].parts[0].text);
        const b64 = call === 1 ? wrongB64 : rightB64;
        return {
          ok: true,
          json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: b64, mimeType: "image/png" } }] } }] }),
        };
      };
      const asset = await service.generateStudioAsset(db, {
        ownerId: owner,
        message: "صورة واجهة مقهى باسم «RIYADH COFFEE»",
        fetchImpl,
      });
      assert.strictEqual(asset.state, "READY", `expected READY, got ${asset.state} (${asset.error_summary})`);
      assert.strictEqual(asset.attempts, 2, "exactly one emphasis retry");
      assert.ok(asset.ocr_coverage >= 0.95);
      assert.ok(prompts[1].includes("CRITICAL"), "retry prompt must carry typography emphasis");
      assert.strictEqual(service.studioQuota(db, owner).used, 2, "two real provider calls = two units");
      delete process.env.GEMINI_API_KEY;
    });

    await test("F8. REAL gate failure: both attempts wrong -> QUALITY_GATE_FAILED honestly", async () => {
      const wrongPng = path.join(os.tmpdir(), `studio_wrong2_${Date.now()}.png`);
      makeTextPng(wrongPng, "HELLO WORLD");
      const wrongB64 = fs.readFileSync(wrongPng).toString("base64");
      process.env.GEMINI_API_KEY = "test-key-123";
      const owner = "usr_studio_f8";
      const fetchImpl = async () => ({
        ok: true,
        json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: wrongB64, mimeType: "image/png" } }] } }] }),
      });
      const asset = await service.generateStudioAsset(db, {
        ownerId: owner,
        message: "صورة واجهة مقهى باسم «RIYADH COFFEE»",
        fetchImpl,
      });
      assert.strictEqual(asset.state, "QUALITY_GATE_FAILED");
      assert.strictEqual(asset.attempts, 2);
      assert.strictEqual(asset.error_code, "OCR_COVERAGE_BELOW_THRESHOLD");
      assert.ok(asset.ocr_coverage < 0.95);
      assert.ok(fs.existsSync(asset.artifact_path), "artifact kept for inspection, state honest");
      delete process.env.GEMINI_API_KEY;
    });
  } else {
    skip("F7. REAL retry orchestration", "tesseract/PIL unavailable");
    skip("F8. REAL gate failure", "tesseract/PIL unavailable");
  }

  // --------------------------------------------------------------------------
  console.log("[G] HTTP routes...");
  // --------------------------------------------------------------------------

  await test("G1. Full route surface over real HTTP (route/enhance/presets/generate/file) + 401 without auth", async () => {
    const express = require("express");
    const app = express();
    app.use(express.json());
    const requireAuth = (req, res, next) => {
      const uid = req.get("x-test-user");
      if (!uid) return res.status(401).json({ error: { code: "UNAUTHENTICATED" } });
      req.user = { id: uid };
      next();
    };
    app.use("/api/studio", studioRoutes(db, requireAuth));
    const server = await new Promise((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    const owner = "usr_studio_g1";
    const H = { "Content-Type": "application/json", "x-test-user": owner };

    try {
      // unauthenticated
      const noAuth = await fetch(`${base}/api/studio/presets`);
      assert.strictEqual(noAuth.status, 401);

      // presets
      const presetsRes = await fetch(`${base}/api/studio/presets`, { headers: H });
      assert.strictEqual(presetsRes.status, 200);
      assert.strictEqual((await presetsRes.json()).presets.length, 6);

      // intent route
      const routeRes = await fetch(`${base}/api/studio/route`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: "صمم لي شعار لمحل قهوة" }),
      });
      assert.strictEqual(routeRes.status, 200);
      assert.strictEqual((await routeRes.json()).mode, "image");

      // enhance
      const enhRes = await fetch(`${base}/api/studio/enhance`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: "صورة واجهة مقهى باسم «RIYADH COFFEE»", preset_id: "storefront" }),
      });
      assert.strictEqual(enhRes.status, 200);
      const enhBody = await enhRes.json();
      assert.ok(enhBody.prompt_en.includes("EXACTLY"));

      // generate (mock provider)
      process.env.IMAGE_PROVIDER_MOCK = "1";
      const genRes = await fetch(`${base}/api/studio/generate`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: "صورة مشهد سينمائي", preset_id: "cinematic" }),
      });
      assert.strictEqual(genRes.status, 201);
      const genBody = await genRes.json();
      assert.strictEqual(genBody.state, "READY");
      assert.ok(genBody.artifact_url, "READY asset must expose artifact_url");
      delete process.env.IMAGE_PROVIDER_MOCK;

      // artifact download
      const fileRes = await fetch(`${base}${genBody.artifact_url}`, { headers: H });
      assert.strictEqual(fileRes.status, 200);
      assert.strictEqual(fileRes.headers.get("content-type"), "image/png");
      const buf = Buffer.from(await fileRes.arrayBuffer());
      assert.deepStrictEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);

      // other owner cannot download
      const stolen = await fetch(`${base}${genBody.artifact_url}`, { headers: { "x-test-user": "usr_studio_other" } });
      assert.strictEqual(stolen.status, 404);

      // provider BLOCKED surfaces as 503 with honest code
      const blockedRes = await fetch(`${base}/api/studio/generate`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: "صورة منتج" }),
      });
      assert.strictEqual(blockedRes.status, 503);
      assert.strictEqual((await blockedRes.json()).error.code, "STUDIO_PROVIDER_BLOCKED");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // --------------------------------------------------------------------------
  console.log("\n================================================================");
  console.log(`✅ SMART STUDIO PHASE 1 SUITE: ${passed}/${total} PASSED${skipped ? ` (${skipped} honestly skipped)` : ""}`);
  console.log("================================================================");

  closeDb();
  try { fs.rmSync(process.env.MEDIA_STORAGE_DIR, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}
}

runSmartStudioSuite().catch((err) => {
  console.error("\n❌ SMART STUDIO SUITE FAILED:", err);
  process.exit(1);
});
