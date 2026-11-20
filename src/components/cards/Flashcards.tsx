/**
 * Flashcards — واجهة بطاقات المراجعة (React 19 + TypeScript strict + Tailwind v4).
 *
 * - قائمة المجموعات مع عدّاد المستحق اليوم.
 * - وضع الدراسة: بطاقة قابلة للقلب، ثم تقييم SM-2 (أعد=1 / صعب=3 / جيد=4 / سهل=5).
 * - المصدر (source_ref) يُعرض دائماً مع الإجابة — الاقتباس جزء من المصداقية.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Layers, BookOpenCheck, RotateCcw, Trash2, Loader2 } from 'lucide-react';

interface Deck {
  id: string;
  title: string;
  source_ref: string | null;
  generated: number;
  card_count: number;
  due_count: number;
}

interface StudyCard {
  id: string;
  front: string;
  back: string;
  source_ref: string | null;
  repetitions: number | null;
}

const QUALITY = [
  { q: 1, label: 'أعد', cls: 'bg-red-800/70 hover:bg-red-700' },
  { q: 3, label: 'صعب', cls: 'bg-amber-800/70 hover:bg-amber-700' },
  { q: 4, label: 'جيد', cls: 'bg-sky-800/70 hover:bg-sky-700' },
  { q: 5, label: 'سهل', cls: 'bg-emerald-800/70 hover:bg-emerald-700' },
] as const;

export default function Flashcards(): React.ReactElement {
  const [decks, setDecks] = useState<Deck[]>([]);
  const [newTitle, setNewTitle] = useState<string>('');
  const [studyDeck, setStudyDeck] = useState<Deck | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refresh = useCallback(async (): Promise<void> => {
    const res = await fetch('/api/cards/decks', { credentials: 'include' });
    if (res.ok) setDecks((await res.json()) as Deck[]);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const createDeck = async (): Promise<void> => {
    if (!newTitle.trim()) return;
    await fetch('/api/cards/decks', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle.trim() }),
    });
    setNewTitle('');
    await refresh();
  };

  const removeDeck = async (id: string): Promise<void> => {
    await fetch(`/api/cards/decks/${id}`, { method: 'DELETE', credentials: 'include' });
    await refresh();
  };

  if (studyDeck) {
    return <StudySession deck={studyDeck} onExit={() => { setStudyDeck(null); void refresh(); }} />;
  }

  return (
    <div dir="rtl" className="mx-auto max-w-3xl p-6 text-slate-100">
      <h1 className="mb-4 flex items-center gap-2 text-xl font-bold">
        <Layers className="h-5 w-5 text-[#246290]" /> بطاقات المراجعة
      </h1>

      <div className="mb-6 flex gap-2">
        <input
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          placeholder="اسم مجموعة جديدة…"
          className="flex-1 rounded-lg border border-slate-700 bg-[#1e1e21] px-3 py-2 text-sm outline-none focus:border-[#246290]"
        />
        <button
          onClick={() => void createDeck()}
          disabled={!newTitle.trim()}
          className="flex items-center gap-2 rounded-lg bg-[#246290] px-4 py-2 text-sm font-semibold hover:opacity-90 disabled:opacity-40"
        >
          <Plus className="h-4 w-4" /> إنشاء
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : decks.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">
          لا توجد مجموعات بعد — أنشئ أول مجموعة للبدء.
        </p>
      ) : (
        <ul className="space-y-3">
          {decks.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-700 bg-[#1e1e21] p-4">
              <div className="min-w-0">
                <div className="truncate font-semibold">{d.title}</div>
                <div className="mt-1 text-xs text-slate-400">
                  {d.card_count} بطاقة · <span className="text-amber-400">{d.due_count} مستحقة اليوم</span>
                  {d.source_ref && <span className="text-slate-500"> · المصدر: {d.source_ref}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  onClick={() => setStudyDeck(d)}
                  disabled={d.card_count === 0}
                  className="flex items-center gap-1 rounded-lg bg-[#246290] px-3 py-1.5 text-sm hover:opacity-90 disabled:opacity-40"
                >
                  <BookOpenCheck className="h-4 w-4" /> ادرس
                </button>
                <button onClick={() => void removeDeck(d.id)} className="p-1.5 text-slate-500 hover:text-red-400" title="حذف المجموعة">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------ جلسة الدراسة ------------------------------ */
function StudySession({ deck, onExit }: { deck: Deck; onExit: () => void }): React.ReactElement {
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [index, setIndex] = useState<number>(0);
  const [flipped, setFlipped] = useState<boolean>(false);
  const [done, setDone] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch(`/api/cards/decks/${deck.id}/due?limit=20`, { credentials: 'include' });
      const list = (await res.json()) as StudyCard[];
      setCards(list);
      setDone(list.length === 0);
      setLoading(false);
    })();
  }, [deck.id]);

  const answer = async (quality: number): Promise<void> => {
    const card = cards[index];
    await fetch(`/api/cards/cards/${card.id}/review`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quality }),
    });
    setFlipped(false);
    if (index + 1 >= cards.length) setDone(true);
    else setIndex(index + 1);
  };

  const card = cards[index];

  return (
    <div dir="rtl" className="mx-auto max-w-2xl p-6 text-slate-100">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-bold">{deck.title}</h2>
        <button onClick={onExit} className="text-sm text-slate-400 hover:text-slate-200">خروج</button>
      </div>

      {loading ? (
        <div className="flex justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-slate-500" /></div>
      ) : done ? (
        <div className="rounded-lg border border-slate-700 bg-[#1e1e21] p-10 text-center">
          <BookOpenCheck className="mx-auto mb-3 h-10 w-10 text-emerald-400" />
          <p className="font-semibold">أنهيت المستحق اليوم — أحسنت.</p>
          <p className="mt-1 text-sm text-slate-400">عد غداً للمراجعة المجدولة (SM-2).</p>
          <button onClick={onExit} className="mt-4 rounded-lg bg-[#246290] px-4 py-2 text-sm">عودة للمجموعات</button>
        </div>
      ) : (
        <>
          <div className="mb-3 text-center text-xs text-slate-500">
            البطاقة {index + 1} من {cards.length}
          </div>

          <button
            onClick={() => setFlipped((f) => !f)}
            className="flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-xl border border-slate-700 bg-[#1e1e21] p-8 text-center transition hover:border-[#246290]"
          >
            <span className="text-lg leading-relaxed">{flipped ? card.back : card.front}</span>
            {flipped && card.source_ref && (
              <span className="text-xs text-slate-500">المصدر: {card.source_ref}</span>
            )}
            {!flipped && <span className="text-xs text-slate-600">اضغط لقلب البطاقة</span>}
          </button>

          {flipped ? (
            <div className="mt-4 grid grid-cols-4 gap-2">
              {QUALITY.map(({ q, label, cls }) => (
                <button key={q} onClick={() => void answer(q)} className={`rounded-lg px-2 py-2 text-sm font-semibold ${cls}`}>
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <div className="mt-4 flex justify-center">
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <RotateCcw className="h-3.5 w-3.5" /> قيّم استدعاءك بعد كشف الإجابة
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
