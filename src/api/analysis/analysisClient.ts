/**
 * Typed client for the binary-analysis gateway routes.
 */
import type {
  AnalyzeResponse,
  DisasmResponse,
  CfgResponse,
  DecompileResponse,
  EmulateResponse,
  IRInstructionOut,
} from '../../types/analysis';

const BASE = '/api/analysis';

export async function analyzeBinary(file: File): Promise<AnalyzeResponse> {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${BASE}/analyze`, { method: 'POST', body: form });
  if (!res.ok) throw new Error(`analysis failed: HTTP ${res.status}`);
  return (await res.json()) as AnalyzeResponse;
}

export async function fetchDisasmPage(
  jobId: string,
  start: number,
  count = 200,
): Promise<DisasmResponse> {
  const res = await fetch(
    `${BASE}/disasm?job_id=${encodeURIComponent(jobId)}&start=${start}&count=${count}`,
  );
  if (!res.ok) throw new Error(`disasm failed: ${res.status}`);
  return (await res.json()) as DisasmResponse;
}

export async function decompileFunction(jobId: string, address: number): Promise<DecompileResponse> {
  const res = await fetch(`${BASE}/decompile?job_id=${encodeURIComponent(jobId)}&address=${address}`,
    { method: 'POST' });
  if (!res.ok) throw new Error(`decompile failed: ${res.status}`);
  return (await res.json()) as DecompileResponse;
}

export async function fetchCfg(jobId: string, start?: number, end?: number): Promise<CfgResponse> {
  const params = new URLSearchParams({ job_id: jobId });
  if (start !== undefined) params.set('start', String(start));
  if (end !== undefined) params.set('end', String(end));
  const res = await fetch(`${BASE}/cfg?${params}`);
  if (!res.ok) throw new Error(`cfg failed: ${res.status}`);
  return (await res.json()) as CfgResponse;
}

export async function liftIr(arch: string, vaddr: number, codeHex: string): Promise<IRInstructionOut[]> {
  const res = await fetch(`${BASE}/ir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ arch, vaddr, code_hex: codeHex }),
  });
  if (!res.ok) throw new Error(`ir failed: ${res.status}`);
  return ((await res.json()) as { instructions: IRInstructionOut[] }).instructions;
}

export async function emulateCode(payload: {
  arch: string; base: number; code_hex: string;
  data_regions?: Record<string, { vaddr: number; data_hex: string }>;
  registers?: Record<string, number>;
  max_instructions?: number;
}): Promise<EmulateResponse> {
  const res = await fetch(`${BASE}/emulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`emulate failed: ${res.status}`);
  return (await res.json()) as EmulateResponse;
}
