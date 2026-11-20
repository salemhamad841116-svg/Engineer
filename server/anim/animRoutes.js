/**
 * مسارات الرسوم المتحركة — Express Router.
 *
 * الدمج في server.ts:
 *   import { animRoutes } from './anim/animRoutes.js';
 *   app.use('/api/anim', animRoutes(db, requireAuth));
 *
 * ملاحظة: عرض حالة المهمة وتنزيل الأثر يتم عبر مسارات محرك الوسائط نفسها
 * (GET /api/media/jobs/:id و GET /api/media/jobs/:id/artifact) — لا حاجة لتكرارها هنا.
 */
import { Router } from 'express';
import { createAnimationJob } from './animService.js';
import { MediaError } from '../media/mediaService.js';

export function animRoutes(db, requireAuth) {
  const r = Router();
  r.use(requireAuth);

  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /**
   * إنشاء مهمة رسم متحرك.
   * body: { description, scene_code, scene_class, format?, seconds?, project_id? }
   * scene_code عادةً يولّده الوكيل (Manim Scene) — يُعامل كمحتوى غير موثوق ويُنفَّذ معزولاً.
   */
  r.post('/jobs', asyncH(async (req, res) => {
    const { description, scene_code, scene_class, format, seconds, project_id } = req.body || {};
    const job = await createAnimationJob(db, {
      ownerId: req.user.id,
      projectId: project_id || null,
      description,
      sceneCode: scene_code,
      sceneClass: scene_class,
      format: format || 'mp4',
      seconds: seconds || 10,
      idempotencyKey: req.get('X-Idempotency-Key') || null,
    });
    res.status(201).json({
      id: job.id,
      type: job.type,
      state: job.state,
      cost_units: job.cost_units,
      created_at: job.created_at,
    });
  }));

  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err instanceof MediaError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('[anim] unexpected:', err);
    res.status(500).json({ error: { code: 'ANIM_INTERNAL_ERROR', message: 'خطأ داخلي غير متوقع.' } });
  });

  return r;
}
