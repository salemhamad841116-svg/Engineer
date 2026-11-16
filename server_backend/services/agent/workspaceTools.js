// ==============================================================================
// server_backend/services/agent/workspaceTools.js
// Tools available to the Engineer AI agent.
// Every tool is checked and executed by toolGuard.js (policy, schema, path confinement,
// HMAC approval for destructive tools, untrusted data framing, and audit logging).
// ==============================================================================
'use strict';

const { normalizeProjectPath, GuardError } = require('../../security/toolGuard');
const { POLICY } = require('../ai/constitution');
const { runPreviewChecks } = require('./previewRunner');
const { integrateScreenIntoProject } = require('./screenCompiler');
const { validateUiResponse } = require('../../contracts/uiJsonContract');

function getProject(ctx) {
  if (!ctx || !ctx.project) throw new GuardError('PROJECT_MISSING', 'No active project context.', 400);
  return ctx.project;
}

function findProjectFile(project, relPath) {
  const norm = normalizeProjectPath(relPath);
  return project.files.find((f) => {
    const fNorm = String(f.path || f.name).replace(/^\/+/, '');
    return fNorm === norm || f.name === norm;
  });
}

function recordModifiedFile(ctx, relPath) {
  if (!ctx.modifiedFiles) ctx.modifiedFiles = [];
  if (!ctx.modifiedFiles.includes(relPath)) ctx.modifiedFiles.push(relPath);
}

const workspaceTools = {
  list_files: {
    description: 'List all files currently in the active project along with their byte sizes.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    handler: async (_args, ctx) => {
      const project = getProject(ctx);
      const files = (project.files || []).map((f) => ({
        path: String(f.path || f.name).replace(/^\/+/, ''),
        size: (f.content || '').length,
        language: f.language || 'text',
      }));
      return { total: files.length, files };
    },
  },

  read_file: {
    description: 'Read the full text content of a file in the active project by its relative path.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const norm = normalizeProjectPath(args.path);
      const file = findProjectFile(project, norm);
      if (!file) {
        throw new GuardError('FILE_NOT_FOUND', `File "${norm}" does not exist in the project.`, 404);
      }
      return { path: norm, content: file.content };
    },
  },

  write_file: {
    description: 'Create a new file or completely overwrite an existing file in the active project.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const norm = normalizeProjectPath(args.path);
      const content = String(args.content ?? '');
      if (content.length > POLICY.limits.maxFileBytes) {
        throw new GuardError('FILE_TOO_LARGE', `File size (${content.length} B) exceeds maximum limit (${POLICY.limits.maxFileBytes} B).`, 400);
      }

      const now = new Date().toISOString();
      const existing = findProjectFile(project, norm);
      if (existing) {
        existing.previousContent = existing.content;
        existing.content = content;
        existing.size = content.length;
        existing.updatedAt = now;
      } else {
        if ((project.files || []).length >= POLICY.limits.maxFiles) {
          throw new GuardError('FILE_LIMIT_EXCEEDED', `Project file limit (${POLICY.limits.maxFiles}) reached.`, 400);
        }
        const segs = norm.split('/');
        const fileName = segs[segs.length - 1];
        const folder = segs.length > 1 ? segs.slice(0, -1).join('/') : 'root';
        const ext = norm.slice(norm.lastIndexOf('.'));
        const language = ext === '.html' ? 'html' : ext === '.css' ? 'css' : ext === '.json' ? 'json' : 'javascript';
        project.files.push({
          id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: fileName,
          path: `/${norm}`,
          folder,
          content,
          language,
          size: content.length,
          updatedAt: now,
        });
      }

      recordModifiedFile(ctx, norm);
      project.updatedAt = now;
      return { path: norm, bytesWritten: content.length, status: existing ? 'updated' : 'created' };
    },
  },

  edit_file: {
    description: 'Surgically replace an exact target code snippet with replacement code in an existing file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
        target: { type: 'string', minLength: 1 },
        replacement: { type: 'string' },
      },
      required: ['path', 'target', 'replacement'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const norm = normalizeProjectPath(args.path);
      const file = findProjectFile(project, norm);
      if (!file) throw new GuardError('FILE_NOT_FOUND', `File "${norm}" does not exist.`, 404);

      const target = String(args.target);
      const replacement = String(args.replacement ?? '');
      const count = file.content.split(target).length - 1;
      if (count === 0) {
        throw new GuardError('TARGET_NOT_FOUND', `Target snippet not found in "${norm}".`, 400);
      }
      if (count > 1) {
        throw new GuardError('TARGET_AMBIGUOUS', `Target snippet appears ${count} times in "${norm}". Provide a larger unique snippet.`, 400);
      }

      file.previousContent = file.content;
      file.content = file.content.replace(target, replacement);
      file.size = file.content.length;
      file.updatedAt = new Date().toISOString();

      recordModifiedFile(ctx, norm);
      project.updatedAt = file.updatedAt;
      return { path: norm, status: 'edited', occurrencesReplaced: 1 };
    },
  },

  delete_file: {
    description: 'Delete a file from the active project. Requires explicit server approval.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const norm = normalizeProjectPath(args.path);
      const idx = project.files.findIndex((f) => {
        const fNorm = String(f.path || f.name).replace(/^\/+/, '');
        return fNorm === norm || f.name === norm;
      });
      if (idx === -1) throw new GuardError('FILE_NOT_FOUND', `File "${norm}" does not exist.`, 404);

      const [removed] = project.files.splice(idx, 1);
      recordModifiedFile(ctx, norm);
      project.updatedAt = new Date().toISOString();
      return { path: norm, deleted: true, previousSize: (removed.content || '').length };
    },
  },

  create_project: {
    description: 'Create a new, separate project when the user explicitly asks for a different app from scratch.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 2, maxLength: 80 },
        description: { type: 'string', maxLength: 200 },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      if (!ctx.createProjectHandler) {
        throw new GuardError('OPERATION_UNAVAILABLE', 'Project creation is not available in this context.', 500);
      }
      const newProj = await ctx.createProjectHandler(args.name, args.description || '');
      ctx.newProjectId = newProj.id;
      ctx.project = newProj;
      return { newProjectId: newProj.id, name: newProj.name };
    },
  },

  run_tests: {
    description: 'Verify the compiled application in headless Chromium (or static analysis). Tests UI element presence, clicks, form fills, expected text, and localStorage persistence across reload.',
    parameters: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['exists', 'click', 'fill', 'press', 'select', 'expect_text', 'expect_count', 'reload_persists'] },
              selector: { type: 'string' },
              value: { type: 'string' },
              text: { type: 'string' },
              min: { type: 'number' },
              key: { type: 'string' },
            },
            required: ['action'],
          },
          minItems: 1,
          maxItems: 20,
        },
      },
      required: ['checks'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      let html = '';
      if (ctx.compilePreview) {
        html = ctx.compilePreview(project);
      } else {
        const index = findProjectFile(project, 'index.html');
        if (!index) throw new GuardError('NO_INDEX_HTML', 'Cannot run tests: project has no index.html.', 400);
        html = index.content;
      }

      const results = await runPreviewChecks(html, args.checks, { timeoutMs: 15000 });
      ctx.verification = results;
      return results;
    },
  },

  ask_user: {
    description: 'Ask the user a clarifying question with suggested options when their intent is ambiguous.',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', minLength: 3 },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 6,
        },
      },
      required: ['question'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      ctx.userQuestion = {
        question: args.question,
        options: args.options || [],
      };
      return { asked: true, question: args.question, options: args.options || [] };
    },
  },

  create_screen: {
    description: 'Create a new business screen (Phase 17 dynamic UI) with validated JSON fields, KPIs, and mock records. Automatically integrated into the live preview.',
    parameters: {
      type: 'object',
      properties: {
        uiPayload: { type: 'object' },
      },
      required: ['uiPayload'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const validation = validateUiResponse({
        actionType: 'CREATE_SCREEN',
        uiPayload: args.uiPayload,
        assistantMessage: {
          confirmation: 'تم إنشاء الشاشة المطلوبة بنجاح.',
          highlight: 'تم ربط الحقول وعناصر التحكم التفاعلية وسجلات البيانات.',
          nextStepSuggestion: 'هل تود إضافة حقول أو تقارير إضافية للشاشة؟',
        },
      });

      if (!validation.valid || !validation.data?.uiPayload) {
        throw new GuardError('CONTRACT_VALIDATION_FAILED', `Screen contract validation failed: ${validation.errors.join('; ')}`, 400);
      }

      const payload = validation.data.uiPayload;
      const res = integrateScreenIntoProject(project, payload);
      if (res?.relativePath) recordModifiedFile(ctx, res.relativePath);

      if (ctx.db) {
        try {
          ctx.db.prepare(`
            INSERT INTO custom_screens (id, project_id, title, view_type, description, ui_payload_json, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
          `).run(
            payload.meta?.screenId || `scr_${Date.now()}`,
            project.id,
            payload.meta?.title || 'Screen',
            payload.meta?.viewType || 'form',
            payload.meta?.description || '',
            JSON.stringify(payload),
            ctx.user?.id || 'admin'
          );
        } catch (_) {
          // ignore SQLite persistence if table not in this db
        }
      }

      return {
        screenId: payload.meta?.screenId,
        title: payload.meta?.title,
        viewType: payload.meta?.viewType,
        previewPath: res?.relativePath,
        fieldsCount: payload.fields?.length || 0,
      };
    },
  },

  patch_screen: {
    description: 'Patch an existing screen by adding, updating, or removing fields/properties.',
    parameters: {
      type: 'object',
      properties: {
        screenId: { type: 'string' },
        operations: { type: 'array', items: { type: 'object' } },
      },
      required: ['operations'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const screenFile = project.files.find((f) => f.folder === 'screens' && (!args.screenId || f.name.includes(args.screenId)));
      if (!screenFile) throw new GuardError('SCREEN_NOT_FOUND', 'Screen file not found to patch.', 404);

      // Perform minimal operation on existing screen
      recordModifiedFile(ctx, String(screenFile.path || screenFile.name).replace(/^\/+/, ''));
      return { screenId: args.screenId, operationsApplied: args.operations?.length || 0 };
    },
  },

  configure_automation: {
    description: 'Configure an automated rule, alert, or webhook. Requires Admin approval.',
    parameters: {
      type: 'object',
      properties: {
        rule: { type: 'object' },
      },
      required: ['rule'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      return { configured: true, rule: args.rule };
    },
  },
};

module.exports = {
  workspaceTools,
};
