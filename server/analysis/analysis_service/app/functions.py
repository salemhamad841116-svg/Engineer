"""
Function manager: deduplication + cross-reference (xref) linking.

Guarantees that a function referenced via multiple address aliases
(e.g. 0x1000 and 0x1001 for the same Thumb function) is stored exactly once,
and that every xref points to that single entity.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .normalize import Arch, normalize_address
from .loader import SymbolInfo


@dataclass
class Function:
    address: int                    # canonical address
    name: str
    size: int = 0
    xrefs_from: list[int] = field(default_factory=list)   # addresses this fn references
    xrefs_to: list[int] = field(default_factory=list)     # addresses referencing this fn


class FunctionManager:
    def __init__(self, arch: Arch):
        self.arch = arch
        self._functions: dict[int, Function] = {}

    def add(self, address: int, name: str | None = None, size: int = 0) -> Function:
        canonical = normalize_address(address, self.arch)
        existing = self._functions.get(canonical)
        if existing is not None:
            if name and existing.name.startswith("sub_"):
                existing.name = name  # prefer a real symbol name over a generated one
            if size:
                existing.size = max(existing.size, size)
            return existing
        fn = Function(address=canonical, name=name or f"sub_{canonical:x}", size=size)
        self._functions[canonical] = fn
        return fn

    def add_symbol(self, sym: SymbolInfo) -> Function | None:
        if not sym.is_function or sym.vaddr == 0:
            return None
        return self.add(sym.vaddr, name=sym.name, size=sym.size)

    def link_xref(self, src: int, dst: int) -> None:
        """Record src -> dst. Creates the target stub if unseen; links both ways."""
        src_c = normalize_address(src, self.arch)
        dst_c = normalize_address(dst, self.arch)
        src_fn = self._functions.get(src_c)
        dst_fn = self._functions.get(dst_c) or self.add(dst_c)
        if src_fn and dst_c not in src_fn.xrefs_from:
            src_fn.xrefs_from.append(dst_c)
        if src_c not in dst_fn.xrefs_to:
            dst_fn.xrefs_to.append(src_c)

    def get(self, address: int) -> Function | None:
        return self._functions.get(normalize_address(address, self.arch))

    def all(self) -> list[Function]:
        return sorted(self._functions.values(), key=lambda f: f.address)

    def __len__(self) -> int:
        return len(self._functions)
