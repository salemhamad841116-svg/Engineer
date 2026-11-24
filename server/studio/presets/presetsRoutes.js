/**
 * presetsRoutes.js — Smart Presets Engine v2 REST surface (annex: 4 routes).
 *
 *   GET    /api/v1/presets                          (list, in-memory <5ms)
 *   POST   /api/v1/presets/resolve                  (Resolved Preset Bundle)
 *   POST   /api/v1/presets/custom                   (save OR pin)
 *   GET    /api/v1/projects/:projectId/brand-kit    (Brand Preset Lock read)
 *   PATCH  /api/v1/projects/:projectId/brand-kit    (Brand Preset Lock write)
 *   DELETE /api/v1/presets/custom/:id               (owner soft-delete; the
 *           graceful-fallback acceptance gate requires a deletion path)
 *
 * Mounted in server.ts behind requireWorkspaceAuth; every query is
 * owner-scoped. Zod violations map to 400; honest states only.
 */

import { Router } from 'express';
import { z } from 'zod';
import { listPresets } from './presetsRegistry.js';
import { resolvePreset, presetLabel } from './presetsResolve.js';
import { saveCustomPreset, setPinned, deleteCustomPreset } from './presetsCustom.js';
import { getBrandKit, patchBrandKit } from './presetsBrandKit.js';
import { getBrandLock } from '../presetStore.js';
import { INTENSITY_LEVELS, PROVIDER_DIALECTS, MODIFIER_MAP_SCHEMA } from './presetsSchema.js';
import { StudioError } from '../studioErrors.js';

const RESOLVE_INPUT = z.object({
  preset_id: z.string().min(1).max(80).nullish(),
  message: z.string().max(1000).optional(),
  lang: z.enum(['ar', 'en']).optional(),
  intensity: z.enum(INTENSITY_LEVELS).optional(),
  modifiers: MODIFIER_MAP_SCHEMA.optional(),
  provider: z.enum(PROVIDER_DIALECTS).optional(),
  aspect_ratio: z.string().regex(/^\d+:\d+$/).nullish(),
  project_id: z.string().max(80).nullish(),
});

function publicPreset(row, lang) {
  return {
    id: row.id,
    version: row.version,
    label: presetLabel(lang, row.i18n_label_key),
    description: presetLabel(lang, row.i18n_description_key),
    category: row.category,
    budget_tier: row.budget_tier,
    default_aspect_ratio: row.default_aspect_ratio,
    ocr_gate_mode: row.ocr_gate_mode,
    modifiers_schema: row.modifiers_schema || {},
    conflict_rules: row.conflict_rules || [],
    palette: row.palette || [],
    tags: row.tags || [],
    is_pinned: row.is_pinned === 1,
    is_system: row.is_system === 1,
    is_custom: row.is_system !== 1,
    parent_preset_id: row.parent_preset_id || null,
    thumbnail_url: row.thumbnail_url || null,
  };
}

export function presetsV1Routes(db, requireAuth) {
  const r = Router();
  r.use(requireAuth);
  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const zodGuard = (fn) => (req, res, next) => {
    try { return fn(req, res, next); }
    catch (err) {
      if (err && err.name === 'ZodError') {
        return next(new StudioError(400, 'PRESETS_INPUT_INVALID', 'Invalid request payload.'));
      }
      return next(err);
    }
  };

  // List: system + own customs, pinned first, tag/label search, category filter.
  // Served from the in-memory registry (Layer 9 — <5ms budget).
  r.get('/presets', (req, res) => {
    const startedAt = performance.now();
    const lang = req.query.lang === 'en' ? 'en' : 'ar';
    const rows = listPresets(db, {
      ownerId: req.user.id,
      q: typeof req.query.q === 'string' ? req.query.q : null,
      category: typeof req.query.category === 'string' ? req.query.category : null,
      labelLookup: (key) => presetLabel(lang, key),
    });
    res.json({
      presets: rows.map((row) => publicPreset(row, lang)),
      server_ms: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
    });
  });

  // Resolve: auto-detect / manual / brand-lock selection, conflict guard,
  // dialect adaptation, OCR binding, cache-key contract.
  r.post('/presets/resolve', asyncH(zodGuard((req, res) => {
    const input = RESOLVE_INPUT.parse(req.body || {});
    if (!input.preset_id && !input.message && !input.project_id) {
      throw new StudioError(400, 'PRESET_RESOLVE_INPUT_REQUIRED', 'Provide preset_id, message or project_id.');
    }
    let brandLock = null;
    if (input.project_id) {
      brandLock = getBrandLock(db, req.user.id, input.project_id);
    }
    const bundle = resolvePreset(db, {
      ownerId: req.user.id,
      projectId: input.project_id || null,
      presetId: input.preset_id || null,
      message: input.message || '',
      lang: input.lang || 'ar',
      intensity: input.intensity || 'balanced',
      modifiers: input.modifiers || {},
      provider: input.provider || process.env.IMAGE_PROVIDER || 'gemini',
      aspectRatio: input.aspect_ratio || null,
      brandLock,
    });
    res.json(bundle);
  })));

  // Save-as-custom OR pin toggle (annex: one endpoint covers both jobs).
  r.post('/presets/custom', asyncH(zodGuard((req, res) => {
    const body = req.body || {};
    if (body.pin_id) {
      const row = setPinned(db, { ownerId: req.user.id, payload: body });
      return res.json({ pinned: row.is_pinned === 1, preset: publicPreset(row, req.query.lang === 'en' ? 'en' : 'ar') });
    }
    const row = saveCustomPreset(db, { ownerId: req.user.id, payload: body });
    res.status(201).json({ created: true, preset: publicPreset(row, req.query.lang === 'en' ? 'en' : 'ar') });
  })));

  // Owner soft-delete of a custom preset (graceful fallback path).
  r.delete('/presets/custom/:id', (req, res) => {
    res.json(deleteCustomPreset(db, { ownerId: req.user.id, id: req.params.id }));
  });

  // Brand Preset Lock read/write (locked_preset_id + locked_style_seed).
  r.get('/projects/:projectId/brand-kit', (req, res) => {
    res.json(getBrandKit(db, { ownerId: req.user.id, projectId: req.params.projectId }));
  });

  r.patch('/projects/:projectId/brand-kit', asyncH(zodGuard((req, res) => {
    res.json(patchBrandKit(db, {
      ownerId: req.user.id, projectId: req.params.projectId, payload: req.body || {},
    }));
  })));

  // Unified error handler — no internal leaks.
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err instanceof StudioError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('[presets-v1] unexpected:', err);
    res.status(500).json({ error: { code: 'PRESETS_INTERNAL_ERROR', message: 'Internal presets error.' } });
  });

  return r;
}
