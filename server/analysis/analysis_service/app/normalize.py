"""
Address normalization & ARM/Thumb alignment rules.

Implements the spec's requirements:
- Clear the Thumb mode bit (addr & ~1) so one function = one canonical address.
- Strip ARM64 top-byte tagging / PAC-related high bits for user-space pointers.
- Thumb-2 halfword framing helpers (hw1/hw2) to detect 32-bit instructions and
  prevent decode drift when sweeping mixed 16/32-bit Thumb code.
"""
from __future__ import annotations

from enum import Enum


class Arch(str, Enum):
    X86_64 = "x86_64"
    X86 = "x86"
    ARM = "arm"
    THUMB = "thumb"
    ARM64 = "arm64"


# User-space mask for ARM64: drops TBI (top-byte ignore) tags kept in bits 63:56.
ARM64_USER_MASK = 0x00FF_FFFF_FFFF_FFFF


def normalize_address(addr: int, arch: Arch) -> int:
    """Return the canonical address for an instruction pointer.

    - ARM/Thumb: bit 0 encodes Thumb state on branch targets (BLX/BX), so a
      function may be referenced as both 0x1000 and 0x1001. Canonical form
      clears it (addr & ~1).
    - ARM64: clears top-byte tag bits (TBI) used by some toolchains; does NOT
      touch PAC bits in-place because those live in the upper bits too — for
      user-space EL0 binaries the 0x00FF... mask is the documented convention.
    - x86/x64: identity (no mode bit exists).
    """
    if arch in (Arch.ARM, Arch.THUMB):
        return addr & ~1
    if arch == Arch.ARM64:
        return addr & ARM64_USER_MASK
    return addr


def is_thumb_address(raw_addr: int) -> bool:
    """True if a raw branch target carries the Thumb state bit."""
    return bool(raw_addr & 1)


def thumb2_is_32bit(hw1: int) -> bool:
    """Thumb-2 framing rule: if the first halfword matches 0b11101/0b11110/
    0b11111 prefixes, the instruction is 32-bit (hw1 + hw2), otherwise 16-bit.

    Decoding a 32-bit instruction as two 16-bit ones (or vice versa) is the
    classic cause of disassembly drift; always frame on hw1 first.
    """
    return (hw1 & 0xF800) >= 0xE800


def split_halfwords(le_bytes: bytes) -> tuple[int, int | None]:
    """Little-endian halfword split for Thumb-2 framing."""
    if len(le_bytes) < 2:
        raise ValueError("need at least 2 bytes for a Thumb halfword")
    hw1 = int.from_bytes(le_bytes[0:2], "little")
    hw2 = int.from_bytes(le_bytes[2:4], "little") if len(le_bytes) >= 4 else None
    return hw1, hw2
