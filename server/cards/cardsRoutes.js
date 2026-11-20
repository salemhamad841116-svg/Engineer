/**
 * مسارات الفلاش كاردز — Express Router.
 *
 * الدمج في server.ts:
 *   import { cardsRoutes } from './cards/cardsRoutes.js';
 *   app.use('/api/cards', cardsRoutes(db, requireAuth));
 *
 * ⚠️ نفس وسيط المصادقة المستخدم في محرك الوسائط (req.user.id).
 * لا يوجد SQL هنا — كل الوصول عبر cardsService فقط.
 */
import { Router } from 'express';
import {
  createDeck, getDeck, listDecks, deleteDeck,
  addCard, listCards, deleteCard,
  dueCards, reviewCard, deckStats, CardError,
} from './cardsService.js';

export function cardsRoutes(db, requireAuth) {
  const r = Router();
  r.use(requireAuth);

  const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  /* المجموعات */
  r.post('/decks', (req, res) => {
    const { title, source_ref, generated } = req.body || {};
    res.status(201).json(createDeck(db, {
      ownerId: req.user.id, title, sourceRef: source_ref || null, generated: !!generated,
    }));
  });

  r.get('/decks', (req, res) => {
    res.json(listDecks(db, req.user.id));
  });

  r.get('/decks/:id', (req, res) => {
    res.json(getDeck(db, req.user.id, req.params.id));
  });

  r.delete('/decks/:id', (req, res) => {
    res.json(deleteDeck(db, req.user.id, req.params.id));
  });

  r.get('/decks/:id/stats', (req, res) => {
    res.json(deckStats(db, req.user.id, req.params.id));
  });

  /* البطاقات */
  r.post('/decks/:id/cards', (req, res) => {
    const { front, back, source_ref, media_job_id } = req.body || {};
    res.status(201).json(addCard(db, {
      ownerId: req.user.id, deckId: req.params.id,
      front, back, sourceRef: source_ref || null, mediaJobId: media_job_id || null,
    }));
  });

  /**
   * استيراد دفعة بطاقات (مخرجات الوكيل بعد التوليد من مستند).
   * نقطة الربط مع workspaceModelRouter: الوكيل يولّد JSON ثم يستدعي هذا المسار.
   * كل بطاقة في المجموعات المولّدة يجب أن تحمل source_ref وإلا رُفضت الدفعة كلها.
   */
  r.post('/decks/:id/import', asyncH(async (req, res) => {
    const items = req.body?.cards;
    if (!Array.isArray(items) || items.length === 0 || items.length > 200) {
      throw new CardError(400, 'IMPORT_INVALID', 'قائمة البطاقات مطلوبة (1–200 بطاقة).');
    }
    const runTx = (fn) => {
      if (typeof db.transaction === 'function') {
        return db.transaction(fn)();
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        const res = fn();
        db.exec('COMMIT');
        return res;
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch (_) {}
        throw err;
      }
    };
    const created = runTx(() => items.map((c) => addCard(db, {
      ownerId: req.user.id, deckId: req.params.id,
      front: c.front, back: c.back, sourceRef: c.source_ref || null, mediaJobId: c.media_job_id || null,
    })));
    res.status(201).json({ imported: created.length, cards: created });
  }));

  r.get('/decks/:id/cards', (req, res) => {
    res.json(listCards(db, req.user.id, req.params.id));
  });

  r.delete('/cards/:id', (req, res) => {
    res.json(deleteCard(db, req.user.id, req.params.id));
  });

  /* الدراسة */
  r.get('/decks/:id/due', (req, res) => {
    const limit = Number(req.query.limit) || 20;
    res.json(dueCards(db, req.user.id, req.params.id, limit));
  });

  r.post('/cards/:id/review', (req, res) => {
    res.json(reviewCard(db, req.user.id, req.params.id, req.body?.quality));
  });

  // معالج أخطاء موحّد
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    if (err instanceof CardError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    console.error('[cards] unexpected:', err);
    res.status(500).json({ error: { code: 'CARDS_INTERNAL_ERROR', message: 'خطأ داخلي غير متوقع.' } });
  });

  return r;
}
