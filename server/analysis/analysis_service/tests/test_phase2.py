"""Phase 2 tests: IR lifting, decompilation, emulation, CFG."""
import subprocess

import pytest
from fastapi.testclient import TestClient

from app.cfg import build_cfg
from app.decompile import decompile_function
from app.disasm import Instruction
from app.emulate import Emulator
from app.ir import IRLifter
from app.main import app
from app.normalize import Arch


# ---------- IR lifting (pypcode / SLEIGH) ----------

def test_ir_lift_x86_64():
    lifter = IRLifter(Arch.X86_64)
    lifted = lifter.lift(bytes.fromhex("4889c3c3"), 0x1000)  # mov rbx,rax; ret
    assert len(lifted) == 2
    assert lifted[0].address == 0x1000
    assert any(op.opcode == "COPY" for op in lifted[0].ops)
    assert any(op.opcode == "RETURN" for op in lifted[1].ops)


def test_ir_lift_thumb():
    lifter = IRLifter(Arch.THUMB)
    lifted = lifter.lift(bytes.fromhex("00bf7047"), 0x2000)  # nop; bx lr
    assert len(lifted) == 2


# ---------- Decompilation (angr) ----------

@pytest.fixture(scope="module")
def branchy_elf(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("dec")
    src = tmp / "b.c"
    elf = tmp / "b.elf"
    src.write_text(
        "__attribute__((noinline)) int sign(int x){ if (x > 0) return 1; else if (x < 0) return -1; return 0; }\n"
        "int main(void){ return sign(-5); }\n"
    )
    subprocess.run(["gcc", "-O1", "-fno-inline", "-o", str(elf), str(src)], check=True)
    return str(elf)


def test_decompile_real_function(branchy_elf):
    import angr
    proj = angr.Project(branchy_elf, auto_load_libs=False)
    proj.analyses.CFGFast(normalize=True)
    sign = proj.kb.functions.function(name="sign")
    assert sign is not None, "fixture: sign() must exist in symtab"
    result = decompile_function(branchy_elf, int(sign.addr), Arch.X86_64)
    assert result.ok, result.error
    assert result.c_code is not None
    assert "return" in result.c_code
    assert "sign" in result.c_code


# ---------- Emulation (Unicorn) ----------

def test_emulate_xor_decryption():
    # mov cl,0x5A; loop: xor [rdi],cl; inc rdi; dec rsi; jnz loop
    code = bytes.fromhex("b15a300f48ffc748ffce75f6")
    cipher = bytes([0x33, 0x22, 0x11])
    emu = Emulator(Arch.X86_64)
    result = emu.run(
        code, base=0x1000,
        data_regions={"buf": (0x2000, cipher)},
        registers={"UC_X86_REG_RDI": 0x2000, "UC_X86_REG_RSI": len(cipher)},
    )
    assert result.ok, result.error
    got = bytes.fromhex(result.memory["buf"])
    assert got == bytes(b ^ 0x5A for b in cipher)
    assert result.instructions_executed > 0


def test_emulate_unmapped_access_fails_honestly():
    emu = Emulator(Arch.X86_64)
    # mov rax, [0xDEAD0000] — reads unmapped memory, must fail, never crash the service
    result = emu.run(bytes.fromhex("488b04250000adde"), base=0x1000)
    assert not result.ok
    assert result.error is not None


# ---------- CFG (basic blocks) ----------

def _i(addr, mnem, ops=""):
    return Instruction(address=addr, size=1, mnemonic=mnem, op_str=ops, raw="00")


def test_cfg_splits_on_conditional_branch():
    # main: 1000 mov; 1001 je 0x1003; 1002 (false path); 1003 ret
    insns = [_i(0x1000, "mov", "rax, rbx"), _i(0x1001, "je", "0x1003"),
             _i(0x1002, "xor", "rax, rax"), _i(0x1003, "ret")]
    graph = build_cfg(insns, Arch.X86_64)
    assert {b.start for b in graph.blocks} == {0x1000, 0x1002, 0x1003}
    kinds = {(e.src, e.dst, e.kind) for e in graph.edges}
    assert (0x1000, 0x1003, "true") in kinds      # taken branch
    assert (0x1000, 0x1002, "false") in kinds     # fall-through


def test_cfg_call_edge_and_next():
    insns = [_i(0x2000, "call", "0x3000"), _i(0x2001, "ret"), _i(0x3000, "ret")]
    graph = build_cfg(insns, Arch.X86_64)
    kinds = {(e.src, e.dst, e.kind) for e in graph.edges}
    assert (0x2000, 0x3000, "call") in kinds
    assert (0x2000, 0x2001, "next") in kinds


# ---------- API end-to-end ----------

def test_api_phase2_endpoints(tmp_path):
    src = tmp_path / "s.c"
    elf = tmp_path / "s.elf"
    src.write_text(
        "__attribute__((noinline)) int dbl(int x){ return x * 2; }\n"
        "int main(void){ return dbl(21); }\n"
    )
    subprocess.run(["gcc", "-O1", "-fno-inline", "-o", str(elf), str(src)], check=True)

    client = TestClient(app)
    resp = client.post("/analyze", files={"file": ("s.elf", elf.read_bytes())})
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    fn = next(f for f in resp.json()["functions"] if f["name"] == "dbl")

    dec = client.post("/decompile", params={"job_id": job_id, "address": fn["address"]})
    assert dec.status_code == 200
    body = dec.json()
    assert body["ok"], body["error"]
    assert "return" in body["c_code"]

    cfg = client.get("/cfg", params={"job_id": job_id})
    assert cfg.status_code == 200
    assert len(cfg.json()["blocks"]) >= 2

    ir = client.post("/ir", json={"arch": "x86_64", "vaddr": 4096, "code_hex": "4889c3c3"})
    assert ir.status_code == 200
    assert len(ir.json()["instructions"]) == 2
