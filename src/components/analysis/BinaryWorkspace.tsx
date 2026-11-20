/**
 * BinaryWorkspace — synchronized tri-pane view (C pseudocode / Assembly / Hex).
 *
 * Phase 2 & 3:
 * - The C pane is live: selecting a function decompiles it via /api/analysis/decompile.
 * - Synchronization contract: every selectable row maps to a canonical address.
 * - Assembly content is lazy-loaded in pages via /api/analysis/disasm.
 * - AI Assistant button calls /api/analysis/explain for automated function reversing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalyzeResponse, InstructionOut } from '../../types/analysis';
import { decompileFunction, fetchDisasmPage } from '../../api/analysis/analysisClient';
import { explainFunction } from '../../api/analysis/assistantClient';

const PAGE = 200;
const HEX_BYTES_PER_ROW = 16;

interface Props {
  analysis: AnalyzeResponse;
  /** Optional override; by default the button calls the platform's AI assistant route. */
  onAskAi?: (fn: { address: number; name: string }, cCode: string | null) => void;
}

export function BinaryWorkspace({ analysis, onAskAi }: Props) {
  const [insns, setInsns] = useState<InstructionOut[]>([]);
  const [selected, setSelected] = useState<number | null>(analysis.entrypoint);
  const [cCode, setCCode] = useState<string>('// اختر دالة لعرض كود C…');
  const [cStatus, setCStatus] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const loadedRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    fetchDisasmPage(analysis.job_id, 0, PAGE).then((page) => {
      if (cancelled) return;
      setInsns(page.instructions);
      loadedRef.current = page.count;
    }).catch(() => {
      // ignore disasm load failure on init
    });
    return () => { cancelled = true; };
  }, [analysis.job_id]);

  const loadMore = useCallback(() => {
    if (loadedRef.current >= analysis.instruction_count) return;
    fetchDisasmPage(analysis.job_id, loadedRef.current, PAGE).then((page) => {
      setInsns((prev) => [...prev, ...page.instructions]);
      loadedRef.current += page.count;
    }).catch(() => {
      // ignore pagination load error
    });
  }, [analysis.job_id, analysis.instruction_count]);

  // Decompile the function containing the selected address.
  const decompileAt = useCallback((address: number) => {
    // Owning function = the one with the greatest start ≤ address.
    let owner: { address: number } | null = null;
    for (const f of analysis.functions) {
      if (f.address <= address && (owner === null || f.address > owner.address)) {
        owner = f;
      }
    }
    const target = owner ? owner.address : address;
    setCStatus('loading');
    decompileFunction(analysis.job_id, target)
      .then((r) => {
        if (r.ok && r.c_code) {
          setCCode(r.c_code);
          setCStatus('ready');
        } else {
          setCCode(`// تعذّر فك الترجمة: ${r.error ?? 'unknown'}`);
          setCStatus('failed');
        }
      })
      .catch((e) => {
        setCCode(`// خطأ في الاتصال بخدمة الفك: ${e instanceof Error ? e.message : String(e)}`);
        setCStatus('failed');
      });
  }, [analysis.job_id, analysis.functions]);

  useEffect(() => {
    if (selected !== null) decompileAt(selected);
  }, [selected, decompileAt]);

  const hexText = useMemo(() => {
    const rows: string[] = [];
    for (const i of insns) {
      for (let off = 0; off < i.raw.length; off += HEX_BYTES_PER_ROW * 2) {
        const chunk = i.raw.slice(off, off + HEX_BYTES_PER_ROW * 2);
        const bytes = chunk.match(/.{1,2}/g) ?? [];
        rows.push(`${(i.address + off / 2).toString(16).padStart(8, '0')}  ${bytes.join(' ')}`);
      }
    }
    return rows.join('\n');
  }, [insns]);

  return (
    <div className="binary-workspace" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
      <section aria-label="c-pseudocode">
        <header>C {cStatus === 'loading' ? '(جارٍ الفك…)' : cStatus === 'ready' ? '✓' : ''}</header>
        <pre dir="ltr">{cCode}</pre>
      </section>

      <section aria-label="assembly">
        <header>
          Assembly ({insns.length}/{analysis.instruction_count})
          <button onClick={loadMore}>تحميل المزيد</button>
        </header>
        <pre dir="ltr">
          {insns.map((i) => (
            <div key={i.address} data-addr={i.address}
                 onClick={() => setSelected(i.address)}
                 style={{ background: i.address === selected ? '#2d4a67' : undefined, cursor: 'pointer' }}>
              {i.address.toString(16).padStart(8, '0')}  {i.mnemonic.padEnd(10)} {i.op_str}
            </div>
          ))}
        </pre>
      </section>

      <section aria-label="hex-view">
        <header>Hex</header>
        <pre dir="ltr">{hexText}</pre>
      </section>

      <footer style={{ gridColumn: '1 / -1' }}>
        <button
          disabled={cStatus !== 'ready' || aiLoading}
          onClick={() => {
            const fn = analysis.functions.find((f) => f.address === selected)
              ?? analysis.functions[0];
            if (!fn) return;
            if (onAskAi) {
              onAskAi({ address: fn.address, name: fn.name }, cCode);
              return;
            }
            // Default: call the platform's AI assistant route (Phase 3).
            setAiLoading(true);
            setAiResult(null);
            explainFunction(analysis.job_id, fn.address, 'ar')
              .then((r) => setAiResult(
                r.status === 'VERIFIED' && r.explanation
                  ? `${r.explanation.summary}\n\n${r.explanation.behavior.map((b) => `• ${b}`).join('\n')}\n\n` +
                    `أسماء مقترحة: ${r.explanation.suggested_names.map((n) => `${n.old} ← ${n.new}`).join('، ')}`
                  : `تعذّر التحليل: ${r.error ?? 'خطأ غير معروف'}`,
              ))
              .catch((e) => setAiResult(`خطأ في الاتصال: ${e instanceof Error ? e.message : String(e)}`))
              .finally(() => setAiLoading(false));
          }}
        >
          {aiLoading ? 'المساعد الذكي يحلل…' : 'المساعد الذكي: اشرح هذه الدالة واقترح أسماء للمتغيرات'}
        </button>
        {aiResult && (
          <div style={{ marginTop: 8, padding: 12, background: '#1e293b', borderRadius: 6, whiteSpace: 'pre-wrap' }}>
            {aiResult}
          </div>
        )}
      </footer>
    </div>
  );
}
