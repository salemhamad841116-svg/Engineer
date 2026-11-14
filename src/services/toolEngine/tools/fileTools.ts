// ==============================================================================
// ENGINEER — FILE OPERATIONS SUITE (Core Tool 1)
// Surgical Read, Create, Patch, Delete, Search & Diff with Tenant Isolation
// ==============================================================================

import path from 'node:path';
import { Project, ProjectFile } from '../../../types/platform';
import {
  ToolExecutionContext,
  UniversalToolDefinition,
  universalToolRegistry,
} from '../universalToolRegistry';

function sanitizePath(filePath: string): string {
  if (!filePath || filePath.includes('..') || path.isAbsolute(filePath)) {
    throw new Error(`Security Guard: Path traversal detected in '${filePath}'. Access denied.`);
  }
  const normalized = path.normalize(filePath);
  return normalized.replace(/\\/g, '/').replace(/^\/+/, '');
}

function getProjectFiles(project: Project): ProjectFile[] {
  if (!project || !Array.isArray(project.files)) {
    throw new Error('Project files not accessible in current context.');
  }
  return project.files;
}

// -----------------------------------------------------------------------------
// 1. files.list
// -----------------------------------------------------------------------------
export const filesListTool: UniversalToolDefinition = {
  id: 'files.list',
  version: '1.0.0',
  name: 'List Project Files',
  category: 'files',
  description: 'Lists all files and directories in the current project workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      directory: { type: 'string', description: 'Subdirectory path to filter (optional)' },
    },
  },
  riskLevel: 'safe',
  requiredPermission: 'read',
  timeoutMs: 5000,
  enabled: true,
  handler: async (params: { directory?: string }, context: ToolExecutionContext) => {
    const files = getProjectFiles(context.project);
    const filterDir = params.directory ? sanitizePath(params.directory) : '';

    const list = files
      .filter((f) => !filterDir || f.path.replace(/^\/+/, '').startsWith(filterDir))
      .map((f) => ({
        name: f.name,
        path: f.path.replace(/^\/+/, ''),
        size: f.size || (f.content ? f.content.length : 0),
        language: f.language,
        isDirty: Boolean(f.isDirty),
        updatedAt: f.updatedAt,
      }));

    return { total: list.length, files: list };
  },
};

// -----------------------------------------------------------------------------
// 2. files.read
// -----------------------------------------------------------------------------
export const filesReadTool: UniversalToolDefinition = {
  id: 'files.read',
  version: '1.0.0',
  name: 'Read File Content',
  category: 'files',
  description: 'Reads content from a project file, with optional line range slicing.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Relative path of the file to read' },
      startLine: { type: 'number', description: '1-indexed start line (optional)' },
      endLine: { type: 'number', description: '1-indexed end line (optional)' },
    },
    required: ['filePath'],
  },
  riskLevel: 'safe',
  requiredPermission: 'read',
  timeoutMs: 5000,
  enabled: true,
  handler: async (
    params: { filePath: string; startLine?: number; endLine?: number },
    context: ToolExecutionContext
  ) => {
    const cleanPath = sanitizePath(params.filePath);
    const files = getProjectFiles(context.project);
    const file = files.find((f) => f.path.replace(/^\/+/, '') === cleanPath || f.name === cleanPath);

    if (!file) {
      throw new Error(`File '${cleanPath}' not found in project '${context.projectId}'.`);
    }

    const lines = file.content.split('\n');
    let outputLines = lines;
    const start = params.startLine ? Math.max(1, params.startLine) : 1;
    const end = params.endLine ? Math.min(lines.length, params.endLine) : lines.length;

    if (params.startLine || params.endLine) {
      outputLines = lines.slice(start - 1, end);
    }

    return {
      filePath: cleanPath,
      totalLines: lines.length,
      startLine: start,
      endLine: end,
      content: outputLines.join('\n'),
    };
  },
};

// -----------------------------------------------------------------------------
// 3. files.create
// -----------------------------------------------------------------------------
export const filesCreateTool: UniversalToolDefinition = {
  id: 'files.create',
  version: '1.0.0',
  name: 'Create File',
  category: 'files',
  description: 'Creates a new file in the project with the specified content.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Relative path for the new file' },
      content: { type: 'string', description: 'Content of the new file' },
      overwrite: { type: 'boolean', description: 'Whether to overwrite if file exists' },
    },
    required: ['filePath', 'content'],
  },
  riskLevel: 'low',
  requiredPermission: 'write',
  timeoutMs: 5000,
  enabled: true,
  handler: async (
    params: { filePath: string; content: string; overwrite?: boolean },
    context: ToolExecutionContext
  ) => {
    const cleanPath = sanitizePath(params.filePath);
    const files = getProjectFiles(context.project);
    const existing = files.find((f) => f.path.replace(/^\/+/, '') === cleanPath || f.name === cleanPath);

    if (existing && !params.overwrite) {
      throw new Error(`File '${cleanPath}' already exists. Pass overwrite: true to overwrite.`);
    }

    const now = new Date().toISOString();
    const fileName = path.basename(cleanPath);
    const ext = path.extname(fileName).toLowerCase();

    let language: ProjectFile['language'] = 'javascript';
    if (ext === '.ts' || ext === '.tsx') language = 'typescript';
    else if (ext === '.css') language = 'css';
    else if (ext === '.html') language = 'html';
    else if (ext === '.json') language = 'json';
    else if (ext === '.md') language = 'markdown';
    else if (ext === '.sql') language = 'sql';

    if (existing) {
      existing.previousContent = existing.content;
      existing.content = params.content;
      existing.size = Buffer.byteLength(params.content, 'utf8');
      existing.updatedAt = now;
      existing.isDirty = false;
    } else {
      files.push({
        id: `file_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        name: fileName,
        path: `/${cleanPath}`,
        folder: path.dirname(cleanPath) || 'root',
        content: params.content,
        language,
        size: Buffer.byteLength(params.content, 'utf8'),
        updatedAt: now,
        isDirty: false,
      });
    }

    context.project.updatedAt = now;
    return {
      success: true,
      filePath: cleanPath,
      sizeBytes: Buffer.byteLength(params.content, 'utf8'),
      action: existing ? 'overwritten' : 'created',
    };
  },
};

// -----------------------------------------------------------------------------
// 4. files.patch
// -----------------------------------------------------------------------------
export const filesPatchTool: UniversalToolDefinition = {
  id: 'files.patch',
  version: '1.0.0',
  name: 'Patch File (Surgical Modification)',
  category: 'files',
  description: 'Applies surgical content modifications to an existing file with dirty-state guards.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Relative path of the file to patch' },
      targetContent: { type: 'string', description: 'Exact text segment to replace' },
      replacementContent: { type: 'string', description: 'New replacement text' },
      forceOverwriteDirty: { type: 'boolean', description: 'Overwrite even if user has unsaved edits' },
    },
    required: ['filePath', 'targetContent', 'replacementContent'],
  },
  riskLevel: 'medium',
  requiredPermission: 'write',
  timeoutMs: 5000,
  enabled: true,
  handler: async (
    params: { filePath: string; targetContent: string; replacementContent: string; forceOverwriteDirty?: boolean },
    context: ToolExecutionContext
  ) => {
    const cleanPath = sanitizePath(params.filePath);
    const files = getProjectFiles(context.project);
    const file = files.find((f) => f.path.replace(/^\/+/, '') === cleanPath || f.name === cleanPath);

    if (!file) {
      throw new Error(`File '${cleanPath}' not found to patch.`);
    }

    if (file.isDirty && !params.forceOverwriteDirty) {
      throw new Error(`Unsaved edits conflict: File '${cleanPath}' has unsaved user edits. Save in IDE or pass forceOverwriteDirty: true.`);
    }

    if (!file.content.includes(params.targetContent)) {
      throw new Error(`Target content not found in '${cleanPath}'. Patch rejected to prevent corrupting file.`);
    }

    file.previousContent = file.content;
    file.content = file.content.replace(params.targetContent, params.replacementContent);
    file.size = Buffer.byteLength(file.content, 'utf8');
    file.updatedAt = new Date().toISOString();
    file.isDirty = false;
    context.project.updatedAt = file.updatedAt;

    return {
      success: true,
      filePath: cleanPath,
      linesModified: params.replacementContent.split('\n').length,
    };
  },
};

// -----------------------------------------------------------------------------
// 5. files.delete
// -----------------------------------------------------------------------------
export const filesDeleteTool: UniversalToolDefinition = {
  id: 'files.delete',
  version: '1.0.0',
  name: 'Delete File',
  category: 'files',
  description: 'Deletes a file from the project workspace.',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Relative path of the file to delete' },
    },
    required: ['filePath'],
  },
  riskLevel: 'medium',
  requiredPermission: 'write',
  timeoutMs: 5000,
  enabled: true,
  handler: async (params: { filePath: string }, context: ToolExecutionContext) => {
    const cleanPath = sanitizePath(params.filePath);
    const files = getProjectFiles(context.project);
    const idx = files.findIndex((f) => f.path.replace(/^\/+/, '') === cleanPath || f.name === cleanPath);

    if (idx === -1) {
      throw new Error(`File '${cleanPath}' not found to delete.`);
    }

    files.splice(idx, 1);
    context.project.updatedAt = new Date().toISOString();
    return { success: true, filePath: cleanPath, action: 'deleted' };
  },
};

// -----------------------------------------------------------------------------
// 6. files.search
// -----------------------------------------------------------------------------
export const filesSearchTool: UniversalToolDefinition = {
  id: 'files.search',
  version: '1.0.0',
  name: 'Search Files (Grep)',
  category: 'files',
  description: 'Searches for text or regex pattern across all project files.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search term or pattern' },
      isRegex: { type: 'boolean', description: 'Whether query is a regex' },
    },
    required: ['query'],
  },
  riskLevel: 'safe',
  requiredPermission: 'read',
  timeoutMs: 10000,
  enabled: true,
  handler: async (params: { query: string; isRegex?: boolean }, context: ToolExecutionContext) => {
    const files = getProjectFiles(context.project);
    const regex = params.isRegex ? new RegExp(params.query, 'g') : new RegExp(params.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const matches: { filePath: string; line: number; snippet: string }[] = [];

    for (const f of files) {
      const lines = f.content.split('\n');
      lines.forEach((line, idx) => {
        if (regex.test(line)) {
          matches.push({
            filePath: f.path.replace(/^\/+/, ''),
            line: idx + 1,
            snippet: line.trim(),
          });
        }
      });
    }

    return { totalMatches: matches.length, matches };
  },
};

// Register all File Tools in Universal Tool Registry
export function registerFileTools(): void {
  universalToolRegistry.registerTool(filesListTool);
  universalToolRegistry.registerTool(filesReadTool);
  universalToolRegistry.registerTool(filesCreateTool);
  universalToolRegistry.registerTool(filesPatchTool);
  universalToolRegistry.registerTool(filesDeleteTool);
  universalToolRegistry.registerTool(filesSearchTool);
}
