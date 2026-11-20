"""
Executable loading via LIEF: format detection, sections, symbols, entrypoint,
and ARM ELF mapping symbols ($a / $t / $d) that delimit ARM code, Thumb code,
and data (literal pools) regions.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import lief

from .normalize import Arch


@dataclass
class SectionInfo:
    name: str
    vaddr: int
    size: int
    offset: int
    is_executable: bool
    is_data: bool


@dataclass
class SymbolInfo:
    name: str
    vaddr: int
    size: int
    is_function: bool


@dataclass
class MappingRegion:
    """ARM mapping-symbol region: kind in {'arm','thumb','data'}."""
    start: int
    kind: str


@dataclass
class BinaryInfo:
    fmt: str                      # 'ELF' | 'PE' | 'MACHO'
    arch: Arch
    entrypoint: int
    image_base: int
    sections: list[SectionInfo] = field(default_factory=list)
    symbols: list[SymbolInfo] = field(default_factory=list)
    mapping_regions: list[MappingRegion] = field(default_factory=list)


def _map_arch(binary: lief.Binary) -> Arch:
    """Map LIEF architecture to our normalized Arch enum."""
    if isinstance(binary, lief.ELF.Binary):
        arch = binary.header.machine_type
        name = str(arch).upper()
        if "AARCH64" in name:
            return Arch.ARM64
        if "ARM" in name:
            return Arch.ARM
        if "X86_64" in name or "X64" in name:
            return Arch.X86_64
        if "I386" in name or "X86" in name:
            return Arch.X86
    if isinstance(binary, lief.PE.Binary):
        machine = str(binary.header.machine).upper()
        if "AMD64" in machine:
            return Arch.X86_64
        if "I386" in machine:
            return Arch.X86
        if "ARM64" in machine:
            return Arch.ARM64
    raise ValueError(f"unsupported architecture: {binary}")


def load_binary(data: bytes, name: str = "sample.bin") -> tuple[lief.Binary, BinaryInfo]:
    """Parse raw bytes with LIEF and extract a normalized BinaryInfo."""
    # LIEF >=0.14 accepts bytes directly; no `name` kwarg in newer releases.
    binary = lief.parse(data)
    if binary is None:
        raise ValueError("unsupported or corrupt binary format")

    fmt = (
        "ELF" if isinstance(binary, lief.ELF.Binary)
        else "PE" if isinstance(binary, lief.PE.Binary)
        else "MACHO" if isinstance(binary, lief.MachO.Binary)
        else "UNKNOWN"
    )

    info = BinaryInfo(
        fmt=fmt,
        arch=_map_arch(binary),
        entrypoint=int(binary.entrypoint),
        image_base=int(getattr(binary, "imagebase", 0)),
    )

    for sec in binary.sections:
        flags = str(getattr(sec, "flags", ""))
        is_exec = "EXECUTE" in flags.upper() or sec.name in (".text", "__text")
        info.sections.append(SectionInfo(
            name=sec.name,
            vaddr=int(sec.virtual_address),
            size=int(sec.size),
            offset=int(sec.offset),
            is_executable=is_exec,
            is_data=not is_exec and sec.size > 0,
        ))

    # Function/static symbols
    for sym in getattr(binary, "symbols", []) or []:
        try:
            value = int(sym.value)
        except Exception:
            continue
        # LIEF reports e.g. "TYPE.FUNC" — match the FUNC token.
        is_func = "FUNC" in str(getattr(sym, "type", "")).upper()
        info.symbols.append(SymbolInfo(name=sym.name, vaddr=value,
                                       size=int(getattr(sym, "size", 0)),
                                       is_function=is_func))

    # ARM ELF mapping symbols: $a (ARM code), $t (Thumb code), $d (data/literal pool)
    if isinstance(binary, lief.ELF.Binary) and info.arch in (Arch.ARM, Arch.ARM64):
        regions: list[MappingRegion] = []
        for sym in binary.symbols:
            sname = sym.name
            if sname in ("$a", "$t", "$d") or sname.startswith(("$a.", "$t.", "$d.")):
                kind = {"$a": "arm", "$t": "thumb", "$d": "data"}[sname[0:2]]
                regions.append(MappingRegion(start=int(sym.value), kind=kind))
        regions.sort(key=lambda r: r.start)
        info.mapping_regions = regions

    return binary, info


def read_section_bytes(binary: lief.Binary, section: SectionInfo) -> bytes:
    """Return the raw bytes of a section from the parsed binary."""
    for sec in binary.sections:
        if sec.name == section.name and int(sec.virtual_address) == section.vaddr:
            return bytes(sec.content)
    raise KeyError(f"section not found: {section.name}")
