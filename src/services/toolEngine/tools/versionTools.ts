// ==============================================================================
// ENGINEER — VERSION CONTROL & ROLLBACK SNAPSHOT SUITE (Core Tool 6)
// Atomic Multi-File Checkpoints, SHA-256 Hashes & 1-Click Rollback Restores
// ==============================================================================

import {
  createRollbackSnapshot,
  restoreRollbackSnapshot,
} from '../../engineering/safeModificationEngine';
import {
  ToolExecutionContext,
  UniversalToolDefinition,
  universalToolRegistry,
} from '../universalToolRegistry';

export const versionCreateSnapshotTool: UniversalToolDefinition = {
  id: 'versions.create_snapshot',
  version: '1.0.0',
  name: 'Create Rollback Snapshot',
  category: 'versions',
  description: 'Creates an atomic SHA-256 snapshot of all project files for safe checkpoints.',
  inputSchema: {
    type: 'object',
    properties: {
      label: { type: 'string', description: 'Descriptive checkpoint label' },
    },
    required: ['label'],
  },
  riskLevel: 'safe',
  requiredPermission: 'write',
  timeoutMs: 5000,
  enabled: true,
  handler: async (params: { label: string }, context: ToolExecutionContext) => {
    const snapshot = createRollbackSnapshot(context.project, params.label);
    return {
      snapshotId: snapshot.id,
      label: snapshot.label,
      createdAt: snapshot.createdAt,
      totalFiles: snapshot.files.length,
    };
  },
};

export const versionRestoreSnapshotTool: UniversalToolDefinition = {
  id: 'versions.restore_snapshot',
  version: '1.0.0',
  name: 'Restore Rollback Snapshot (1-Click Restore)',
  category: 'versions',
  description: 'Atomically restores project files to a previous snapshot checkpoint.',
  inputSchema: {
    type: 'object',
    properties: {
      snapshotId: { type: 'string', description: 'Snapshot ID to restore' },
    },
    required: ['snapshotId'],
  },
  riskLevel: 'medium',
  requiredPermission: 'write',
  timeoutMs: 5000,
  enabled: true,
  handler: async (params: { snapshotId: string }, context: ToolExecutionContext) => {
    const result = restoreRollbackSnapshot(context.project, params.snapshotId);
    if (!result.success) {
      throw new Error(result.message);
    }
    context.project.updatedAt = new Date().toISOString();
    return {
      success: true,
      restoredFilesCount: result.restoredFilesCount,
      message: result.message,
    };
  },
};

export function registerVersionTools(): void {
  universalToolRegistry.registerTool(versionCreateSnapshotTool);
  universalToolRegistry.registerTool(versionRestoreSnapshotTool);
}
