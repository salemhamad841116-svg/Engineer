/**
 * Migration 028 — Flashcard Engine
 * جداول بطاقات المراجعة: المجموعات، البطاقات، حالة التكرار المتباعد (SM-2)، سجل التدقيق.
 *
 * التركيب: بجانب الترحيل 027 وسجّله في مُشغّل الترحيلات بعده.
 */
export function up(db) {
  db.exec(`
    -- مجموعات البطاقات (Deck)
    CREATE TABLE IF NOT EXISTS card_decks (
      id         TEXT PRIMARY KEY,
      owner_id   TEXT NOT NULL,
      title      TEXT NOT NULL,
      source_ref TEXT,                          -- مرجع المصدر (كتاب/فصل/صفحة) عند التوليد من مستند
      generated  INTEGER NOT NULL DEFAULT 0,    -- 1 = مولّدة بالذكاء الاصطناعي (تُلزِم الاقتباس لكل بطاقة)
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_card_decks_owner ON card_decks(owner_id, created_at DESC);

    -- البطاقات: وجه أمامي / خلفي / مرجع مصدر إلزامي للبطاقات المولّدة
    CREATE TABLE IF NOT EXISTS cards (
      id           TEXT PRIMARY KEY,
      deck_id      TEXT NOT NULL REFERENCES card_decks(id) ON DELETE CASCADE,
      owner_id     TEXT NOT NULL,
      front        TEXT NOT NULL,
      back         TEXT NOT NULL,
      source_ref   TEXT,                        -- الاقتباس/الصفحة المصدر — إلزامي إذا كانت المجموعة generated=1
      media_job_id TEXT,                        -- ربط اختياري بأثر من محرك الوسائط (صورة توضيحية)
      created_at   TEXT NOT NULL,
      updated_at   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cards_deck ON cards(deck_id);
    CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner_id);

    -- حالة التكرار المتباعد لكل مستخدم × بطاقة (SM-2)
    CREATE TABLE IF NOT EXISTS card_reviews (
      card_id          TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      owner_id         TEXT NOT NULL,
      easiness         REAL    NOT NULL DEFAULT 2.5,   -- معامل السهولة (أدنى حد 1.3)
      interval_days    INTEGER NOT NULL DEFAULT 0,
      repetitions      INTEGER NOT NULL DEFAULT 0,
      due_at           TEXT,                            -- موعد المراجعة القادم (UTC ISO)
      last_reviewed_at TEXT,
      PRIMARY KEY (card_id, owner_id)
    );
    CREATE INDEX IF NOT EXISTS idx_card_reviews_due ON card_reviews(owner_id, due_at);

    -- سجل تدقيق غير قابل للتعديل
    CREATE TABLE IF NOT EXISTS card_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id   TEXT NOT NULL,
      deck_id    TEXT,
      card_id    TEXT,
      event      TEXT NOT NULL,                 -- DECK_CREATED/CARD_ADDED/REVIEWED/...
      meta_json  TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_card_events_deck ON card_events(deck_id);
  `);
}
