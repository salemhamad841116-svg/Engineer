/**
 * محرك الرسوم المتحركة — تنفيذ Manim داخل حاوية Docker معزولة.
 *
 * نموذج الأمان (طبقات):
 * 1) الحاوية هي الحد الأمني الحقيقي: --network none + --memory + --cpus + --read-only + --pids-limit.
 * 2) قائمة الأنماط المحظورة خط دفاع أولي فقط — ليست بديلاً عن العزل.
 * 3) التحقق من الناتج عبر FFprobe داخل الحاوية نفسها — لا نثق بنجاح الأمر وحده.
 * 4) كود المشهد يُعامل كمحتوى غير موثوق (قد يكون مولّداً بالذكاء الاصطناعي).
 *
 * لا يوجد SQL لجداول الوسائط هنا — كل الوصول عبر دوال mediaService المُصدَّرة.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createJob, beginJob, completeJobArtifact, failJobError, MediaError } from '../media/mediaService.js';

const execFileP = promisify(execFile);

const WORK_ROOT = process.env.ANIM_WORK_DIR || path.join(process.cwd(), 'data', 'anim_work');
const MEDIA_ROOT = process.env.MEDIA_STORAGE_DIR || path.join(process.cwd(), 'data', 'media');
const TIMEOUT_MS = Number(process.env.ANIM_TIMEOUT_MS) || 180_000; // 3 دقائق
const MAX_SCENE_BYTES = 20_000;
const MAX_SECONDS = 60;

/* أنماط محظورة — دفاع أولي؛ الحاوية المعزولة هي الحد الفعلي */
const BLOCKED_PATTERNS = [
  /import\s+os\b/, /import\s+sys\b/, /import\s+socket/, /import\s+subprocess/,
  /import\s+shutil/, /import\s+ctypes/, /import\s+urllib/, /import\s+requests/,
  /__import__/, /\beval\s*\(/, /\bexec\s*\(/, /\bopen\s*\(/, /while\s+True\s*:/,
];

export async function createAnimationJob(db, {
  ownerId, projectId = null, description, sceneCode, sceneClass,
  format = 'mp4', seconds = 10, idempotencyKey = null,
}) {
  /* التحقق من المدخلات */
  if (!description || typeof description !== 'string' || description.length > 500) {
    throw new MediaError(400, 'ANIM_DESC_INVALID', 'وصف الرسم مطلوب (حتى 500 حرف).');
  }
  if (!sceneCode || Buffer.byteLength(sceneCode, 'utf8') > MAX_SCENE_BYTES) {
    throw new MediaError(400, 'ANIM_CODE_TOO_LARGE', `كود المشهد يتجاوز ${MAX_SCENE_BYTES} بايت.`);
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(sceneClass || '')) {
    throw new MediaError(400, 'ANIM_CLASS_INVALID', 'اسم صنف المشهد غير صالح.');
  }
  if (!sceneCode.includes(`class ${sceneClass}`)) {
    throw new MediaError(400, 'ANIM_CLASS_MISSING', `كود المشهد لا يحتوي الصنف ${sceneClass}.`);
  }
  if (!['mp4', 'gif'].includes(format)) {
    throw new MediaError(400, 'ANIM_FORMAT_INVALID', 'الصيغ المدعومة: mp4 أو gif.');
  }
  const secs = Math.min(Math.max(1, Number(seconds) || 10), MAX_SECONDS);

  for (const pat of BLOCKED_PATTERNS) {
    if (pat.test(sceneCode)) {
      throw new MediaError(400, 'ANIM_CODE_REJECTED', `كود المشهد يحتوي نمطاً محظوراً: ${pat.source}`);
    }
  }

  /* إنشاء المهمة عبر محرك الوسائط (حصة: ثانية = وحدة) */
  const job = createJob(db, {
    ownerId, projectId,
    type: 'animation',
    prompt: description,
    params: { seconds: secs, format, scene_class: sceneClass },
    idempotencyKey,
  });

  /* Idempotency أعاد مهمة سابقة — لا نعيد التنفيذ */
  if (job.state !== 'QUEUED') return job;

  /* حفظ كود المشهد في مجلد عمل خاص بالمهمة */
  const workdir = path.join(WORK_ROOT, job.id);
  fs.mkdirSync(workdir, { recursive: true });
  fs.writeFileSync(path.join(workdir, 'scene.py'), sceneCode, 'utf8');

  void processAnimationJob(db, job.id, ownerId, sceneClass, format);
  return job;
}

async function processAnimationJob(db, jobId, ownerId, sceneClass, format) {
  const workdir = path.join(WORK_ROOT, jobId);
  const containerName = `anim-${jobId}`;

  try {
    if (!beginJob(db, jobId)) return;

    /* أمر الحاوية: عزل كامل، تنفيذ، ثم تحقق FFprobe، ثم نسخ الأثر إلى /work */
    const script = [
      'set -e',
      `manim render -ql --format ${format} --media_dir /work/out /work/scene.py ${sceneClass}`,
      `OUT=$(find /work/out -type f \\( -name '*.mp4' -o -name '*.gif' \\) | head -n 1)`,
      'test -n "$OUT"',
      'ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames,duration -of json "$OUT" > /work/probe.json',
      `cp "$OUT" /work/artifact.${format}`,
    ].join(' && ');

    await execFileP('docker', [
      'run', '--rm', '--name', containerName,
      '--network', 'none',            // لا شبكة إطلاقاً
      '--memory', '1g', '--cpus', '1',
      '--pids-limit', '128',
      '--read-only',                  // نظام ملفات الحاوية للقراءة فقط
      '--tmpfs', '/tmp:rw,noexec,nosuid,size=256m',
      '-v', `${workdir}:/work`,       // نقطة التواصل الوحيدة
      '-w', '/work',
      process.env.MANIM_DOCKER_IMAGE,
      'sh', '-lc', script,
    ], { timeout: TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 });

    /* التحقق الفعلي من الإطارات والمدة */
    const probe = JSON.parse(fs.readFileSync(path.join(workdir, 'probe.json'), 'utf8'));
    const frames = Number(probe?.streams?.[0]?.nb_read_frames ?? 0);
    const duration = Number(probe?.streams?.[0]?.duration ?? 0);
    if (frames < 1 || duration <= 0 || duration > 300) {
      throw new MediaError(502, 'ANIM_VERIFY_FAILED', `فشل التحقق: frames=${frames} duration=${duration}`);
    }

    /* نقل الأثر إلى مخزن الوسائط بنفس نمط الصور (ownerId معروف من إنشاء المهمة — لا SQL إضافي) */
    const ownerDir = path.join(MEDIA_ROOT, ownerId);
    fs.mkdirSync(ownerDir, { recursive: true });
    const rel = path.join(ownerId, `${jobId}.${format}`);
    fs.copyFileSync(path.join(workdir, `artifact.${format}`), path.join(MEDIA_ROOT, rel));
    const bytes = fs.statSync(path.join(MEDIA_ROOT, rel)).size;

    completeJobArtifact(db, jobId, {
      relPath: rel,
      mime: format === 'gif' ? 'image/gif' : 'video/mp4',
      bytes,
    });
  } catch (err) {
    /* إيقاف الحاوية عند المهلة — أفضل جهد */
    void execFileP('docker', ['rm', '-f', containerName]).catch(() => {});
    failJobError(db, jobId, err);
  } finally {
    fs.rmSync(workdir, { recursive: true, force: true }); // تنظيف مجلد العمل دائماً
  }
}
