/**
 * مسارات الفيديو — Express Router.
 *
 * الدمج في server.ts:
 *   import { videoRoutes } from './video/videoRoutes.js';
 *   app.use('/api/video', videoRoutes(db, requireAuth));
 *
 * التدفق: POST /jobs (خطة → DRAFT + تقدير) ثم POST /jobs/:id/confirm (موافقة → تشغيل).
 * عرض الحالة والتنزيل عبر مسارات الوسائط القائمة: GET /api/media/jobs/:id[/artifact].
 */
import { Router } from 'express';
import { createVideoJob, confirmVideoJob, getVideoJob } from './videoService.js';
import { MediaError } from '../media/mediaService.js';

export function videoRoutes(db, requireAuth) {
  const r = Router();
  r.use(requireAuth);

  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /**
   * إنشاء خطة فيديو → مسودة + تقدير تكلفة. لا خصم ولا تشغيل هنا.
   * body: { title?, plan: { scenes: [{ title?, body?, narration, citation? }] }, project_id? }
   */
  r.post('/jobs', asyncH(async (req, res) => {
    const { title, plan, project_id } = req.body || {};
    const { job, estimate } = await createVideoJob(db, {
      ownerId: req.user.id,
      projectId: project_id || null,
      title,
      plan,
      idempotencyKey: req.get('X-Idempotency-Key') || null,
    });
    res.status(201).json({ job: publicJob(job), estimate });
  }));

  /** موافقة المستخدم الصريحة على التكلفة → خصم الحصص وبدء التنفيذ */
  r.post('/jobs/:id/confirm', asyncH(async (req, res) => {
    const job = await confirmVideoJob(db, req.user.id, req.params.id);
    res.json(publicJob(job));
  }));

  r.get('/jobs/:id', (req, res) => {
    res.json(publicJob(getVideoJob(db, req.user.id, req.params.id)));
  });

  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err instanceof MediaError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('[video] unexpected:', err);
    res.status(500).json({ error: { code: 'VIDEO_INTERNAL_ERROR', message: 'خطأ داخلي غير متوقع.' } });
  });

  return r;
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    state: job.state,
    prompt: job.prompt,
    cost_units: job.cost_units,
    error_code: job.error_code,
    error_summary: job.error_summary,
    created_at: job.created_at,
    finished_at: job.finished_at,
    artifact_url: job.state === 'READY' ? `/api/media/jobs/${job.id}/artifact` : null,
  };
}
