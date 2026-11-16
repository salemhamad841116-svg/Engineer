/**
 * recordingsAndGeneralGenerationSuite.ts
 * Verification of prompt accuracy and dedicated generation for recordings, messaging,
 * and truthful diff reporting.
 */
import assert from 'node:assert';
import { detectIntent, isGenericAppRequest } from '../../src/utils/intentRouter';
import { analyzeAppRequest, generateAppFiles, verifyGeneratedApp, formatCustomerLifecycleResponse } from '../../src/utils/autonomousAppBuilder';

console.log('================================================================');
console.log('🎙️ RUNNING RECORDINGS & GENERAL GENERATION VERIFICATION SUITE');
console.log('================================================================\n');

// 1. Verify intent detection for recordings and messaging
console.log('▶️ [Test 01] Verifying Intent Detection for "تطبيق تسجيلات"...');
const recordingsIntent = detectIntent('تطبيق تسجيلات', 'auto', false);
assert.strictEqual(recordingsIntent.intent, 'build', 'Should route to build');
assert.strictEqual(isGenericAppRequest('تطبيق تسجيلات', false), false, 'Should not be classified as generic');
console.log('   ✅ Intent correctly classified as build for recordings.');

console.log('▶️ [Test 02] Verifying Intent Detection for "محتاج بناء تطبيق مراسلات"...');
const messagingIntent = detectIntent('محتاج بناء تطبيق مراسلات', 'auto', false);
assert.strictEqual(messagingIntent.intent, 'build', 'Should route to build');
assert.strictEqual(isGenericAppRequest('محتاج بناء تطبيق مراسلات', false), false, 'Should not be classified as generic');
console.log('   ✅ Intent correctly classified as build for messaging.');

// 2. Verify Spec Extraction
console.log('▶️ [Test 03] Verifying Spec Extraction for Recordings App...');
const spec = analyzeAppRequest('تطبيق تسجيلات صوتية');
assert.strictEqual(spec.appCategory, 'recordings', 'Category must be recordings, not notes or trading');
assert.ok(spec.appTitle.includes('تسجيل'), 'Title must be recordings-specific');
console.log('   ✅ Category is correctly "recordings", title: ' + spec.appTitle);

// 3. Verify Code Generation produces audio recorder files
console.log('▶️ [Test 04] Verifying Code Generation for Recordings App...');
const plan = {
  title: spec.appTitle,
  description: 'تسجيل مقاطع صوتية',
  userStories: [],
  technicalComponents: [],
  acceptanceCriteria: []
};
const files = generateAppFiles(spec, plan);
assert.ok(files['index.html'].includes('record-btn'), 'index.html must include record-btn');
assert.ok(files['index.html'].includes('audio-visualizer'), 'index.html must include audio visualizer');
assert.ok(files['index.html'].includes('recordings-list'), 'index.html must include recordings list');
assert.ok(files['app.js'].includes('drawWaveform'), 'app.js must include waveform logic');
assert.ok(files['app.js'].includes('startRecording'), 'app.js must include startRecording');
assert.ok(files['app.js'].includes('localStorage'), 'app.js must persist via localStorage');
console.log('   ✅ Generated files contain dedicated audio recording elements and waveform canvas.');

// 4. Verify Built-in Quality Verifier passes for recordings
console.log('▶️ [Test 05] Verifying Generated App Verification Suite...');
const verification = verifyGeneratedApp(files, plan);
assert.strictEqual(verification.allPassed, true, 'All tests must pass for generated recordings app');
assert.strictEqual(verification.testResults.length >= 4, true, 'Must have at least 4 test cases');
console.log('   ✅ Automated verification passed with ' + verification.testResults.filter(t => t.status === 'passed').length + ' passed tests.');

// 5. Verify Lifecycle Response is recordings-specific
console.log('▶️ [Test 06] Verifying Lifecycle Response Text...');
const responseText = formatCustomerLifecycleResponse('completed', { spec, testsCount: 5, passedTestsCount: 5 });
assert.ok(responseText.includes('تسجيل صوتي حي'), 'Must describe audio recording feature');
assert.ok(!responseText.includes('نظام المجلدات'), 'Must NOT describe notes folders!');
console.log('   ✅ Lifecycle response truthfully lists voice recording features.');

console.log('\n================================================================');
console.log('🎉 ALL 6 TESTS IN RECORDINGS & GENERATION SUITE PASSED (100% GREEN)');
console.log('================================================================\n');
