/**
 * محرك الوسائط — طبقة الخدمات (DAL الوحيدة لجداول الوسائط).
 *
 * قواعد صارمة (متوافقة مع دستور المشروع):
 * 1) كل استعلامات SQL الخاصة بالوسائط موجودة في هذا الملف فقط — ممنوع كتابتها في المسارات أو الواجهة.
 * 2) owner_id إلزامي في كل عملية (عزل المستأجرين على مستوى التطبيق).
 * 3) لا تُعلَّم أي مهمة READY إلا بعد تحقق فعلي من الأثر الناتج (Magic Bytes / حجم الملف).
 * 4) المزوّد غير المهيأ يُرجع BLOCKED بصدق — لا وعود وهمية.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MEDIA_ROOT = process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'data', 'media');

/* ----------------------------- الحصص اليومية ----------------------------- */
/* الوحدات: image=صورة، tts=حرف، animation=ثانية، video=ثانية، flashcards=مجموعة */
const QUOTAS = {
  image:      { daily: 20,   unitCost: 1 },
  diagram:    { daily: 50,   unitCost: 1 },
  tts:        { daily: 5000, unitCost: 1 },
  animation:  { daily: 60,   unitCost: 1 },
  video:      { daily: 30,   unitCost: 1 },
  flashcards: { daily: 10,   unitCost: 1 },
};

const JOB_TYPES = Object.keys(QUOTAS);

/* الانتقالات المسموحة بين الحالات — أي انتقال آخر يُرفض */
const TRANSITIONS = {
  DRAFT:     ['QUEUED', 'CANCELLED'],
  QUEUED:    ['RUNNING', 'CANCELLED', 'FAILED'],
  RUNNING:   ['READY', 'FAILED', 'CANCELLED'],
  FAILED:    ['QUEUED'],          // إعادة المحاولة فقط
  READY:     ['EXPIRED'],
  CANCELLED: [],
  EXPIRED:   [],
};

export class MediaError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const now = () => new Date().toISOString();
const utcDay = () => new Date().toISOString().slice(0, 10);

/* --------------------------- حالة المزوّدات (صدق) --------------------------- */
export function providerStatus(type) {
  if (type === 'image') {
    const ok = !!(process.env.MEDIA_IMAGE_BASE_URL && process.env.MEDIA_IMAGE_API_KEY && process.env.MEDIA_IMAGE_MODEL);
    return ok ? 'READY' : 'BLOCKED';
  }
  if (type === 'animation') {
    return process.env.MANIM_DOCKER_IMAGE ? 'READY' : 'BLOCKED';
  }
  if (type === 'tts') {
    const ok = !!(process.env.MEDIA_TTS_BASE_URL && process.env.MEDIA_TTS_API_KEY && process.env.MEDIA_TTS_MODEL);
    return ok ? 'READY' : 'BLOCKED';
  }
  if (type === 'video') {
    const tts = !!(process.env.MEDIA_TTS_BASE_URL && process.env.MEDIA_TTS_API_KEY && process.env.MEDIA_TTS_MODEL);
    return (tts && process.env.VIDEO_DOCKER_IMAGE) ? 'READY' : 'BLOCKED';
  }
  if (type === 'flashcards' || type === 'diagram') {
    return 'READY';
  }
  return 'BLOCKED';
}

function providerName(type) {
  if (type === 'image') return `openai-compatible:${process.env.MEDIA_IMAGE_MODEL}`;
  if (type === 'animation') return `manim-docker:${process.env.MANIM_DOCKER_IMAGE || 'none'}`;
  if (type === 'video') return `video-pipeline:${process.env.VIDEO_DOCKER_IMAGE || 'none'}`;
  if (type === 'tts') return `tts:${process.env.MEDIA_TTS_MODEL || 'none'}`;
  return 'none';
}

/* ------------------------------- الحصص ---------------------------------- */
function estimateUnits(type, params) {
  if (type === 'tts') return Math.min(String(params.text || '').length, 10000);
  if (type === 'video' || type === 'animation') return Math.max(1, Number(params.seconds) || 5);
  return 1;
}

function enforceQuota(db, ownerId, type, units) {
  const q = QUOTAS[type];
  const row = db.prepare('SELECT units FROM media_usage WHERE owner_id = ? AND day = ? AND type = ?')
    .get(ownerId, utcDay(), type);
  const used = row ? row.units : 0;
  if (used + units > q.daily) {
    throw new MediaError(429, 'MEDIA_QUOTA_EXCEEDED',
      `تجاوزت الحصة اليومية لنوع ${type} (${used}/${q.daily}). تُصفَّر الحصة منتصف الليل UTC.`);
  }
}

function chargeQuota(db, ownerId, type, units) {
  db.prepare(`INSERT INTO media_usage (owner_id, day, type, units) VALUES (?,?,?,?)
              ON CONFLICT(owner_id, day, type) DO UPDATE SET units = units + excluded.units`)
    .run(ownerId, utcDay(), type, units);
}

/* ------------------------------ سجل التدقيق ------------------------------ */
function recordEvent(db, jobId, ownerId, event, meta = {}) {
  db.prepare('INSERT INTO media_events (job_id, owner_id, event, meta_json, created_at) VALUES (?,?,?,?,?)')
    .run(jobId, ownerId, event, JSON.stringify(meta), now());
}

/* --------------------------- إدارة حالة المهام ---------------------------- */
function transition(db, job, next, extra = {}) {
  const allowed = TRANSITIONS[job.state] || [];
  if (!allowed.includes(next)) {
    throw new MediaError(409, 'MEDIA_STATE_INVALID', `انتقال غير مسموح: ${job.state} → ${next}`);
  }
  const t = now();
  db.prepare(`UPDATE media_jobs SET state = ?, updated_at = ?,
              started_at  = CASE WHEN ? = 'RUNNING' THEN ? ELSE started_at END,
              finished_at = CASE WHEN ? IN ('READY','FAILED','CANCELLED') THEN ? ELSE finished_at END
              WHERE id = ? AND owner_id = ?`)
    .run(next, t, next, t, next, t, job.id, job.owner_id);
  recordEvent(db, job.id, job.owner_id, next, extra);
}

/* ------------------------------- الواجهة -------------------------------- */
export function createJob(db, { ownerId, projectId = null, type, prompt, params = {}, idempotencyKey = null }) {
  if (!JOB_TYPES.includes(type)) throw new MediaError(400, 'MEDIA_TYPE_INVALID', `نوع غير مدعوم: ${type}`);
  if (!prompt || typeof prompt !== 'string' || prompt.length > 4000) {
    throw new MediaError(400, 'MEDIA_PROMPT_INVALID', 'النص مطلوب وبحد أقصى 4000 حرف.');
  }
  if (providerStatus(type) === 'BLOCKED') {
    throw new MediaError(503, 'MEDIA_PROVIDER_BLOCKED',
      `مزوّد ${type} غير مهيأ بعد. اضبط متغيرات البيئة الموثقة في دليل الدمج ثم أعد المحاولة.`);
  }

  // Idempotency: نفس المفتاح يعيد نفس المهمة — لا تكرار ولا خصم مزدوج
  if (idempotencyKey) {
    const existing = db.prepare('SELECT * FROM media_jobs WHERE idempotency_key = ?').get(String(idempotencyKey));
    if (existing) return existing;
  }

  const units = QUOTAS[type].unitCost * estimateUnits(type, params);
  enforceQuota(db, ownerId, type, units);

  const id = crypto.randomUUID();
  const t = now();
  db.prepare(`INSERT INTO media_jobs
              (id, owner_id, project_id, type, state, prompt, params_json, provider, idempotency_key, cost_units, created_at, updated_at)
              VALUES (?,?,?,?, 'QUEUED', ?,?,?,?,?,?,?)`)
    .run(id, ownerId, projectId, type, prompt, JSON.stringify(params), providerName(type),
         idempotencyKey ? String(idempotencyKey) : null, units, t, t);
  recordEvent(db, id, ownerId, 'QUEUED', { prompt_len: prompt.length });
  chargeQuota(db, ownerId, type, units);
  return getJob(db, ownerId, id);
}

export function getJob(db, ownerId, id) {
  const job = db.prepare('SELECT * FROM media_jobs WHERE id = ? AND owner_id = ?').get(id, ownerId);
  if (!job) throw new MediaError(404, 'MEDIA_NOT_FOUND', 'المهمة غير موجودة.');
  return job;
}

export function listJobs(db, ownerId, { limit = 30, offset = 0 } = {}) {
  return db.prepare('SELECT * FROM media_jobs WHERE owner_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(ownerId, Math.min(limit, 100), Math.max(offset, 0));
}

export function cancelJob(db, ownerId, id) {
  const job = getJob(db, ownerId, id);
  transition(db, job, 'CANCELLED');
  return getJob(db, ownerId, id);
}

export function retryJob(db, ownerId, id) {
  const job = getJob(db, ownerId, id);
  if (job.state !== 'FAILED') throw new MediaError(409, 'MEDIA_STATE_INVALID', 'يمكن إعادة المحاولة فقط للمهام الفاشلة.');
  enforceQuota(db, ownerId, job.type, Math.max(1, job.cost_units));
  transition(db, job, 'QUEUED', { retry: true });
  chargeQuota(db, ownerId, job.type, Math.max(1, job.cost_units));
  return getJob(db, ownerId, id);
}

/* ------------------------- تنفيذ توليد الصورة ---------------------------- */
export async function processImageJob(db, jobId) {
  const job = db.prepare('SELECT * FROM media_jobs WHERE id = ?').get(jobId);
  if (!job || job.state !== 'QUEUED') return;

  transition(db, job, 'RUNNING');
  try {
    const params = JSON.parse(job.params_json || '{}');
    const res = await fetch(`${process.env.MEDIA_IMAGE_BASE_URL}/images/generations`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.MEDIA_IMAGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.MEDIA_IMAGE_MODEL,
        prompt: job.prompt,
        size: params.size || '1024x1024',
        response_format: 'b64_json',
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new MediaError(502, 'MEDIA_PROVIDER_ERROR', `استجابة المزوّد: HTTP ${res.status}`);

    const data = await res.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) throw new MediaError(502, 'MEDIA_PROVIDER_EMPTY', 'المزوّد لم يُرجع صورة.');

    const buf = Buffer.from(b64, 'base64');
    const { ext, mime } = sniffImage(buf); // تحقق فعلي من الصيغة — لا نثق بادعاء المزوّد

    const dir = path.join(MEDIA_ROOT, job.owner_id);
    fs.mkdirSync(dir, { recursive: true });
    const rel = path.join(job.owner_id, `${job.id}.${ext}`);
    fs.writeFileSync(path.join(MEDIA_ROOT, rel), buf);

    const t = now();
    db.prepare(`UPDATE media_jobs SET state='READY', artifact_path=?, artifact_mime=?, artifact_bytes=?,
                updated_at=?, finished_at=? WHERE id=? AND owner_id=?`)
      .run(rel, mime, buf.length, t, t, job.id, job.owner_id);
    recordEvent(db, job.id, job.owner_id, 'READY', { bytes: buf.length, mime });
  } catch (err) {
    const code = err instanceof MediaError ? err.code : 'MEDIA_INTERNAL_ERROR';
    const msg = err instanceof Error ? err.message.slice(0, 300) : 'خطأ غير معروف';
    const t = now();
    db.prepare(`UPDATE media_jobs SET state='FAILED', error_code=?, error_summary=?, updated_at=?, finished_at=?
                WHERE id=? AND owner_id=?`)
      .run(code, msg, t, t, job.id, job.owner_id);
    recordEvent(db, job.id, job.owner_id, 'FAILED', { code, msg });
  }
}

/** تحقق بايتي فعلي من صيغة الصورة (PNG/JPEG/WebP) */
function sniffImage(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', mime: 'image/png' };
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8) return { ext: 'jpg', mime: 'image/jpeg' };
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', mime: 'image/webp' };
  throw new MediaError(502, 'MEDIA_ARTIFACT_INVALID', 'الملف المستلم ليس صورة صالحة.');
}

/** قراءة آمنة للأثر — تمنع الخروج من مخزن الوسائط (Path Traversal) */
export function resolveArtifactPath(db, ownerId, id) {
  const job = getJob(db, ownerId, id);
  if (job.state !== 'READY' || !job.artifact_path) {
    throw new MediaError(404, 'MEDIA_ARTIFACT_NOT_READY', 'لا يوجد أثر جاهز لهذه المهمة.');
  }
  const abs = path.resolve(MEDIA_ROOT, job.artifact_path);
  if (!abs.startsWith(path.resolve(MEDIA_ROOT) + path.sep)) {
    throw new MediaError(403, 'MEDIA_PATH_FORBIDDEN', 'مسار غير مسموح.');
  }
  return { abs, mime: job.artifact_mime || 'application/octet-stream' };
}

/* ------------------ دوال دورة حياة المهام (الرسوم والفيديو) ------------------- */
export function beginJob(db, jobId) {
  const job = db.prepare('SELECT * FROM media_jobs WHERE id = ?').get(jobId);
  if (!job || job.state !== 'QUEUED') return false;
  transition(db, job, 'RUNNING');
  return true;
}

export function completeJobArtifact(db, jobId, { relPath, mime, bytes }) {
  const job = db.prepare('SELECT * FROM media_jobs WHERE id = ?').get(jobId);
  if (!job) return;
  const t = now();
  db.prepare(`UPDATE media_jobs SET state='READY', artifact_path=?, artifact_mime=?, artifact_bytes=?,
              updated_at=?, finished_at=? WHERE id=? AND owner_id=?`)
    .run(relPath, mime, bytes, t, t, job.id, job.owner_id);
  recordEvent(db, job.id, job.owner_id, 'READY', { bytes, mime });
}

export function failJobError(db, jobId, err) {
  const job = db.prepare('SELECT * FROM media_jobs WHERE id = ?').get(jobId);
  if (!job) return;
  const code = err instanceof MediaError ? err.code : 'MEDIA_INTERNAL_ERROR';
  const msg = err instanceof Error ? err.message.slice(0, 300) : 'خطأ غير معروف';
  const t = now();
  db.prepare(`UPDATE media_jobs SET state='FAILED', error_code=?, error_summary=?, updated_at=?, finished_at=?
              WHERE id=? AND owner_id=?`)
    .run(code, msg, t, t, job.id, job.owner_id);
  recordEvent(db, job.id, job.owner_id, 'FAILED', { code, msg });
}

export function createDraftJob(db, { ownerId, projectId = null, type, prompt, params = {}, idempotencyKey = null }) {
  if (!JOB_TYPES.includes(type)) throw new MediaError(400, 'MEDIA_TYPE_INVALID', `نوع غير مدعوم: ${type}`);
  if (!prompt || typeof prompt !== 'string' || prompt.length > 4000) {
    throw new MediaError(400, 'MEDIA_PROMPT_INVALID', 'النص مطلوب وبحد أقصى 4000 حرف.');
  }
  if (providerStatus(type) === 'BLOCKED') {
    throw new MediaError(503, 'MEDIA_PROVIDER_BLOCKED',
      `مزوّد ${type} غير مهيأ بعد. اضبط متغيرات البيئة الموثقة في دليل الدمج ثم أعد المحاولة.`);
  }

  if (idempotencyKey) {
    const existing = db.prepare('SELECT * FROM media_jobs WHERE idempotency_key = ?').get(String(idempotencyKey));
    if (existing) return existing;
  }

  const units = QUOTAS[type].unitCost * estimateUnits(type, params);
  enforceQuota(db, ownerId, type, units);

  const id = crypto.randomUUID();
  const t = now();
  db.prepare(`INSERT INTO media_jobs
              (id, owner_id, project_id, type, state, prompt, params_json, provider, idempotency_key, cost_units, created_at, updated_at)
              VALUES (?,?,?,?, 'DRAFT', ?,?,?,?,?,?,?)`)
    .run(id, ownerId, projectId, type, prompt, JSON.stringify(params), providerName(type),
         idempotencyKey ? String(idempotencyKey) : null, units, t, t);
  recordEvent(db, id, ownerId, 'DRAFT', { prompt_len: prompt.length });
  return getJob(db, ownerId, id);
}

export function confirmDraftJob(db, ownerId, jobId) {
  const job = getJob(db, ownerId, jobId);
  if (job.state !== 'DRAFT') {
    throw new MediaError(409, 'MEDIA_STATE_INVALID', 'يمكن تأكيد المسودات فقط.');
  }
  if (providerStatus(job.type) === 'BLOCKED') {
    throw new MediaError(503, 'MEDIA_PROVIDER_BLOCKED',
      `مزوّد ${job.type} غير مهيأ بعد. اضبط متغيرات البيئة الموثقة في دليل الدمج ثم أعد المحاولة.`);
  }
  enforceQuota(db, ownerId, job.type, job.cost_units);
  transition(db, job, 'QUEUED');
  chargeQuota(db, ownerId, job.type, job.cost_units);
  return getJob(db, ownerId, jobId);
}

export function chargeUnits(db, ownerId, type, units) {
  if (!QUOTAS[type]) throw new MediaError(400, 'MEDIA_TYPE_INVALID', `نوع غير مدعوم: ${type}`);
  const u = Math.max(0, Number(units) || 0);
  if (u === 0) return;
  enforceQuota(db, ownerId, type, u);
  chargeQuota(db, ownerId, type, u);
}
