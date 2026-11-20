/**
 * Migration 027 — Media Studio
 * جداول محرك الوسائط: المهام، استهلاك الحصص، سجل الأحداث (تدقيق غير قابل للتعديل).
 *
 * التركيب: انسخ هذا الملف إلى مجلد الترحيلات لديك (بجانب الترحيلات 001–026)
 * وسجّله في مُشغّل الترحيلات بنفس نمط الترحيلات السابقة.
 */
export function up(db) {
  db.exec(`
    -- مهام توليد الوسائط (صورة / مخطط / صوت / تحريك / فيديو / بطاقات)
    CREATE TABLE IF NOT EXISTS media_jobs (
      id              TEXT PRIMARY KEY,
      owner_id        TEXT NOT NULL,
      project_id      TEXT,
      type            TEXT NOT NULL CHECK (type IN ('image','diagram','tts','animation','video','flashcards')),
      state           TEXT NOT NULL DEFAULT 'QUEUED'
                      CHECK (state IN ('DRAFT','QUEUED','RUNNING','READY','FAILED','CANCELLED','EXPIRED')),
      prompt          TEXT NOT NULL DEFAULT '',
      params_json     TEXT NOT NULL DEFAULT '{}',
      provider        TEXT,
      idempotency_key TEXT UNIQUE,            -- منع تكرار العملية الواحدة (Idempotency)
      cost_units      INTEGER NOT NULL DEFAULT 0,
      artifact_path   TEXT,                    -- مسار نسبي داخل مخزن الوسائط فقط
      artifact_mime   TEXT,
      artifact_bytes  INTEGER,
      error_code      TEXT,
      error_summary   TEXT,
      created_at      TEXT NOT NULL,
      updated_at      TEXT NOT NULL,
      started_at      TEXT,
      finished_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_media_jobs_owner ON media_jobs(owner_id, created_at DESC);

    -- استهلاك الحصص اليومية (يوم UTC) لكل مستخدم ولكل نوع وسائط
    CREATE TABLE IF NOT EXISTS media_usage (
      owner_id TEXT NOT NULL,
      day      TEXT NOT NULL,                 -- YYYY-MM-DD (UTC)
      type     TEXT NOT NULL,
      units    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (owner_id, day, type)
    );

    -- سجل تدقيق غير قابل للتعديل (لا توجد أي عملية UPDATE/DELETE عليه في الكود)
    CREATE TABLE IF NOT EXISTS media_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id     TEXT NOT NULL,
      owner_id   TEXT NOT NULL,
      event      TEXT NOT NULL,               -- QUEUED/RUNNING/READY/FAILED/CANCELLED/...
      meta_json  TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_events_job ON media_events(job_id);
  `);
}
