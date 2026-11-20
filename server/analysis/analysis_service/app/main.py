"""
Binary Analysis Service — FastAPI entrypoint.

Endpoints:
  POST /analyze        upload a binary, run the full pipeline, get a job_id
  GET  /jobs/{job_id}  fetch the stored analysis summary
  GET  /disasm         lazy-load instructions (job_id, start, count)
  GET  /health         liveness probe

Security notes (per platform constitution):
- File size is capped (MAX_UPLOAD_MB) — enforced before parsing.
- This service is meant to run as an internal worker behind the Node.js
  gateway, which owns authentication, tenant isolation, and quotas.
  Do NOT expose it directly to the internet.
"""
from __future__ import annotations

import os
import uuid

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse

from .crypto_scan import scan_binary
from .cfg import build_cfg
from .decompile import decompile_function
from .disasm import Disassembler, branch_targets, Instruction
from .emulate import Emulator
from .functions import FunctionManager
from .ir import IRLifter
from .loader import load_binary, read_section_bytes
from .models import (
    AnalyzeResponse, CfgBlockOut, CfgEdgeOut, CfgResponse, CryptoFindingOut,
    DecompileResponse, DisasmResponse, EmulateRequest, EmulateResponse,
    FunctionOut, IRInstructionOut, IROpOut, IRRequest, IRResponse,
    InstructionOut, SectionOut,
)
from .normalize import Arch, normalize_address

MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "50"))
MAX_DISASM_INSTRUCTIONS = int(os.environ.get("MAX_DISASM_INSTRUCTIONS", "20000"))

app = FastAPI(title="Engineer Binary Analysis Service", version="0.1.0")

# In-memory job store — replace with Redis/Postgres for multi-worker production.
_JOBS: dict[str, dict] = {}


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"file exceeds {MAX_UPLOAD_MB}MB limit")
    if not data:
        raise HTTPException(status_code=400, detail="empty file")

    try:
        binary, info = load_binary(data, name=file.filename or "sample.bin")
    except Exception as exc:
        return JSONResponse(status_code=422,
                            content={"status": "FAILED", "detail": f"parse error: {exc}"})

    # 1) Function registry from symbols (deduped, normalized addresses)
    fn_mgr = FunctionManager(info.arch)
    for sym in info.symbols:
        fn_mgr.add_symbol(sym)
    fn_mgr.add(info.entrypoint, name="entrypoint")

    # 2) Disassemble executable sections (mapping-symbol aware on ARM)
    dis = Disassembler(info)
    instructions: list[Instruction] = []
    section_blobs: list[tuple[str, int, bytes]] = []
    for sec in info.sections:
        blob = read_section_bytes(binary, sec)
        if sec.is_data:
            section_blobs.append((sec.name, sec.vaddr, blob))
        if not sec.is_executable or not blob:
            continue
        instructions.extend(dis.disasm_code_bytes(blob, sec.vaddr))
        if len(instructions) >= MAX_DISASM_INSTRUCTIONS:
            instructions = instructions[:MAX_DISASM_INSTRUCTIONS]
            break

    # 3) Xrefs / call edges -> single-entity linking
    for src, targets in branch_targets(instructions, info.arch).items():
        for dst in targets:
            fn_mgr.link_xref(src, dst)

    # 4) Crypto constant scan over data sections
    findings = scan_binary(section_blobs)

    job_id = uuid.uuid4().hex[:12]
    _JOBS[job_id] = {
        "info": info,
        "functions": fn_mgr.all(),
        "instructions": instructions,
        "findings": findings,
        "raw": data,                     # kept for on-demand decompilation
        "filename": file.filename or "sample.bin",
    }

    return AnalyzeResponse(
        job_id=job_id,
        status="VERIFIED",
        fmt=info.fmt,
        arch=info.arch.value,
        entrypoint=info.entrypoint,
        image_base=info.image_base,
        sections=[SectionOut(name=s.name, vaddr=s.vaddr, size=s.size,
                             is_executable=s.is_executable) for s in info.sections],
        functions=[FunctionOut(address=f.address, name=f.name, size=f.size,
                               xrefs_to=f.xrefs_to, xrefs_from=f.xrefs_from)
                   for f in fn_mgr.all()],
        crypto_findings=[CryptoFindingOut(**vars(f)) for f in findings],
        instruction_count=len(instructions),
    )


@app.get("/disasm", response_model=DisasmResponse)
def get_disasm(job_id: str,
               start: int = Query(0, ge=0),
               count: int = Query(200, ge=1, le=2000)):
    """Lazy-loading endpoint: the UI pages through instructions instead of
    pulling the whole listing at once."""
    job = _JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job_id")
    insns: list[Instruction] = job["instructions"]
    window = insns[start:start + count]
    return DisasmResponse(
        job_id=job_id,
        start=start,
        count=len(window),
        instructions=[InstructionOut(address=i.address, size=i.size,
                                     mnemonic=i.mnemonic, op_str=i.op_str,
                                     raw=i.raw) for i in window],
    )


@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = _JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job_id")
    info = job["info"]
    return {
        "job_id": job_id,
        "fmt": info.fmt,
        "arch": info.arch.value,
        "entrypoint": info.entrypoint,
        "function_count": len(job["functions"]),
        "instruction_count": len(job["instructions"]),
        "crypto_findings": [vars(f) for f in job["findings"]],
    }


# ---------- Phase 2 endpoints ----------

@app.post("/decompile", response_model=DecompileResponse)
def decompile(job_id: str = Query(...), address: int = Query(...)):
    """C pseudocode for one function (angr; swap-in Ghidra headless later)."""
    job = _JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job_id")
    info = job["info"]
    # angr needs a real file path — materialize the uploaded bytes to a temp file
    import tempfile
    suffix = ".elf" if info.fmt == "ELF" else (".exe" if info.fmt == "PE" else ".bin")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=True) as tmp:
        tmp.write(job["raw"])
        tmp.flush()
        result = decompile_function(tmp.name, address, info.arch)
    return DecompileResponse(job_id=job_id, ok=result.ok, address=result.address,
                             c_code=result.c_code, error=result.error)


@app.get("/cfg", response_model=CfgResponse)
def cfg(job_id: str = Query(...),
        start: int | None = Query(None),
        end: int | None = Query(None)):
    """Basic-block CFG over the stored instruction stream (or a scope of it)."""
    job = _JOBS.get(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="unknown job_id")
    graph = build_cfg(job["instructions"], job["info"].arch,
                      scope_start=start, scope_end=end)
    return CfgResponse(
        job_id=job_id,
        scope_start=start,
        scope_end=end,
        blocks=[CfgBlockOut(start=b.start, end=b.end,
                            instruction_count=len(b.instructions),
                            preview=" ; ".join(f"{i.mnemonic} {i.op_str}".strip()
                                               for i in b.instructions[:3]))
                for b in graph.blocks],
        edges=[CfgEdgeOut(src=e.src, dst=e.dst, kind=e.kind) for e in graph.edges],
    )


@app.post("/ir", response_model=IRResponse)
def lift_ir(req: IRRequest):
    """Lift raw bytes to Ghidra p-code (SLEIGH engine via pypcode)."""
    try:
        arch = Arch(req.arch)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"unknown arch: {req.arch}")
    try:
        code = bytes.fromhex(req.code_hex)
    except ValueError:
        raise HTTPException(status_code=400, detail="code_hex is not valid hex")
    lifter = IRLifter(arch)
    lifted = lifter.lift(code, req.vaddr, max_instructions=req.max_instructions)
    return IRResponse(instructions=[
        IRInstructionOut(address=li.address,
                         ops=[IROpOut(opcode=o.opcode, inputs=o.inputs, output=o.output)
                              for o in li.ops])
        for li in lifted
    ])


@app.post("/emulate", response_model=EmulateResponse)
def emulate(req: EmulateRequest):
    """Sandboxed emulation of an isolated code region (dynamic decryption)."""
    try:
        arch = Arch(req.arch)
        code = bytes.fromhex(req.code_hex)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"bad request: {exc}")
    regions = {name: (r.vaddr, bytes.fromhex(r.data_hex))
               for name, r in req.data_regions.items()}
    emu = Emulator(arch, max_instructions=req.max_instructions)
    result = emu.run(code, req.base, data_regions=regions,
                     registers=req.registers, end=req.end)
    return EmulateResponse(ok=result.ok, error=result.error,
                           memory=result.memory,
                           instructions_executed=result.instructions_executed)
