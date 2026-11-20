/**
 * Client for the AI Assistant gateway route (Phase 3).
 */
const BASE = '/api/analysis';

export interface ExplainResult {
  status: 'VERIFIED' | 'FAILED';
  address: number;
  explanation: {
    summary: string;
    behavior: string[];
    suggested_names: Array<{ old: string; new: string }>;
    risk_notes: string[];
  } | null;
  raw_llm_content: string | null;
  error: string | null;
  model: string | null;
}

export async function explainFunction(
  jobId: string,
  address: number,
  lang: 'ar' | 'en' = 'ar',
): Promise<ExplainResult> {
  const res = await fetch(`${BASE}/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_id: jobId, address, lang }),
  });
  // 502 here means an honest upstream failure — still a structured result.
  const body = (await res.json()) as ExplainResult;
  return body;
}
