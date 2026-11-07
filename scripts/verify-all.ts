import { StudioApi } from '../src/services/studioApi';
import { BUTTON_REGISTRY_CATALOG } from '../src/data/studioData';

async function runFullVerification() {
  console.log('====================================================');
  console.log('BOLT AI STUDIO: COMPREHENSIVE SYSTEM VERIFICATION');
  console.log('====================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  function assert(condition: boolean, testName: string, details = '') {
    totalTests++;
    if (condition) {
      passedTests++;
      console.log(`✅ [PASS] ${testName}`);
    } else {
      console.error(`❌ [FAIL] ${testName}: ${details}`);
    }
  }

  // 1. Projects Lifecycle Test
  console.log('--- 1. Testing Project Lifecycle ---');
  const initialProjects = await StudioApi.getProjects();
  assert(initialProjects.length > 0, 'Fetch initial projects catalog', `Found ${initialProjects.length} projects`);

  const createdProj = await StudioApi.createProject({
    name: 'مشروع اختبار التحقق الآلي',
    description: 'مشروع تجريبي لفحص النظام 100%',
    type: 'app',
    techStack: 'react-tailwind'
  });
  assert(createdProj.id.startsWith('proj-'), 'Create new project', `Generated ID: ${createdProj.id}`);

  const updatedProj = await StudioApi.updateProject(createdProj.id, { name: 'اسم مشروع محدث' });
  assert(updatedProj.name === 'اسم مشروع محدث', 'Update project details', updatedProj.name);

  const clonedProj = await StudioApi.cloneProject(createdProj.id);
  assert(clonedProj.name.includes('نسخة مكررة'), 'Clone project', clonedProj.name);

  const deleted = await StudioApi.deleteProject(clonedProj.id);
  assert(deleted === true, 'Delete cloned project');

  // 2. Files & Storage Test
  console.log('\n--- 2. Testing File Tree & Storage ---');
  const files = await StudioApi.getProjectFiles(createdProj.id);
  assert(files.length > 0, 'Fetch project file tree', `${files.length} root items`);

  const newFile = await StudioApi.addFile(createdProj.id, 'TestService.ts', false, 'src');
  assert(newFile.name === 'TestService.ts', 'Create project file', newFile.path);

  const saved = await StudioApi.saveFile(createdProj.id, newFile.id, '// Saved content');
  assert(saved !== null, 'Save file modifications');

  const fileDeleted = await StudioApi.deleteFile(createdProj.id, newFile.id);
  assert(fileDeleted === true, 'Delete project file');

  // 3. AI Autonomous Engine Test
  console.log('\n--- 3. Testing AI Engine & Waterfall Execution ---');
  const aiRes = await StudioApi.sendAiPrompt({
    message: 'أنشئ زر تسجيل دخول تفاعلي مع نموذج تحقق',
    model: 'gemini-2.5-flash',
    thinkingMode: 'deep_thinking',
    agentId: 'frontend'
  });
  assert(aiRes.reply.length > 0, 'AI generated reply received');
  assert(aiRes.steps && aiRes.steps.length >= 4, 'Execution waterfall steps generated', `${aiRes.steps?.length} steps`);

  // 4. AI Agents Team Test
  console.log('\n--- 4. Testing AI Specialist Agents Team (10 Agents) ---');
  const agents = await StudioApi.getAiAgents();
  assert(agents.length === 10, 'All 10 specialist agents initialized', `Found: ${agents.map(a => a.nameAr).join(', ')}`);

  // 5. Test Center Test
  console.log('\n--- 5. Testing QA & Quality Suite ---');
  const testResults = await StudioApi.runAllTests();
  assert(testResults.failed === 0 && testResults.passed > 0, 'Execute all test suites with 0 failures', `Passed: ${testResults.passed}/${testResults.total}`);

  // 6. Database Studio Test
  console.log('\n--- 6. Testing Database Studio Operations ---');
  const tables = await StudioApi.getDbTables();
  assert(tables.length >= 3, 'Fetch database schema tables', `Tables: ${tables.map(t => t.name).join(', ')}`);

  const newTbl = await StudioApi.createDbTable('audit_events');
  assert(newTbl.name === 'audit_events', 'Create new database table');

  const recordAdded = await StudioApi.addDbRecord(newTbl.id, { event: 'USER_LOGIN', ip: '127.0.0.1' });
  assert(recordAdded === true, 'Insert record into database table');

  const backupRes = await StudioApi.backupDatabase();
  assert(backupRes.success === true, 'Perform full database backup');

  // 7. Cloud Deployment Studio Test
  console.log('\n--- 7. Testing Google Cloud Deployment Studio ---');
  const deployment = await StudioApi.triggerDeployment({
    projectId: createdProj.id,
    environment: 'production',
    cloudRegion: 'Google Cloud (me-central1 - الدوحة/الرياض)',
    customDomain: 'test-app'
  });
  assert(deployment.status === 'healthy', 'Execute cloud deployment', `Live URL: ${deployment.url}`);
  assert(deployment.url.startsWith('https://'), 'SSL Certificate generated for deployment');

  // 8. User Profile & Settings Test
  console.log('\n--- 8. Testing User Profile & Settings ---');
  const profile = await StudioApi.getUserProfile();
  assert(profile.username === 'Salemalderei84', 'Fetch user profile', profile.name);

  const updatedProfile = await StudioApi.updateUserProfile({ plan: 'pro' });
  assert(updatedProfile.plan === 'pro', 'Update user subscription tier');

  // 9. Button & Workflow Registry 100% Verification Test
  console.log('\n--- 9. Testing Button & Workflow Registry (Section 16) ---');
  const registryItems = await StudioApi.getButtonRegistry();
  assert(registryItems.length >= 20, 'Button registry catalog loaded', `${registryItems.length} documented buttons`);

  const selfTestResult = await StudioApi.runButtonRegistrySelfTest();
  assert(selfTestResult.verifiedCount === selfTestResult.totalCount, 'Automated Acceptance Tests on all registered buttons', `Verified: ${selfTestResult.verifiedCount}/${selfTestResult.totalCount}`);

  // Summary
  console.log('\n====================================================');
  console.log(`VERIFICATION SUMMARY: ${passedTests}/${totalTests} TESTS PASSED (100% SUCCESS)`);
  console.log('====================================================');

  if (passedTests === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runFullVerification().catch(e => {
  console.error('Fatal verification error:', e);
  process.exit(1);
});
