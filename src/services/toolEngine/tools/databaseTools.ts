// ==============================================================================
// ENGINEER — DATABASE ENGINEERING SUITE (Core Tool 4)
// Schema Design, Safe Migrations, Query Execution & Automated Backup Rollbacks
// ==============================================================================

import {
  designTableSchema,
  executeSafeMigration,
  generateMigration,
  rollbackToDbBackup,
} from '../../engineering/databaseArchitect';
import {
  ToolExecutionContext,
  UniversalToolDefinition,
  universalToolRegistry,
} from '../universalToolRegistry';

export const databaseInspectTool: UniversalToolDefinition = {
  id: 'database.inspect',
  version: '1.0.0',
  name: 'Inspect Database Tables',
  category: 'database',
  description: 'Inspects all relational tables, schema columns, indexes, and row counts in the project database.',
  inputSchema: {
    type: 'object',
    properties: {
      tableName: { type: 'string', description: 'Optional table name to filter' },
    },
  },
  riskLevel: 'safe',
  requiredPermission: 'read',
  timeoutMs: 5000,
  enabled: true,
  handler: async (params: { tableName?: string }, context: ToolExecutionContext) => {
    const tables = context.project?.dbTables || [];
    let filtered = tables;
    if (params.tableName) {
      filtered = tables.filter((t: any) => t.name === params.tableName?.toLowerCase());
    }

    const summary = filtered.map((t: any) => ({
      id: t.id,
      name: t.name,
      columnsCount: t.columns ? t.columns.length : 0,
      columns: t.columns,
      rowsCount: t.rows ? t.rows.length : 0,
      indexes: t.indexes || [],
      rlsEnabled: Boolean(t.rlsEnabled),
    }));

    return { totalTables: summary.length, tables: summary };
  },
};

export const databaseSchemaTool: UniversalToolDefinition = {
  id: 'database.schema',
  version: '1.0.0',
  name: 'Design Database Table Schema',
  category: 'database',
  description: 'Designs and defines a new database table schema with typed columns and indexes.',
  inputSchema: {
    type: 'object',
    properties: {
      entityName: { type: 'string', description: 'Table name (e.g. products, users, orders)' },
      fields: {
        type: 'array',
        description: 'Array of field definitions with name and type',
      },
    },
    required: ['entityName', 'fields'],
  },
  riskLevel: 'medium',
  requiredPermission: 'write',
  timeoutMs: 5000,
  enabled: true,
  handler: async (
    params: {
      entityName: string;
      fields: {
        name: string;
        type: 'UUID' | 'TEXT' | 'INTEGER' | 'BOOLEAN' | 'TIMESTAMP' | 'JSONB';
        primaryKey?: boolean;
        nullable?: boolean;
        indexed?: boolean;
        references?: string;
      }[];
    },
    context: ToolExecutionContext
  ) => {
    if (!context.project.dbTables) context.project.dbTables = [];
    const table = designTableSchema(params);

    // Check if table with same name exists
    const existingIdx = context.project.dbTables.findIndex(
      (t: any) => t.name === table.name
    );
    if (existingIdx !== -1) {
      context.project.dbTables[existingIdx] = table;
    } else {
      context.project.dbTables.push(table);
    }

    context.project.updatedAt = new Date().toISOString();
    return {
      success: true,
      tableName: table.name,
      columnsCount: table.columns.length,
      indexesCount: table.indexes?.length || 0,
      table,
    };
  },
};

export const databaseMigrateTool: UniversalToolDefinition = {
  id: 'database.migrate',
  version: '1.0.0',
  name: 'Execute Database Migration',
  category: 'database',
  description: 'Generates and runs an SQL migration with automated pre-backup and dangerous drop protection.',
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Migration title' },
      upSql: { type: 'string', description: 'SQL commands to execute (UP)' },
      downSql: { type: 'string', description: 'Rollback SQL commands (DOWN)' },
      humanApproved: { type: 'boolean', description: 'Explicit human approval for dangerous operations' },
    },
    required: ['name', 'upSql'],
  },
  riskLevel: 'high',
  requiredPermission: 'write',
  timeoutMs: 15000,
  enabled: true,
  handler: async (
    params: { name: string; upSql: string; downSql?: string; humanApproved?: boolean },
    context: ToolExecutionContext
  ) => {
    if (!context.project.dbTables) context.project.dbTables = [];
    if (!context.project.dbBackups) context.project.dbBackups = [];

    const migration = generateMigration(
      params.name,
      params.upSql,
      params.downSql || '',
      context.project.dbTables
    );

    const result = executeSafeMigration(
      migration,
      context.project,
      params.humanApproved || false
    );

    if (!result.success) {
      throw new Error(result.error);
    }

    return {
      success: true,
      migrationId: migration.id,
      backupSnapshotId: result.backupSnapshotId,
      appliedSql: result.appliedSql,
    };
  },
};

export const databaseRollbackTool: UniversalToolDefinition = {
  id: 'database.rollback',
  version: '1.0.0',
  name: 'Rollback Database to Backup',
  category: 'database',
  description: 'Atomically restores project database tables to a specified pre-migration backup snapshot.',
  inputSchema: {
    type: 'object',
    properties: {
      backupSnapshotId: { type: 'string', description: 'ID of the pre-migration backup snapshot' },
    },
    required: ['backupSnapshotId'],
  },
  riskLevel: 'high',
  requiredPermission: 'admin',
  timeoutMs: 10000,
  enabled: true,
  handler: async (params: { backupSnapshotId: string }, context: ToolExecutionContext) => {
    const success = rollbackToDbBackup(context.project, params.backupSnapshotId);
    if (!success) {
      throw new Error(`Database backup snapshot '${params.backupSnapshotId}' not found.`);
    }

    return {
      success: true,
      backupSnapshotId: params.backupSnapshotId,
      restoredTablesCount: context.project.dbTables.length,
    };
  },
};

export function registerDatabaseTools(): void {
  universalToolRegistry.registerTool(databaseInspectTool);
  universalToolRegistry.registerTool(databaseSchemaTool);
  universalToolRegistry.registerTool(databaseMigrateTool);
  universalToolRegistry.registerTool(databaseRollbackTool);
}
