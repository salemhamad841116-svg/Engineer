// ==============================================================================
// ENGINEER — SAFE CODE MODIFICATION ENGINE (Phase 2)
// Surgical Diffs, Conflict Detection, Unsaved Work Guard, and 1-Click Rollback Points
// ==============================================================================

import crypto from 'node:crypto';
import { Project, ProjectFile } from '../../types/platform';
import { ImpactAnalysisResult } from './codeIntelligenceEngine';

export interface PlannedFileDiff {
  filePath: string;
  originalContent: string;
  modifiedContent: string;
  linesAdded: number;
  linesRemoved: number;
  unifiedDiff: string;
}

export interface ModificationPlan {
  id: string;
  prompt: string;
  createdAt: string;
  impact: ImpactAnalysisResult;
  diffs: PlannedFileDiff[];
  hasUnsavedConflicts: boolean;
  conflictingFiles: string[];
  requiresUserApproval: boolean;
  approvalReason?: string;
}

export interface RollbackSnapshot {
  id: string;
  projectId: string;
  createdAt: string;
  label: string;
  fileHashes: Record<string, string>;
  files: { path: string; content: string }[];
}

// In-memory or state-persisted rollback history
const rollbackSnapshots: Map<string, RollbackSnapshot> = new Map();

// -----------------------------------------------------------------------------
// 1. Rollback Snapshot Manager
// -----------------------------------------------------------------------------

export function createRollbackSnapshot(project: Project, label = 'Pre-Modification Checkpoint'): RollbackSnapshot {
  const snapshotId = `snap_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const fileHashes: Record<string, string> = {};
  const files: { path: string; content: string }[] = [];

  for (const f of project.files) {
    const hash = crypto.createHash('sha256').update(f.content).digest('hex');
    fileHashes[f.path] = hash;
    files.push({ path: f.path, content: f.content });
  }

  const snapshot: RollbackSnapshot = {
    id: snapshotId,
    projectId: project.id,
    createdAt: new Date().toISOString(),
    label,
    fileHashes,
    files,
  };

  rollbackSnapshots.set(snapshotId, snapshot);
  return snapshot;
}

export function restoreRollbackSnapshot(project: Project, snapshotId: string): { success: boolean; restoredFilesCount: number; message: string } {
  const snapshot = rollbackSnapshots.get(snapshotId);
  if (!snapshot) {
    return { success: false, restoredFilesCount: 0, message: 'Rollback snapshot not found.' };
  }

  const snapshotMap = new Map(snapshot.files.map((f) => [f.path, f.content]));
  let restored = 0;

  for (const file of project.files) {
    if (snapshotMap.has(file.path)) {
      const prev = snapshotMap.get(file.path)!;
      if (file.content !== prev) {
        file.previousContent = file.content;
        file.content = prev;
        file.size = prev.length;
        file.updatedAt = new Date().toISOString();
        file.isDirty = false;
        restored += 1;
      }
    }
  }

  return {
    success: true,
    restoredFilesCount: restored,
    message: `Successfully rolled back project to checkpoint: ${snapshot.label} (${restored} files restored).`,
  };
}

// -----------------------------------------------------------------------------
// 2. Modification Planning & Conflict Detection
// -----------------------------------------------------------------------------

export function createModificationPlan(
  prompt: string,
  project: Project,
  impact: ImpactAnalysisResult,
  proposedChanges: Record<string, string>
): ModificationPlan {
  const planId = `plan_mod_${Date.now()}`;
  const diffs: PlannedFileDiff[] = [];
  const conflictingFiles: string[] = [];

  for (const [filePath, newContent] of Object.entries(proposedChanges)) {
    const cleanPath = filePath.replace(/^\/+/, '');
    const currentFile = project.files.find((f) => f.path.replace(/^\/+/, '') === cleanPath || f.name === cleanPath);

    if (currentFile) {
      // Guard: Detect if user has unsaved edits in IDE
      if (currentFile.isDirty) {
        conflictingFiles.push(cleanPath);
      }

      const diff = generateUnifiedDiff(cleanPath, currentFile.content, newContent);
      diffs.push(diff);
    } else {
      // New file
      diffs.push({
        filePath: cleanPath,
        originalContent: '',
        modifiedContent: newContent,
        linesAdded: newContent.split('\n').length,
        linesRemoved: 0,
        unifiedDiff: `--- /dev/null\n+++ b/${cleanPath}\n@@ -0,0 +1,${newContent.split('\n').length} @@\n+${newContent.split('\n').join('\n+')}`,
      });
    }
  }

  const hasUnsavedConflicts = conflictingFiles.length > 0;
  const requiresUserApproval = hasUnsavedConflicts || impact.breakingChangesRisk === 'high';
  let approvalReason: string | undefined;

  if (hasUnsavedConflicts) {
    approvalReason = `تنبيه أمان: يوجد تعديلات غير محفوظة من المستخدم في الملفات (${conflictingFiles.join(', ')}). يجب حفظ التعديلات أو الموافقة على استبدالها.`;
  } else if (impact.breakingChangesRisk === 'high') {
    approvalReason = `تنبيه أمان: التعديل المطلوب عالي الخطورة (${impact.riskExplanation}). يتطلب مراجعة التغييرات قبل التطبيق.`;
  }

  return {
    id: planId,
    prompt,
    createdAt: new Date().toISOString(),
    impact,
    diffs,
    hasUnsavedConflicts,
    conflictingFiles,
    requiresUserApproval,
    approvalReason,
  };
}

// -----------------------------------------------------------------------------
// 3. Surgical Modification Application
// -----------------------------------------------------------------------------

export function applyModificationPlan(
  plan: ModificationPlan,
  project: Project,
  forceOverwriteDirty = false
): { success: boolean; modifiedPaths: string[]; error?: string; rollbackSnapshotId?: string } {
  if (plan.hasUnsavedConflicts && !forceOverwriteDirty) {
    return {
      success: false,
      modifiedPaths: [],
      error: `Conflict detected: Cannot overwrite unsaved files without explicit approval: ${plan.conflictingFiles.join(', ')}`,
    };
  }

  // Create automatic rollback snapshot before applying changes
  const snapshot = createRollbackSnapshot(project, `Auto-checkpoint before: ${plan.prompt.slice(0, 40)}`);
  const modifiedPaths: string[] = [];

  for (const diff of plan.diffs) {
    const existingFile = project.files.find((f) => f.path.replace(/^\/+/, '') === diff.filePath || f.name === diff.filePath);

    if (existingFile) {
      existingFile.previousContent = existingFile.content;
      existingFile.content = diff.modifiedContent;
      existingFile.size = diff.modifiedContent.length;
      existingFile.updatedAt = new Date().toISOString();
      existingFile.isDirty = false;
      modifiedPaths.push(existingFile.path);
    } else {
      const newFile: ProjectFile = {
        id: `file_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`,
        name: diff.filePath.split('/').pop() || diff.filePath,
        path: `/${diff.filePath}`,
        folder: 'root',
        content: diff.modifiedContent,
        language: diff.filePath.endsWith('.ts') || diff.filePath.endsWith('.tsx') ? 'typescript' : 'javascript',
        size: diff.modifiedContent.length,
        updatedAt: new Date().toISOString(),
        isDirty: false,
      };
      project.files.push(newFile);
      modifiedPaths.push(newFile.path);
    }
  }

  return {
    success: true,
    modifiedPaths,
    rollbackSnapshotId: snapshot.id,
  };
}

// -----------------------------------------------------------------------------
// Unified Diff Helper
// -----------------------------------------------------------------------------

function generateUnifiedDiff(filePath: string, oldText: string, newText: string): PlannedFileDiff {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  let linesAdded = 0;
  let linesRemoved = 0;
  const diffLines: string[] = [];

  diffLines.push(`--- a/${filePath}`);
  diffLines.push(`+++ b/${filePath}`);

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const o = oldLines[i];
    const n = newLines[i];

    if (o === undefined && n !== undefined) {
      linesAdded += 1;
      diffLines.push(`+ ${n}`);
    } else if (o !== undefined && n === undefined) {
      linesRemoved += 1;
      diffLines.push(`- ${o}`);
    } else if (o !== n) {
      linesRemoved += 1;
      linesAdded += 1;
      diffLines.push(`- ${o}`);
      diffLines.push(`+ ${n}`);
    }
  }

  return {
    filePath,
    originalContent: oldText,
    modifiedContent: newText,
    linesAdded,
    linesRemoved,
    unifiedDiff: diffLines.join('\n'),
  };
}
