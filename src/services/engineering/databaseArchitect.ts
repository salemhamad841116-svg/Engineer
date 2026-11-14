// ==============================================================================
// ENGINEER — ADVANCED DATABASE ARCHITECT & MIGRATION ENGINE (Phase 2)
// Schema Design, Foreign Keys, Risky Migration Guard & Automated Backup Rollback
// Requires explicit human approval before any destructive schema alterations.
// ==============================================================================

import crypto from 'node:crypto';
import { DbTable, Project } from '../../types/platform';

export interface DatabaseMigration {
  id: string;
  version: number;
  name: string;
  createdAt: string;
  upSql: string;
  downSql: string;
  isDangerous: boolean;
  dangerDetails?: {
    dropsTable?: string;
    dropsColumn?: string;
    affectsExistingData: boolean;
    reason: string;
  };
  executed: boolean;
  executedAt?: string;
  backupSnapshotId?: string;
}

export interface SchemaDesignRequest {
  entityName: string;
  fields: {
    name: string;
    type: 'UUID' | 'TEXT' | 'INTEGER' | 'BOOLEAN' | 'TIMESTAMP' | 'JSONB';
    primaryKey?: boolean;
    nullable?: boolean;
    indexed?: boolean;
    references?: string;
  }[];
}

// -----------------------------------------------------------------------------
// 1. Schema Generation & Relationship Design
// -----------------------------------------------------------------------------

export function designTableSchema(req: SchemaDesignRequest): DbTable {
  const tableId = `tbl_${req.entityName.toLowerCase()}_${Date.now()}`;
  const indexes: string[] = [];

  req.fields.forEach((f) => {
    if (f.indexed || f.references) {
      indexes.push(`idx_${req.entityName.toLowerCase()}_${f.name}`);
    }
  });

  return {
    id: tableId,
    name: req.entityName.toLowerCase(),
    columns: req.fields,
    rows: [],
    indexes,
    rlsEnabled: true,
    updatedAt: new Date().toISOString(),
  };
}

// -----------------------------------------------------------------------------
// 2. Migration Generation & Dangerous Operation Detection
// -----------------------------------------------------------------------------

export function generateMigration(
  name: string,
  upSql: string,
  downSql: string,
  existingTables: DbTable[] = []
): DatabaseMigration {
  const migrationId = `mig_${Date.now()}_${crypto.randomUUID().slice(0, 6)}`;
  const version = Date.now();

  const upLower = upSql.toLowerCase();

  // Dangerous Operation Analysis
  let isDangerous = false;
  let dangerReason = '';
  let dropsTable: string | undefined;
  let dropsColumn: string | undefined;

  // 1. Check for DROP TABLE
  const dropTableMatch = upLower.match(/drop\s+table\s+(?:if\s+exists\s+)?([a-zA-Z0-9_]+)/i);
  if (dropTableMatch) {
    isDangerous = true;
    dropsTable = dropTableMatch[1];
    dangerReason = `عملية خطيرة: حذف الجدول '${dropsTable}' سيؤدي لفقدان كافة البيانات المخزنة فيه نهائياً.`;
  }

  // 2. Check for DROP COLUMN
  const dropColMatch = upLower.match(/alter\s+table\s+[a-zA-Z0-9_]+\s+drop\s+column\s+([a-zA-Z0-9_]+)/i);
  if (dropColMatch) {
    isDangerous = true;
    dropsColumn = dropColMatch[1];
    dangerReason = `عملية خطيرة: حذف العمود '${dropsColumn}' سيؤدي لمسح قيم الحقل من كافة السجلات السابقة.`;
  }

  // 3. Check for TRUNCATE TABLE
  if (upLower.includes('truncate table')) {
    isDangerous = true;
    dangerReason = 'عملية خطيرة: أمر TRUNCATE TABLE سيقوم بإفراغ الجدول بالكامل.';
  }

  // Check if target table has existing data rows
  let affectsExistingData = false;
  if (dropsTable) {
    const existing = existingTables.find((t) => t.name === dropsTable);
    if (existing && existing.rows.length > 0) {
      affectsExistingData = true;
      dangerReason += ` الجدول يحتوي حالياً على ${existing.rows.length} سجل.`;
    }
  }

  return {
    id: migrationId,
    version,
    name,
    createdAt: new Date().toISOString(),
    upSql,
    downSql,
    isDangerous,
    dangerDetails: isDangerous
      ? {
          dropsTable,
          dropsColumn,
          affectsExistingData,
          reason: dangerReason,
        }
      : undefined,
    executed: false,
  };
}

// -----------------------------------------------------------------------------
// 3. Safe Migration Runner with Pre-Backup & Human Gate
// -----------------------------------------------------------------------------

export function executeSafeMigration(
  migration: DatabaseMigration,
  project: Project,
  humanApproved = false
): {
  success: boolean;
  backupSnapshotId?: string;
  error?: string;
  appliedSql?: string;
} {
  // Human Approval Gate: Dangerous migrations CANNOT execute without explicit approval
  if (migration.isDangerous && !humanApproved) {
    return {
      success: false,
      error: `بوابة الأمان: ترحيل قاعدة البيانات مصنف كـ [عملية خطيرة]: ${migration.dangerDetails?.reason}. يتطلب موافقة بشرية صريحة قبل التنفيذ لمنع فقدان البيانات.`,
    };
  }

  // Automated Pre-Migration Backup Snapshot
  const backupId = `db_backup_${Date.now()}`;
  project.dbBackups.push({
    id: backupId,
    label: `Pre-Migration Backup: ${migration.name}`,
    createdAt: new Date().toISOString(),
    sizeBytes: JSON.stringify(project.dbTables).length,
    tablesSnapshot: JSON.parse(JSON.stringify(project.dbTables)),
  });

  try {
    // If migration is dropping a table and approved
    if (migration.dangerDetails?.dropsTable) {
      project.dbTables = project.dbTables.filter(
        (t) => t.name !== migration.dangerDetails?.dropsTable
      );
    }

    migration.executed = true;
    migration.executedAt = new Date().toISOString();
    migration.backupSnapshotId = backupId;

    return {
      success: true,
      backupSnapshotId: backupId,
      appliedSql: migration.upSql,
    };
  } catch (err: unknown) {
    // Auto-rollback from pre-migration backup on error
    rollbackToDbBackup(project, backupId);
    return {
      success: false,
      error: `فشل تنفيذ الترحيل وتم التراجع التلقائي إلى النسخة الاحتياطية (${backupId}): ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export function rollbackToDbBackup(project: Project, backupId: string): boolean {
  const backup = project.dbBackups.find((b) => b.id === backupId);
  if (!backup) return false;

  project.dbTables = JSON.parse(JSON.stringify(backup.tablesSnapshot));
  project.updatedAt = new Date().toISOString();
  return true;
}
