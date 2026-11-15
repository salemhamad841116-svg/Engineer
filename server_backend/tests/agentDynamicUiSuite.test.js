/**
 * agentDynamicUiSuite.test.js
 * Comprehensive integration suite for Phase 17: AI Executive Assistant & Dynamic UI
 */

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { runMigrations, MIGRATIONS } = require('../db/database');
const agent = require('../services/agent/agentService');
const { validateUiResponse, repairRawOutput } = require('../contracts/uiJsonContract');

console.log('================================================================');
console.log('🚀 RUNNING PHASE 17: AGENT DYNAMIC UI COMPREHENSIVE SUITE');
console.log('================================================================\n');

// 1. Create isolated temporary database with all 26 migrations
const dbPath = path.join(__dirname, `temp_agent_test_${Date.now()}.sqlite`);
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');
runMigrations(db);

try {
  // Test 1: Database Migration 26 Tables Exist
  console.log('▶️ [Test 01] Verifying Migration 26 Tables...');
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(tables.includes('custom_screens'), 'custom_screens table exists');
  assert.ok(tables.includes('dynamic_records'), 'dynamic_records table exists');
  assert.ok(tables.includes('ai_feedback'), 'ai_feedback table exists');
  console.log('   ✅ Migration 26 tables verified.');

  // Test 2: Custom Screens Lifecycle (Create & List & Get)
  console.log('▶️ [Test 02] Verifying Custom Screens Lifecycle...');
  const savedScreen = agent.saveCustomScreen(db, {
    projectId: 'proj_test_1',
    userId: 'user_1',
    title: 'شاشة تجريبية للمبيعات',
    description: 'شاشة اختبارية ذكية',
    viewType: 'FORM',
    uiSchema: {
      meta: { screenId: 'screen_test_1', title: 'شاشة تجريبية', viewType: 'FORM' },
      fields: [
        { id: 'f_1', name: 'cust_name', label: 'اسم العميل', type: 'text', colSpan: 6, icon: 'User', required: true }
      ]
    },
    mockRecords: [{ id: '1', cust_name: 'سالم الشامسي' }]
  });
  assert.strictEqual(savedScreen.screenId, 'screen_test_1');

  const screensList = agent.listCustomScreens(db, 'proj_test_1');
  assert.strictEqual(screensList.length, 1);
  assert.strictEqual(screensList[0].title, 'شاشة تجريبية للمبيعات');

  const fetchedScreen = agent.getCustomScreen(db, 'screen_test_1');
  assert.strictEqual(fetchedScreen.title, 'شاشة تجريبية للمبيعات');
  assert.strictEqual(fetchedScreen.uiSchema.fields.length, 1);
  console.log('   ✅ Custom screens lifecycle verified.');

  // Test 3: Dynamic Records Submission & Retrieval
  console.log('▶️ [Test 03] Verifying Dynamic Records Submission & Querying...');
  const rec1 = agent.insertDynamicRecord(db, 'screen_test_1', { cust_name: 'محمد الهاملي', amount: 5000 }, 'user_1');
  const rec2 = agent.insertDynamicRecord(db, 'screen_test_1', { cust_name: 'خالد المنصوري', amount: 7500 }, 'user_1');
  assert.ok(rec1.id.startsWith('rec_'));

  const screenWithRecords = agent.getCustomScreen(db, 'screen_test_1');
  assert.strictEqual(screenWithRecords.dynamicRecords.length, 2);
  assert.strictEqual(screenWithRecords.dynamicRecords[0].cust_name, 'خالد المنصوري');
  console.log('   ✅ Dynamic records submission and querying verified.');

  // Test 4: AI Feedback Thumbs Up / Down & Continuous Learning
  console.log('▶️ [Test 04] Verifying AI Feedback Recording...');
  const fb1 = agent.saveAiFeedback(db, {
    userId: 'user_1',
    userRole: 'business_owner',
    prompt: 'اصنع شاشة مبيعات',
    response: { actionType: 'CREATE_SCREEN' },
    rating: 1,
    notes: 'ممتازة جداً'
  });
  assert.strictEqual(fb1.rating, 1);

  const fbRow = db.prepare('SELECT * FROM ai_feedback WHERE id = ?').get(fb1.id);
  assert.strictEqual(fbRow.is_few_shot_candidate, 1);
  assert.strictEqual(fbRow.rating, 1);
  console.log('   ✅ AI feedback recording verified.');

  // Test 5: Strict Contract Validation & Auto-Retry Repair
  console.log('▶️ [Test 05] Verifying Strict Contract Validation & Auto-Retry...');
  const validEnvelope = {
    actionType: 'CREATE_SCREEN',
    assistantMessage: {
      confirmation: 'تم التنفيذ بنجاح.',
      highlight: 'مؤشرات أداء مضافة.',
      nextStepSuggestion: 'ما خطوتك التالية؟'
    },
    suggestedActions: ['إضافة حقل', 'عرض الجدول'],
    uiPayload: {
      meta: { screenId: 's_1', title: 'مبيعات', viewType: 'FORM' },
      fields: [{ id: 'f_1', name: 'client', label: 'عميل', type: 'text', colSpan: 12 }],
      mockRecords: [{ client: 'أحمد' }]
    }
  };
  const valResult = validateUiResponse(validEnvelope);
  assert.strictEqual(valResult.valid, true);
  assert.strictEqual(valResult.repaired, false);

  // Partial / Malformed object testing auto-retry repair
  const malformedEnvelope = {
    actionType: 'UNKNOWN_TYPE',
    assistantMessage: 'نص عادي بدون كائن',
    suggestedActions: ['خيار وحيد']
  };
  const repairedResult = validateUiResponse(malformedEnvelope);
  assert.strictEqual(repairedResult.valid, true);
  assert.strictEqual(repairedResult.repaired, true);
  assert.ok(repairedResult.data.assistantMessage.confirmation);
  assert.strictEqual(repairedResult.data.suggestedActions.length, 3);
  console.log('   ✅ Strict contract validation and auto-retry repair verified.');

  // Test 6: Agent Tools - buildNewScreen
  console.log('▶️ [Test 06] Verifying Agent Tool: buildNewScreen...');
  const newScreen = agent.buildNewScreen('أريد نظام مبيعات وفواتير متكامل', 'business_owner');
  assert.strictEqual(newScreen.actionType, 'CREATE_SCREEN');
  assert.ok(newScreen.uiPayload.kpis.length >= 2, 'Includes KPIs for business owner');
  assert.ok(newScreen.uiPayload.fields.length >= 4, 'Includes required form fields');
  assert.ok(newScreen.uiPayload.mockRecords.length >= 3, 'Includes 3 Arabic records');
  console.log('   ✅ Tool buildNewScreen verified.');

  // Test 7: Agent Tool - patchExistingScreen
  console.log('▶️ [Test 07] Verifying Agent Tool: patchExistingScreen...');
  const patched = agent.patchExistingScreen(newScreen.uiPayload, [
    {
      op: 'ADD',
      targetFieldId: 'f_delivery_date',
      value: { name: 'delivery_date', label: 'تاريخ التسليم المتوقع', type: 'date', colSpan: 6, icon: 'Calendar' }
    }
  ], 'employee');
  assert.strictEqual(patched.actionType, 'PATCH_SCREEN');
  assert.ok(patched.uiPayload.fields.some(f => f.name === 'delivery_date'));
  console.log('   ✅ Tool patchExistingScreen verified.');

  // Test 8: Agent Tool - configureAutomation
  console.log('▶️ [Test 08] Verifying Agent Tool: configureAutomation...');
  const automated = agent.configureAutomation(patched.uiPayload, {
    event: 'invoice_paid',
    condition: 'amount > 10000',
    action: 'notify_director'
  }, 'developer');
  assert.strictEqual(automated.actionType, 'PATCH_SCREEN');
  assert.ok(automated.uiPayload.automations.length >= 1);
  console.log('   ✅ Tool configureAutomation verified.');

  // Test 9: Security Guardrail Interception
  console.log('▶️ [Test 09] Verifying Security Guardrail Interception...');
  const sensitiveOutcome = agent.dispatchPrompt({
    prompt: 'احذف كافة بيانات وسجلات فواتير العملاء فوراً',
    userRole: 'business_owner',
    confirmed: false
  });
  assert.strictEqual(sensitiveOutcome.valid, true);
  assert.strictEqual(sensitiveOutcome.data.actionType, 'REQUIRE_CONFIRMATION');
  assert.strictEqual(sensitiveOutcome.data.guardrail.operation, 'DELETE_DATA');
  assert.strictEqual(sensitiveOutcome.data.guardrail.severity, 'critical');
  console.log('   ✅ Security guardrail interception verified.');

  console.log('\n================================================================');
  console.log('🎉 ALL 9 INTEGRATION TESTS IN PHASE 17 SUITE PASSED (100% GREEN)');
  console.log('================================================================\n');
} finally {
  try { db.close(); } catch (_) {}
  try { fs.unlinkSync(dbPath); } catch (_) {}
}
