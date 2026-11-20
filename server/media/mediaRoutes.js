/**
 * مسارات الوسائط — Express Router.
 *
 * الدمج في server.ts:
 *   import { mediaRoutes } from './media/mediaRoutes.js';
 *   app.use('/api/media', mediaRoutes(db, requireAuth));
 *
 * ⚠️ استبدل requireAuth بوسيط المصادقة الفعلي لديك الذي يضع req.user.id.
 * لا توجد أي استعلامات SQL هنا — كل الوصول للبيانات عبر mediaService فقط.
 */
import { Router } from 'express';
import fs from 'node:fs';
import {
  createJob, getJob, listJobs, cancelJob, retryJob,
  processImageJob, resolveArtifactPath, providerStatus, MediaError,
} from './mediaService.js';

export function mediaRoutes(db, requireAuth) {
  const r = Router();
  r.use(requireAuth);

  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // حالة المزوّدات — تغذّي الواجهة لتعرض BLOCKED بصدق بدل وعود وهمية
  r.get('/providers', (req, res) => {
    res.json({
      image: providerStatus('image'),
      diagram: providerStatus('diagram'),
      tts: providerStatus('tts'),
      animation: providerStatus('animation'),
      video: providerStatus('video'),
      flashcards: providerStatus('flashcards'),
    });
  });

  // إنشاء مهمة وسائط (Idempotent عبر X-Idempotency-Key)
  r.post('/jobs', asyncH(async (req, res) => {
    const { type, prompt, params, project_id: projectId } = req.body || {};
    const idem = req.get('X-Idempotency-Key') || null;
    const job = createJob(db, {
      ownerId: req.user.id,
      projectId: projectId || null,
      type,
      prompt,
      params: params || {},
      idempotencyKey: idem,
    });
    // التنفيذ اللاحق للصور — لا يُحجب الرد بانتظار المزوّد
    if (job.type === 'image' && job.state === 'QUEUED') {
      void processImageJob(db, job.id);
    }
    res.status(201).json(publicJob(job));
  }));

  r.get('/jobs', (req, res) => {
    const limit = Number(req.query.limit) || 30;
    const offset = Number(req.query.offset) || 0;
    res.json(listJobs(db, req.user.id, { limit, offset }).map(publicJob));
  });

  r.get('/jobs/:id', (req, res) => {
    res.json(publicJob(getJob(db, req.user.id, req.params.id)));
  });

  r.post('/jobs/:id/retry', asyncH(async (req, res) => {
    const job = retryJob(db, req.user.id, req.params.id);
    if (job.type === 'image') void processImageJob(db, job.id);
    res.json(publicJob(job));
  }));

  r.post('/jobs/:id/cancel', (req, res) => {
    res.json(publicJob(cancelJob(db, req.user.id, req.params.id)));
  });

  // تنزيل الأثر — تحقق ملكية + مسار آمن + ترويسات صحيحة
  r.get('/jobs/:id/artifact', (req, res) => {
    const { abs, mime } = resolveArtifactPath(db, req.user.id, req.params.id);
    res.setHeader('Content-Type', mime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(abs).pipe(res);
  });

  // معالج أخطاء موحّد — لا تسريب لتفاصيل داخلية
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err instanceof MediaError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('[media] unexpected:', err);
    res.status(500).json({ error: { code: 'MEDIA_INTERNAL_ERROR', message: 'خطأ داخلي غير متوقع.' } });
  });

  return r;
}

/** عرض عام للمهمة — يخفي الحقول الداخلية ويضيف رابط الأثر عند الجاهزية فقط */
function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    state: job.state,
    prompt: job.prompt,
    provider: job.provider,
    cost_units: job.cost_units,
    error_code: job.error_code,
    error_summary: job.error_summary,
    created_at: job.created_at,
    finished_at: job.finished_at,
    artifact_url: job.state === 'READY' ? `/api/media/jobs/${job.id}/artifact` : null,
  };
}
