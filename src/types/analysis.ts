/** Shared TypeScript contracts — mirror of analysis_service/app/models.py */

export interface SectionOut {
  name: string;
  vaddr: number;
  size: number;
  is_executable: boolean;
}

export interface FunctionOut {
  address: number;
  name: string;
  size: number;
  xrefs_to: number[];
  xrefs_from: number[];
}

export interface CryptoFindingOut {
  algorithm: string;
  section: string;
  vaddr: number;
  score: number;
  note: string;
}

export interface AnalyzeResponse {
  job_id: string;
  status: "VERIFIED" | "FAILED";
  fmt: "ELF" | "PE" | "MACHO" | string;
  arch: "arm" | "thumb" | "arm64" | "x86" | "x86_64" | string;
  entrypoint: number;
  image_base: number;
  sections: SectionOut[];
  functions: FunctionOut[];
  crypto_findings: CryptoFindingOut[];
  instruction_count: number;
}

export interface InstructionOut {
  address: number;
  size: number;
  mnemonic: string;
  op_str: string;
  raw: string;
}

export interface DisasmResponse {
  job_id: string;
  start: number;
  count: number;
  instructions: InstructionOut[];
}

// ---------- Phase 2 contracts ----------

export interface DecompileResponse {
  job_id: string;
  ok: boolean;
  address: number;
  c_code: string | null;
  error: string | null;
}

export interface CfgBlockOut {
  start: number;
  end: number;
  instruction_count: number;
  preview: string;
}

export interface CfgEdgeOut {
  src: number;
  dst: number;
  kind: "jump" | "true" | "false" | "call" | "next";
}

export interface CfgResponse {
  job_id: string;
  scope_start: number | null;
  scope_end: number | null;
  blocks: CfgBlockOut[];
  edges: CfgEdgeOut[];
}

export interface IROpOut {
  opcode: string;
  inputs: string[];
  output: string | null;
}

export interface IRInstructionOut {
  address: number;
  ops: IROpOut[];
}

export interface EmulateResponse {
  ok: boolean;
  error: string | null;
  memory: Record<string, string>;
  instructions_executed: number;
}
