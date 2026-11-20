/**
 * Binary Analysis proxy routes — Express (TypeScript).
 *
 * Mount under your authenticated API, e.g.:
 *   app.use("/api/analysis", workspaceAuth.requireWorkspaceAuth, analysisRouter);
 *
 * The Python analysis worker is INTERNAL ONLY (never exposed publicly).
 * AuthN/tenant isolation/quotas stay here at the gateway, per the platform
 * constitution: the worker trusts the gateway, the gateway trusts nobody.
 */
import express from 'express';
import type { Request, Response } from 'express';
import { multerCompat } from './multerCompat.ts';

const ANALYSIS_SERVICE_URL = process.env.ANALYSIS_SERVICE_URL ?? 'http://127.0.0.1:8090';
const MAX_UPLOAD_MB = Number(process.env.ANALYSIS_MAX_UPLOAD_MB ?? '50');

export const analysisRouter = express.Router();

const upload = multerCompat({
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

/** POST /api/analysis/analyze — upload a binary, start analysis. */
analysisRouter.post(
  '/analyze',
  upload.single('file'),
  async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ status: 'FAILED', detail: 'file is required' });
    }
    try {
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(req.file.buffer)]),
        req.file.originalname || 'sample.bin',
      );
      const upstream = await fetch(`${ANALYSIS_SERVICE_URL}/analyze`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      const body = await upstream.json();
      return res.status(upstream.status).json(body);
    } catch {
      return res.status(502).json({ status: 'FAILED', detail: 'analysis service unavailable' });
    }
  },
);

/** GET /api/analysis/disasm?job_id&start&count — lazy instruction paging. */
analysisRouter.get('/disasm', async (req: Request, res: Response) => {
  const { job_id, start = '0', count = '200' } = req.query;
  if (typeof job_id !== 'string') {
    return res.status(400).json({ status: 'FAILED', detail: 'job_id is required' });
  }
  try {
    const upstream = await fetch(
      `${ANALYSIS_SERVICE_URL}/disasm?job_id=${encodeURIComponent(job_id)}&start=${start}&count=${count}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    return res.status(upstream.status).json(await upstream.json());
  } catch {
    return res.status(502).json({ status: 'FAILED', detail: 'analysis service unavailable' });
  }
});

/** GET /api/analysis/jobs/:id — job summary. */
analysisRouter.get('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const upstream = await fetch(
      `${ANALYSIS_SERVICE_URL}/jobs/${encodeURIComponent(req.params.id)}`,
      { signal: AbortSignal.timeout(15_000) },
    );
    return res.status(upstream.status).json(await upstream.json());
  } catch {
    return res.status(502).json({ status: 'FAILED', detail: 'analysis service unavailable' });
  }
});

// ---------- Phase 2 routes ----------

/** POST /api/analysis/decompile?job_id&address — C pseudocode. */
analysisRouter.post('/decompile', async (req: Request, res: Response) => {
  const { job_id, address } = req.query;
  if (typeof job_id !== 'string' || typeof address !== 'string') {
    return res.status(400).json({ status: 'FAILED', detail: 'job_id and address are required' });
  }
  try {
    const upstream = await fetch(
      `${ANALYSIS_SERVICE_URL}/decompile?job_id=${encodeURIComponent(job_id)}&address=${encodeURIComponent(address)}`,
      { method: 'POST', signal: AbortSignal.timeout(180_000) },
    );
    return res.status(upstream.status).json(await upstream.json());
  } catch {
    return res.status(502).json({ status: 'FAILED', detail: 'analysis service unavailable' });
  }
});

/** GET /api/analysis/cfg?job_id&start&end — basic-block CFG. */
analysisRouter.get('/cfg', async (req: Request, res: Response) => {
  const params = new URLSearchParams();
  for (const k of ['job_id', 'start', 'end']) {
    const v = req.query[k];
    if (typeof v === 'string') params.set(k, v);
  }
  try {
    const upstream = await fetch(`${ANALYSIS_SERVICE_URL}/cfg?${params}`,
      { signal: AbortSignal.timeout(30_000) });
    return res.status(upstream.status).json(await upstream.json());
  } catch {
    return res.status(502).json({ status: 'FAILED', detail: 'analysis service unavailable' });
  }
});

/** POST /api/analysis/ir — lift raw bytes to p-code. Body passthrough. */
analysisRouter.post('/ir', async (req: Request, res: Response) => {
  try {
    const upstream = await fetch(`${ANALYSIS_SERVICE_URL}/ir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30_000),
    });
    return res.status(upstream.status).json(await upstream.json());
  } catch {
    return res.status(502).json({ status: 'FAILED', detail: 'analysis service unavailable' });
  }
});

/** POST /api/analysis/emulate — sandboxed emulation. Body passthrough. */
analysisRouter.post('/emulate', async (req: Request, res: Response) => {
  try {
    const upstream = await fetch(`${ANALYSIS_SERVICE_URL}/emulate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body),
      signal: AbortSignal.timeout(30_000),
    });
    return res.status(upstream.status).json(await upstream.json());
  } catch {
    return res.status(502).json({ status: 'FAILED', detail: 'analysis service unavailable' });
  }
});
