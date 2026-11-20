/**
 * MediaStudio — واجهة استوديو الوسائط (React 19 + TypeScript strict + Tailwind v4).
 *
 * مبادئ ملزمة من الدستور:
 * - لا تُعرض الصورة إلا عندما state === 'READY' مع artifact_url حقيقي.
 * - المزوّد المحظور (BLOCKED) يُعرض كما هو — لا وعود وهمية.
 * - أثناء QUEUED/RUNNING يُعرض تقدّم صادق مع استطلاع دوري.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ImagePlus, Loader2, RefreshCw, XCircle, AlertTriangle, Ban } from 'lucide-react';

type JobState = 'DRAFT' | 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED' | 'CANCELLED' | 'EXPIRED';

interface MediaJob {
  id: string;
  type: string;
  state: JobState;
  prompt: string;
  provider: string | null;
  cost_units: number;
  error_code: string | null;
  error_summary: string | null;
  created_at: string;
  finished_at: string | null;
  artifact_url: string | null;
}

type Providers = Record<string, 'READY' | 'BLOCKED'>;

const STATE_LABEL: Record<JobState, string> = {
  DRAFT: 'مسودة',
  QUEUED: 'في الانتظار',
  RUNNING: 'قيد التوليد',
  READY: 'جاهز',
  FAILED: 'فشل',
  CANCELLED: 'ملغى',
  EXPIRED: 'منتهي',
};

export default function MediaStudio(): React.ReactElement {
  const [prompt, setPrompt] = useState<string>('');
  const [jobs, setJobs] = useState<MediaJob[]>([]);
  const [providers, setProviders] = useState<Providers>({});
  const [busy, setBusy] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const idemRef = useRef<string>(crypto.randomUUID());

  const refresh = useCallback(async (): Promise<void> => {
    const res = await fetch('/api/media/jobs', { credentials: 'include' });
    if (res.ok) setJobs((await res.json()) as MediaJob[]);
  }, []);

  useEffect(() => {
    void refresh();
    void (async () => {
      const res = await fetch('/api/media/providers', { credentials: 'include' });
      if (res.ok) setProviders((await res.json()) as Providers);
    })();
  }, [refresh]);

  // استطلاع كل 3 ثوانٍ ما دامت هناك مهام نشطة — يتوقف تلقائياً عند انتهائها
  useEffect(() => {
    const active = jobs.some((j) => j.state === 'QUEUED' || j.state === 'RUNNING');
    if (!active) return;
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [jobs, refresh]);

  const generate = async (): Promise<void> => {
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/media/jobs', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idemRef.current },
        body: JSON.stringify({ type: 'image', prompt: prompt.trim(), params: { size: '1024x1024' } }),
      });
      const body = (await res.json()) as MediaJob & { error?: { message: string } };
      if (!res.ok) {
        setError(body.error?.message ?? 'تعذّر إنشاء المهمة.');
        return;
      }
      idemRef.current = crypto.randomUUID(); // مفتاح جديد لكل طلب مقصود
      setPrompt('');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const retry = async (id: string): Promise<void> => {
    await fetch(`/api/media/jobs/${id}/retry`, { method: 'POST', credentials: 'include' });
    await refresh();
  };

  const cancel = async (id: string): Promise<void> => {
    await fetch(`/api/media/jobs/${id}/cancel`, { method: 'POST', credentials: 'include' });
    await refresh();
  };

  const imageBlocked = providers.image === 'BLOCKED';

  return (
    <div dir="rtl" className="mx-auto max-w-3xl p-6 text-slate-100">
      <h1 className="mb-4 text-xl font-bold">استوديو الوسائط</h1>

      {imageBlocked && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber-600/40 bg-amber-950/40 p-3 text-sm text-amber-300">
          <Ban className="h-4 w-4 shrink-0" />
          توليد الصور غير مهيأ بعد (BLOCKED) — اضبط متغيرات البيئة الموثقة في دليل الدمج.
        </div>
      )}

      <div className="mb-6 flex gap-2">
        <input
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="صف الصورة المطلوبة…"
          disabled={imageBlocked || busy}
          className="flex-1 rounded-lg border border-slate-700 bg-[#1e1e21] px-3 py-2 text-sm outline-none focus:border-[#246290] disabled:opacity-50"
        />
        <button
          onClick={() => void generate()}
          disabled={imageBlocked || busy || !prompt.trim()}
          className="flex items-center gap-2 rounded-lg bg-[#246290] px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-40"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          توليد
        </button>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-600/40 bg-red-950/40 p-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <ul className="space-y-3">
        {jobs.map((job) => (
          <li key={job.id} className="rounded-lg border border-slate-700 bg-[#1e1e21] p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate text-sm">{job.prompt}</span>
              <StateBadge state={job.state} />
            </div>

            {/* لا تُعرض الصورة أو الفيديو إلا بعد التحقق الفعلي (READY + artifact_url) */}
            {job.state === 'READY' && job.artifact_url && (
              isVideoOrAnim(job) ? (
                <video src={job.artifact_url} controls className="max-h-80 rounded-lg" />
              ) : (
                <img src={job.artifact_url} alt={job.prompt} className="max-h-80 rounded-lg" loading="lazy" />
              )
            )}

            {job.state === 'DRAFT' && (
              <button
                type="button"
                onClick={() => void fetch(`/api/video/jobs/${job.id}/confirm`, { method: 'POST', credentials: 'include' }).then(() => refresh())}
                className="mt-2 rounded-lg bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
              >
                تأكيد التكلفة والتشغيل ({job.cost_units} وحدة)
              </button>
            )}

            {(job.state === 'QUEUED' || job.state === 'RUNNING') && (
              <div className="flex items-center gap-2 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {STATE_LABEL[job.state]}…
              </div>
            )}

            {job.state === 'FAILED' && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm text-red-400">{job.error_summary ?? 'فشل غير معروف'}</span>
                <button onClick={() => void retry(job.id)} className="flex items-center gap-1 text-sm text-[#246290] hover:underline">
                  <RefreshCw className="h-3.5 w-3.5" /> إعادة المحاولة
                </button>
              </div>
            )}

            {(job.state === 'QUEUED' || job.state === 'RUNNING') && (
              <button onClick={() => void cancel(job.id)} className="mt-2 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300">
                <XCircle className="h-3.5 w-3.5" /> إلغاء
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function StateBadge({ state }: { state: JobState }): React.ReactElement {
  const color =
    state === 'READY' ? 'bg-emerald-900/60 text-emerald-300' :
    state === 'FAILED' ? 'bg-red-900/60 text-red-300' :
    state === 'QUEUED' || state === 'RUNNING' ? 'bg-sky-900/60 text-sky-300' :
    'bg-slate-800 text-slate-400';
  return <span className={`rounded-full px-2 py-0.5 text-xs ${color}`}>{STATE_LABEL[state]}</span>;
}

function isVideoOrAnim(job: MediaJob): boolean {
  if (job.type === 'animation' || job.type === 'video') return true;
  if (job.artifact_url) {
    const url = job.artifact_url.toLowerCase();
    if (url.endsWith('.mp4') || url.endsWith('.webm')) return true;
  }
  return false;
}

