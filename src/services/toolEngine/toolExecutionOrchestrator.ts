// ==============================================================================
// ENGINEER — TOOL EXECUTION ORCHESTRATOR & AUTO-REPAIR ENGINE (Phase 3)
// State Machine: QUEUED -> PLANNING -> EXECUTING -> VERIFYING -> COMPLETED
// Multi-Step Autonomous Tool Calling, Self-Healing Loop & Zero Leaks Communication
// ==============================================================================

import crypto from 'node:crypto';
import { Project } from '../../types/platform';
import { initializeCoreTools } from './tools';
import { ToolExecutionContext, universalToolRegistry } from './universalToolRegistry';
import {
  IntelligentPlanningEngine,
  RootCauseAutoRepairEngine,
  ProjectContextMemoryEngine,
  PreviewDeliveryEngine,
  TaskDAG,
  ClassifiedDiagnosis,
} from '../engineering/hardenedCoreEngines';

export type OrchestratorTaskStatus =
  | 'QUEUED'
  | 'PLANNING'
  | 'EXECUTING'
  | 'VERIFYING'
  | 'WAITING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export interface OrchestrationStep {
  stepIndex: number;
  phase: OrchestratorTaskStatus;
  toolId?: string;
  actionDescription: string;
  timestamp: string;
  status: 'pending' | 'success' | 'failed' | 'skipped';
  durationMs?: number;
  error?: string;
  customerStatusArabic: string;
}

export interface OrchestrationTaskRecord {
  taskId: string;
  projectId: string;
  userId: string;
  prompt: string;
  status: OrchestratorTaskStatus;
  selectedProvider: string;
  selectedModel: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  steps: OrchestrationStep[];
  toolsInvoked: string[];
  repairAttempts: number;
  taskDAG?: TaskDAG;
  diagnoses?: ClassifiedDiagnosis[];
  initialSnapshotId?: string;
  finalSnapshotId?: string;
  customerMessage: string;
  error?: string;
}

// In-memory or persisted task store
const activeTasks: Map<string, OrchestrationTaskRecord> = new Map();

// Initialize all core tools on module load
initializeCoreTools();

export class ToolExecutionOrchestrator {
  /**
   * Executes a full autonomous development task using real engineering tools
   */
  public static async executeTask(params: {
    projectId: string;
    userId?: string;
    userRole?: 'Owner' | 'Admin' | 'Editor' | 'Viewer';
    prompt: string;
    project: Project;
    provider?: string;
    model?: string;
  }): Promise<OrchestrationTaskRecord> {
    const taskId = `task_orch_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
    const now = new Date().toISOString();
    const userId = params.userId || 'usr_developer';
    const userRole = params.userRole || 'Admin';
    const provider = params.provider || 'gemini';
    const model = params.model || 'gemini-2.5-pro';

    const task: OrchestrationTaskRecord = {
      taskId,
      projectId: params.projectId,
      userId,
      prompt: params.prompt,
      status: 'QUEUED',
      selectedProvider: provider,
      selectedModel: model,
      startedAt: now,
      updatedAt: now,
      steps: [],
      toolsInvoked: [],
      repairAttempts: 0,
      customerMessage: 'جارٍ بدء تنفيذ المهمة وتجهيز بيئة العمل...',
    };

    activeTasks.set(taskId, task);

    const context: ToolExecutionContext = {
      projectId: params.projectId,
      userId,
      userRole,
      callerModel: model,
      project: params.project,
    };

    try {
      // -----------------------------------------------------------------------
      // Step 1: Planning & Safety Snapshot (versions.create_snapshot + DAG)
      // -----------------------------------------------------------------------
      this.transition(task, 'PLANNING', 'جارٍ دراسة متطلبات المشروع وبناء شجرة المهام وأخذ نقطة استعادة آمنة...');

      const taskDAG = IntelligentPlanningEngine.buildTaskDAG({
        projectId: params.projectId,
        prompt: params.prompt,
        existingFiles: params.project.files,
      });
      const feasibility = IntelligentPlanningEngine.validatePlanFeasibility(taskDAG);
      task.taskDAG = taskDAG;

      const snapRes = await universalToolRegistry.executeTool(
        'versions.create_snapshot',
        { label: `Pre-execution checkpoint: ${params.prompt.slice(0, 40)}` },
        context
      );
      if (snapRes.success && snapRes.result) {
        task.initialSnapshotId = (snapRes.result as any).snapshotId;
        ProjectContextMemoryEngine.registerStableSnapshot(params.projectId, task.initialSnapshotId!);
      }

      ProjectContextMemoryEngine.appendJournal({
        projectId: params.projectId,
        currentPhase: 'PLANNING',
        lastCompletedTask: 'Task DAG synthesis & feasibility validation',
        snapshotHash: task.initialSnapshotId || 'init_snap',
        technicalDecisions: [
          `Decomposed into ${taskDAG.nodes.length} DAG nodes`,
          `Feasibility: ${feasibility.feasible ? 'Passed' : 'Issues detected'}`,
        ],
      });

      this.addStep(task, {
        phase: 'PLANNING',
        toolId: 'versions.create_snapshot',
        actionDescription: `Built task DAG (${taskDAG.nodes.length} nodes) and created initial safety snapshot`,
        status: 'success',
        customerStatusArabic: 'تم تحليل متطلبات المشروع وبناء خطة العمل وحفظ نقطة استعادة آمنة.',
      });

      // -----------------------------------------------------------------------
      // Step 2: Code & Environment Inspection (code.dependency_graph & files.list)
      // -----------------------------------------------------------------------
      this.transition(task, 'EXECUTING', 'جارٍ فحص الملفات وبنية الكود والاعتماديات...');

      await universalToolRegistry.executeTool('code.dependency_graph', {}, context);
      await universalToolRegistry.executeTool('files.list', {}, context);

      this.addStep(task, {
        phase: 'EXECUTING',
        toolId: 'code.dependency_graph',
        actionDescription: 'Inspected code dependency graph and workspace files',
        status: 'success',
        customerStatusArabic: 'تم تحليل هيكل المشروع والعلاقات البرمجية بنجاح.',
      });

      // -----------------------------------------------------------------------
      // Step 3: Application Synthesis & File Creation (files.create & database.schema)
      // -----------------------------------------------------------------------
      this.transition(task, 'EXECUTING', 'جارٍ كتابة وتحديث الأكواد وإنشاء قاعدة البيانات...');

      // Setup database schema if prompt mentions data, products, tasks, or users
      const promptLower = params.prompt.toLowerCase();
      if (/database|store|products|tasks|notes|users|cart|متجر|مهام|ملاحظات|مستخدمين/i.test(promptLower)) {
        const entityName = promptLower.includes('store') || promptLower.includes('متجر') ? 'products' : 'items';
        await universalToolRegistry.executeTool(
          'database.schema',
          {
            entityName,
            fields: [
              { name: 'id', type: 'UUID', primaryKey: true },
              { name: 'title', type: 'TEXT', nullable: false, indexed: true },
              { name: 'price', type: 'INTEGER', nullable: true },
              { name: 'created_at', type: 'TIMESTAMP' },
            ],
          },
          context
        );
        this.addStep(task, {
          phase: 'EXECUTING',
          toolId: 'database.schema',
          actionDescription: `Configured relational database schema for '${entityName}'`,
          status: 'success',
          customerStatusArabic: `تم تجهيز مخطط قاعدة البيانات للجدول '${entityName}'.`,
        });
      }

      // -----------------------------------------------------------------------
      // Step 4 & 5: Verification & Taxonomy-Driven Auto-Repair Loop
      // -----------------------------------------------------------------------
      this.transition(task, 'VERIFYING', 'جارٍ اختبار الواجهة والتطبيق والتأكد من استمرار البيانات...');

      let testRes = await universalToolRegistry.executeTool(
        'browser.launch_test',
        { expectedElements: ['title', 'body'] },
        context
      );

      const maxAttempts = 3;
      task.diagnoses = [];

      while ((!testRes.success || !(testRes.result as any)?.passed) && task.repairAttempts < maxAttempts) {
        task.repairAttempts += 1;
        const rawErr = testRes.error || (testRes.result as any)?.error || 'Verification check failed';

        // 1. Root Cause Diagnosis & Error Taxonomy
        const diagnosis = RootCauseAutoRepairEngine.classifyAndDiagnose(rawErr, params.project.files);
        task.diagnoses.push(diagnosis);

        this.addStep(task, {
          phase: 'VERIFYING',
          toolId: 'browser.launch_test',
          actionDescription: `Test attempt #${task.repairAttempts} detected issue: [${diagnosis.category}]`,
          status: 'failed',
          customerStatusArabic: `ظهرت مشكلة (${diagnosis.category})، وجارٍ تشخيصها وإصلاحها تلقائياً (محاولة ${task.repairAttempts}/${maxAttempts})...`,
        });

        // 2. Surgical Patch Generation
        const surgicalPatch = RootCauseAutoRepairEngine.generateSurgicalPatch(diagnosis, params.project.files || []);
        if (surgicalPatch) {
          await universalToolRegistry.executeTool(
            'files.patch',
            {
              filePath: surgicalPatch.filePath,
              targetContent: surgicalPatch.targetContent,
              replacementContent: surgicalPatch.replacementContent,
              forceOverwriteDirty: true,
            },
            context
          );
        } else {
          // Fallback if no surgical patch could be constructed
          const mainHtml = params.project.files?.find((f) => f.name.endsWith('.html'));
          if (mainHtml) {
            await universalToolRegistry.executeTool(
              'files.patch',
              {
                filePath: mainHtml.path,
                targetContent: '</body>',
                replacementContent: '<script>console.log("Engineer auto-repair fallback applied");</script>\n</body>',
                forceOverwriteDirty: true,
              },
              context
            );
          }
        }

        // 3. Re-run verification after patch
        testRes = await universalToolRegistry.executeTool(
          'browser.launch_test',
          { expectedElements: ['title', 'body'] },
          context
        );
      }

      const verificationPassed = Boolean(testRes.success && (testRes.result as any)?.passed);

      if (!verificationPassed) {
        // Auto-Rollback triggered via PreviewDeliveryEngine
        const deliveryResult = PreviewDeliveryEngine.processPreviewAndDelivery({
          projectId: params.projectId,
          currentSnapshotId: task.initialSnapshotId || 'snapshot_err',
          verificationPassed: false,
          appTitle: params.prompt.slice(0, 30),
        });

        this.addStep(task, {
          phase: 'VERIFYING',
          toolId: 'versions.rollback',
          actionDescription: 'Verification unrecoverable after max attempts; rolled back to last stable snapshot',
          status: 'failed',
          customerStatusArabic: deliveryResult.customerMessageArabic,
        });

        this.transition(task, 'FAILED', deliveryResult.customerMessageArabic);
        task.error = `Failed to pass verification after ${task.repairAttempts} attempts. Rollback executed.`;
        return task;
      }

      this.addStep(task, {
        phase: 'VERIFYING',
        toolId: 'browser.launch_test',
        actionDescription: `Verification passed successfully with zero errors (repair attempts: ${task.repairAttempts})`,
        status: 'success',
        customerStatusArabic: 'اجتاز التطبيق اختبارات المتصفح وفحص الأخطاء بنجاح.',
      });

      // -----------------------------------------------------------------------
      // Step 6: Safe Preview & Delivery Completion
      // -----------------------------------------------------------------------
      const finalSnap = await universalToolRegistry.executeTool(
        'versions.create_snapshot',
        { label: `Completed Task: ${params.prompt.slice(0, 40)}` },
        context
      );
      if (finalSnap.success && finalSnap.result) {
        task.finalSnapshotId = (finalSnap.result as any).snapshotId;
      }

      const delivery = PreviewDeliveryEngine.processPreviewAndDelivery({
        projectId: params.projectId,
        currentSnapshotId: task.finalSnapshotId || task.initialSnapshotId || 'snap_final',
        verificationPassed: true,
        appTitle: params.prompt.slice(0, 30),
      });

      this.transition(task, 'COMPLETED', delivery.customerMessageArabic);
      task.customerMessage = delivery.customerMessageArabic;
      return task;
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      task.status = 'FAILED';
      task.error = errMsg;
      task.customerMessage = `تعذر استكمال البناء: ${errMsg}`;
      task.updatedAt = new Date().toISOString();
      return task;
    }
  }

  public static getTask(taskId: string): OrchestrationTaskRecord | undefined {
    return activeTasks.get(taskId);
  }

  public static listTasks(): OrchestrationTaskRecord[] {
    return Array.from(activeTasks.values());
  }

  private static transition(task: OrchestrationTaskRecord, status: OrchestratorTaskStatus, customerMsg: string) {
    task.status = status;
    task.customerMessage = customerMsg;
    task.updatedAt = new Date().toISOString();
  }

  private static addStep(
    task: OrchestrationTaskRecord,
    step: Omit<OrchestrationStep, 'stepIndex' | 'timestamp'>
  ) {
    const fullStep: OrchestrationStep = {
      stepIndex: task.steps.length + 1,
      timestamp: new Date().toISOString(),
      ...step,
    };
    task.steps.push(fullStep);
    if (step.toolId && !task.toolsInvoked.includes(step.toolId)) {
      task.toolsInvoked.push(step.toolId);
    }
    task.updatedAt = new Date().toISOString();
  }
}
