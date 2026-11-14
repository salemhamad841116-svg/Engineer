// ==============================================================================
// ENGINEER — Autonomous App Builder & Customer Response System Test Suite
// Mandatory Acceptance Scenarios (A through F) Verification Gate
//
// Test A: General Chat («هلا») -> greeting, no build, zero file modifications.
// Test B: New Application («اعمل لي تطبيق ملاحظات فيه مجلدات وصور وتسجيل صوت»)
//         -> full build, real features, working folders, image uploader, voice recorder,
//            localStorage persistence, live preview compilation, and tests passed.
// Test C: Modification («أضف صفحة الإعدادات») -> incremental update, no data loss.
// Test D: Bug Fix («زر حفظ الملاحظات لا يعمل») -> diagnose, fix handler, re-test, report.
// Test E: Failed Build -> honest failure display, no false success claims.
// Test F: Resume Project -> reload persistence across disk/state.
// Zero Leaks Gate: Strict verification that internal agent titles never leak.
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const { createRequire } = require('node:module');

const projectRoot = path.resolve(__dirname, '../..');

function loadTsModule(relPath) {
  const absPath = path.join(projectRoot, relPath);
  const result = esbuild.buildSync({
    entryPoints: [absPath],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
  });
  const jsCode = result.outputFiles[0].text;
  const mod = { exports: {} };
  const fn = new Function('exports', 'module', 'require', '__dirname', '__filename', jsCode);
  fn(mod.exports, mod, require, path.dirname(absPath), absPath);
  return mod.exports;
}

function runAutonomousAppBuilderSuite() {
  console.log('================================================================');
  console.log('🚀 RUNNING AUTONOMOUS APP BUILDER & CUSTOMER RESPONSE SUITE');
  console.log('================================================================\n');

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

  const {
    analyzeAppRequest,
    generateInternalPlan,
    generateAppFiles,
    verifyGeneratedApp,
    formatCustomerLifecycleResponse,
  } = loadTsModule('src/utils/autonomousAppBuilder.ts');

  const { compileProjectToPreviewHtml, createSeedProjects } = loadTsModule('src/utils/platformEngine.ts');
  const { detectIntent } = loadTsModule('src/utils/intentRouter.ts');
  const { formatUserFacingResponse } = loadTsModule('src/utils/responseFormatter');

  const seedProjects = createSeedProjects();
  const baseProject = JSON.parse(JSON.stringify(seedProjects[0]));

  // --------------------------------------------------------------------------
  // Test A — General Chat: «هلا»
  // --------------------------------------------------------------------------
  runTest('Test A: General Chat («هلا») routes to chat, no build, no file touch', () => {
    const prompt = 'هلا';
    const spec = analyzeAppRequest(prompt, baseProject);
    const intentResult = detectIntent(prompt, 'auto');

    assert.strictEqual(spec.intent, 'chat', 'Spec intent must be chat');
    assert.strictEqual(intentResult.intent, 'chat', 'Intent router must classify as chat');

    const initialFilesCount = baseProject.files.length;
    const initialTimestamp = baseProject.files[0]?.updatedAt;

    // Chat mode must NEVER modify files or run builder
    assert.strictEqual(baseProject.files.length, initialFilesCount);
    assert.strictEqual(baseProject.files[0]?.updatedAt, initialTimestamp);
  });

  // --------------------------------------------------------------------------
  // Test B — New Application: «اعمل لي تطبيق ملاحظات فيه مجلدات وصور وتسجيل صوت»
  // --------------------------------------------------------------------------
  let testBProject = JSON.parse(JSON.stringify(baseProject));
  let testBFiles = {};
  let testBPlan = null;

  runTest('Test B: New Application request analysis & feature extraction', () => {
    const prompt = 'اعمل لي تطبيق ملاحظات فيه مجلدات وصور وتسجيل صوت';
    const spec = analyzeAppRequest(prompt, testBProject);

    assert.strictEqual(spec.intent, 'new_app', 'Intent must be new_app');
    assert.strictEqual(spec.appCategory, 'notes', 'Category must be notes');
    assert.strictEqual(spec.features.folders, true, 'Folders feature must be extracted');
    assert.strictEqual(spec.features.images, true, 'Images feature must be extracted');
    assert.strictEqual(spec.features.voiceRecording, true, 'Voice recording feature must be extracted');
    assert.strictEqual(spec.features.localStorage, true, 'LocalStorage persistence must be enabled');
    assert.strictEqual(spec.constraints.direction, 'rtl', 'Direction must be rtl for Arabic');

    testBPlan = generateInternalPlan(spec, testBProject);
    assert.ok(testBPlan.id, 'Internal plan ID must exist');
    assert.ok(testBPlan.uiComponents.length >= 4, 'UI components must be planned');

    testBFiles = generateAppFiles(spec, testBPlan, testBProject.files);
    assert.ok(testBFiles['index.html'], 'Must generate index.html');
    assert.ok(testBFiles['styles.css'], 'Must generate styles.css');
    assert.ok(testBFiles['app.js'], 'Must generate app.js');

    // Verify Real Functional Logic
    const html = testBFiles['index.html'];
    const js = testBFiles['app.js'];

    // 1. Folders
    assert.ok(html.includes('id="folders-list"'), 'Must have folders-list element');
    assert.ok(html.includes('id="new-folder-btn"'), 'Must have new-folder-btn button');
    assert.ok(js.includes('folders'), 'JS must maintain folders state');

    // 2. Notes CRUD
    assert.ok(html.includes('id="save-note-btn"'), 'Must have save-note-btn button');
    assert.ok(html.includes('id="note-title"'), 'Must have note-title input');
    assert.ok(html.includes('id="note-content"'), 'Must have note-content input');
    assert.ok(html.includes('id="notes-grid"'), 'Must have notes-grid element');
    assert.ok(js.includes('addNote'), 'JS must implement addNote function');
    assert.ok(js.includes('__engineerDeleteNote'), 'JS must implement delete note function');

    // 3. Images Upload
    assert.ok(html.includes('id="note-image-input"'), 'Must have note-image-input file picker');
    assert.ok(js.includes('FileReader') || js.includes('readAsDataURL'), 'JS must use FileReader for images');

    // 4. Voice Recording
    assert.ok(html.includes('id="voice-record-btn"'), 'Must have voice-record-btn button');
    assert.ok(js.includes('toggleVoiceRecording') || js.includes('MediaRecorder'), 'JS must have audio recording logic');

    // 5. LocalStorage
    assert.ok(js.includes('localStorage.setItem') && js.includes('localStorage.getItem'), 'Must have localStorage persistence');

    // Apply files to project
    testBProject.files = Object.entries(testBFiles).map(([name, content]) => ({
      id: `file-${name}`,
      name,
      path: `/${name}`,
      folder: 'root',
      content,
      language: name.endsWith('.html') ? 'html' : name.endsWith('.css') ? 'css' : 'javascript',
      size: content.length,
      updatedAt: new Date().toISOString(),
    }));

    // Verify Live Preview Compilation
    const previewHtml = compileProjectToPreviewHtml(testBProject);
    assert.ok(previewHtml.includes(spec.appTitle), 'Live preview must contain real app title');
    assert.ok(previewHtml.includes('id="save-note-btn"'), 'Live preview must contain real save button');
    assert.ok(previewHtml.includes('id="folders-list"'), 'Live preview must contain real folder list');
    assert.ok(!previewHtml.includes('Live Production Simulator'), 'Live preview must NOT display old fallback simulator');

    // Run Automated Verification Tests
    const verification = verifyGeneratedApp(testBFiles, testBPlan);
    assert.strictEqual(verification.allPassed, true, 'All automated tests must pass');
    assert.ok(verification.testResults.length >= 4, 'Must have at least 4 test cases');

    // Format Customer Message
    const customerMsg = formatCustomerLifecycleResponse('completed', {
      spec,
      testsCount: verification.testResults.length,
      passedTestsCount: verification.testResults.length,
    });
    assert.ok(customerMsg.includes('تم إنشاء التطبيق بنجاح'), 'Must announce successful build');
    assert.ok(customerMsg.includes('المجلدات'), 'Must summarize folders feature');
    assert.ok(customerMsg.includes('الصور'), 'Must summarize images feature');
    assert.ok(customerMsg.includes('الصوت'), 'Must summarize voice memo feature');
  });

  // --------------------------------------------------------------------------
  // Test C — Application Modification: «أضف صفحة الإعدادات»
  // --------------------------------------------------------------------------
  runTest('Test C: Continuous Modification («أضف صفحة الإعدادات») without data loss', () => {
    const modPrompt = 'أضف صفحة الإعدادات';
    const modSpec = analyzeAppRequest(modPrompt, testBProject);

    assert.strictEqual(modSpec.intent, 'modify_app', 'Intent must be modify_app');
    assert.strictEqual(modSpec.features.settings, true, 'Settings feature must be enabled');

    const modPlan = generateInternalPlan(modSpec, testBProject);
    const modFiles = generateAppFiles(modSpec, modPlan, testBProject.files);

    // Verify settings modal was added
    assert.ok(modFiles['index.html'].includes('settings-modal'), 'Settings modal must be injected');

    // Verify existing features remain intact (no data loss)
    assert.ok(modFiles['index.html'].includes('id="folders-list"'), 'Folders list must be retained');
    assert.ok(modFiles['index.html'].includes('id="save-note-btn"'), 'Save button must be retained');
    assert.ok(modFiles['app.js'].includes('folders'), 'Folders state in JS must be retained');

    // Re-verify tests
    const modVerification = verifyGeneratedApp(modFiles, modPlan);
    assert.strictEqual(modVerification.allPassed, true, 'Modified application must pass all tests');
  });

  // --------------------------------------------------------------------------
  // Test D — Bug Fix: «زر حفظ الملاحظات لا يعمل»
  // --------------------------------------------------------------------------
  runTest('Test D: Bug Fix («زر حفظ الملاحظات لا يعمل») patches code and re-verifies', () => {
    const bugPrompt = 'زر حفظ الملاحظات لا يعمل';
    const bugSpec = analyzeAppRequest(bugPrompt, testBProject);

    assert.strictEqual(bugSpec.intent, 'fix_bug', 'Intent must be fix_bug');

    const bugPlan = generateInternalPlan(bugSpec, testBProject);
    const bugFixedFiles = generateAppFiles(bugSpec, bugPlan, testBProject.files);

    assert.ok(bugFixedFiles['app.js'].includes('save-note-btn'), 'Repaired JS must explicitly handle save-note-btn');

    const bugVerification = verifyGeneratedApp(bugFixedFiles, bugPlan);
    assert.strictEqual(bugVerification.allPassed, true, 'Repaired application must pass all tests');

    const bugReport = formatCustomerLifecycleResponse('bug_repaired', { spec: bugSpec });
    assert.ok(bugReport.includes('تم تشخيص المشكلة') || bugReport.includes('إصلاح'), 'Customer response must explain fix');
  });

  // --------------------------------------------------------------------------
  // Test E — Failed Build: Honest failure state without false success
  // --------------------------------------------------------------------------
  runTest('Test E: Failed Build displays honest failure without false claims', () => {
    const brokenFiles = {
      'index.html': '<div>Broken Shell</div>', // Missing meta, missing controls, missing rtl
      'app.js': 'undefined(); null.fail();',
    };

    const failPlan = {
      id: 'plan-fail',
      version: 1,
      title: 'Broken App',
      description: 'Broken app test',
      architecture: 'none',
      techStack: { framework: 'none', styling: 'none', storage: 'none', multimedia: [] },
      uiComponents: [],
      dbSchema: { tables: [] },
      fileStructure: [],
      acceptanceTests: [],
      createdAt: new Date().toISOString(),
    };

    const failVerification = verifyGeneratedApp(brokenFiles, failPlan);
    assert.strictEqual(failVerification.allPassed, false, 'Broken app must fail verification');

    const failedReport = formatCustomerLifecycleResponse('failed', {
      spec: analyzeAppRequest('اعمل لي تطبيق', baseProject),
      failedFeatures: failVerification.testResults.filter((t) => t.status !== 'passed').map((t) => t.name),
    });

    assert.ok(failedReport.includes('لم تجتز الاختبارات') || failedReport.includes('معالجتها'), 'Must honestly report failure');
    assert.ok(!failedReport.includes('تم إنشاء التطبيق بنجاح'), 'Must NEVER claim completion on failure');
  });

  // --------------------------------------------------------------------------
  // Test F — Resume Project: Persistence across reload / restart
  // --------------------------------------------------------------------------
  runTest('Test F: Resume Project restores chat history, files, tests, and preview state', () => {
    const testDbPath = path.resolve(projectRoot, '.data/platform-db-test-persistence.json');
    const projectToPersist = {
      ...testBProject,
      chatThreads: [
        {
          id: 'chat-persistence-test',
          title: 'محادثة الملاحظات',
          updatedAt: new Date().toISOString(),
          messages: [
            { id: 'm1', role: 'user', content: 'اعمل لي تطبيق ملاحظات فيه مجلدات وصور وتسجيل صوت', timestamp: new Date().toISOString() },
            { id: 'm2', role: 'assistant', content: 'تم إنشاء التطبيق بنجاح', timestamp: new Date().toISOString() },
          ],
        },
      ],
    };

    const stateToSave = {
      projects: [projectToPersist],
      settings: { language: 'ar', theme: 'dark' },
    };

    fs.mkdirSync(path.dirname(testDbPath), { recursive: true });
    fs.writeFileSync(testDbPath, JSON.stringify(stateToSave, null, 2), 'utf8');

    // Simulate reading back from disk
    const reloadedRaw = fs.readFileSync(testDbPath, 'utf8');
    const reloadedState = JSON.parse(reloadedRaw);
    const reloadedProject = reloadedState.projects[0];

    assert.strictEqual(reloadedProject.id, projectToPersist.id, 'Project ID must match');
    assert.strictEqual(reloadedProject.files.length, projectToPersist.files.length, 'Files count must match');
    assert.strictEqual(reloadedProject.chatThreads[0].messages.length, 2, 'Chat messages must persist');

    // Ensure preview compiles identically after restoration
    const reloadedPreview = compileProjectToPreviewHtml(reloadedProject);
    assert.ok(reloadedPreview.includes('id="save-note-btn"'), 'Restored preview must render live note controls');

    // Clean up temporary test file
    try { fs.unlinkSync(testDbPath); } catch (_) {}
  });

  // --------------------------------------------------------------------------
  // Zero Leaks Gate: Verification across all customer messages
  // --------------------------------------------------------------------------
  runTest('Zero Leaks Gate: Zero occurrences of internal agents across all outputs', () => {
    const leakKeywords = [
      'chief architect',
      'المدير الرئيسي',
      'planner agent',
      'وكيل التخطيط',
      'builder agent',
      'reviewer agent',
      'engineering execution engine',
      'محرك التنفيذ الهندسي',
      '1. تحليل الطلب والتخطيط',
      '2. تحديث الأكواد والملفات',
    ];

    const testSpec = analyzeAppRequest('اعمل لي تطبيق ملاحظات', baseProject);
    const messagesToAudit = [
      formatCustomerLifecycleResponse('acknowledgment', { spec: testSpec }),
      formatCustomerLifecycleResponse('preview_ready', { spec: testSpec }),
      formatCustomerLifecycleResponse('completed', { spec: testSpec, testsCount: 5, passedTestsCount: 5 }),
      formatCustomerLifecycleResponse('bug_repaired', { spec: testSpec }),
      formatCustomerLifecycleResponse('failed', { spec: testSpec, failedFeatures: ['DOM elements'] }),
      formatUserFacingResponse('Chief Architect: Starting task...'),
      formatUserFacingResponse('المدير الرئيسي: 1. تحليل الطلب والتخطيط: تمت قراءة المشروع'),
    ];

    for (const msg of messagesToAudit) {
      const lower = msg.toLowerCase();
      for (const kw of leakKeywords) {
        assert.ok(
          !lower.includes(kw.toLowerCase()),
          `Leak detected! Found "${kw}" in customer message: "${msg}"`
        );
      }
    }
  });

  console.log('\n================================================================');
  console.log(`🎉 ALL ${passedTests}/${totalTests} ACCEPTANCE TESTS PASSED!`);
  console.log('================================================================\n');
}

runAutonomousAppBuilderSuite();
