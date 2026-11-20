"""
Sandboxed emulation via Unicorn Engine (Phase 2).

Purpose: run small isolated code regions to dynamically decrypt obfuscated
strings/data (XOR loops, RC4-ish transforms, etc.) without executing anything
on the host. Hard limits on instruction count, memory and time are mandatory —
emulated code is untrusted input.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from unicorn import (
    Uc, UcError,
    UC_ARCH_X86, UC_ARCH_ARM, UC_ARCH_ARM64,
    UC_MODE_64, UC_MODE_32, UC_MODE_ARM, UC_MODE_THUMB, UC_MODE_LITTLE_ENDIAN,
    UC_HOOK_CODE,
)
from unicorn.x86_const import UC_X86_REG_RSP

from .normalize import Arch


DEFAULT_MAX_INSTRUCTIONS = 100_000
DEFAULT_TIMEOUT_MS = 5_000
STACK_SIZE = 0x10000


@dataclass
class EmulationResult:
    ok: bool
    error: str | None
    memory: dict[str, str] = field(default_factory=dict)   # region name -> hex bytes after run
    instructions_executed: int = 0


class Emulator:
    """One-shot sandboxed emulator. Every run is a fresh Uc instance."""

    def __init__(self, arch: Arch, max_instructions: int = DEFAULT_MAX_INSTRUCTIONS):
        self.arch = arch
        self.max_instructions = max_instructions

    def _make_uc(self) -> Uc:
        if self.arch == Arch.X86_64:
            uc = Uc(UC_ARCH_X86, UC_MODE_64)
        elif self.arch == Arch.X86:
            uc = Uc(UC_ARCH_X86, UC_MODE_32)
        elif self.arch == Arch.ARM:
            uc = Uc(UC_ARCH_ARM, UC_MODE_ARM | UC_MODE_LITTLE_ENDIAN)
        elif self.arch == Arch.THUMB:
            uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_LITTLE_ENDIAN)
        elif self.arch == Arch.ARM64:
            uc = Uc(UC_ARCH_ARM64, UC_MODE_LITTLE_ENDIAN)
        else:
            raise ValueError(f"no unicorn engine for {self.arch}")
        return uc

    def run(self, code: bytes, base: int,
            data_regions: dict[str, tuple[int, bytes]] | None = None,
            registers: dict[str, int] | None = None,
            end: int | None = None) -> EmulationResult:
        """Emulate `code` placed at `base`.

        data_regions: {name: (vaddr, initial_bytes)} — mapped RW, returned after run.
        registers: {unicorn_const_name: value} — e.g. {"UC_X86_REG_RDI": 0x2000}.
        end: stop address (defaults to base + len(code)). NEVER let emulation
        fall off into unmapped memory — treat that as a failed run.
        """
        uc = self._make_uc()
        counter = {"n": 0}

        try:
            uc.mem_map(base & ~0xFFF, 0x1000 * (1 + (len(code) // 0x1000)))
            uc.mem_write(base, code)

            for name, (vaddr, blob) in (data_regions or {}).items():
                size = max(0x1000, 0x1000 * (1 + (len(blob) // 0x1000)))
                uc.mem_map(vaddr & ~0xFFF, size)
                uc.mem_write(vaddr, blob)

            # Stack for archs whose code may push/pop.
            stack_base = 0x7FFF_0000
            uc.mem_map(stack_base, STACK_SIZE)
            if self.arch == Arch.X86_64:
                uc.reg_write(UC_X86_REG_RSP, stack_base + STACK_SIZE - 8)

            if registers:
                import unicorn.x86_const as xc
                import unicorn.arm_const as ac
                import unicorn.arm64_const as a64c
                ns = {**vars(xc), **vars(ac), **vars(a64c)}
                for reg_name, value in registers.items():
                    const = ns.get(reg_name)
                    if const is None:
                        return EmulationResult(ok=False, error=f"unknown register: {reg_name}")
                    uc.reg_write(const, value)

            def _count(uc_, address, size, user):
                counter["n"] += 1
                if counter["n"] >= self.max_instructions:
                    uc_.emu_stop()

            uc.hook_add(UC_HOOK_CODE, _count)
            stop = end if end is not None else base + len(code)
            uc.emu_start(base, stop, timeout=DEFAULT_TIMEOUT_MS)

            result = EmulationResult(ok=True, error=None, instructions_executed=counter["n"])
            for name, (vaddr, blob) in (data_regions or {}).items():
                result.memory[name] = bytes(uc.mem_read(vaddr, len(blob))).hex()
            return result
        except UcError as exc:
            return EmulationResult(ok=False, error=str(exc), instructions_executed=counter["n"])
        finally:
            # Uc has no explicit close; dropping the reference frees the engine.
            pass
