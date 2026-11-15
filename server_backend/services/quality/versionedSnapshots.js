/**
 * versionedSnapshots.js
 * Capability 17: Versioned Builds & Rollback (Quality & Delivery)
 *
 * Maintains an archived timeline of verified project snapshots in the
 * project_build_versions table, facilitating single-click instant rollbacks
 * and autonomous rollbacks to the last-known-good build upon detecting defects.
 */

class VersionedSnapshots {
  constructor(db = null) {
    this.db = db;
    this.inMemoryVersions = new Map(); // projectId -> Array<versionRecord>
  }

  setDb(db) {
    this.db = db;
  }

  createSnapshot(projectId, files = {}, label = 'Build Snapshot', isHealthy = 1) {
    const list = this.inMemoryVersions.get(projectId) || [];
    const versionNumber = list.length + 1;
    const versionId = 'v_' + projectId + '_' + versionNumber + '_' + Date.now();
    const now = new Date().toISOString();

    const versionRecord = {
      id: versionId,
      projectId,
      versionNumber,
      snapshotLabel: label,
      snapshotFiles: files,
      isHealthy: isHealthy ? 1 : 0,
      rollbackAvailable: 1,
      createdAt: now
    };

    list.push(versionRecord);
    this.inMemoryVersions.set(projectId, list);

    if (this.db) {
      const stmt = this.db.prepare(`
        INSERT INTO project_build_versions (
          id, project_id, version_number, snapshot_label,
          snapshot_files_json, is_healthy, rollback_available, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `);
      stmt.run(
        versionId,
        projectId,
        versionNumber,
        label,
        JSON.stringify(files),
        isHealthy ? 1 : 0,
        now
      );
    }

    return versionRecord;
  }

  listVersions(projectId) {
    if (this.db) {
      const rows = this.db.prepare(`
        SELECT id, project_id, version_number, snapshot_label, is_healthy, rollback_available, created_at
        FROM project_build_versions
        WHERE project_id = ?
        ORDER BY version_number DESC
      `).all(projectId);
      if (rows && rows.length > 0) {
        return rows.map(r => ({
          id: r.id,
          projectId: r.project_id,
          versionNumber: r.version_number,
          snapshotLabel: r.snapshot_label,
          isHealthy: r.is_healthy,
          rollbackAvailable: r.rollback_available,
          createdAt: r.created_at
        }));
      }
    }
    return (this.inMemoryVersions.get(projectId) || []).slice().reverse();
  }

  rollbackToVersion(projectId, versionNumber) {
    let target = null;

    if (this.db) {
      const row = this.db.prepare(`
        SELECT * FROM project_build_versions
        WHERE project_id = ? AND version_number = ?
      `).get(projectId, versionNumber);
      if (row) {
        target = {
          id: row.id,
          projectId: row.project_id,
          versionNumber: row.version_number,
          snapshotLabel: row.snapshot_label,
          isHealthy: row.is_healthy,
          snapshotFiles: JSON.parse(row.snapshot_files_json || '{}')
        };
      }
    }

    if (!target) {
      const list = this.inMemoryVersions.get(projectId) || [];
      target = list.find(v => v.versionNumber === versionNumber);
    }

    if (!target) {
      throw new Error(`Version ${versionNumber} for project ${projectId} not found`);
    }

    return {
      success: true,
      restoredVersion: target.versionNumber,
      label: target.snapshotLabel,
      restoredFilesCount: Object.keys(target.snapshotFiles || {}).length,
      files: target.snapshotFiles,
      restoredAt: new Date().toISOString()
    };
  }

  autoRollbackOnDefect(projectId) {
    // Find latest version marked as healthy
    let healthy = null;

    if (this.db) {
      const row = this.db.prepare(`
        SELECT * FROM project_build_versions
        WHERE project_id = ? AND is_healthy = 1
        ORDER BY version_number DESC LIMIT 1
      `).get(projectId);
      if (row) {
        healthy = {
          id: row.id,
          projectId: row.project_id,
          versionNumber: row.version_number,
          snapshotLabel: row.snapshot_label,
          isHealthy: row.is_healthy,
          snapshotFiles: JSON.parse(row.snapshot_files_json || '{}')
        };
      }
    }

    if (!healthy) {
      const list = this.inMemoryVersions.get(projectId) || [];
      healthy = list.slice().reverse().find(v => v.isHealthy === 1);
    }

    if (!healthy) {
      return { success: false, reason: 'No prior healthy snapshot available for rollback' };
    }

    return {
      success: true,
      autoRollbackTriggered: true,
      targetVersion: healthy.versionNumber,
      label: healthy.snapshotLabel,
      files: healthy.snapshotFiles
    };
  }
}

module.exports = {
  VersionedSnapshots
};
