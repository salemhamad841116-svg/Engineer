"""
Basic-block Control Flow Graph builder.

Splits a linear instruction stream into basic blocks:
- A block ends at a terminator (branch/jump/call/return).
- A new block starts at every branch target and every fall-through after a
  conditional branch.
Edges are typed: 'jump' (unconditional), 'true'/'false' (conditional split),
'call', 'return' (no outgoing edge).
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .disasm import Instruction
from .normalize import Arch, normalize_address


_BRANCH = {
    Arch.X86_64: {"jmp", "je", "jne", "jz", "jnz", "ja", "jb", "jae", "jbe", "jg", "jl", "jge", "jle", "call"},
    Arch.X86: {"jmp", "je", "jne", "jz", "jnz", "ja", "jb", "jae", "jbe", "jg", "jl", "jge", "jle", "call"},
    Arch.ARM: {"b", "bl", "blx", "beq", "bne", "bx"},
    Arch.THUMB: {"b", "bl", "blx", "beq", "bne", "bx", "cbz", "cbnz"},
    Arch.ARM64: {"b", "bl", "blx", "cbz", "cbnz", "b.eq", "b.ne", "b.hs", "b.lo", "ret"},
}
_RET = {
    Arch.X86_64: {"ret"}, Arch.X86: {"ret"},
    Arch.ARM: {"bx"}, Arch.THUMB: {"bx"}, Arch.ARM64: {"ret"},
}
_CALL = {
    Arch.X86_64: {"call"}, Arch.X86: {"call"},
    Arch.ARM: {"bl", "blx"}, Arch.THUMB: {"bl", "blx"}, Arch.ARM64: {"bl", "blx"},
}
_UNCOND = {
    Arch.X86_64: {"jmp"}, Arch.X86: {"jmp"},
    Arch.ARM: {"b", "bx"}, Arch.THUMB: {"b", "bx"}, Arch.ARM64: {"b"},
}


@dataclass
class BasicBlock:
    start: int
    end: int                       # address of last instruction
    instructions: list[Instruction] = field(default_factory=list)


@dataclass
class CfgEdge:
    src: int
    dst: int
    kind: str                      # jump | true | false | call


@dataclass
class Cfg:
    blocks: list[BasicBlock]
    edges: list[CfgEdge]


def _parse_target(op_str: str) -> int | None:
    token = op_str.split(",")[0].strip().lstrip("#")
    try:
        return int(token, 16)
    except ValueError:
        return None


def build_cfg(instructions: list[Instruction], arch: Arch,
              scope_start: int | None = None, scope_end: int | None = None) -> Cfg:
    """Build a CFG from instructions within [scope_start, scope_end)."""
    insns = [i for i in instructions
             if (scope_start is None or i.address >= scope_start)
             and (scope_end is None or i.address < scope_end)]
    if not insns:
        return Cfg(blocks=[], edges=[])

    branch = _BRANCH.get(arch, set())
    ret = _RET.get(arch, set())
    call = _CALL.get(arch, set())
    uncond = _UNCOND.get(arch, set())
    in_scope = {i.address for i in insns}

    # 1) Find block leaders
    leaders: set[int] = {insns[0].address}
    for idx, insn in enumerate(insns):
        mnem = insn.mnemonic.lower()
        if mnem in branch or mnem in ret:
            target = _parse_target(insn.op_str) if mnem in branch else None
            if target is not None:
                t = normalize_address(target, arch)
                if t in in_scope:
                    leaders.add(t)
            if idx + 1 < len(insns):
                leaders.add(insns[idx + 1].address)   # fall-through leader

    # 2) Split into blocks
    blocks: list[BasicBlock] = []
    current: BasicBlock | None = None
    for insn in insns:
        if insn.address in leaders or current is None:
            current = BasicBlock(start=insn.address, end=insn.address)
            blocks.append(current)
        current.instructions.append(insn)
        current.end = insn.address

    # 3) Edges
    edges: list[CfgEdge] = []
    block_by_start = {b.start: b for b in blocks}
    ordered = list(blocks)
    for bi, block in enumerate(ordered):
        last = block.instructions[-1]
        mnem = last.mnemonic.lower()
        fall_through = ordered[bi + 1].start if bi + 1 < len(ordered) else None
        if mnem in ret:
            continue
        target = _parse_target(last.op_str) if mnem in branch else None
        target_in = target is not None and normalize_address(target, arch) in block_by_start
        if mnem in call:
            if target_in:
                edges.append(CfgEdge(src=block.start, dst=normalize_address(target, arch), kind="call"))
            if fall_through is not None:
                edges.append(CfgEdge(src=block.start, dst=fall_through, kind="next"))
        elif mnem in uncond:
            if target_in:
                edges.append(CfgEdge(src=block.start, dst=normalize_address(target, arch), kind="jump"))
        elif mnem in branch:
            if target_in:
                edges.append(CfgEdge(src=block.start, dst=normalize_address(target, arch), kind="true"))
            if fall_through is not None:
                edges.append(CfgEdge(src=block.start, dst=fall_through, kind="false"))
        elif fall_through is not None:
            edges.append(CfgEdge(src=block.start, dst=fall_through, kind="next"))
    return Cfg(blocks=blocks, edges=edges)
