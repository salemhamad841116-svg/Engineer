"""
C pseudocode via angr's decompiler (Phase 2).

angr ships a full structuring decompiler usable offline. In production you can
swap this adapter for the Ghidra headless engine behind the same function
signature — the API contract (address in, C text out) does not change.
"""
from __future__ import annotations

from dataclasses import dataclass

from .normalize import Arch, normalize_address


@dataclass
class DecompileResult:
    ok: bool
    address: int
    c_code: str | None
    error: str | None


def decompile_function(binary_path: str, address: int, arch: Arch,
                       timeout_note: str = "") -> DecompileResult:
    """Decompile one function to C-like pseudocode.

    Requires a file path (angr loads the whole binary for CFG context).
    Addresses are normalized before lookup so Thumb aliases resolve.
    """
    try:
        import angr  # local import: heavy dependency, loaded on demand
    except ImportError:
        return DecompileResult(ok=False, address=address, c_code=None,
                               error="angr is not installed on the analysis worker")

    canonical = normalize_address(address, arch)
    try:
        proj = angr.Project(binary_path, auto_load_libs=False)
        cfg = proj.analyses.CFGFast(normalize=True)

        # LIEF reports file-relative vaddrs; angr maps PIE binaries at its own
        # base (e.g. 0x400000). Try both addressing domains.
        mapped_base = int(proj.loader.main_object.mapped_base)
        candidates = [canonical, canonical + mapped_base]
        func = None
        for cand in candidates:
            func = proj.kb.functions.function(addr=cand)
            if func is not None:
                break
        if func is None:
            # CFGFast may register the function at a slightly different start;
            # fall back to the function whose range contains the address.
            for cand in candidates:
                floor = proj.kb.functions.floor_func(cand)
                if floor is not None and floor.addr <= cand < floor.addr + max(floor.size or 1, 1):
                    func = floor
                    break
        if func is None:
            return DecompileResult(ok=False, address=canonical, c_code=None,
                                   error=f"no function at {canonical:#x}")
        dec = proj.analyses.Decompiler(func, cfg=cfg.model)
        if dec.codegen is None or not dec.codegen.text:
            return DecompileResult(ok=False, address=canonical, c_code=None,
                                   error="decompiler produced no output")
        return DecompileResult(ok=True, address=canonical, c_code=dec.codegen.text, error=None)
    except Exception as exc:  # angr raises many custom exception types
        return DecompileResult(ok=False, address=canonical, c_code=None, error=str(exc))
