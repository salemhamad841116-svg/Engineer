"""
Capstone-based disassembly engine.

Supports ARM / Thumb / Thumb-2 / ARM64 / x86 / x64. For ARM ELF binaries the
sweep is guided by mapping symbols ($a/$t/$d): data regions (literal pools)
are skipped as code so the decode never drifts into constants.
"""
from __future__ import annotations

from dataclasses import dataclass

from capstone import (
    Cs, CsInsn,
    CS_ARCH_ARM, CS_ARCH_ARM64, CS_ARCH_X86,
    CS_MODE_ARM, CS_MODE_THUMB, CS_MODE_64, CS_MODE_32, CS_MODE_LITTLE_ENDIAN,
)

from .normalize import Arch, normalize_address
from .loader import BinaryInfo, MappingRegion


@dataclass
class Instruction:
    address: int          # canonical (normalized) address
    size: int
    mnemonic: str
    op_str: str
    raw: str              # hex bytes, for the Hex View sync


def _make_engine(arch: Arch) -> Cs:
    if arch == Arch.ARM:
        return Cs(CS_ARCH_ARM, CS_MODE_ARM | CS_MODE_LITTLE_ENDIAN)
    if arch == Arch.THUMB:
        return Cs(CS_ARCH_ARM, CS_MODE_THUMB | CS_MODE_LITTLE_ENDIAN)
    if arch == Arch.ARM64:
        return Cs(CS_ARCH_ARM64, CS_MODE_LITTLE_ENDIAN)
    if arch == Arch.X86_64:
        return Cs(CS_ARCH_X86, CS_MODE_64)
    if arch == Arch.X86:
        return Cs(CS_ARCH_X86, CS_MODE_32)
    raise ValueError(f"no capstone engine for {arch}")


class Disassembler:
    def __init__(self, info: BinaryInfo):
        self.info = info
        self._engines: dict[Arch, Cs] = {}

    def _engine(self, arch: Arch) -> Cs:
        if arch not in self._engines:
            eng = _make_engine(arch)
            eng.detail = False
            self._engines[arch] = eng
        return self._engines[arch]

    def disasm_block(self, code: bytes, vaddr: int, arch: Arch | None = None,
                     max_instructions: int = 10_000) -> list[Instruction]:
        """Disassemble a raw block at a virtual address."""
        arch = arch or self.info.arch
        # ARM ELF files may mix ARM/Thumb; the caller picks the mode per region.
        engine_arch = arch
        out: list[Instruction] = []
        for insn in self._engine(engine_arch).disasm(code, vaddr, count=max_instructions):
            out.append(Instruction(
                address=normalize_address(insn.address, arch),
                size=insn.size,
                mnemonic=insn.mnemonic,
                op_str=insn.op_str,
                raw=insn.bytes.hex(),
            ))
            if len(out) >= max_instructions:
                break
        return out

    def disasm_code_bytes(self, code: bytes, section_vaddr: int) -> list[Instruction]:
        """Disassemble a full executable section.

        If ARM mapping regions exist, sweep each region with its own engine
        (ARM vs Thumb) and skip 'data' regions entirely (literal-pool isolation).
        Otherwise linear-sweep with the binary's base architecture.
        """
        if self.info.mapping_regions and self.info.arch in (Arch.ARM, Arch.ARM64):
            return self._sweep_with_mapping(code, section_vaddr)
        return self.disasm_block(code, section_vaddr)

    def _sweep_with_mapping(self, code: bytes, section_vaddr: int) -> list[Instruction]:
        regions = self._regions_overlapping(section_vaddr, len(code))
        out: list[Instruction] = []
        for start, end, kind in regions:
            off = start - section_vaddr
            chunk = code[off:off + (end - start)]
            if kind == "data":
                continue  # literal pool / data: never decoded as instructions
            arch = Arch.ARM if kind == "arm" else Arch.THUMB
            out.extend(self.disasm_block(chunk, start, arch=arch))
        out.sort(key=lambda i: i.address)
        return out

    def _regions_overlapping(self, vaddr: int, size: int) -> list[tuple[int, int, str]]:
        """Clip mapping regions to [vaddr, vaddr+size) and close the last region."""
        sec_end = vaddr + size
        regs = [r for r in self.info.mapping_regions if vaddr <= r.start < sec_end]
        if not regs:
            return []
        out: list[tuple[int, int, str]] = []
        for i, r in enumerate(regs):
            end = regs[i + 1].start if i + 1 < len(regs) else sec_end
            out.append((max(r.start, vaddr), min(end, sec_end), r.kind))
        return out


def branch_targets(insns: list[Instruction], arch: Arch) -> dict[int, list[int]]:
    """Extract intra-function branch targets for xref/call graph building.

    Returns {source_address: [target_address, ...]}. Targets are normalized so
    ARM/Thumb dual references (0x1000 vs 0x1001) converge to one entity.
    """
    branch_mnemonics = {
        Arch.ARM64: {"b", "bl", "blx", "cbz", "cbnz", "b.eq", "b.ne", "b.hs", "b.lo"},
        Arch.ARM: {"b", "bl", "blx", "beq", "bne", "bx"},
        Arch.THUMB: {"b", "bl", "blx", "beq", "bne", "bx", "cbz", "cbnz"},
        Arch.X86_64: {"call", "jmp", "je", "jne", "jz", "jnz", "ja", "jb", "jae", "jbe"},
        Arch.X86: {"call", "jmp", "je", "jne", "jz", "jnz", "ja", "jb", "jae", "jbe"},
    }
    wanted = branch_mnemonics.get(arch, set())
    result: dict[int, list[int]] = {}
    for insn in insns:
        if insn.mnemonic.lower() not in wanted:
            continue
        token = insn.op_str.split(",")[0].strip().lstrip("#")
        try:
            target = int(token, 16)
        except ValueError:
            continue  # register-indirect branch (e.g. bx lr) — no static target
        result.setdefault(insn.address, []).append(normalize_address(target, arch))
    return result
