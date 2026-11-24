// ==============================================================================
// server_backend/tests/studioPresetsSuite.test.js
// Smart Presets Subsystem Verification Suite (Phase 1 extension)
// Verifies the 4 layers from the spec:
//   1. Categorized Preset Library (6 presets, full 5-parameter bundles, spec matrix)
//   2. Smart Parameter Bundling (wrapper/negative/aspect/OCR gate/palette in final prompt)
//   3. Auto-Detection & Quick Modifiers (auto-detect badge, modifier fragments, intensity)
//   4. Custom & Brand Presets (save from asset, brand lock pins seed+palette per project)
// Plus the codebase gate: registry files are English-only; Arabic lives in i18n only.
// ==============================================================================
"use strict";

process.env.LLM_PROVIDER = "mock";
process.env.DB_PATH = require("path").join(
  require("os").tmpdir(),
  `studiopreset_test_${Date.now()}_${Math.random().toString(36).slice(2)}.db`
);
process.env.MEDIA_STORAGE_DIR = require("path").join(
  require("os").tmpdir(),
  `studiopreset_media_${Date.now()}_${Math.random().toString(36).slice(2)}`
);
delete process.env.GEMINI_API_KEY;
delete process.env.MEDIA_IMAGE_BASE_URL;
delete process.env.MEDIA_IMAGE_API_KEY;
delete process.env.MEDIA_IMAGE_MODEL;
process.env.IMAGE_PROVIDER_MOCK = "1";

const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const { getDb, closeDb } = require("../db/database");

async function runStudioPresetsSuite() {
  console.log("================================================================");
  console.log("🎛️  RUNNING SMART PRESETS SUBSYSTEM VERIFICATION SUITE");
  console.log("================================================================\n");

  const registry = await import("../../server/studio/presetRegistry.js");
  const labels = await import("../../server/studio/i18n/labels.js");
  const service = await import("../../server/studio/studioService.js");
  const store = await import("../../server/studio/presetStore.js");
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

  const OWNER = "usr_presets_main";
  const PROJ = "prj_presets_lock";

  // --------------------------------------------------------------------------
  console.log("[Layer 1] Categorized Preset Library...");
  // --------------------------------------------------------------------------

  await test("L1.1 Registry holds exactly the 6 spec presets with full 5-parameter bundles", async () => {
    const ids = registry.listRegistry().map((p) => p.id);
    assert.deepStrictEqual(ids, [
      "cinematic_photo", "commercial_storefront", "product_studio",
      "ui_assets", "fintech_tech", "marketing_banner",
    ]);
    for (const p of registry.listRegistry()) {
      assert.ok(p.wrapper_en?.prefix && p.wrapper_en?.suffix && p.wrapper_en?.strong_boost, `${p.id}: wrapper incomplete`);
      assert.ok(p.negative_en?.length > 10, `${p.id}: negative rules missing`);
      assert.ok(p.default_aspect, `${p.id}: default aspect missing`);
      assert.ok(["off", "always", "on_text_detected"].includes(p.ocr_gate), `${p.id}: ocr_gate invalid`);
      assert.ok(Array.isArray(p.palette) && p.palette.length >= 3 && p.palette.every((c) => /^#[0-9a-f]{6}$/i.test(c)), `${p.id}: palette invalid`);
      assert.ok(Array.isArray(p.modifiers), `${p.id}: modifiers missing`);
    }
  });

  await test("L1.2 Spec matrix: aspect + OCR gate per preset", async () => {
    const m = Object.fromEntries(registry.listRegistry().map((p) => [p.id, p]));
    assert.strictEqual(m.cinematic_photo.default_aspect, "16:9");
    assert.strictEqual(m.cinematic_photo.ocr_gate, "off");
    assert.strictEqual(m.commercial_storefront.ocr_gate, "always");
    assert.strictEqual(m.product_studio.default_aspect, "1:1");
    assert.strictEqual(m.product_studio.ocr_gate, "on_text_detected");
    assert.strictEqual(m.ui_assets.ocr_gate, "off");
    assert.ok(m.ui_assets.alt_aspects.includes("16:9"));
    assert.strictEqual(m.fintech_tech.ocr_gate, "on_text_detected");
    assert.strictEqual(m.marketing_banner.ocr_gate, "always");
    assert.ok(m.marketing_banner.alt_aspects.includes("4:5"));
  });

  await test("L1.3 Codebase gate: registry English-only; Arabic lives in i18n only", async () => {
    const regSrc = fs.readFileSync(path.join(__dirname, "../../server/studio/presetRegistry.js"), "utf8");
    assert.ok(!/[؀-ۿ]/.test(regSrc), "presetRegistry.js must contain zero Arabic characters");
    const i18nSrc = fs.readFileSync(path.join(__dirname, "../../server/studio/i18n/labels.js"), "utf8");
    assert.ok(/[؀-ۿ]/.test(i18nSrc), "labels.js must carry the Arabic labels (positive control)");
    assert.strictEqual(labels.presetLabel("cinematic_photo", "ar"), "تصوير سينمائي واقعي");
    assert.strictEqual(labels.presetLabel("cinematic_photo", "en"), "Cinematic Photo");
  });

  // --------------------------------------------------------------------------
  console.log("[Layer 2] Smart Parameter Bundling...");
  // --------------------------------------------------------------------------

  await test("L2.1 Wrapper + palette + style seed land inside the final provider prompt", async () => {
    const asset = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة واجهة محل قهوة", presetId: "commercial_storefront",
    });
    assert.strictEqual(asset.state, "READY");
    assert.ok(asset.prompt_en.includes("storefront"), "wrapper prefix must be in final prompt");
    assert.ok(asset.prompt_en.includes("Color palette:"), "palette injection required");
    assert.ok(asset.prompt_en.includes("Style seed:"), "style seed anchor required");
    for (const hex of JSON.parse(asset.palette_json)) {
      assert.ok(asset.prompt_en.includes(hex), `palette color ${hex} must appear in prompt`);
    }
    assert.ok(asset.style_seed && asset.style_seed.length >= 8);
  });

  await test("L2.2 Manual aspect override beats preset default", async () => {
    const asset = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة منتج عطر فاخر", presetId: "product_studio", aspectOverride: "9:16",
    });
    assert.strictEqual(asset.aspect, "9:16");
  });

  await test("L2.3 Intensity weighting: subtle drops suffix, strong adds boost", async () => {
    const subtle = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة مشهد مدينة", presetId: "cinematic_photo", intensity: "subtle",
    });
    assert.ok(!subtle.prompt_en.includes("film grain"), "subtle must drop the wrapper suffix");
    const strong = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة مشهد مدينة", presetId: "cinematic_photo", intensity: "strong",
    });
    assert.ok(strong.prompt_en.includes("anamorphic"), "strong must add the strong_boost");
    await assert.rejects(
      service.generateStudioAsset(db, { ownerId: OWNER, message: "صورة مدينة", presetId: "cinematic_photo", intensity: "extreme" }),
      (err) => err.code === "STUDIO_INTENSITY_INVALID"
    );
  });

  // --------------------------------------------------------------------------
  console.log("[Layer 3] Auto-Detection & Quick Modifiers...");
  // --------------------------------------------------------------------------

  await test("L3.1 Auto-Detect: 'صورة احترافية في سحراء' -> cinematic_photo, 16:9, OCR off, badge set", async () => {
    const asset = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة احترافية في سحراء",
    });
    assert.strictEqual(asset.preset, "cinematic_photo");
    assert.strictEqual(asset.aspect, "16:9");
    assert.strictEqual(asset.ocr_gate_mode, "off");
    assert.strictEqual(asset.auto_detected, 1, "auto_detected flag drives the changeable badge");
    assert.strictEqual(asset.state, "READY");
  });

  await test("L3.2 Conditional OCR: storefront/banner ALWAYS verify; cinematic/ui_assets never call OCR", async () => {
    let calls = 0;
    const spy = async () => { calls++; return { pass: true, coverage: 1, missing: [], reason: null }; };

    // cinematic_photo WITH overlay text -> gate off, zero OCR calls
    await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة صحراء باسم «RIYADH COFFEE»", presetId: "cinematic_photo", verifyImpl: spy,
    });
    assert.strictEqual(calls, 0, "cinematic_photo must never call OCR");

    // ui_assets WITH overlay text -> zero OCR calls
    await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "أيقونة باسم «APP ICON»", presetId: "ui_assets", verifyImpl: spy,
    });
    assert.strictEqual(calls, 0, "ui_assets must never call OCR");

    // commercial_storefront -> always calls OCR when texts exist
    await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "واجهة محل باسم «RIYADH COFFEE»", presetId: "commercial_storefront", verifyImpl: spy,
    });
    assert.strictEqual(calls, 1, "storefront must call OCR");

    // marketing_banner -> always calls
    await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "بانر إعلاني بعنوان «GRAND OPENING»", presetId: "marketing_banner", verifyImpl: spy,
    });
    assert.strictEqual(calls, 2, "marketing_banner must call OCR");

    // product_studio: conditional — no text -> skip; with text -> call
    await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة منتج عطر", presetId: "product_studio", verifyImpl: spy,
    });
    assert.strictEqual(calls, 2, "product_studio without overlay text must skip OCR");
    await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة منتج عطر باسم «OUD ROYAL»", presetId: "product_studio", verifyImpl: spy,
    });
    assert.strictEqual(calls, 3, "product_studio with overlay text must call OCR");

    // fintech_tech with text -> calls
    await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "خلفية منصة تداول بعنوان «TRADE PRO»", presetId: "fintech_tech", verifyImpl: spy,
    });
    assert.strictEqual(calls, 4, "fintech_tech with overlay text must call OCR");
  });

  await test("L3.3 Quick modifiers land in the final prompt; invalid ones rejected", async () => {
    const asset = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة واجهة محل قهوة", presetId: "commercial_storefront",
      modifiers: { timing: "lit_night", style: "luxury" },
    });
    assert.ok(asset.prompt_en.includes("illuminated signage"), "timing fragment must be in prompt");
    assert.ok(asset.prompt_en.includes("luxury boutique facade"), "style fragment must be in prompt");
    assert.deepStrictEqual(JSON.parse(asset.modifiers_json), { timing: "lit_night", style: "luxury" });
    await assert.rejects(
      service.generateStudioAsset(db, {
        ownerId: OWNER, message: "صورة محل", presetId: "commercial_storefront",
        modifiers: { timing: "apocalypse" },
      }),
      (err) => err.code === "STUDIO_MODIFIER_INVALID"
    );
    await assert.rejects(
      service.generateStudioAsset(db, {
        ownerId: OWNER, message: "صورة محل", presetId: "commercial_storefront",
        modifiers: { volume: "loud" },
      }),
      (err) => err.code === "STUDIO_MODIFIER_INVALID"
    );
  });

  // --------------------------------------------------------------------------
  console.log("[Layer 4] Custom & Brand Presets...");
  // --------------------------------------------------------------------------

  await test("L4.1 Save as Custom Preset captures seed + palette + modifiers from the asset", async () => {
    const asset = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة واجهة محل قهوة", presetId: "commercial_storefront",
      modifiers: { timing: "lit_night" }, intensity: "strong",
    });
    const cp = store.saveCustomPresetFromAsset(db, { ownerId: OWNER, assetId: asset.id, name: "هوية مقهاي الليلية" });
    assert.strictEqual(cp.style_seed, asset.style_seed, "custom preset reuses the asset style seed");
    assert.strictEqual(cp.palette_json, asset.palette_json);
    assert.deepStrictEqual(JSON.parse(cp.modifiers_json), { timing: "lit_night" });
    assert.strictEqual(cp.intensity, "strong");
    assert.strictEqual(cp.base_preset_id, "commercial_storefront");
    assert.strictEqual(store.listCustomPresets(db, OWNER, {}).length, 1);
    // name validation
    assert.throws(
      () => store.saveCustomPresetFromAsset(db, { ownerId: OWNER, assetId: asset.id, name: "x" }),
      (err) => err.code === "STUDIO_PRESET_NAME_INVALID"
    );
  });

  await test("L4.2 Generation via custom preset reuses its seed and palette", async () => {
    const src = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة منتج عطر فاخر", presetId: "product_studio",
      modifiers: { surface: "marble" },
    });
    const cp = store.saveCustomPresetFromAsset(db, { ownerId: OWNER, assetId: src.id, name: "منتجاتي" });
    const gen = await service.generateStudioAsset(db, {
      ownerId: OWNER, message: "صورة منتج ساعة يد", customPresetId: cp.id,
    });
    assert.strictEqual(gen.style_seed, cp.style_seed, "custom preset seed must propagate");
    assert.strictEqual(gen.palette_json, cp.palette_json);
    assert.ok(gen.prompt_en.includes("marble"), "saved modifier fragment must propagate");
    assert.strictEqual(gen.preset, `custom:${cp.id}`);
  });

  await test("L4.3 Brand Lock pins preset + seed + palette across project generations until unlock", async () => {
    const lock = store.setBrandLock(db, { ownerId: OWNER, projectId: PROJ, presetId: "fintech_tech" });
    assert.strictEqual(lock.preset_id, "fintech_tech");
    assert.ok(lock.style_seed);

    const g1 = await service.generateStudioAsset(db, {
      ownerId: OWNER, projectId: PROJ, message: "خلفية لمنصة تداول",
    });
    assert.strictEqual(g1.preset, "fintech_tech", "brand lock forces the preset");
    assert.strictEqual(g1.style_seed, lock.style_seed, "brand lock forces the style seed");
    assert.strictEqual(g1.palette_json, lock.palette_json);
    assert.strictEqual(g1.auto_detected, 0);

    const g2 = await service.generateStudioAsset(db, {
      ownerId: OWNER, projectId: PROJ, message: "صورة مختلفة تماماً لرسم بياني",
    });
    assert.strictEqual(g2.style_seed, lock.style_seed, "second generation keeps the SAME seed — identity pinned");

    store.clearBrandLock(db, OWNER, PROJ);
    const g3 = await service.generateStudioAsset(db, {
      ownerId: OWNER, projectId: PROJ, message: "خلفية لمنصة تداول",
    });
    assert.notStrictEqual(g3.style_seed, lock.style_seed, "after unlock a fresh seed is issued");
  });

  await test("L4.4 Tenant isolation: brand lock and custom presets are owner-scoped", async () => {
    const other = "usr_presets_other";
    const lock = store.setBrandLock(db, { ownerId: OWNER, projectId: PROJ, presetId: "marketing_banner" });
    assert.throws(() => store.getBrandLock(db, other, PROJ), (err) => err.code === "STUDIO_LOCK_FORBIDDEN");
    assert.deepStrictEqual(store.listCustomPresets(db, other, {}), []);
    store.clearBrandLock(db, OWNER, PROJ);
    assert.strictEqual(lock.preset_id, "marketing_banner");
  });

  // --------------------------------------------------------------------------
  console.log("[Routes] HTTP surface...");
  // --------------------------------------------------------------------------

  await test("R1. Preset gallery (labels ar/en), SVG thumbnails, custom presets, brand lock, generate", async () => {
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
    const H = { "Content-Type": "application/json", "x-test-user": "usr_presets_http" };

    try {
      // gallery: 6 presets, Arabic labels, modifiers resolved
      const gallery = await (await fetch(`${base}/api/studio/presets`, { headers: H })).json();
      assert.strictEqual(gallery.presets.length, 6);
      const sf = gallery.presets.find((p) => p.id === "commercial_storefront");
      assert.strictEqual(sf.label, "تصميم تجاري وواجهات متاجر");
      assert.ok(sf.modifiers.find((m) => m.id === "timing").options.length === 2);
      assert.ok(sf.thumbnail_url.includes("/thumbnail"));
      assert.strictEqual(gallery.intensity_levels.length, 3);
      const galleryEn = await (await fetch(`${base}/api/studio/presets?lang=en`, { headers: H })).json();
      assert.strictEqual(galleryEn.presets[0].label, "Cinematic Photo");

      // thumbnail: real SVG, palette-driven
      const thumb = await fetch(`${base}/api/studio/presets/cinematic_photo/thumbnail`, { headers: H });
      assert.strictEqual(thumb.status, 200);
      assert.ok(thumb.headers.get("content-type").includes("image/svg+xml"));
      const svg = await thumb.text();
      assert.ok(svg.includes("#1a2634"), "thumbnail must use the preset palette");
      const badThumb = await fetch(`${base}/api/studio/presets/nope/thumbnail`, { headers: H });
      assert.strictEqual(badThumb.status, 404);

      // generate with modifiers -> 201 + badge/modifiers reflected
      const genRes = await fetch(`${base}/api/studio/generate`, {
        method: "POST", headers: H,
        body: JSON.stringify({
          message: "صورة واجهة محل قهوة", preset_id: "storefront", // legacy alias
          modifiers: { timing: "lit_night" }, intensity: "strong",
        }),
      });
      assert.strictEqual(genRes.status, 201);
      const gen = await genRes.json();
      assert.strictEqual(gen.preset, "commercial_storefront");
      assert.deepStrictEqual(gen.modifiers, { timing: "lit_night" });
      assert.strictEqual(gen.intensity, "strong");
      assert.ok(gen.style_seed);
      assert.ok(Array.isArray(gen.palette) && gen.palette.length >= 3);

      // auto-detect badge
      const autoRes = await fetch(`${base}/api/studio/generate`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: "صورة احترافية في صحراء" }),
      });
      const auto = await autoRes.json();
      assert.strictEqual(auto.auto_detected, true);
      assert.deepStrictEqual(auto.badge, { type: "auto_detected", preset: "cinematic_photo" });

      // save custom preset from asset
      const cpRes = await fetch(`${base}/api/studio/presets/custom`, {
        method: "POST", headers: H,
        body: JSON.stringify({ asset_id: gen.id, name: "قالب المتجر" }),
      });
      assert.strictEqual(cpRes.status, 201);
      const cp = await cpRes.json();
      assert.strictEqual(cp.style_seed, gen.style_seed);
      const cpList = await (await fetch(`${base}/api/studio/presets/custom`, { headers: H })).json();
      assert.strictEqual(cpList.custom_presets.length, 1);

      // brand lock flow
      const lockRes = await fetch(`${base}/api/studio/projects/prj_http/brand-lock`, {
        method: "PUT", headers: H,
        body: JSON.stringify({ custom_preset_id: cp.id }),
      });
      assert.strictEqual(lockRes.status, 200);
      const lock = await lockRes.json();
      assert.strictEqual(lock.custom_preset_id, cp.id);
      const lockedGen = await (await fetch(`${base}/api/studio/generate`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: "صورة جديدة", project_id: "prj_http" }),
      })).json();
      assert.strictEqual(lockedGen.style_seed, cp.style_seed, "locked generation reuses custom preset seed");
      const delLock = await (await fetch(`${base}/api/studio/projects/prj_http/brand-lock`, { method: "DELETE", headers: H })).json();
      assert.strictEqual(delLock.cleared, true);
      const delCp = await (await fetch(`${base}/api/studio/presets/custom/${cp.id}`, { method: "DELETE", headers: H })).json();
      assert.strictEqual(delCp.deleted, true);

      // unknown preset -> honest 400
      const bad = await fetch(`${base}/api/studio/generate`, {
        method: "POST", headers: H,
        body: JSON.stringify({ message: "صورة", preset_id: "nope" }),
      });
      assert.strictEqual(bad.status, 400);
      assert.strictEqual((await bad.json()).error.code, "STUDIO_PRESET_INVALID");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  // --------------------------------------------------------------------------
  console.log("\n================================================================");
  console.log(`✅ SMART PRESETS SUBSYSTEM SUITE: ${passed}/${total} PASSED`);
  console.log("================================================================");

  closeDb();
  try { fs.rmSync(process.env.MEDIA_STORAGE_DIR, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(process.env.DB_PATH, { force: true }); } catch {}
}

runStudioPresetsSuite().catch((err) => {
  console.error("\n❌ SMART PRESETS SUITE FAILED:", err);
  process.exit(1);
});
