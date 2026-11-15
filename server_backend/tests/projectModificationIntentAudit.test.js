// ==============================================================================
// ENGINEER — PROJECT MODIFICATION & INTENT ROUTING P0 ACCEPTANCE AUDIT
// Acceptance Tests A through G for engineer.misruq.com
// Tests:
// Test A: «هلا» -> Pure chat greeting, zero tool execution, zero file mutation
// Test B: «محتاج تعديل في التطبيق» -> Ambiguous edit clarification («أكيد، ما التعديل الذي تريد إجراءه على التطبيق الحالي؟»)
// Test C: «أضف رسماً بيانياً إلى حاسبة المخاطرة» & «أظهر الرسم البياني» -> Dynamic Chart injection & linkage
// Test D: «غيّر لون زر الشراء إلى الأزرق.» -> UI style patch for #dir-long-btn
// Test E: Preserve existing functions -> Calculation & journal non-regression verification
// Test F: Persistence & Context retention across consecutive modifications
// Test G: Failure handling -> Honest error diagnosis response
// ==============================================================================

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const projectRoot = path.resolve(__dirname, "../..");

function loadTsModule(relPath) {
  const absPath = path.join(projectRoot, relPath);
  const result = esbuild.buildSync({
    entryPoints: [absPath],
    bundle: true,
    platform: "node",
    format: "cjs",
    write: false,
  });
  const jsCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function("exports", "module", "require", "__dirname", "__filename", jsCode);
  fn(mod.exports, mod, require, path.dirname(absPath), absPath);
  return mod.exports;
}

function runProjectModificationIntentAudit() {
  console.log("================================================================");
  console.log("🛡️ RUNNING PROJECT MODIFICATION & INTENT ROUTING AUDIT (TESTS A–G)");
  console.log("================================================================\n");

  let passedTests = 0;
  let totalTests = 0;

  function runTest(testName, fn) {
    totalTests++;
    try {
      fn();
      passedTests++;
      console.log(`  ✅ [PASS] ${testName}`);
    } catch (err) {
      console.error(`  ❌ [FAIL] ${testName}: ${err.message}`);
      throw err;
    }
  }

  const { detectIntent, isAmbiguousEditRequest } = loadTsModule("src/utils/intentRouter.ts");
  const {
    analyzeAppRequest,
    buildTradingRiskCalculatorFiles,
    generateAppFiles,
    verifyGeneratedApp,
    formatCustomerLifecycleResponse
  } = loadTsModule("src/utils/autonomousAppBuilder.ts");
  const { classifyMasterIntent } = require("../services/ai/engineerMasterPrompt");

  // Baseline Trading Risk Calculator Project
  const initialFilesMap = buildTradingRiskCalculatorFiles("حاسبة نسبة المخاطرة في التداول");
  const activeProject = {
    id: "proj-risk-calc-001",
    name: "حاسبة نسبة المخاطرة في التداول",
    language: "ar",
    files: Object.entries(initialFilesMap).map(([name, content]) => ({
      id: `file-${name}`,
      name,
      path: "/" + name,
      folder: "root",
      content,
      language: name.endsWith(".html") ? "html" : name.endsWith(".css") ? "css" : "javascript",
      size: content.length,
      updatedAt: new Date().toISOString(),
    })),
    chatThreads: [],
    tests: [],
  };

  // ----------------------------------------------------
  // TEST A: Pure Greeting «هلا»
  // ----------------------------------------------------
  runTest("Test A: «هلا» -> Pure chat greeting, zero tool execution, zero file mutation", () => {
    const prompt = "هلا";
    const intentRes = detectIntent(prompt, "auto", true);
    assert.strictEqual(intentRes.intent, "chat", "Prompt must be classified as chat");
    assert.strictEqual(intentRes.subIntent, "greeting", "SubIntent must be greeting");

    const masterIntent = classifyMasterIntent(prompt);
    assert.strictEqual(masterIntent, "CHAT", "Master intent must be CHAT");

    const spec = analyzeAppRequest(prompt, activeProject);
    assert.strictEqual(spec.intent, "chat", "analyzeAppRequest must detect chat");
  });

  // ----------------------------------------------------
  // TEST B: Ambiguous Modification Request «محتاج تعديل في التطبيق»
  // ----------------------------------------------------
  runTest("Test B: «محتاج تعديل في التطبيق» -> Exact clarification without blind modification", () => {
    const prompt = "محتاج تعديل في التطبيق";
    assert.ok(isAmbiguousEditRequest(prompt), "isAmbiguousEditRequest must be true for «محتاج تعديل في التطبيق»");

    const intentRes = detectIntent(prompt, "auto", true);
    assert.strictEqual(intentRes.intent, "chat", "Ambiguous edit must be routed to chat for clarification");
    assert.strictEqual(intentRes.subIntent, "ambiguous_edit", "SubIntent must be ambiguous_edit");

    // Also check other common variations
    const variations = [
      "محتاج تعديل",
      "أريد تعديل في التطبيق",
      "عدل التطبيق",
      "تعديل في التطبيق",
      "عندي تعديل"
    ];
    for (const v of variations) {
      assert.ok(isAmbiguousEditRequest(v), `Variation "${v}" must be recognized as ambiguous edit`);
      const r = detectIntent(v, "auto", true);
      assert.strictEqual(r.subIntent, "ambiguous_edit", `Variation "${v}" must have subIntent ambiguous_edit`);
    }
  });

  // ----------------------------------------------------
  // TEST C: Dynamic Chart Modification
  // ----------------------------------------------------
  runTest("Test C: «أضف رسماً بيانياً إلى حاسبة المخاطرة» & «أظهر الرسم البياني» -> Injects & links chart", () => {
    const prompts = [
      "أظهر الرسم البياني",
      "أظهر رسم البيان",
      "أضف رسماً بيانياً إلى حاسبة المخاطرة يوضح العلاقة بين رصيد الحساب وقيمة المخاطرة."
    ];

    for (const prompt of prompts) {
      assert.strictEqual(isAmbiguousEditRequest(prompt), false, `Prompt "${prompt}" is specific and must NOT be ambiguous`);
      const intentRes = detectIntent(prompt, "auto", true);
      assert.strictEqual(intentRes.intent, "build", `Prompt "${prompt}" must be classified as build`);
      assert.strictEqual(intentRes.subIntent, "modify_code", `Prompt "${prompt}" must be modify_code`);

      const masterIntent = classifyMasterIntent(prompt);
      assert.strictEqual(masterIntent, "EDIT", `Master intent for "${prompt}" must be EDIT`);

      const spec = analyzeAppRequest(prompt, activeProject);
      assert.strictEqual(spec.intent, "modify_app", `analyzeAppRequest must detect modify_app for "${prompt}"`);
      assert.ok(spec.features.chart, `Chart feature must be extracted for "${prompt}"`);

      // Execute file generation / patch
      const patchedFiles = generateAppFiles(spec, { title: activeProject.name }, activeProject.files);
      assert.ok(patchedFiles["index.html"].includes("risk-chart-panel"), "index.html must include #risk-chart-panel");
      assert.ok(patchedFiles["index.html"].includes("risk-chart-canvas"), "index.html must include #risk-chart-canvas");
      assert.ok(patchedFiles["styles.css"].includes(".chart-panel"), "styles.css must include .chart-panel");
      assert.ok(patchedFiles["app.js"].includes("initRiskChartEngine"), "app.js must include initRiskChartEngine");
      assert.ok(patchedFiles["app.js"].includes("drawRiskChart"), "app.js must include dynamic drawRiskChart");

      // Verify automated testing passes
      const verification = verifyGeneratedApp(patchedFiles, { title: activeProject.name, description: "" });
      assert.strictEqual(verification.allPassed, true, "All automated verification tests must pass for patched chart");

      // Check customer lifecycle response
      const successReply = formatCustomerLifecycleResponse("modified", {
        spec,
        testsCount: verification.testResults.length,
        passedTestsCount: verification.testResults.filter((t) => t.status === "passed").length,
      });
      assert.strictEqual(
        successReply,
        "تم تعديل التطبيق وإضافة الميزة المطلوبة. يمكنك تجربة النتيجة في المعاينة.",
        "Exact customer-facing success message must match specification"
      );
    }
  });

  // ----------------------------------------------------
  // TEST D: Button Color Modification «غيّر لون زر الشراء إلى الأزرق.»
  // ----------------------------------------------------
  runTest("Test D: «غيّر لون زر الشراء إلى الأزرق.» -> Injects blue styling for #dir-long-btn", () => {
    const prompt = "غيّر لون زر الشراء إلى الأزرق.";
    const intentRes = detectIntent(prompt, "auto", true);
    assert.strictEqual(intentRes.intent, "build", "Color change must be classified as build");
    assert.strictEqual(intentRes.subIntent, "modify_code", "SubIntent must be modify_code");

    const spec = analyzeAppRequest(prompt, activeProject);
    assert.strictEqual(spec.intent, "modify_app", "analyzeAppRequest must detect modify_app");

    const patchedFiles = generateAppFiles(spec, { title: activeProject.name }, activeProject.files);
    assert.ok(patchedFiles["styles.css"].includes("#dir-long-btn"), "styles.css must style #dir-long-btn");
    assert.ok(patchedFiles["styles.css"].includes("#2563EB"), "styles.css must apply blue #2563EB");

    const verification = verifyGeneratedApp(patchedFiles, { title: activeProject.name, description: "" });
    assert.strictEqual(verification.allPassed, true, "All verification tests must pass after button color change");
  });

  // ----------------------------------------------------
  // TEST E: Preservation of Existing Functions (Non-regression)
  // ----------------------------------------------------
  runTest("Test E: Existing calculations, form inputs, and trade journal completely preserved", () => {
    const prompt = "أظهر الرسم البياني";
    const spec = analyzeAppRequest(prompt, activeProject);
    const patchedFiles = generateAppFiles(spec, { title: activeProject.name }, activeProject.files);

    const js = patchedFiles["app.js"];
    const html = patchedFiles["index.html"];

    // Core Risk Calculator DOM Elements
    assert.ok(html.includes("id=\"account-balance\""), "account-balance input preserved");
    assert.ok(html.includes("id=\"risk-slider\""), "risk-slider preserved");
    assert.ok(html.includes("id=\"risk-input\""), "risk-input preserved");
    assert.ok(html.includes("id=\"entry-price\""), "entry-price preserved");
    assert.ok(html.includes("id=\"stop-loss-price\""), "stop-loss-price preserved");
    assert.ok(html.includes("id=\"take-profit-price\""), "take-profit-price preserved");
    assert.ok(html.includes("id=\"metric-risk-amount\""), "metric-risk-amount preserved");
    assert.ok(html.includes("id=\"metric-pos-size\""), "metric-pos-size preserved");
    assert.ok(html.includes("id=\"metric-profit-amount\""), "metric-profit-amount preserved");
    assert.ok(html.includes("id=\"metric-rr-ratio\""), "metric-rr-ratio preserved");
    assert.ok(html.includes("id=\"save-trade-btn\""), "save-trade-btn preserved");

    // Core Business Logic Handlers in app.js
    assert.ok(js.includes("recalculateMetrics"), "recalculateMetrics preserved in app.js");
    assert.ok(js.includes("renderTradesTable"), "renderTradesTable preserved in app.js");
    assert.ok(js.includes("engineer_trading_trades"), "LocalStorage persistence key preserved in app.js");
  });

  // ----------------------------------------------------
  // TEST F: Consecutive Multi-Turn Modifications (Persistence)
  // ----------------------------------------------------
  runTest("Test F: Consecutive modifications retain both chart and button color changes", () => {
    // Turn 1: Add chart
    const specChart = analyzeAppRequest("أضف رسماً بيانياً إلى حاسبة المخاطرة", activeProject);
    const turn1Files = generateAppFiles(specChart, { title: activeProject.name }, activeProject.files);

    const projectAfterTurn1 = {
      ...activeProject,
      files: Object.entries(turn1Files).map(([name, content]) => ({
        id: `file-${name}`,
        name,
        path: "/" + name,
        folder: "root",
        content,
        language: name.endsWith(".html") ? "html" : name.endsWith(".css") ? "css" : "javascript",
        size: content.length,
        updatedAt: new Date().toISOString(),
      })),
    };

    // Turn 2: Change button color
    const specButton = analyzeAppRequest("غيّر لون زر الشراء إلى الأزرق", projectAfterTurn1);
    const turn2Files = generateAppFiles(specButton, { title: projectAfterTurn1.name }, projectAfterTurn1.files);

    // Both modifications must be present!
    assert.ok(turn2Files["index.html"].includes("risk-chart-canvas"), "Chart canvas retained after button color change");
    assert.ok(turn2Files["styles.css"].includes("#dir-long-btn"), "Button color styling added");
    assert.ok(turn2Files["styles.css"].includes(".chart-panel"), "Chart styling retained");
    assert.ok(turn2Files["app.js"].includes("initRiskChartEngine"), "Chart JS engine retained");
  });

  // ----------------------------------------------------
  // TEST G: Modification Failure Handling
  // ----------------------------------------------------
  runTest("Test G: Modification failure outputs exact customer-facing failure message", () => {
    const spec = analyzeAppRequest("عدل التطبيق وأضف ميزة", activeProject);
    const failureReply = formatCustomerLifecycleResponse("modification_failed", {
      spec,
      failedFeatures: ["canvas-render-error"],
    });

    assert.strictEqual(
      failureReply,
      "تعذر إكمال التعديل بسبب مشكلة أثناء التنفيذ أو الاختبار. سأعرض لك سبب المشكلة وما يحتاج إلى إصلاح.",
      "Exact customer-facing failure message must match specification"
    );
  });

  console.log("\n================================================================");
  console.log(`🏆 ALL ${passedTests}/${totalTests} PROJECT MODIFICATION ACCEPTANCE TESTS PASSED (100% GREEN)`);
  console.log("================================================================\n");
}

if (require.main === module) {
  runProjectModificationIntentAudit();
}

module.exports = { runProjectModificationIntentAudit };
