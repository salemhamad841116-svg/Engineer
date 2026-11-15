/**
 * parallelWorkspaces.js
 * Capability 10: Parallel Development Workspaces (Smart Execution)
 *
 * Facilitates parallel feature development on isolated workspace branches / worktrees
 * backed by the workspace_branches table, with pre-merge conflict detection and atomic merges.
 */

const crypto = require('crypto');

class ParallelWorkspaces {
  constructor(db = null) {
    this.db = db;
    this.inMemoryBranches = new Map(); // branchId -> branchState
  }

  setDb(db) {
    this.db = db;
  }

  createBranch(projectId, branchName, baseBranch = 'main') {
    const branchId = 'br_' + projectId + '_' + branchName.replace(/[^a-zA-Z0-9_]/g, '_') + '_' + Date.now();
    const now = new Date().toISOString();

    const branchData = {
      id: branchId,
      projectId,
      branchName,
      baseBranch,
      status: 'active',
      headCommitHash: crypto.randomBytes(8).toString('hex'),
      worktreePath: `/tmp/worktrees/${projectId}/${branchName}`,
      diffSummary: {},
      files: {},
      createdAt: now,
      updatedAt: now
    };

    if (this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO workspace_branches (
          id, project_id, branch_name, base_branch, status, head_commit_hash,
          worktree_path, diff_summary, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, '{}', ?, ?)
      `);
      stmt.run(branchId, projectId, branchName, baseBranch, branchData.headCommitHash, branchData.worktreePath, now, now);
    }

    this.inMemoryBranches.set(branchId, branchData);
    return branchData;
  }

  commitToBranch(branchId, files = {}, commitMessage = '') {
    const branch = this.inMemoryBranches.get(branchId);
    if (!branch) throw new Error(`Branch ${branchId} not found`);

    branch.files = { ...branch.files, ...files };
    branch.headCommitHash = crypto.randomBytes(8).toString('hex');
    branch.updatedAt = new Date().toISOString();

    const diffSummary = {
      changedFiles: Object.keys(files),
      message: commitMessage,
      commitHash: branch.headCommitHash
    };
    branch.diffSummary = diffSummary;

    if (this.db) {
      this.db.prepare(`
        UPDATE workspace_branches
        SET head_commit_hash = ?, diff_summary = ?, updated_at = ?
        WHERE id = ?
      `).run(branch.headCommitHash, JSON.stringify(diffSummary), branch.updatedAt, branchId);
    }

    return {
      branchId,
      commitHash: branch.headCommitHash,
      fileCount: Object.keys(branch.files).length
    };
  }

  detectMergeConflicts(sourceBranchId, targetBranchId) {
    const source = this.inMemoryBranches.get(sourceBranchId);
    const target = this.inMemoryBranches.get(targetBranchId);

    if (!source || !target) {
      return { hasConflict: false, conflictingFiles: [] };
    }

    const conflictingFiles = [];
    const sourceFiles = Object.keys(source.files || {});
    const targetFiles = Object.keys(target.files || {});

    for (const sf of sourceFiles) {
      if (targetFiles.includes(sf)) {
        if (source.files[sf] !== target.files[sf]) {
          conflictingFiles.push(sf);
        }
      }
    }

    return {
      hasConflict: conflictingFiles.length > 0,
      conflictingFiles
    };
  }

  mergeBranch(sourceBranchId, targetBranchId) {
    const conflictCheck = this.detectMergeConflicts(sourceBranchId, targetBranchId);
    const source = this.inMemoryBranches.get(sourceBranchId);
    const target = this.inMemoryBranches.get(targetBranchId);

    if (conflictCheck.hasConflict) {
      if (this.db) {
        this.db.prepare("UPDATE workspace_branches SET status = 'conflict' WHERE id = ?").run(sourceBranchId);
      }
      return {
        success: false,
        status: 'conflict',
        conflicts: conflictCheck.conflictingFiles
      };
    }

    // Merge files safely
    if (source && target) {
      target.files = { ...target.files, ...source.files };
      source.status = 'merged';
    }

    if (this.db) {
      this.db.prepare("UPDATE workspace_branches SET status = 'merged', updated_at = datetime('now') WHERE id = ?").run(sourceBranchId);
    }

    return {
      success: true,
      status: 'merged',
      mergedFilesCount: Object.keys(source?.files || {}).length
    };
  }
}

module.exports = {
  ParallelWorkspaces
};
