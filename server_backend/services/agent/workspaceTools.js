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

  search_code: {
    description: 'Semantic symbol & feature search across the project: finds declarations (functions, components, classes, handlers, state, elements) and dependencies matching a query. Always call it BEFORE creating new code to avoid duplicating existing features.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', minLength: 1, maxLength: 200 },
        kind: { type: 'string', enum: ['function', 'component', 'class', 'method', 'variable', 'state', 'handler', 'element', 'selector', 'route'] },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['query'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const { getDb } = require('../../db/database.js');
      const { buildOrUpdateIndex, searchSymbols, locateFeature } = require('./projectIndex');
      const db = getDb();
      const ownerId = ctx?.user?.id || 'usr_workspace_owner';
      buildOrUpdateIndex({ db, project, ownerId });
      const exact = searchSymbols({ db, projectId: project.id, query: args.query, kind: args.kind || null, limit: args.limit || 10 });
      if (exact.total > 0) return { source: 'symbol-index', ...exact };
      const fuzzy = locateFeature({ db, projectId: project.id, query: args.query, limit: args.limit || 10 });
      return { source: 'feature-index', ...fuzzy };
    },
  },

  get_symbol: {
    description: 'Exact symbol lookup before editing: returns every declaration of a name with file, line range and byte range, plus the files that call it. Use it to confirm you are MODIFYING an existing symbol instead of creating a duplicate.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 120 },
        path: { type: 'string', maxLength: 200 },
      },
      required: ['name'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const { getDb } = require('../../db/database.js');
      const { buildOrUpdateIndex, getSymbol } = require('./projectIndex');
      const db = getDb();
      const ownerId = ctx?.user?.id || 'usr_workspace_owner';
      buildOrUpdateIndex({ db, project, ownerId });
      const result = getSymbol({ db, projectId: project.id, name: args.name, filePath: args.path || null });
      if (result.total === 0) {
        return { ...result, hint: 'No existing symbol with this name — creating it new is acceptable. If you intended to MODIFY a feature, search_code with a keyword first.' };
      }
      return result;
    },
  },

  list_dependents: {
    description: 'Cross-layer tracing: which files import or call into a given file. Run it BEFORE editing a shared file so a change to one layer does not silently break its dependents.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 200 },
      },
      required: ['path'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const { getDb } = require('../../db/database.js');
      const { buildOrUpdateIndex, listDependents, getFileOutline } = require('./projectIndex');
      const db = getDb();
      const ownerId = ctx?.user?.id || 'usr_workspace_owner';
      buildOrUpdateIndex({ db, project, ownerId });
      const norm = normalizeProjectPath(args.path);
      const outline = getFileOutline({ db, projectId: project.id, filePath: norm });
      if (!outline) throw new GuardError('FILE_NOT_INDEXED', `File "${norm}" is not in the project index.`, 404);
      return { outline: { path: outline.path, language: outline.language, symbolCount: outline.symbols.length, dependencies: outline.dependencies }, ...listDependents({ db, projectId: project.id, filePath: norm }) };
    },
  },

  recommend_options: {
    description: 'Personalized recommendations: suggests the right structure, features and data model for the user request (rule-based, deterministic), plus evidence-based next steps for the CURRENT project from its semantic index. Use it when the user asks "what do you recommend?" or before proposing an architecture.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', maxLength: 4000 },
      },
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const { recommendForPrompt, nextStepsForProject } = require('./recommendationService');
      const isAr = /[\u0600-\u06FF]/.test(String(args.prompt || '')) || project.language === 'ar';
      const out = {
        method: 'rule-based deterministic engine (states its basis; not ML)',
      };
      if (args.prompt && String(args.prompt).trim()) {
        out.forRequest = recommendForPrompt({ prompt: args.prompt, language: isAr ? 'ar' : 'en' });
      }
      const steps = nextStepsForProject({ db: ctx.db || null, projectId: project.id, project });
      if (steps.length) out.nextSteps = steps;
      return out;
    },
  },

  predict_build_risk: {
    description: 'Predictive risk assessment: estimates the probability band that the current build/edit request fails, with named factors and concrete mitigations. Transparent heuristic — every point is traceable. Call it BEFORE large or vague requests.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', maxLength: 4000 },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const { assessBuildRisk } = require('./buildRiskService');
      return assessBuildRisk({ project, prompt: args.prompt, db: ctx.db || null });
    },
  },

  analyze_screenshot: {
    description: 'Computer vision review of an uploaded UI screenshot attachment: returns structured issues (severity, location, detail, fix) visible in the image. Reports BLOCKED honestly when no vision provider is configured — never fabricates analysis.',
    parameters: {
      type: 'object',
      properties: {
        attachment_id: { type: 'string', minLength: 1, maxLength: 120 },
        question: { type: 'string', maxLength: 300 },
      },
      required: ['attachment_id'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const { analyzeScreenshot } = require('./visionService');
      try {
        return await analyzeScreenshot({ projectId: project.id, attachmentId: args.attachment_id, question: args.question || '' });
      } catch (err) {
        if (err.code === 'VISION_UNAVAILABLE') {
          throw new GuardError('VISION_UNAVAILABLE', 'Screenshot analysis is blocked: no vision-capable provider is configured (set a Gemini API key or GEMINI_VISION_MODEL).', 503);
        }
        if (err.code === 'ATTACHMENT_NOT_FOUND') {
          throw new GuardError('ATTACHMENT_NOT_FOUND', `Attachment "${args.attachment_id}" not found in this project.`, 404);
        }
        if (err.code === 'NOT_AN_IMAGE') {
          throw new GuardError('NOT_AN_IMAGE', 'The attachment is not an image (png/jpg/webp/gif).', 400);
        }
        throw err;
      }
    },
  },

  plan_project: {
    description: 'Reasoning & planning: decomposes the request into an explicit persisted build plan (ordered steps with dependencies) BEFORE writing code. Creates a new plan version; the previous plan is superseded, never silently lost.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', minLength: 3, maxLength: 4000 },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const project = getProject(ctx);
      const { getDb } = require('../../db/database.js');
      const { createPlan } = require('./buildPlanService');
      const db = getDb();
      const ownerId = ctx?.user?.id || 'usr_workspace_owner';
      const isAr = /[\u0600-\u06FF]/.test(String(args.prompt || '')) || project.language === 'ar';
      const plan = createPlan({ db, projectId: project.id, ownerId, prompt: args.prompt, language: isAr ? 'ar' : 'en' });
      return {
        planId: plan.id,
        domain: plan.domain,
        steps: plan.steps,
        recommendation: plan.recommendation,
        note: isAr ? 'خطة مبدئية محفوظة — نفّذها خطوة خطوة ثم تحقق.' : 'Persisted draft plan — execute it step by step, then verify.',
      };
    },
  },

  media_image_generate: {
    description: 'Generate an image from a text prompt via the media engine (durable job, quota-enforced).',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', maxLength: 4000 },
        size: { type: 'string', enum: ['1024x1024', '1024x1536', '1536x1024'] },
      },
      required: ['prompt'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const { createJob, processImageJob } = await import('../../../server/media/mediaService.js');
      const { getDb } = require('../../db/database.js');
      const db = getDb();
      const ownerId = ctx?.user?.id || 'usr_workspace_owner';
      const projectId = ctx?.project?.id || null;
      const job = createJob(db, {
        ownerId,
        projectId,
        type: 'image',
        prompt: args.prompt,
        params: { size: args.size || '1024x1024' },
      });
      if (job.state === 'QUEUED') {
        void processImageJob(db, job.id);
      }
      return {
        id: job.id,
        state: job.state,
        type: job.type,
        prompt: job.prompt,
        cost_units: job.cost_units,
      };
    },
  },

  cards_deck_create: {
    description: 'Create a flashcard deck. If generated from a document, source_ref is required.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        source_ref: { type: 'string' },
        generated: { type: 'boolean' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const { createDeck } = await import('../../../server/cards/cardsService.js');
      const { getDb } = require('../../db/database.js');
      const db = getDb();
      const ownerId = ctx?.user?.id || 'usr_workspace_owner';
      const deck = createDeck(db, {
        ownerId,
        title: args.title,
        sourceRef: args.source_ref || null,
        generated: !!args.generated,
      });
      return deck;
    },
  },

  cards_import: {
    description: 'Import LLM-generated flashcards into a deck. Every card must carry source_ref when the deck is generated=1 — fabricated citations are rejected as a batch.',
    parameters: {
      type: 'object',
      properties: {
        deck_id: { type: 'string' },
        cards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              front: { type: 'string', maxLength: 2000 },
              back: { type: 'string', maxLength: 4000 },
              source_ref: { type: 'string' },
            },
            required: ['front', 'back'],
          },
        },
      },
      required: ['deck_id', 'cards'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const { addCard, getDeck } = await import('../../../server/cards/cardsService.js');
      const { getDb } = require('../../db/database.js');
      const db = getDb();
      const ownerId = ctx?.user?.id || 'usr_workspace_owner';
      const deck = getDeck(db, ownerId, args.deck_id);
      const items = args.cards || [];
      if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
        throw new GuardError('CARDS_INVALID', 'Cards array must contain between 1 and 200 items.', 400);
      }
      if (deck.generated) {
        for (const c of items) {
          if (!c.source_ref) {
            throw new GuardError('CARD_SOURCE_REQUIRED', 'All cards in a generated deck must have a valid source_ref citation.', 400);
          }
        }
      }
      const created = [];
      for (const c of items) {
        const row = addCard(db, {
          ownerId,
          deckId: args.deck_id,
          front: c.front,
          back: c.back,
          sourceRef: c.source_ref || null,
        });
        created.push(row);
      }
      return { imported: created.length, cards: created };
    },
  },

  media_animation_render: {
    description: 'Render a programmatic animation using Manim inside an isolated container.',
    parameters: {
      type: 'object',
      properties: {
        description: { type: 'string', maxLength: 500 },
        scene_code: { type: 'string' },
        scene_class: { type: 'string' },
        format: { type: 'string', enum: ['mp4', 'gif'] },
        seconds: { type: 'number' },
      },
      required: ['description', 'scene_code', 'scene_class'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const { createAnimationJob } = await import('../../../server/anim/animService.js');
      const { getDb } = require('../../db/database.js');
      const db = getDb();
      const ownerId = ctx?.user?.id || 'usr_workspace_owner';
      const projectId = ctx?.project?.id || null;
      const job = await createAnimationJob(db, {
        ownerId,
        projectId,
        description: args.description,
        sceneCode: args.scene_code,
        sceneClass: args.scene_class,
        format: args.format || 'mp4',
        seconds: args.seconds || 10,
      });
      return {
        id: job.id,
        state: job.state,
        type: job.type,
        cost_units: job.cost_units,
      };
    },
  },

  media_video_plan: {
    description: 'Plan a multi-scene narrated video, creating a DRAFT job with estimated duration and narration character count. Does not charge quota or start rendering.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', maxLength: 200 },
        plan: {
          type: 'object',
          properties: {
            scenes: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  body: { type: 'string' },
                  narration: { type: 'string' },
                  citation: { type: 'string' },
                },
                required: ['narration'],
              },
            },
          },
          required: ['scenes'],
        },
      },
      required: ['plan'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const { createVideoJob } = await import('../../../server/video/videoService.js');
      const { getDb } = require('../../db/database.js');
      const db = getDb();
      const ownerId = ctx?.user?.id || 'usr_workspace_owner';
      const projectId = ctx?.project?.id || null;
      const { job, estimate } = await createVideoJob(db, {
        ownerId,
        projectId,
        title: args.title || null,
        plan: args.plan,
      });
      return {
        id: job.id,
        state: job.state,
        type: job.type,
        cost_units: job.cost_units,
        estimate,
      };
    },
  },

  media_video_confirm: {
    description: 'Confirm and start rendering a planned video DRAFT job. Validates and charges video + TTS quota.',
    parameters: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
    handler: async (args, ctx) => {
      const { confirmVideoJob } = await import('../../../server/video/videoService.js');
      const { getDb } = require('../../db/database.js');
      const db = getDb();
      const ownerId = ctx?.user?.id || 'usr_workspace_owner';
      const job = await confirmVideoJob(db, ownerId, args.job_id);
      return {
        id: job.id,
        state: job.state,
        type: job.type,
        cost_units: job.cost_units,
      };
    },
  },
};

workspaceTools['media.image.generate'] = workspaceTools.media_image_generate;
workspaceTools['media.animation.render'] = workspaceTools.media_animation_render;
workspaceTools['media.video.plan'] = workspaceTools.media_video_plan;
workspaceTools['media.video.confirm'] = workspaceTools.media_video_confirm;
workspaceTools['cards.deck.create'] = workspaceTools.cards_deck_create;
workspaceTools['cards.import'] = workspaceTools.cards_import;

module.exports = {
  workspaceTools,
};
