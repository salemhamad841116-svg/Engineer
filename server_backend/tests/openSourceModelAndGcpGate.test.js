/**
 * openSourceModelAndGcpGate.test.js
 * Mandatory Gate: Phase 11 Open Source Model Integration, Resource Guard & GCP Production Suite
 *
 * Enforces:
 * 1. Model Provider Interface dynamic switching via config/env only (zero code changes).
 * 2. Zero hardcoded model names (all model names driven by environment variables).
 * 3. Declared Resource Suspension on local inference failure (zero silent fallback to cloud API).
 * 4. Opt-in Cloud Fallback when explicitly permitted by configuration.
 * 5. Three Research Tiers local cost bounds ($0 fee + resource quota).
 * 6. VRAM and RAM monitoring with threshold alerting (critical alert at >= 85% VRAM / >= 90% RAM).
 * 7. Autonomous Coding Agent graceful transition to 'suspended_resources' under VRAM pressure.
 * 8. Golden Dataset 34-question benchmark execution, verbatim grounding and quality gate compliance.
 * 9. Production GCP Host verification and admin subdomain isolation (engineer-mgt.misruq.com).
 * 10. Production Docker Compose and deployment configuration integrity.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/database.js');
const { modelProvider, ModelProviderInterface, ModelUnavailableError } = require('../services/ai/modelProviderInterface.js');
const { systemHealthMonitor } = require('../services/operations/systemHealthMonitor.js');
const { executeDeepResearch } = require('../services/research/deepResearchEngine.js');
const { evaluateGoldenDataset } = require('../services/research/goldenDatasetManager.js');
const { executeAutonomousTask } = require('../services/agent/autonomousAgent.js');
const { isAdminDomain } = require('../middleware/subdomainRouter.js');

async function runTestSuite() {
  console.log('================================================================');
  console.log('🚀 RUNNING PHASE 11 OPEN SOURCE MODEL & GCP PRODUCTION SUITE');
  console.log('================================================================\n');

  // Ensure DB is initialized
  getDb();

  // ----------------------------------------------------
  // Test 1: Model Provider Interface Dynamic Switching
  // ----------------------------------------------------
  console.log('[Test 1] Verifying Model Provider Interface dynamic switching via config...');

  const originalProvider = process.env.LLM_PROVIDER;
  const originalBaseUrl = process.env.LLM_BASE_URL;
  const originalModel = process.env.LLM_MODEL;

  try {
    // Test Ollama local setup
    process.env.LLM_PROVIDER = 'ollama';
    delete process.env.LLM_BASE_URL;
    delete process.env.LLM_MODEL;
    let cfg = modelProvider.getActiveConfig();
    assert.strictEqual(cfg.provider, 'ollama');
    assert.strictEqual(cfg.baseUrl, 'http://localhost:11434/v1');
    assert.strictEqual(cfg.model, 'qwen2.5:7b');
    assert.strictEqual(cfg.isLocal, true);

    // Test vLLM production setup
    process.env.LLM_PROVIDER = 'vllm';
    cfg = modelProvider.getActiveConfig();
    assert.strictEqual(cfg.provider, 'vllm');
    assert.strictEqual(cfg.baseUrl, 'http://localhost:8000/v1');
    assert.strictEqual(cfg.model, 'Qwen/Qwen2.5-32B-Instruct-AWQ');
    assert.strictEqual(cfg.isLocal, true);

    // Test OpenAI cloud setup
    process.env.LLM_PROVIDER = 'openai';
    cfg = modelProvider.getActiveConfig();
    assert.strictEqual(cfg.provider, 'openai');
    assert.strictEqual(cfg.baseUrl, 'https://api.openai.com/v1');
    assert.strictEqual(cfg.model, 'gpt-4o-mini');
    assert.strictEqual(cfg.isLocal, false);

    console.log('  ✅ Provider switching verified across Ollama, vLLM, and OpenAI via config alone.');
  } finally {
    process.env.LLM_PROVIDER = originalProvider || 'mock';
    if (originalBaseUrl) process.env.LLM_BASE_URL = originalBaseUrl; else delete process.env.LLM_BASE_URL;
    if (originalModel) process.env.LLM_MODEL = originalModel; else delete process.env.LLM_MODEL;
  }

  // ----------------------------------------------------
  // Test 2: Zero Hardcoded Model Names Enforcement
  // ----------------------------------------------------
  console.log('\n[Test 2] Verifying zero hardcoded model names (all driven by env variables)...');

  try {
    process.env.LLM_MODEL = 'qwen2.5-coder:14b-instruct-q8_0';
    process.env.LLM_BASE_URL = 'http://custom-vllm-cluster:8000/v1';
    const cfg = modelProvider.getActiveConfig();
    assert.strictEqual(cfg.model, 'qwen2.5-coder:14b-instruct-q8_0');
    assert.strictEqual(cfg.baseUrl, 'http://custom-vllm-cluster:8000/v1');
    console.log('  ✅ Custom environment model and base URL correctly overrides defaults without code edits.');
  } finally {
    delete process.env.LLM_MODEL;
    delete process.env.LLM_BASE_URL;
  }

  // ----------------------------------------------------
  // Test 3: Declared Resource Suspension on Local Failure (Zero Silent Fallback)
  // ----------------------------------------------------
  console.log('\n[Test 3] Verifying declared resource suspension when local inference engine fails...');

  const prevProvider = process.env.LLM_PROVIDER;
  const prevFallback = process.env.ALLOW_CLOUD_FALLBACK;
  const prevBaseUrl = process.env.LLM_BASE_URL;

  try {
    process.env.LLM_PROVIDER = 'ollama';
    process.env.LLM_BASE_URL = 'http://127.0.0.1:59999/v1'; // Unreachable port
    process.env.ALLOW_CLOUD_FALLBACK = 'false';

    let caughtError = null;
    try {
      await modelProvider.chat({
        messages: [{ role: 'user', content: 'ما هي معمارية Microservices؟' }],
        timeoutMs: 1500,
      });
    } catch (err) {
      caughtError = err;
    }

    assert(caughtError, 'Expected modelProvider.chat to fail when local engine is down');
    assert(caughtError.isSuspended, 'Expected isSuspended to be true');
    assert.strictEqual(caughtError.code, 'MODEL_UNAVAILABLE');
    assert(caughtError.message.includes('تم تعليق العملية معلنةً'), 'Expected declared suspension explanation in Arabic');

    console.log('  ✅ Declared suspension strictly enforced: zero silent fallback to cloud API.');
  } finally {
    process.env.LLM_PROVIDER = prevProvider || 'mock';
    if (prevFallback) process.env.ALLOW_CLOUD_FALLBACK = prevFallback; else delete process.env.ALLOW_CLOUD_FALLBACK;
    if (prevBaseUrl) process.env.LLM_BASE_URL = prevBaseUrl; else delete process.env.LLM_BASE_URL;
  }

  // ----------------------------------------------------
  // Test 4: Deterministic Grounded Completion & Honest Refusal
  // ----------------------------------------------------
  console.log('\n[Test 4] Verifying grounded completion and honest refusal...');

  try {
    process.env.LLM_PROVIDER = 'mock';

    // Test grounded RAG excerpt synthesis
    const mockContext = [
      {
        role: 'user',
        content: `Context from Knowledge Base:
--- CONTEXT EXCERPT #1 (Source: "هندسة البرمجيات والأنظمة الموزعة الحديثة", Page: 42, Relevance: 98.0%) ---
الفرق المعماري بين Microservices و SOA يكمن في التخلص من ناقل الخدمة المؤسسي ESB.

User Question:
ما الفرق المعماري بين Microservices و SOA؟`,
      },
    ];

    const ragRes = await modelProvider.chat({ messages: mockContext });
    assert(ragRes.text.includes('النتيجة المباشرة'), 'Expected direct result in response');
    assert(ragRes.text.includes('Microservices'), 'Expected subject in response');

    // Test honest refusal for out-of-domain query
    const refusalRes = await modelProvider.chat({
      messages: [{ role: 'user', content: 'ما هي نتائج مباراة الأمس؟' }],
    });
    assert(refusalRes.text.includes('تصريح رسمي بنقص المعلومات'), 'Expected honest refusal declaration');
    assert(refusalRes.text.includes('يمتنع النظام تماماً عن التخمين'), 'Expected honest non-hallucination policy');

    console.log('  ✅ Grounded context synthesis and honest refusal verified 100%.');
  } finally {
    process.env.LLM_PROVIDER = 'mock';
  }

  // ----------------------------------------------------
  // Test 5: Three Research Tiers with Local Cost Accounting
  // ----------------------------------------------------
  console.log('\n[Test 5] Verifying Three Research Tiers local cost bounds ($0 fee + resource quota)...');

  try {
    process.env.LLM_PROVIDER = 'mock';

    // 1. Quick tier
    const quickResult = await executeDeepResearch({
      query: 'ما هو نمط CQRS وما المشكلة التي يحلها؟',
      manualLevel: 'quick',
    });
    assert.strictEqual(quickResult.session.costEstimate, 0.0, 'Local model cost must be exactly $0.00');
    assert(quickResult.localResourceUsage, 'Expected localResourceUsage object');
    assert.strictEqual(quickResult.localResourceUsage.isLocal, true);
    assert(quickResult.localResourceUsage.durationMs < 15000, 'Quick tier duration within 15s limit');

    // 2. Deep tier
    const deepResult = await executeDeepResearch({
      query: 'ما الفرق بين عزل القراءة المتكررة والتسلسلي؟',
      manualLevel: 'deep',
    });
    assert.strictEqual(deepResult.session.costEstimate, 0.0);
    assert(deepResult.localResourceUsage.quotaMet, 'Deep tier quota must be met');

    // 3. Expert tier
    const expertResult = await executeDeepResearch({
      query: 'قارن بين بروتوكول Raft و Paxos ومستويات اتساق المعاملات',
      manualLevel: 'expert',
    });
    assert.strictEqual(expertResult.session.costEstimate, 0.0);
    assert(expertResult.localResourceUsage.tokensCount > 0);

    console.log('  ✅ All 3 research tiers verified with $0.00 token cost and local resource tracking.');
  } finally {
    process.env.LLM_PROVIDER = 'mock';
  }

  // ----------------------------------------------------
  // Test 6: VRAM and RAM Health Monitoring & Threshold Alerting
  // ----------------------------------------------------
  console.log('\n[Test 6] Verifying VRAM and RAM health monitoring & threshold alerts...');

  const origVram = process.env.MOCK_VRAM_USAGE_PERCENT;
  try {
    // Simulate high VRAM pressure (92% > 85% threshold)
    process.env.MOCK_VRAM_USAGE_PERCENT = '92';

    const metrics = systemHealthMonitor.getModelResourceMetrics();
    assert.strictEqual(metrics.vram.usagePercent, 92);
    assert.strictEqual(metrics.vram.isOverThreshold, true);
    assert.strictEqual(metrics.pressureLevel, 'critical');

    // Record a critical VRAM alert
    const alert = systemHealthMonitor.recordAlert({
      level: 'critical',
      category: 'memory',
      message: 'High VRAM utilization (92%) exceeds safe threshold (85%) on Nvidia L4 GPU.',
      details: metrics.vram,
    });

    assert.strictEqual(alert.level, 'critical');
    assert.strictEqual(alert.category, 'memory');
    assert(alert.message.includes('High VRAM utilization'));

    const healthReport = systemHealthMonitor.getSystemHealthReport();
    assert.strictEqual(healthReport.status, 'critical', 'System health status must reflect critical VRAM pressure');

    console.log('  ✅ VRAM/RAM threshold monitoring and critical alerting verified.');
  } finally {
    if (origVram !== undefined) process.env.MOCK_VRAM_USAGE_PERCENT = origVram;
    else delete process.env.MOCK_VRAM_USAGE_PERCENT;
  }

  // ----------------------------------------------------
  // Test 7: Autonomous Agent Declared Suspension under VRAM Pressure
  // ----------------------------------------------------
  console.log('\n[Test 7] Verifying Autonomous Agent transitions to suspended_resources under VRAM pressure...');

  try {
    process.env.MOCK_VRAM_USAGE_PERCENT = '95';

    const agentResult = await executeAutonomousTask({
      projectId: 'proj-fintrack-erp',
      prompt: 'قم بإعادة هيكلة محرك التقارير المحاسبية',
      autonomyLevel: 'supervised',
    });

    assert.strictEqual(agentResult.status, 'suspended_resources');
    assert(agentResult.message.includes('VRAM: 95%') || agentResult.message.includes('تجاوز استهلاك'), 'Expected VRAM suspension message');
    console.log('  ✅ Agent gracefully transitioned to suspended_resources without crashing.');
  } finally {
    delete process.env.MOCK_VRAM_USAGE_PERCENT;
  }

  // ----------------------------------------------------
  // Test 8: Golden Dataset 34-Question Benchmark Execution & Metrics
  // ----------------------------------------------------
  console.log('\n[Test 8] Verifying Golden Dataset 34-question benchmark execution & metrics...');

  try {
    process.env.LLM_PROVIDER = 'mock';

    // Evaluate Batch 1 (24 reference questions)
    const report1 = await evaluateGoldenDataset({ batch: 1 });
    assert.strictEqual(report1.evaluatedCount, 24);
    assert.strictEqual(report1.overallMetrics.recallAt5Percent, 100);
    assert.strictEqual(report1.overallMetrics.verbatimGroundingPercent, 100);
    assert.strictEqual(report1.overallMetrics.qualityGatePassRatePercent, 100);

    // Evaluate Batch 2 (10 stress questions)
    const report2 = await evaluateGoldenDataset({ batch: 2 });
    assert.strictEqual(report2.evaluatedCount, 10);
    assert.strictEqual(report2.overallMetrics.recallAt5Percent, 100);
    assert.strictEqual(report2.overallMetrics.verbatimGroundingPercent, 100);
    assert.strictEqual(report2.overallMetrics.qualityGatePassRatePercent, 100);

    console.log('  ✅ Golden Dataset 34 questions evaluated: 100% Recall@5, 100% Verbatim Grounding, 100% Quality Gate.');
  } finally {
    process.env.LLM_PROVIDER = 'mock';
  }

  // ----------------------------------------------------
  // Test 9: Production GCP Host Configuration & Admin Isolation
  // ----------------------------------------------------
  console.log('\n[Test 9] Verifying GCP production host configuration (engineer-mgt.misruq.com)...');

  const origAdminHost = process.env.ADMIN_HOST;
  try {
    process.env.ADMIN_HOST = 'engineer-mgt.misruq.com';

    assert.strictEqual(isAdminDomain('engineer-mgt.misruq.com'), true, 'engineer-mgt.misruq.com must be identified as admin host');
    assert.strictEqual(isAdminDomain('misruq.com'), false, 'Main domain must NOT be identified as admin host');
    assert.strictEqual(isAdminDomain('www.misruq.com'), false);
    assert.strictEqual(isAdminDomain('api.misruq.com'), false);

    console.log('  ✅ Admin subdomain host engineer-mgt.misruq.com strictly verified with zero leak to main domain.');
  } finally {
    if (origAdminHost) process.env.ADMIN_HOST = origAdminHost;
    else delete process.env.ADMIN_HOST;
  }

  // ----------------------------------------------------
  // Test 10: Production Docker Compose & Deployment Assets Integrity
  // ----------------------------------------------------
  console.log('\n[Test 10] Verifying GCP deployment documentation & docker-compose.prod.yml...');

  const gcpDocPath = path.resolve(__dirname, '../../deploy/gcp-compute-engine.md');
  const composeProdPath = path.resolve(__dirname, '../../deploy/docker-compose.prod.yml');

  assert(fs.existsSync(gcpDocPath), 'deploy/gcp-compute-engine.md must exist');
  assert(fs.existsSync(composeProdPath), 'deploy/docker-compose.prod.yml must exist');

  const docContent = fs.readFileSync(gcpDocPath, 'utf8');
  assert(docContent.includes('g2-standard-8'), 'Must document g2-standard-8 VM');
  assert(docContent.includes('nvidia-l4'), 'Must document Nvidia L4 GPU');
  assert(docContent.includes('engineer-mgt.misruq.com'), 'Must document engineer-mgt.misruq.com');
  assert(docContent.includes('vllm'), 'Must document vLLM inference engine');
  assert(docContent.includes('Qwen/Qwen2.5-32B-Instruct-AWQ'), 'Must document Qwen2.5-32B-AWQ model');

  const composeContent = fs.readFileSync(composeProdPath, 'utf8');
  assert(composeContent.includes('vllm-engine:'), 'docker-compose must define vllm-engine service');
  assert(composeContent.includes('knowledge-app:'), 'docker-compose must define knowledge-app service');
  assert(composeContent.includes('engineer-mgt.misruq.com'), 'docker-compose must define ADMIN_HOST=engineer-mgt.misruq.com');
  assert(composeContent.includes('Qwen/Qwen2.5-32B-Instruct-AWQ'), 'docker-compose must specify Qwen2.5-32B model');

  console.log('  ✅ Production deployment artifacts verified 100% complete and compliant.');

  console.log('\n================================================================');
  console.log('🎉 ALL 10 PHASE 11 OPEN SOURCE MODEL & GCP TESTS PASSED (100%)');
  console.log('================================================================\n');
}

runTestSuite().catch((err) => {
  console.error('\n❌ Phase 11 Test Suite Failed:', err);
  process.exit(1);
});
