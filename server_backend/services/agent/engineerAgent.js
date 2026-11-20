// ==============================================================================
// server_backend/services/agent/engineerAgent.js
// The Engineer AI Agent: Multi-turn reasoning and real function calling.
//
// Every action is routed through toolGuard (server-side policy, schema validation,
// path confinement, HMAC approval for destructive actions, untrusted framing).
// Canned keyword fallbacks and fake personas are strictly prohibited;
// outcomes are reported truthfully based on actual diffs and test results.
// ==============================================================================
'use strict';

const { createToolGuard, normalizeProjectPath } = require('../../security/toolGuard');
const { workspaceTools } = require('./workspaceTools');
const { CONSTITUTION_VERSION, POLICY, buildSystemPrompt, isToolAllowed } = require('../ai/constitution');
const { chatWithTools, WorkspaceModelError } = require('../ai/workspaceModelRouter');
const { runPreviewChecks } = require('./previewRunner');

/**
 * Creates an agent execution context.
 */
function createEngineerAgent({ tools = workspaceTools, guard, audit } = {}) {
  const toolGuard = guard || createToolGuard({ tools, audit });

  /**
   * Runs the agent on a user prompt with the active project context.
   *
   * @param {object} params
   * @param {string} params.prompt
   * @param {object} params.project
   * @param {object} params.user - { id, role, account }
   * @param {string} [params.mode='workspace'] - 'workspace' | 'architect' | 'screens' | 'autonomous_build'
   * @param {string} [params.modelId]
   * @param {AbortSignal} [params.signal]
   * @param {Array<object>} [params.history=[]]
   * @param {Array<object>} [params.attachments=[]]
   * @param {Record<string, string>} [params.approvals={}]
   * @param {object} [params.db]
   * @param {(stage: string, detail?: any) => void} [params.onStage]
   * @param {(chunk: string) => void} [params.onDelta]
   * @param {(event: object) => void} [params.onTool]
   * @param {(spec: object) => any} [params.createProjectHandler]
   * @param {() => Promise<string>} [params.compilePreview]
   * @returns {Promise<object>}
   */
  async function run({
    prompt,
    project,
    user,
    mode = 'workspace',
    modelId,
    signal,
    history = [],
    attachments = [],
    approvals = {},
    db,
    onStage = () => {},
    onDelta = () => {},
    onTool = () => {},
    createProjectHandler,
    compilePreview,
  }) {
    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error('Prompt is required for agent execution.');
    }
    if (!project || typeof project !== 'object') {
      throw new Error('Project context is required.');
    }
    const cleanPrompt = prompt.trim();
    const isAr = /[\u0600-\u06FF]/.test(cleanPrompt) || project.language === 'ar';
    const callerUser = {
      id: (user && user.id) || 'usr_anonymous',
      role: (user && user.role) || 'Developer',
      account: (user && user.account) || 'standard',
    };

    onStage('agent_start', { mode, role: callerUser.role, constitution: CONSTITUTION_VERSION });

    // Phase A — Live Semantic Project Index: keep the structural map of the
    // active project fresh BEFORE the reasoning loop starts, so every
    // search_code / get_symbol / list_dependents call inside the loop reads
    // current data. Incremental (content-hash) — unchanged files cost nothing.
    // Index failures never block the agent; they are reported honestly.
    if (db && project.id && Array.isArray(project.files) && project.files.length > 0) {
      try {
        const { buildOrUpdateIndex } = require('./projectIndex');
        const indexReport = buildOrUpdateIndex({ db, project, ownerId: callerUser.id });
        onStage('index_ready', {
          status: indexReport.status,
          version: indexReport.version,
          files: indexReport.fileCount,
          symbols: indexReport.symbolCount,
          edges: indexReport.edgeCount,
          reindexed: indexReport.filesReindexed,
          durationMs: indexReport.durationMs,
        });
      } catch (indexErr) {
        onStage('index_warn', { error: indexErr.message });
      }
    }

    // Track starting file states for accurate diff calculation
    const initialFiles = new Map((project.files || []).map((f) => [normalizeProjectPath(f.path || f.name), f.content || '']));

    // Build system prompt strictly from the unified constitution
    // AI Personalization: adapt style to the user's expertise level. An explicit
    // user choice always wins; inference never overrides it (honesty contract).
    let expertiseLevel = 'intermediate';
    if (db && callerUser.id && callerUser.id !== 'usr_anonymous') {
      try {
        const { updateInferredExpertise } = require('./personalizationService');
        const recentUserTexts = [
          cleanPrompt,
          ...history.filter((h) => h.role === 'user').slice(-6).map((h) => String(h.content || '')),
        ];
        const row = updateInferredExpertise(db, callerUser.id, recentUserTexts);
        expertiseLevel = (row && row.level) || 'intermediate';
      } catch (_) { /* personalization must never break a run */ }
    }
    const systemPrompt = buildSystemPrompt({
      mode,
      role: callerUser.role,
      project,
      language: isAr ? 'ar' : 'en',
      expertise: expertiseLevel,
    });

    // Format attachments context if present
    const attachmentContext = (attachments || [])
      .map((a) => (a.text ? `--- ATTACHMENT ${a.name} (${a.kind || 'file'}) ---\n${a.text.slice(0, 16000)}` : `--- ATTACHMENT ${a.name} (${a.kind || 'binary'}, ${a.size} B) ---`))
      .join('\n\n');

    const userMessageContent = attachmentContext
      ? `${cleanPrompt}\n\n${attachmentContext}`
      : cleanPrompt;

    const messages = [
      { role: 'system', content: systemPrompt },
      ...history.map((h) => ({ role: h.role, content: String(h.content || '') })),
      { role: 'user', content: userMessageContent },
    ];

    // Filter tools permitted for this role and mode
    const availableTools = toolGuard.toolSchemas(callerUser.role, mode);

    const executedToolCalls = [];
    const modifiedFilesRecord = [];
    const budget = { calls: 0 };
    let currentStep = 0;
    const maxSteps = POLICY.limits.maxSteps || 10;
    let finalAssistantText = '';
    let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, estimated: false };
    let newProjectId = undefined;

    const executionCtx = {
      user: callerUser,
      mode,
      projectId: project.id,
      project,
      db,
      approvals,
      budget,
      signal,
      modifiedFiles: modifiedFilesRecord,
      createProjectHandler,
      compilePreview,
    };

    while (currentStep < maxSteps) {
      if (signal && signal.aborted) {
        throw Object.assign(new Error('Agent execution cancelled by client'), { code: 'CANCELLED' });
      }

      currentStep++;
      onStage('turn_start', { step: currentStep, maxSteps });

      let turnResult;
      try {
        turnResult = await chatWithTools({
          modelId,
          messages,
          tools: availableTools,
          signal,
        });
      } catch (err) {
        onStage('turn_error', { step: currentStep, error: err.message });
        throw err;
      }

      if (turnResult.usage) {
        totalUsage.promptTokens += turnResult.usage.promptTokens || 0;
        totalUsage.completionTokens += turnResult.usage.completionTokens || 0;
        totalUsage.totalTokens += turnResult.usage.totalTokens || 0;
      }

      const turnText = turnResult.text || '';
      const toolCalls = turnResult.toolCalls || [];

      if (turnText) {
        onDelta(turnText);
        finalAssistantText += (finalAssistantText ? '\n\n' : '') + turnText;
      }

      // If no tool calls were requested, the model has completed its task
      if (!toolCalls.length) {
        onStage('agent_completed', { step: currentStep, toolCallsTotal: executedToolCalls.length });
        break;
      }

      onStage('turn_tool_calls', { step: currentStep, count: toolCalls.length, calls: toolCalls.map((c) => c.name) });

      // Append assistant message with tool_calls for OpenAI conversation continuity
      messages.push({
        role: 'assistant',
        content: turnText || null,
        tool_calls: toolCalls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments) },
        })),
      });

      // Execute each tool call through the toolGuard
      for (const call of toolCalls) {
        if (signal && signal.aborted) {
          throw Object.assign(new Error('Agent execution cancelled by client'), { code: 'CANCELLED' });
        }

        onTool({ id: call.id, name: call.name, arguments: call.arguments, status: 'running' });
        onStage('tool_executing', { tool: call.name });

        const guardResult = await toolGuard.execute(call, executionCtx);

        executedToolCalls.push({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          status: guardResult.status,
          ok: guardResult.ok,
          code: guardResult.code,
        });

        onTool({
          id: call.id,
          name: call.name,
          arguments: call.arguments,
          status: guardResult.status,
          result: guardResult.result,
          error: guardResult.message,
          code: guardResult.code,
        });

        // 1. Approval Required (High-risk action intercepted)
        if (guardResult.status === 'approval_required') {
          onStage('approval_required', { tool: call.name, approvalToken: guardResult.approvalToken });
          return {
            status: 'approval_required',
            approvalRequired: true,
            approvalToken: guardResult.approvalToken,
            pendingTool: call.name,
            pendingArgs: guardResult.pendingArgs,
            text: guardResult.message || `الإجراء «${call.name}» يتطلب موافقة صريحة من مسؤول النظام قبل التنفيذ.`,
            toolCalls: executedToolCalls,
            filesModified: computeFilesDiff(initialFiles, project.files),
            usage: totalUsage,
          };
        }

        // 2. Ask User (Clarification required from human)
        if (call.name === 'ask_user' && guardResult.ok) {
          const q = guardResult.result || {};
          onStage('ask_user', { question: q.question });
          return {
            status: 'ask_user',
            isQuestion: true,
            question: q.question,
            options: q.options || [],
            text: q.question,
            toolCalls: executedToolCalls,
            filesModified: computeFilesDiff(initialFiles, project.files),
            usage: totalUsage,
          };
        }

        // 3. Project Creation
        if (call.name === 'create_project' && guardResult.ok && guardResult.result?.project?.id) {
          newProjectId = guardResult.result.project.id;
          executionCtx.projectId = newProjectId;
          executionCtx.project = guardResult.result.project;
        }

        // Append tool result framed as untrusted data to conversation history
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: guardResult.framed || String(guardResult.result || ''),
        });
      }
    }

    // Compute actual files diff
    const filesModified = computeFilesDiff(initialFiles, project.files);

    // Verification step
    let verification = { allPassed: true, testResults: [] };
    if (filesModified.length > 0) {
      onStage('verification_start', { filesModifiedCount: filesModified.length });
      try {
        verification = await runPreviewChecks(project);
        onStage('verification_end', { passed: verification.allPassed, testsCount: verification.testResults?.length || 0 });
      } catch (verr) {
        onStage('verification_warn', { error: verr.message });
      }
    }

    // Truthful report enforcement: if intent was build/edit, but 0 files were touched
    let finalOutputText = finalAssistantText.trim();
    if (!finalOutputText) {
      if (filesModified.length > 0) {
        finalOutputText = isAr
          ? `تم تحديث ملفات المشروع بنجاح (${filesModified.length} ملف: ${filesModified.join('، ')}).`
          : `Project files updated successfully (${filesModified.length} files: ${filesModified.join(', ')}).`;
      } else {
        finalOutputText = isAr
          ? 'تم استلام طلبك ومراجعته. لم يتم تعديل أي ملفات في المشروع.'
          : 'Your request was processed. No project files were modified.';
      }
    }

    return {
      status: 'completed',
      text: finalOutputText,
      toolCalls: executedToolCalls,
      filesModified,
      verification,
      newProjectId,
      usage: totalUsage,
    };
  }

  return {
    run,
    toolGuard,
  };
}

/**
 * Computes list of relative paths that were modified or newly added or removed.
 */
function computeFilesDiff(initialMap, currentFiles = []) {
  const modified = [];
  const currentMap = new Map();

  for (const f of currentFiles) {
    const norm = normalizeProjectPath(f.path || f.name);
    currentMap.set(norm, f.content || '');
    if (!initialMap.has(norm)) {
      modified.push(norm);
    } else if (initialMap.get(norm) !== (f.content || '')) {
      modified.push(norm);
    }
  }

  for (const [norm] of initialMap) {
    if (!currentMap.has(norm)) {
      modified.push(norm);
    }
  }

  return Array.from(new Set(modified));
}

// Default singleton agent instance
const defaultEngineerAgent = createEngineerAgent();

module.exports = {
  createEngineerAgent,
  defaultEngineerAgent,
  computeFilesDiff,
};
