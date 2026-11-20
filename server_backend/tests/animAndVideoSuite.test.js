// ==============================================================================
// server_backend/tests/animAndVideoSuite.test.js
// Comprehensive Test Suite for Animation Engine (Phase 3) & Video Engine (Phase 4)
// Verifies:
// 1. Truthful Provider Status (BLOCKED when Docker/TTS unconfigured)
// 2. Animation Code Validation & AST/Pattern Security Guards (Rejects malicious code)
// 3. Video Planning Two-Step Lifecycle (DRAFT -> CONFIRM) without upfront quota loss
// 4. Quota Enforcement for Video Seconds & TTS Characters
// 5. Idempotency Key Handling for Animation & Video Jobs
// 6. Application-level Tenant Isolation
// 7. AI Agent Tools (media_animation_render, media_video_plan, media_video_confirm)
// 8. Constitution Tool Policy & Approval Enforcement
// ==============================================================================
"use strict";

const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const { getDb } = require("../db/database");
const { workspaceTools } = require("../services/agent/workspaceTools");
const { POLICY } = require("../services/ai/constitution");

async function runAnimAndVideoSuite() {
  console.log("================================================================");
  console.log("🎬 RUNNING ANIMATION & VIDEO ENGINE TEST SUITE (PHASES 3 & 4)");
  console.log("================================================================\n");

  const mediaService = await import("../../server/media/mediaService.js");
  const animService = await import("../../server/anim/animService.js");
  const videoService = await import("../../server/video/videoService.js");

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

  const userA = "usr_anim_video_test_a";
  const userB = "usr_anim_video_test_b";

  // Clean test artifacts
  const cleanUserJobs = (uid) => {
    db.prepare("DELETE FROM media_events WHERE owner_id = ?").run(uid);
    db.prepare("DELETE FROM media_usage WHERE owner_id = ?").run(uid);
    db.prepare("DELETE FROM media_jobs WHERE owner_id = ?").run(uid);
  };
  cleanUserJobs(userA);
  cleanUserJobs(userB);

  // --------------------------------------------------------------------------
  console.log("[Phase 3] Animation Engine Verification...");
  // --------------------------------------------------------------------------

  await test("3.1 Provider returns BLOCKED when MANIM_DOCKER_IMAGE is unset", async () => {
    const orig = process.env.MANIM_DOCKER_IMAGE;
    delete process.env.MANIM_DOCKER_IMAGE;
    try {
      assert.strictEqual(mediaService.providerStatus("animation"), "BLOCKED");
    } finally {
      if (orig) process.env.MANIM_DOCKER_IMAGE = orig;
    }
  });

  await test("3.2 Provider returns READY when MANIM_DOCKER_IMAGE is configured", async () => {
    process.env.MANIM_DOCKER_IMAGE = "local/manim:latest";
    assert.strictEqual(mediaService.providerStatus("animation"), "READY");
  });

  await test("3.3 Animation input validation rejects empty or missing fields", async () => {
    try {
      await animService.createAnimationJob(db, {
        ownerId: userA,
        description: "",
        sceneCode: "class S(Scene): pass",
        sceneClass: "S",
      });
      assert.fail("Should have thrown on empty description");
    } catch (err) {
      assert.strictEqual(err.code, "ANIM_DESC_INVALID");
    }

    try {
      await animService.createAnimationJob(db, {
        ownerId: userA,
        description: "Test description",
        sceneCode: "class S(Scene): pass",
        sceneClass: "Invalid-Class-Name!",
      });
      assert.fail("Should have thrown on invalid class name");
    } catch (err) {
      assert.strictEqual(err.code, "ANIM_CLASS_INVALID");
    }

    try {
      await animService.createAnimationJob(db, {
        ownerId: userA,
        description: "Test description",
        sceneCode: "class OtherScene(Scene): pass",
        sceneClass: "TargetScene",
      });
      assert.fail("Should have thrown on missing class in code");
    } catch (err) {
      assert.strictEqual(err.code, "ANIM_CLASS_MISSING");
    }

    try {
      await animService.createAnimationJob(db, {
        ownerId: userA,
        description: "Test description",
        sceneCode: "class S(Scene): pass",
        sceneClass: "S",
        format: "avi",
      });
      assert.fail("Should have thrown on invalid format");
    } catch (err) {
      assert.strictEqual(err.code, "ANIM_FORMAT_INVALID");
    }
  });

  await test("3.4 Security defense rejects malicious Python patterns (import os, sys, eval, exec)", async () => {
    const maliciousSnippets = [
      "import os\nclass TestScene(Scene):\n    def construct(self): pass",
      "import sys\nclass TestScene(Scene):\n    def construct(self): pass",
      "import subprocess\nclass TestScene(Scene):\n    def construct(self): pass",
      "class TestScene(Scene):\n    def construct(self):\n        eval('1+1')",
      "class TestScene(Scene):\n    def construct(self):\n        exec('x=1')",
      "class TestScene(Scene):\n    def construct(self):\n        f = open('/etc/passwd', 'r')",
      "class TestScene(Scene):\n    def construct(self):\n        while True: pass",
      "class TestScene(Scene):\n    def construct(self):\n        __import__('os').system('ls')",
    ];

    for (const code of maliciousSnippets) {
      try {
        await animService.createAnimationJob(db, {
          ownerId: userA,
          description: "Dangerous code test",
          sceneCode: code,
          sceneClass: "TestScene",
        });
        assert.fail(`Should have rejected malicious code: ${code}`);
      } catch (err) {
        assert.strictEqual(err.code, "ANIM_CODE_REJECTED");
        assert.strictEqual(err.status, 400);
      }
    }
  });

  await test("3.5 Valid animation code creates a QUEUED job and charges units", async () => {
    const validCode = `from manim import *
class CoolingCycle(Scene):
    def construct(self):
        title = Text("دورة التبريد")
        self.play(Write(title))
`;
    const job = await animService.createAnimationJob(db, {
      ownerId: userA,
      description: "مخطط توضيحي لدورة التبريد في محركات الديزل",
      sceneCode: validCode,
      sceneClass: "CoolingCycle",
      format: "mp4",
      seconds: 15,
      idempotencyKey: "anim-idem-001",
    });

    assert.ok(job.id);
    assert.strictEqual(job.type, "animation");
    assert.strictEqual(job.state, "QUEUED");
    assert.strictEqual(job.cost_units, 15);

    // Idempotency check: same key returns existing job without duplicate charge
    const jobDup = await animService.createAnimationJob(db, {
      ownerId: userA,
      description: "مخطط توضيحي لدورة التبريد في محركات الديزل",
      sceneCode: validCode,
      sceneClass: "CoolingCycle",
      format: "mp4",
      seconds: 15,
      idempotencyKey: "anim-idem-001",
    });
    assert.strictEqual(jobDup.id, job.id);
  });

  // --------------------------------------------------------------------------
  console.log("\n[Phase 4] Video Engine Verification...");
  // --------------------------------------------------------------------------

  await test("4.1 Provider returns BLOCKED when VIDEO_DOCKER_IMAGE or TTS is unset", async () => {
    const origVideo = process.env.VIDEO_DOCKER_IMAGE;
    const origTTS = process.env.MEDIA_TTS_API_KEY;
    delete process.env.VIDEO_DOCKER_IMAGE;
    try {
      assert.strictEqual(mediaService.providerStatus("video"), "BLOCKED");
    } finally {
      if (origVideo) process.env.VIDEO_DOCKER_IMAGE = origVideo;
      if (origTTS) process.env.MEDIA_TTS_API_KEY = origTTS;
    }
  });

  await test("4.2 Provider returns READY when VIDEO_DOCKER_IMAGE and TTS are configured", async () => {
    process.env.VIDEO_DOCKER_IMAGE = "local/video:latest";
    process.env.MEDIA_TTS_BASE_URL = "http://127.0.0.1:9999/v1";
    process.env.MEDIA_TTS_API_KEY = "test-tts-key";
    process.env.MEDIA_TTS_MODEL = "tts-1";
    assert.strictEqual(mediaService.providerStatus("video"), "READY");
  });

  await test("4.3 Video plan validation enforces scene counts and character limits", async () => {
    // Empty scenes
    assert.throws(
      () => videoService.createVideoJob(db, { ownerId: userA, plan: { scenes: [] } }),
      (err) => err.code === "VIDEO_PLAN_INVALID"
    );

    // Missing narration
    assert.throws(
      () => videoService.createVideoJob(db, { ownerId: userA, plan: { scenes: [{ title: "Scene 1", narration: "" }] } }),
      (err) => err.code === "VIDEO_NARRATION_REQUIRED"
    );

    // Narration too long (>500 per scene)
    assert.throws(
      () => videoService.createVideoJob(db, { ownerId: userA, plan: { scenes: [{ narration: "A".repeat(501) }] } }),
      (err) => err.code === "VIDEO_SCENE_TOO_LONG"
    );

    // Total narration too long (>3000 total)
    const longScenes = Array.from({ length: 7 }, () => ({ narration: "B".repeat(450) }));
    assert.throws(
      () => videoService.createVideoJob(db, { ownerId: userA, plan: { scenes: longScenes } }),
      (err) => err.code === "VIDEO_NARRATION_TOO_LONG"
    );
  });

  let draftJobId = null;

  await test("4.4 createVideoJob returns DRAFT state with estimate, WITHOUT charging quota", async () => {
    const validPlan = {
      scenes: [
        {
          title: "مقدمة الديناميكا الحرارية",
          body: "القانون الأول: الطاقة لا تفنى ولا تستحدث من العدم.",
          narration: "مرحباً بكم في درس الديناميكا الحرارية التطبيقية للمهندسين.",
          citation: "كتاب الديناميكا الحرارية، الفصل الثاني",
        },
        {
          title: "دورة كارنو",
          body: "الكفاءة القصوى لأي محرك حراري بين مستودعين حراريين.",
          narration: "تعتبر دورة كارنو الأساس النظري لكفاءة المحركات الحرارية.",
          citation: "المرجع السابق، ص 84",
        },
      ],
    };

    const { job, estimate } = videoService.createVideoJob(db, {
      ownerId: userA,
      title: "شرح الديناميكا الحرارية",
      plan: validPlan,
      idempotencyKey: "vid-draft-001",
    });

    assert.ok(job.id);
    draftJobId = job.id;
    assert.strictEqual(job.type, "video");
    assert.strictEqual(job.state, "DRAFT");
    assert.strictEqual(job.cost_units, 16); // 2 scenes * 8s = 16s

    assert.ok(estimate);
    assert.strictEqual(estimate.scenes, 2);
    assert.strictEqual(estimate.seconds, 16);
    assert.ok(estimate.tts_chars > 0);

    // Crucial: Constitution §20 Guarantee: ZERO quota charged on DRAFT
    const usageRow = db.prepare("SELECT units FROM media_usage WHERE owner_id = ? AND type = 'video'").get(userA);
    const currentVideoUsage = usageRow ? usageRow.units : 0;
    assert.strictEqual(currentVideoUsage, 0);

    // Check plan.json was written to work directory
    const planFile = path.join(process.cwd(), "data", "video_work", job.id, "plan.json");
    assert.ok(fs.existsSync(planFile), "plan.json should be saved in video work directory");
  });

  await test("4.5 confirmVideoJob validates, transitions to QUEUED, and deducts quota", async () => {
    const job = await videoService.confirmVideoJob(db, userA, draftJobId);
    assert.strictEqual(job.id, draftJobId);
    assert.strictEqual(job.state, "QUEUED");

    // Quota deduction check
    const videoUsage = db.prepare("SELECT units FROM media_usage WHERE owner_id = ? AND type = 'video'").get(userA);
    assert.ok(videoUsage && videoUsage.units >= 16);

    const ttsUsage = db.prepare("SELECT units FROM media_usage WHERE owner_id = ? AND type = 'tts'").get(userA);
    assert.ok(ttsUsage && ttsUsage.units > 0);
  });

  await test("4.6 Confirming a non-DRAFT job throws 409 MEDIA_STATE_INVALID", async () => {
    try {
      await videoService.confirmVideoJob(db, userA, draftJobId);
      assert.fail("Should reject confirming an already QUEUED job");
    } catch (err) {
      assert.strictEqual(err.code, "MEDIA_STATE_INVALID");
      assert.strictEqual(err.status, 409);
    }
  });

  await test("4.7 Daily quota enforcement rejects requests exceeding limits", async () => {
    // Daily video quota is 30 seconds. UserA already used 16 seconds.
    // A plan requiring 20 seconds (3 scenes * 8s = 24s) should exceed 16 + 24 = 40 > 30.
    const heavyPlan = {
      scenes: [
        { narration: "المشهد الأول من المقطع الطويل جداً الذي سيتجاوز الحد المسموح." },
        { narration: "المشهد الثاني من المقطع الطويل جداً الذي سيتجاوز الحد المسموح." },
        { narration: "المشهد الثالث من المقطع الطويل جداً الذي سيتجاوز الحد المسموح." },
      ],
    };

    assert.throws(
      () => videoService.createVideoJob(db, { ownerId: userA, plan: heavyPlan }),
      (err) => err.code === "MEDIA_QUOTA_EXCEEDED" && err.status === 429
    );
  });

  await test("4.8 Application-level tenant isolation prevents User B from accessing User A jobs", async () => {
    assert.throws(
      () => videoService.getVideoJob(db, userB, draftJobId),
      (err) => err.code === "MEDIA_NOT_FOUND" && err.status === 404
    );

    try {
      await videoService.confirmVideoJob(db, userB, draftJobId);
      assert.fail("User B must not be able to confirm User A job");
    } catch (err) {
      assert.strictEqual(err.code, "MEDIA_NOT_FOUND");
      assert.strictEqual(err.status, 404);
    }
  });

  // --------------------------------------------------------------------------
  console.log("\n[Agent Tools & Constitution] Verification...");
  // --------------------------------------------------------------------------

  await test("5.1 Constitution TOOL_POLICY includes media_animation_render, media_video_plan, media_video_confirm", () => {
    const animPolicy = POLICY.tools.media_animation_render;
    assert.ok(animPolicy, "media_animation_render must exist in TOOL_POLICY");
    assert.strictEqual(animPolicy.minRole, "Editor");
    assert.strictEqual(animPolicy.risk, "high");

    const planPolicy = POLICY.tools.media_video_plan;
    assert.ok(planPolicy, "media_video_plan must exist in TOOL_POLICY");
    assert.strictEqual(planPolicy.minRole, "Editor");
    assert.strictEqual(planPolicy.approval, false);

    const confirmPolicy = POLICY.tools.media_video_confirm;
    assert.ok(confirmPolicy, "media_video_confirm must exist in TOOL_POLICY");
    assert.strictEqual(confirmPolicy.minRole, "Editor");
    assert.strictEqual(confirmPolicy.approval, true, "media_video_confirm must require explicit user approval");
  });

  await test("5.2 Agent tool media_video_plan creates a draft via tool execution", async () => {
    const tool = workspaceTools.media_video_plan;
    assert.ok(tool);
    const res = await tool.handler(
      {
        title: "فيديو الذكاء الاصطناعي",
        plan: {
          scenes: [
            {
              title: "مقدمة",
              narration: "مرحباً بكم في درس الذكاء الاصطناعي.",
            },
          ],
        },
      },
      { user: { id: userB } }
    );

    assert.ok(res.id);
    assert.strictEqual(res.state, "DRAFT");
    assert.strictEqual(res.type, "video");
    assert.ok(res.estimate);

    // Confirm via media_video_confirm
    const confirmTool = workspaceTools.media_video_confirm;
    assert.ok(confirmTool);
    const confRes = await confirmTool.handler({ job_id: res.id }, { user: { id: userB } });
    assert.strictEqual(confRes.id, res.id);
    assert.strictEqual(confRes.state, "QUEUED");
  });

  await test("5.3 Agent tool media_animation_render renders an animation job", async () => {
    const animTool = workspaceTools.media_animation_render;
    assert.ok(animTool);
    const res = await animTool.handler(
      {
        description: "رسم متحرك هندسي",
        scene_code: "from manim import *\nclass BoxScene(Scene):\n    def construct(self):\n        pass",
        scene_class: "BoxScene",
        seconds: 5,
      },
      { user: { id: userB } }
    );

    assert.ok(res.id);
    assert.strictEqual(res.type, "animation");
    assert.strictEqual(res.state, "QUEUED");
  });

  console.log("\n================================================================");
  console.log(`🎉 ALL ${passed}/${total} ANIMATION & VIDEO TESTS PASSED`);
  console.log("================================================================\n");
}

module.exports = { runAnimAndVideoSuite };

if (require.main === module) {
  runAnimAndVideoSuite()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Test suite failed:", err);
      process.exit(1);
    });
}
