/**
 * محرك الفيديو — خطة مشاهد → سرد عربي TTS (على الخادم) → تركيب معزول → تحقق → تسليم.
 *
 * التدفق (دستور §20):
 *   createVideoJob  → DRAFT + تقدير تكلفة (لا خصم، لا تشغيل)
 *   confirmVideoJob → موافقة المستخدم → خصم الحصص (ثواني فيديو + أحرف TTS) → QUEUED → تشغيل
 *
 * الفصل الأمني: TTS يتم على الخادم (شبكة مسموحة)، والتركيب داخل حاوية بلا شبكة.
 * لا يوجد SQL لجداول الوسائط هنا — كل الوصول عبر دوال mediaService المُصدَّرة.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  createDraftJob, confirmDraftJob, chargeUnits,
  beginJob, completeJobArtifact, failJobError, getJob, MediaError,
} from '../media/mediaService.js';

const execFileP = promisify(execFile);

const WORK_ROOT = process.env.VIDEO_WORK_DIR || path.join(process.cwd(), 'data', 'video_work');
const MEDIA_ROOT = process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'data', 'media');
const TIMEOUT_MS = Number(process.env.VIDEO_TIMEOUT_MS) || 600_000; // 10 دقائق

const MAX_SCENES = 10;
const MAX_NARRATION_TOTAL = 3000;  // حرف — ضمن حصة TTS اليومية (5000)

/* ------------------------------ التحقق من الخطة ------------------------------ */
function validatePlan(plan) {
  if (!plan || !Array.isArray(plan.scenes) || plan.scenes.length < 1 || plan.scenes.length > MAX_SCENES) {
    throw new MediaError(400, 'VIDEO_PLAN_INVALID', `الخطة تتطلب 1–${MAX_SCENES} مشاهد.`);
  }
  let narrationChars = 0;
  for (const [i, sc] of plan.scenes.entries()) {
    if (!sc || typeof sc !== 'object') throw new MediaError(400, 'VIDEO_PLAN_INVALID', `المشهد ${i} غير صالح.`);
    if (!sc.narration || typeof sc.narration !== 'string' || sc.narration.trim().length === 0) {
      throw new MediaError(400, 'VIDEO_NARRATION_REQUIRED', `المشهد ${i + 1}: نص السرد مطلوب.`);
    }
    if ((sc.title || '').length > 80 || (sc.body || '').length > 300 || sc.narration.length > 500 || (sc.citation || '').length > 200) {
      throw new MediaError(400, 'VIDEO_SCENE_TOO_LONG', `المشهد ${i + 1}: يتجاوز الحدود (عنوان 80 / نص 300 / سرد 500 / مصدر 200).`);
    }
    narrationChars += sc.narration.length;
  }
  if (narrationChars > MAX_NARRATION_TOTAL) {
    throw new MediaError(400, 'VIDEO_NARRATION_TOO_LONG', `إجمالي السرد ${narrationChars} حرف يتجاوز ${MAX_NARRATION_TOTAL}.`);
  }
  return narrationChars;
}

const estimateSeconds = (plan) => Math.min(plan.scenes.length * 8, 90); // تقدير محافظ

/* ------------------------------ الإنشاء والتأكيد ------------------------------ */
export function createVideoJob(db, { ownerId, projectId = null, plan, title = null, idempotencyKey = null }) {
  const narrationChars = validatePlan(plan);
  const seconds = estimateSeconds(plan);

  const job = createDraftJob(db, {
    ownerId, projectId,
    type: 'video',
    prompt: (title || plan.scenes[0].title || 'فيديو تعليمي').slice(0, 200),
    params: { seconds, scenes: plan.scenes.length },
    idempotencyKey,
  });
  if (job.state !== 'DRAFT') return { job, estimate: null }; // Idempotency أعاد مهمة سابقة

  const workdir = path.join(WORK_ROOT, job.id);
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, 'plan.json'), JSON.stringify({ scenes: plan.scenes }), 'utf8');

  return { job, estimate: { seconds, tts_chars: narrationChars, scenes: plan.scenes.length } };
}

export async function confirmVideoJob(db, ownerId, jobId) {
  const job = confirmDraftJob(db, ownerId, jobId);          // يخصم ثواني الفيديو
  const plan = JSON.parse(fs.readFileSync(path.join(WORK_ROOT, jobId, 'plan.json'), 'utf8'));
  const narrationChars = plan.scenes.reduce((n, sc) => n + sc.narration.length, 0);
  chargeUnits(db, ownerId, 'tts', narrationChars);          // ويخصم أحرف السرد
  void processVideoJob(db, job.id, ownerId, plan);
  return job;
}

/* -------------------------------- التنفيذ -------------------------------- */
async function synthesizeNarration(text) {
  const res = await fetch(`${process.env.MEDIA_TTS_BASE_URL}/audio/speech`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.MEDIA_TTS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: process.env.MEDIA_TTS_MODEL,
      voice: process.env.MEDIA_TTS_VOICE || 'alloy',
      input: text,
      response_format: 'mp3',
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new MediaError(502, 'TTS_PROVIDER_ERROR', `استجابة مزوّد الصوت: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new MediaError(502, 'TTS_EMPTY', 'مزوّد الصوت أعاد مقطعاً فارغاً.');
  return buf;
}

async function processVideoJob(db, jobId, ownerId, plan) {
  const workdir = path.join(WORK_ROOT, jobId);
  const containerName = `video-${jobId}`;

  try {
    if (!beginJob(db, jobId)) return;

    /* 1) السرد الصوتي على الخادم (الحاوية بلا شبكة) */
    for (const [i, sc] of plan.scenes.entries()) {
      const audio = await synthesizeNarration(sc.narration);
      fs.writeFileSync(path.join(workdir, `audio_${i}.mp3`), audio);
    }

    /* 2) التركيب داخل الحاوية المعزولة + تحقق FFprobe داخلي */
    await execFileP('docker', [
      'run', '--rm', '--name', containerName,
      '--network', 'none',
      '--memory', '2g', '--cpus', '2',
      '--pids-limit', '128',
      '--read-only',
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=512m',
      '-v', `${workdir}:/work`,
      '-w', '/work',
      process.env.VIDEO_DOCKER_IMAGE,
      'sh', '-lc', 'python3 /opt/compose_video.py /work/plan.json /work/artifact.mp4 /work/probe.json',
    ], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });

    /* 3) تحقق مضاعف على الخادم — لا نثق بمخرجات الحاوية وحدها */
    const probe = JSON.parse(fs.readFileSync(path.join(workdir, 'probe.json'), 'utf8'));
    if (!probe.has_audio || probe.frames < 1 || probe.duration <= 0 || probe.duration > 600) {
      throw new MediaError(502, 'VIDEO_VERIFY_FAILED', JSON.stringify(probe));
    }

    /* 4) نقل الأثر إلى مخزن الوسائط */
    const ownerDir = path.join(MEDIA_ROOT, ownerId);
    fs.mkdirSync(ownerDir, { recursive: true });
    const rel = path.join(ownerId, `${jobId}.mp4`);
    fs.copyFileSync(path.join(workdir, 'artifact.mp4'), path.join(MEDIA_ROOT, rel));
    const bytes = fs.statSync(path.join(MEDIA_ROOT, rel)).size;

    completeJobArtifact(db, jobId, { relPath: rel, mime: 'video/mp4', bytes });
  } catch (err) {
    void execFileP('docker', ['rm', '-f', containerName]).catch(() => {});
    failJobError(db, jobId, err);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

/** عرض الحالة يمر عبر getJob في محرك الوسائط — مُصدَّر هنا للمسارات */
export function getVideoJob(db, ownerId, jobId) {
  const job = getJob(db, ownerId, jobId);
  if (job.type !== 'video') throw new MediaError(404, 'VIDEO_NOT_FOUND', 'مهمة الفيديو غير موجودة.');
  return job;
}
