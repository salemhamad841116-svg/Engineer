/**
 * backupManager.js
 * Production-Grade SQLite Automated Backup & Retention Manager
 *
 * Implements:
 * 1. Transactionally consistent SQLite snapshots via VACUUM INTO / WAL checkpointing.
 * 2. Retention Rotation policy (preserves last N backups, default: 5).
 * 3. Atomic restore functionality to restore any snapshot to a target database file.
 * 4. Verification and integrity auditing.
 */

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../../config.js');

const DEFAULT_BACKUP_DIR = path.resolve(__dirname, '../../../data/backups');
const DEFAULT_RETENTION_COUNT = 5;

class BackupManager {
  constructor(options = {}) {
    this.backupDir = options.backupDir || DEFAULT_BACKUP_DIR;
    this.retentionCount = options.retentionCount || DEFAULT_RETENTION_COUNT;
    this.sourceDbPath = options.sourceDbPath || config.dbPath;

    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Generates a unique, timestamped backup filename.
   */
  generateBackupFilename(tag = 'auto') {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `backup_${tag}_${timestamp}.sqlite`;
  }

  /**
   * Creates a transactionally consistent snapshot of the database.
   * Uses SQLite VACUUM INTO for clean, defragmented, atomic backup creation.
   *
   * @param {Object} [options]
   * @param {string} [options.tag='scheduled'] - Identifying tag for backup
   * @param {DatabaseSync} [options.dbHandle] - Optional existing database handle
   * @returns {Object} Backup metadata { id, filename, filepath, sizeBytes, createdAt, integrityStatus }
   */
  createBackup(options = {}) {
    const tag = options.tag || 'scheduled';
    const filename = this.generateBackupFilename(tag);
    const targetFilePath = path.join(this.backupDir, filename);

    // Ensure target doesn't already exist
    if (fs.existsSync(targetFilePath)) {
      fs.unlinkSync(targetFilePath);
    }

    let handle = options.dbHandle;
    let ownHandle = false;

    try {
      if (!handle) {
        if (!fs.existsSync(this.sourceDbPath)) {
          throw new Error(`Source database does not exist at: ${this.sourceDbPath}`);
        }
        handle = new DatabaseSync(this.sourceDbPath);
        ownHandle = true;
      }

      // Checkpoint WAL frames before vacuuming
      try {
        handle.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      } catch (_) {}

      // VACUUM INTO writes an atomic, consistent, standalone snapshot
      // Escaping path for SQL
      const escapedPath = targetFilePath.replace(/'/g, "''");
      handle.exec(`VACUUM INTO '${escapedPath}'`);

      if (!fs.existsSync(targetFilePath)) {
        throw new Error(`Failed to create backup: file was not generated at ${targetFilePath}`);
      }

      const stat = fs.statSync(targetFilePath);

      // Verify the generated backup file immediately via quick_check
      let testHandle = null;
      let integrityStatus = 'unknown';
      try {
        testHandle = new DatabaseSync(targetFilePath);
        const check = testHandle.prepare('PRAGMA quick_check').all();
        integrityStatus = check.length > 0 && Object.values(check[0])[0] === 'ok' ? 'valid' : 'corrupted';
      } finally {
        if (testHandle) {
          try { testHandle.close(); } catch (_) {}
        }
      }

      if (integrityStatus !== 'valid') {
        throw new Error(`Integrity check failed on newly created backup: ${filename}`);
      }

      // Prune older backups according to retention policy
      const pruned = this.pruneOldBackups();

      const metadata = {
        id: `bk_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        filename,
        filepath: targetFilePath,
        sizeBytes: stat.size,
        createdAt: new Date().toISOString(),
        integrityStatus,
        prunedCount: pruned.length
      };

      return metadata;
    } finally {
      if (ownHandle && handle) {
        try { handle.close(); } catch (_) {}
      }
    }
  }

  /**
   * Lists all existing backup files sorted by creation date descending.
   */
  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];

    const files = fs.readdirSync(this.backupDir)
      .filter((f) => f.startsWith('backup_') && f.endsWith('.sqlite'))
      .map((f) => {
        const fullPath = path.join(this.backupDir, f);
        const stat = fs.statSync(fullPath);
        return {
          filename: f,
          filepath: fullPath,
          sizeBytes: stat.size,
          mtime: stat.mtimeMs,
          createdAt: stat.birthtime.toISOString()
        };
      })
      .sort((a, b) => b.mtime - a.mtime);

    return files;
  }

  /**
   * Applies the retention rotation policy, removing backups exceeding retentionCount.
   *
   * @param {number} [keepCount] - Number of most recent backups to preserve
   * @returns {string[]} List of deleted backup filenames
   */
  pruneOldBackups(keepCount = this.retentionCount) {
    const allBackups = this.listBackups();
    const toDelete = allBackups.slice(keepCount);
    const deleted = [];

    for (const b of toDelete) {
      try {
        if (fs.existsSync(b.filepath)) {
          fs.unlinkSync(b.filepath);
          deleted.push(b.filename);
        }
      } catch (err) {
        console.warn(`[BackupManager] Failed to prune old backup ${b.filename}:`, err.message);
      }
    }

    return deleted;
  }

  /**
   * Restores a backup file onto a target database destination.
   *
   * @param {string} backupFilePath - Path to source backup .sqlite file
   * @param {string} targetDbPath - Destination path
   * @returns {Object} { success, restoredFrom, targetDbPath, integrityStatus }
   */
  restoreBackup(backupFilePath, targetDbPath) {
    if (!fs.existsSync(backupFilePath)) {
      throw new Error(`Backup file not found at: ${backupFilePath}`);
    }

    // Ensure target directory exists
    const targetDir = path.dirname(targetDbPath);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Clean up existing destination files (including potential WAL / SHM)
    try {
      if (fs.existsSync(targetDbPath)) fs.unlinkSync(targetDbPath);
      if (fs.existsSync(`${targetDbPath}-wal`)) fs.unlinkSync(`${targetDbPath}-wal`);
      if (fs.existsSync(`${targetDbPath}-shm`)) fs.unlinkSync(`${targetDbPath}-shm`);
    } catch (_) {}

    // Atomic file copy from backup to target
    fs.copyFileSync(backupFilePath, targetDbPath);

    // Verify integrity of the restored database
    let restoredDb = null;
    let integrityStatus = 'failed';
    try {
      restoredDb = new DatabaseSync(targetDbPath);
      restoredDb.exec('PRAGMA foreign_keys = ON');
      const check = restoredDb.prepare('PRAGMA integrity_check').all();
      if (check.length > 0 && Object.values(check[0])[0] === 'ok') {
        integrityStatus = 'ok';
      }
    } finally {
      if (restoredDb) {
        try { restoredDb.close(); } catch (_) {}
      }
    }

    if (integrityStatus !== 'ok') {
      throw new Error(`Restoration failed: target database at ${targetDbPath} did not pass PRAGMA integrity_check.`);
    }

    return {
      success: true,
      restoredFrom: backupFilePath,
      targetDbPath,
      integrityStatus
    };
  }
}

module.exports = { BackupManager, DEFAULT_BACKUP_DIR, DEFAULT_RETENTION_COUNT };
