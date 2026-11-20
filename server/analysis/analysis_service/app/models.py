"""Pydantic schemas for the analysis API (request/response contracts)."""
from __future__ import annotations

from pydantic import BaseModel


class SectionOut(BaseModel):
    name: str
    vaddr: int
    size: int
    is_executable: bool


class FunctionOut(BaseModel):
    address: int
    name: str
    size: int
    xrefs_to: list[int]
    xrefs_from: list[int]


class CryptoFindingOut(BaseModel):
    algorithm: str
    section: str
    vaddr: int
    score: float
    note: str


class AnalyzeResponse(BaseModel):
    job_id: str
    status: str                     # VERIFIED | FAILED
    fmt: str
    arch: str
    entrypoint: int
    image_base: int
    sections: list[SectionOut]
    functions: list[FunctionOut]
    crypto_findings: list[CryptoFindingOut]
    instruction_count: int


class InstructionOut(BaseModel):
    address: int
    size: int
    mnemonic: str
    op_str: str
    raw: str


class DisasmResponse(BaseModel):
    job_id: str
    start: int
    count: int
    instructions: list[InstructionOut]


class ErrorResponse(BaseModel):
    status: str = "FAILED"
    detail: str


# ---------- Phase 2 schemas ----------

class DecompileResponse(BaseModel):
    job_id: str
    ok: bool
    address: int
    c_code: str | None
    error: str | None


class CfgBlockOut(BaseModel):
    start: int
    end: int
    instruction_count: int
    preview: str                     # first mnemonics, for node labels


class CfgEdgeOut(BaseModel):
    src: int
    dst: int
    kind: str                        # jump | true | false | call | next


class CfgResponse(BaseModel):
    job_id: str
    scope_start: int | None
    scope_end: int | None
    blocks: list[CfgBlockOut]
    edges: list[CfgEdgeOut]


class IRRequest(BaseModel):
    arch: str                        # arm | thumb | arm64 | x86 | x86_64
    vaddr: int
    code_hex: str
    max_instructions: int = 200


class IROpOut(BaseModel):
    opcode: str
    inputs: list[str]
    output: str | None


class IRInstructionOut(BaseModel):
    address: int
    ops: list[IROpOut]


class IRResponse(BaseModel):
    instructions: list[IRInstructionOut]


class EmulateRegion(BaseModel):
    vaddr: int
    data_hex: str


class EmulateRequest(BaseModel):
    arch: str
    base: int
    code_hex: str
    data_regions: dict[str, EmulateRegion] = {}
    registers: dict[str, int] = {}
    end: int | None = None
    max_instructions: int = 100_000


class EmulateResponse(BaseModel):
    ok: bool
    error: str | None
    memory: dict[str, str]
    instructions_executed: int
