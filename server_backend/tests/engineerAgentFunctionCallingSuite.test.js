/**
 * engineerAgentFunctionCallingSuite.test.js
 * Verification of the real Engineer AI Agent with function calling,
 * toolGuard server-side choke point, approvals, and truthful reporting.
 */
process.env.LLM_PROVIDER = 'mock';
const assert = require('node:assert');
const { createEngineerAgent, computeFilesDiff } = require('../services/agent/engineerAgent');
const { createToolGuard, normalizeProjectPath } = require('../security/toolGuard');
const { workspaceTools } = require('../services/agent/workspaceTools');
const { setMockToolResponder, _resetCache } = require('../services/ai/workspaceModelRouter');
_resetCache();

console.log('================================================================');
console.log('🤖 RUNNING ENGINEER AGENT & FUNCTION CALLING VERIFICATION SUITE');
console.log('================================================================\n');

(async () => {
  // 1. Path Confinement
  console.log('▶️ [Test 01] Verifying Path Confinement in toolGuard...');
  assert.throws(() => normalizeProjectPath('../../../etc/passwd'), /Path traversal/, 'Path traversal must be rejected');
  assert.throws(() => normalizeProjectPath('//evil.com/payload.js'), /Absolute or URL paths/, 'Network paths must be rejected');
  assert.throws(() => normalizeProjectPath('.hidden/secret.txt'), /Hidden files/, 'Hidden files must be rejected');
  assert.strictEqual(normalizeProjectPath('src/index.html'), 'src/index.html');
  console.log('   ✅ Path confinement verified: traversal, network, and hidden paths blocked.');

  // 2. Destructive Tool Single-Use Approval
  console.log('▶️ [Test 02] Verifying Destructive Tool Approval Gate...');
  const guard = createToolGuard({ tools: workspaceTools });
  const testProject = {
    id: 'proj_guard_test',
    files: [
      { name: 'index.html', path: 'index.html', content: '<h1>Test</h1>' },
      { name: 'styles.css', path: 'styles.css', content: 'body { color: red; }' }
    ]
  };

  const deleteCall = { name: 'delete_file', arguments: { path: 'styles.css' } };
  const adminUser = { id: 'usr_admin', role: 'Admin', account: 'enterprise' };
  const denyOutcome = await guard.execute(deleteCall, {
    user: adminUser,
    mode: 'build',
    projectId: testProject.id,
    project: testProject
  });

  assert.strictEqual(denyOutcome.status, 'approval_required', 'Destructive tool must require approval');
  assert.ok(denyOutcome.approvalToken, 'Approval token must be issued');
  console.log('   ✅ Destructive tool intercepted with approval token issued.');

  // 3. Approval Token Consumption
  console.log('▶️ [Test 03] Verifying Approval Token Consumption...');
  const allowOutcome = await guard.execute(deleteCall, {
    user: adminUser,
    mode: 'build',
    projectId: testProject.id,
    project: testProject,
    approvals: { delete_file: denyOutcome.approvalToken }
  });
  assert.strictEqual(allowOutcome.ok, true, 'Valid approval token must allow execution');
  assert.ok(!testProject.files.some(f => f.name === 'styles.css'), 'File must be deleted from project');

  // Verify single-use nonce
  const replayOutcome = await guard.execute(deleteCall, {
    user: adminUser,
    mode: 'build',
    projectId: testProject.id,
    project: testProject,
    approvals: { delete_file: denyOutcome.approvalToken }
  });
  assert.strictEqual(replayOutcome.status, 'approval_required', 'Replayed approval token must be rejected');
  console.log('   ✅ Single-use HMAC approval verified; replay rejected.');

  // 4. Role Enforcement (Viewer cannot write files)
  console.log('▶️ [Test 04] Verifying Role-Based Tool Policy (RBAC)...');
  const viewerUser = { id: 'usr_viewer', role: 'Viewer', account: 'standard' };
  const writeCall = { name: 'write_file', arguments: { path: 'index.html', content: '<h1>Hacked</h1>' } };
  const viewerOutcome = await guard.execute(writeCall, {
    user: viewerUser,
    mode: 'build',
    projectId: testProject.id,
    project: testProject
  });
  assert.strictEqual(viewerOutcome.ok, false, 'Viewer must not be permitted to write files');
  assert.strictEqual(viewerOutcome.code, 'ROLE_INSUFFICIENT');
  console.log('   ✅ RBAC verified: Viewer denied write_file tool access.');

  // 5. Untrusted Data Framing
  console.log('▶️ [Test 05] Verifying Untrusted Data Framing...');
  const readCall = { name: 'read_file', arguments: { path: 'index.html' } };
  const readOutcome = await guard.execute(readCall, {
    user: adminUser,
    mode: 'build',
    projectId: testProject.id,
    project: testProject
  });
  assert.ok(readOutcome.framed.startsWith('<tool_result name="read_file" trust="untrusted-data">'));
  assert.ok(readOutcome.framed.endsWith('</tool_result>'));
  console.log('   ✅ Tool result framed as untrusted data.');

  // 6. Real Multi-Turn Agent Loop with Tool Calling
  console.log('▶️ [Test 06] Verifying Multi-Turn Agent Loop & Function Calling...');
  const agentProject = {
    id: 'proj_agent_e2e',
    name: 'Agent Test App',
    language: 'ar',
    files: [
      { name: 'index.html', path: 'index.html', content: '<h1>Initial</h1>' }
    ]
  };

  // Mock a 2-step model conversation:
  // Step 1: Model decides to call write_file to add app.js
  // Step 2: Model finishes with explanation
  let callCount = 0;
  setMockToolResponder(async ({ messages }) => {
    callCount++;
    if (callCount === 1) {
      return {
        text: 'سأقوم بإنشاء ملف app.js لإضافة المنطق التفاعلي.',
        toolCalls: [
          {
            name: 'write_file',
            arguments: { path: 'app.js', content: 'console.log("Interactive logic running");' }
          }
        ]
      };
    } else {
      return {
        text: 'تم إنشاء ملف app.js بنجاح وإضافته إلى المشروع.',
        toolCalls: []
      };
    }
  });

  const agent = createEngineerAgent({ tools: workspaceTools });
  const agentRunResult = await agent.run({
    prompt: 'أضف ملف جافاسكريبت تفاعلي',
    project: agentProject,
    user: adminUser,
    mode: 'build'
  });

  assert.strictEqual(agentRunResult.status, 'completed');
  assert.strictEqual(agentRunResult.toolCalls.length, 1);
  assert.strictEqual(agentRunResult.toolCalls[0].name, 'write_file');
  assert.strictEqual(agentRunResult.toolCalls[0].ok, true);
  assert.ok(agentProject.files.some(f => f.name === 'app.js'), 'app.js must be created in project');
  assert.ok(agentRunResult.filesModified.includes('app.js'), 'filesModified must report app.js');
  console.log('   ✅ Agent executed write_file tool call and verified modification truthfully.');

  // 6.1 Live test tool execution using the actual workspace tool registry
  console.log('▶️ [Test 06.1] Verifying live run_tests workspace tool execution...');
  const testOutcome = await guard.execute({
    name: 'run_tests',
    arguments: { checks: [{ action: 'exists', selector: 'h1' }] }
  }, {
    user: adminUser,
    mode: 'build',
    projectId: agentProject.id,
    project: agentProject
  });
  assert.strictEqual(testOutcome.ok, true, 'run_tests tool must execute successfully');
  console.log('   ✅ Live workspace run_tests tool execution verified.');

  // 7. Truthful Diff Reporting: 0 files modified
  console.log('▶️ [Test 07] Verifying Truthful Reporting for 0 Diffs...');
  const diffs = computeFilesDiff(
    new Map([['index.html', 'content']]),
    [{ name: 'index.html', path: 'index.html', content: 'content' }]
  );
  assert.strictEqual(diffs.length, 0, 'No diffs when files are identical');
  console.log('   ✅ Truthful diff computation verified (0 diffs).');

  // Reset mock responder
  setMockToolResponder(null);

  console.log('\n================================================================');
  console.log('🎉 ALL 7 TESTS IN ENGINEER AGENT SUITE PASSED (100% GREEN)');
  console.log('================================================================\n');
})();
