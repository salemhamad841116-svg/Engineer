"""
IR lifting via pypcode — Ghidra's SLEIGH/p-code engine as a Python library.

Lifts machine code (x86/x64/ARM/Thumb/ARM64) to p-code operations. Each source
instruction is delimited by an IMARK op; ops between two IMARKs belong to the
same instruction.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import pypcode

from .normalize import Arch


# SLEIGH language IDs for the architectures we support.
_LANGUAGES = {
    Arch.X86_64: "x86:LE:64:default",
    Arch.X86: "x86:LE:32:default",
    Arch.ARM: "ARM:LE:32:v7",
    Arch.THUMB: "ARM:LE:32:v7",   # Thumb decoding selected via TMode context reg
    Arch.ARM64: "AARCH64:LE:64:v8A",
}


@dataclass
class PcodeOp:
    opcode: str
    inputs: list[str]
    output: str | None


@dataclass
class LiftedInstruction:
    address: int
    ops: list[PcodeOp]


def _fmt_varnode(v) -> str:
    return f"{v.space.name}[{v.offset:#x}].{v.size}"


class IRLifter:
    def __init__(self, arch: Arch):
        self.arch = arch
        self._ctx = pypcode.Context(_LANGUAGES[arch])
        if arch == Arch.THUMB:
            # SLEIGH: TMode context register selects Thumb decoding.
            self._ctx.setVariableDefault("TMode", 1)

    def lift(self, code: bytes, vaddr: int, max_instructions: int = 500) -> list[LiftedInstruction]:
        """Lift a code block to p-code, grouped per source instruction."""
        tx = self._ctx.translate(code, vaddr, max_instructions=max_instructions)
        out: list[LiftedInstruction] = []
        current: LiftedInstruction | None = None
        for op in tx.ops:
            if op.opcode.name == "IMARK":
                if current is not None:
                    out.append(current)
                current = LiftedInstruction(address=int(op.inputs[0].offset), ops=[])
                continue
            if current is None:
                continue
            current.ops.append(PcodeOp(
                opcode=op.opcode.name,
                inputs=[_fmt_varnode(i) for i in op.inputs],
                output=_fmt_varnode(op.output) if op.output else None,
            ))
        if current is not None:
            out.append(current)
        return out
