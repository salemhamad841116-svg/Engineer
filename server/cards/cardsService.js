/**
 * محرك الفلاش كاردز — طبقة الخدمات (DAL الوحيدة لجداول البطاقات).
 *
 * قواعد صارمة:
 * 1) كل SQL الخاص بالبطاقات هنا فقط؛ owner_id إلزامي في كل عملية.
 * 2) البطاقة المولّدة (داخل مجموعة generated=1) بدون source_ref تُرفض — الاقتباس المصدري إلزامي.
 * 3) جدولة المراجعة بخوارزمية SM-2 القياسية.
 * 4) حذف المجموعة ذرّي (معاملة واحدة) مع كاسكاد للبطاقات والمراجعات.
 */
import crypto from 'node:crypto';

export class CardError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const DAY_MS = 86_400_000;

function recordEvent(db, ownerId, event, { deckId = null, cardId = null, meta = {} } = {}) {
  db.prepare('INSERT INTO card_events (owner_id, deck_id, card_id, event, meta_json, created_at) VALUES (?,?,?,?,?,?)')
    .run(ownerId, deckId, cardId, event, JSON.stringify(meta), now());
}

/* ------------------------------- المجموعات ------------------------------- */
export function createDeck(db, { ownerId, title, sourceRef = null, generated = false }) {
  if (!title || typeof title !== 'string' || title.trim().length === 0 || title.length > 200) {
    throw new CardError(400, 'DECK_TITLE_INVALID', 'عنوان المجموعة مطلوب (حتى 200 حرف).');
  }
  if (generated && !sourceRef) {
    throw new CardError(400, 'DECK_SOURCE_REQUIRED', 'المجموعة المولّدة من مستند تتطلب مرجع المصدر.');
  }
  const id = crypto.randomUUID();
  const t = now();
  db.prepare('INSERT INTO card_decks (id, owner_id, title, source_ref, generated, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, ownerId, title.trim(), sourceRef, generated ? 1 : 0, t, t);
  recordEvent(db, ownerId, 'DECK_CREATED', { deckId: id, meta: { generated: !!generated } });
  return getDeck(db, ownerId, id);
}

export function getDeck(db, ownerId, id) {
  const deck = db.prepare('SELECT * FROM card_decks WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!deck) throw new CardError(404, 'DECK_NOT_FOUND', 'المجموعة غير موجودة.');
  return deck;
}

export function listDecks(db, ownerId) {
  return db.prepare(`
    SELECT d.*,
      (SELECT COUNT(*) FROM cards c WHERE c.deck_id = d.id) AS card_count,
      (SELECT COUNT(*) FROM cards c
        LEFT JOIN card_reviews r ON r.card_id = c.id AND r.owner_id = ?
        WHERE c.deck_id = d.id AND (r.due_at IS NULL OR r.due_at <= ?)) AS due_count
    FROM card_decks d WHERE d.owner_id = ? ORDER BY d.created_at DESC
  `).all(ownerId, now(), ownerId);
}

function runTx(db, fn) {
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
}

/** حذف ذرّي — كل شيء أو لا شيء */
export function deleteDeck(db, ownerId, id) {
  getDeck(db, ownerId, id);
  runTx(db, () => {
    db.prepare('DELETE FROM card_reviews WHERE owner_id = ? AND card_id IN (SELECT id FROM cards WHERE deck_id = ?)').run(ownerId, id);
    db.prepare('DELETE FROM cards WHERE deck_id = ? AND owner_id = ?').run(id, ownerId);
    db.prepare('DELETE FROM card_decks WHERE id = ? AND owner_id = ?').run(id, ownerId);
    recordEvent(db, ownerId, 'DECK_DELETED', { deckId: id });
  });
  return { deleted: true };
}

/* -------------------------------- البطاقات -------------------------------- */
export function addCard(db, { ownerId, deckId, front, back, sourceRef = null, mediaJobId = null }) {
  const deck = getDeck(db, ownerId, deckId);
  if (!front?.trim() || !back?.trim() || front.length > 2000 || back.length > 4000) {
    throw new CardError(400, 'CARD_CONTENT_INVALID', 'وجها البطاقة مطلوبان (أمامي 2000 / خلفي 4000 حرف كحد أقصى).');
  }
  // دستور المصداقية: بطاقة مولّدة بلا مصدر = عيب حرج → تُرفض
  if (deck.generated && !sourceRef) {
    throw new CardError(400, 'CARD_SOURCE_REQUIRED', 'البطاقات المولّدة تتطلب مرجع المصدر (اقتباس/صفحة).');
  }
  const id = crypto.randomUUID();
  const t = now();
  db.prepare('INSERT INTO cards (id, deck_id, owner_id, front, back, source_ref, media_job_id, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, deckId, ownerId, front.trim(), back.trim(), sourceRef, mediaJobId, t, t);
  recordEvent(db, ownerId, 'CARD_ADDED', { deckId, cardId: id });
  return db.prepare('SELECT * FROM cards WHERE id = ? AND owner_id = ?').get(id, ownerId);
}

export function listCards(db, ownerId, deckId) {
  getDeck(db, ownerId, deckId);
  return db.prepare('SELECT * FROM cards WHERE deck_id = ? AND owner_id = ? ORDER BY created_at ASC').all(deckId, ownerId);
}

export function deleteCard(db, ownerId, cardId) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND owner_id = ?').get(cardId, ownerId);
  if (!card) throw new CardError(404, 'CARD_NOT_FOUND', 'البطاقة غير موجودة.');
  runTx(db, () => {
    db.prepare('DELETE FROM card_reviews WHERE card_id = ? AND owner_id = ?').run(cardId, ownerId);
    db.prepare('DELETE FROM cards WHERE id = ? AND owner_id = ?').run(cardId, ownerId);
    recordEvent(db, ownerId, 'CARD_DELETED', { deckId: card.deck_id, cardId });
  });
  return { deleted: true };
}

/* --------------------------- جلسة الدراسة (SM-2) --------------------------- */
/** البطاقات المستحقة الآن: الجديدة أولاً ثم الأقدم استحقاقاً */
export function dueCards(db, ownerId, deckId, limit = 20) {
  getDeck(db, ownerId, deckId);
  return db.prepare(`
    SELECT c.*, r.easiness, r.interval_days, r.repetitions, r.due_at
    FROM cards c
    LEFT JOIN card_reviews r ON r.card_id = c.id AND r.owner_id = ?
    WHERE c.deck_id = ? AND c.owner_id = ?
      AND (r.due_at IS NULL OR r.due_at <= ?)
    ORDER BY (r.due_at IS NULL) DESC, r.due_at ASC
    LIMIT ?
  `).all(ownerId, deckId, ownerId, now(), Math.min(limit, 100));
}

/**
 * تسجيل مراجعة بخوارزمية SM-2.
 * quality: 0–5 (0=نسيان تام … 5=استدعاء مثالي)
 */
export function reviewCard(db, ownerId, cardId, quality) {
  const q = Number(quality);
  if (!Number.isInteger(q) || q < 0 || q > 5) {
    throw new CardError(400, 'REVIEW_QUALITY_INVALID', 'التقييم يجب أن يكون عدداً صحيحاً بين 0 و 5.');
  }
  const card = db.prepare('SELECT * FROM cards WHERE id = ? AND owner_id = ?').get(cardId, ownerId);
  if (!card) throw new CardError(404, 'CARD_NOT_FOUND', 'البطاقة غير موجودة.');

  const prev = db.prepare('SELECT * FROM card_reviews WHERE card_id = ? AND owner_id = ?').get(cardId, ownerId)
    || { easiness: 2.5, interval_days: 0, repetitions: 0 };

  let { easiness, interval_days, repetitions } = prev;
  if (q < 3) {
    repetitions = 0;
    interval_days = 1;                       // فشل الاستدعاء → إعادة غداً
  } else {
    repetitions += 1;
    if (repetitions === 1) interval_days = 1;
    else if (repetitions === 2) interval_days = 6;
    else interval_days = Math.round(interval_days * easiness);
  }
  easiness = easiness + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (easiness < 1.3) easiness = 1.3;

  const t = now();
  const due = new Date(Date.now() + interval_days * DAY_MS).toISOString();
  db.prepare(`INSERT INTO card_reviews (card_id, owner_id, easiness, interval_days, repetitions, due_at, last_reviewed_at)
              VALUES (?,?,?,?,?,?,?)
              ON CONFLICT(card_id, owner_id) DO UPDATE SET
                easiness = excluded.easiness, interval_days = excluded.interval_days,
                repetitions = excluded.repetitions, due_at = excluded.due_at,
                last_reviewed_at = excluded.last_reviewed_at`)
    .run(cardId, ownerId, easiness, interval_days, repetitions, due, t);
  recordEvent(db, ownerId, 'REVIEWED', { deckId: card.deck_id, cardId, meta: { quality: q, interval_days } });
  return { card_id: cardId, easiness, interval_days, repetitions, due_at: due };
}

/* -------------------------------- إحصاءات -------------------------------- */
export function deckStats(db, ownerId, deckId) {
  getDeck(db, ownerId, deckId);
  const t = now();
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN r.due_at IS NULL OR r.due_at <= ? THEN 1 ELSE 0 END) AS due,
      SUM(CASE WHEN r.repetitions >= 3 THEN 1 ELSE 0 END) AS learned
    FROM cards c
    LEFT JOIN card_reviews r ON r.card_id = c.id AND r.owner_id = ?
    WHERE c.deck_id = ? AND c.owner_id = ?
  `).get(t, ownerId, deckId, ownerId);
  return { total: row.total ?? 0, due: row.due ?? 0, learned: row.learned ?? 0 };
}
