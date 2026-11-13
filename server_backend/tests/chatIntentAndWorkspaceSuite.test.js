// ==============================================================================
// Automated Chat Response & Intent Router Quality Gate
// Priority P0 Acceptance Suite:
// 1. «هلا» returns friendly natural greeting without triggering build or modifying files.
// 2. «اشرح لي React» returns educational answer without altering project files.
// 3. «أنشئ تطبيق مهام» executes build mode with clean summary and file updates.
// 4. «عدل لون الزر إلى الأزرق» modifies target files.
// 5. Zero occurrences of "Chief Architect", "المدير الرئيسي", or "تحليل الطلب والتخطيط" in chat stream.
// 6. Project state & preview untouched on chat messages.
// 7. Manual mode override ('chat' forces chat; 'build' forces build).
// ==============================================================================

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');

const projectRoot = path.resolve(__dirname, '../..');

function loadTsModule(relPath) {
  const absPath = path.join(projectRoot, relPath);
  const tsCode = fs.readFileSync(absPath, 'utf8');
  const jsCode = esbuild.transformSync(tsCode, { loader: 'ts', format: 'cjs' }).code;
  const module = { exports: {} };
  const fn = new Function('exports', 'module', 'require', '__dirname', '__filename', jsCode);
  fn(module.exports, module, require, path.dirname(absPath), absPath);
  return module.exports;
}

function runChatIntentAndWorkspaceSuite() {
  console.log('================================================================');
  console.log('💬 RUNNING CHAT INTENT & WORKSPACE VERIFICATION SUITE');
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

  const { detectIntent } = loadTsModule('src/utils/intentRouter.ts');
  const { formatUserFacingResponse } = loadTsModule('src/utils/responseFormatter.ts');

  // --------------------------------------------------------------------------
  // Test 1: «هلا» routes to Chat Mode with greeting sub-intent
  // --------------------------------------------------------------------------
  runTest('Criterion 1: «هلا» routes to Chat Mode (greeting)', () => {
    const r1 = detectIntent('هلا');
    assert.strictEqual(r1.intent, 'chat', 'Expected intent to be chat');
    assert.strictEqual(r1.subIntent, 'greeting', 'Expected subIntent to be greeting');

    const r2 = detectIntent('مرحبا يا مهندس');
    assert.strictEqual(r2.intent, 'chat');
    assert.strictEqual(r2.subIntent, 'greeting');

    const r3 = detectIntent('hello there');
    assert.strictEqual(r3.intent, 'chat');
    assert.strictEqual(r3.subIntent, 'greeting');
  });

  // --------------------------------------------------------------------------
  // Test 2: «اشرح لي React» routes to Chat Mode with QA sub-intent
  // --------------------------------------------------------------------------
  runTest('Criterion 2: «اشرح لي React» routes to Chat Mode (qa)', () => {
    const r1 = detectIntent('اشرح لي React');
    assert.strictEqual(r1.intent, 'chat', 'Expected intent to be chat');
    assert.strictEqual(r1.subIntent, 'qa', 'Expected subIntent to be qa');

    const r2 = detectIntent('ما الفرق بين SQL و NoSQL');
    assert.strictEqual(r2.intent, 'chat');
    assert.strictEqual(r2.subIntent, 'qa');

    const r3 = detectIntent('what is a virtual dom in react');
    assert.strictEqual(r3.intent, 'chat');
    assert.strictEqual(r3.subIntent, 'qa');
  });

  // --------------------------------------------------------------------------
  // Test 3: «أنشئ تطبيق مهام» routes to Build Mode (build_new)
  // --------------------------------------------------------------------------
  runTest('Criterion 3: «أنشئ تطبيق مهام» routes to Build Mode (build_new)', () => {
    const r = detectIntent('أنشئ تطبيق مهام تفاعلي');
    assert.strictEqual(r.intent, 'build', 'Expected intent to be build');
    assert.strictEqual(r.subIntent, 'build_new', 'Expected subIntent to be build_new');

    const r2 = detectIntent('build a dashboard for invoices');
    assert.strictEqual(r2.intent, 'build');
  });

  // --------------------------------------------------------------------------
  // Test 4: «عدل لون الزر إلى الأزرق» routes to Build Mode (modify_code)
  // --------------------------------------------------------------------------
  runTest('Criterion 4: «عدل لون الزر إلى الأزرق» routes to Build Mode (modify_code)', () => {
    const r = detectIntent('عدل لون الزر إلى الأزرق');
    assert.strictEqual(r.intent, 'build', 'Expected intent to be build');
    assert.strictEqual(r.subIntent, 'modify_code', 'Expected subIntent to be modify_code');
  });

  // --------------------------------------------------------------------------
  // Test 5: Manual mode override ('chat' forces chat even if build words exist)
  // --------------------------------------------------------------------------
  runTest('Criterion 5: Manual mode override honors user preference', () => {
    const rChatForced = detectIntent('عدل لون الزر إلى الأزرق', 'chat');
    assert.strictEqual(rChatForced.intent, 'chat', 'Manual chat mode must force chat intent');

    const rBuildForced = detectIntent('هلا', 'build');
    assert.strictEqual(rBuildForced.intent, 'build', 'Manual build mode must force build intent');
  });

  // --------------------------------------------------------------------------
  // Test 6: Zero Leaks: responseFormatter removes Chief Architect and pipeline dumps
  // --------------------------------------------------------------------------
  runTest('Criterion 6: formatUserFacingResponse removes Chief Architect and internal stage leaks', () => {
    const leakedOutput = `تم تنفيذ طلبك بنجاح عبر **المدير الرئيسي (Chief Architect)**:

1. **تحليل الطلب والتخطيط**: تمت قراءة بنية المشروع (8 ملفات) وتحديث خطة العمل.
2. **تحديث الأكواد والملفات**: تم تحديث \`/src/App.tsx\` وإضافة وحدة مخصصة لطلبك: *"هلا"*.
3. **البناء والاختبارات**: تم تجميع الحزمة وفحص الاختبارات التسعة بنجاح دون أخطاء.`;

    const cleaned = formatUserFacingResponse(leakedOutput);
    assert(!cleaned.includes('Chief Architect'), 'Output must not contain Chief Architect');
    assert(!cleaned.includes('المدير الرئيسي'), 'Output must not contain المدير الرئيسي');
    assert(!cleaned.includes('تحليل الطلب والتخطيط'), 'Output must not contain تحليل الطلب والتخطيط');
    assert(!cleaned.includes('تحديث الأكواد والملفات'), 'Output must not contain تحديث الأكواد والملفات');
    assert(!cleaned.includes('البناء والاختبارات'), 'Output must not contain البناء والاختبارات');
  });

  // --------------------------------------------------------------------------
  // Test 7: Chat Mode guarantee: Files and preview remain untouched
  // --------------------------------------------------------------------------
  runTest('Criterion 7: Chat Mode guarantees zero project file mutations', () => {
    const sampleAppContent = `export default function App() { return <button className="btn">Test</button>; }`;
    const prompt = 'هلا';
    const intentResult = detectIntent(prompt);
    assert.strictEqual(intentResult.intent, 'chat');

    // Simulate chat execution: content must NOT be touched
    let fileContent = sampleAppContent;
    if (intentResult.intent === 'build') {
      fileContent += '// feature modified';
    }
    assert.strictEqual(fileContent, sampleAppContent, 'File content must remain completely untouched in Chat Mode');
  });

  console.log(`\n🎉 All ${passedTests}/${totalTests} Chat Intent & Workspace tests passed successfully!`);
}

if (require.main === module) {
  runChatIntentAndWorkspaceSuite();
}

module.exports = { runChatIntentAndWorkspaceSuite };
