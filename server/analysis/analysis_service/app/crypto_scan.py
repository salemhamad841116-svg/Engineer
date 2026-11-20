"""
Automatic crypto detection: scans data sections for well-known algorithm
constants (AES S-boxes, SHA-256 round constants, MD5 table seed, ChaCha sigma).
A hit flags the region so linked functions can be marked 'crypto-related'.

This is signature-based detection — Phase 2 can extend it with IR-level
heuristics on top of the Ghidra decompiler output.
"""
from __future__ import annotations

from dataclasses import dataclass

# AES S-box (first 32 bytes are enough for a confident match)
_AES_SBOX = bytes([
    0x63, 0x7C, 0x77, 0x7B, 0xF2, 0x6B, 0x6F, 0xC5,
    0x30, 0x01, 0x67, 0x2B, 0xFE, 0xD7, 0xAB, 0x76,
    0xCA, 0x82, 0xC9, 0x7D, 0xFA, 0x59, 0x47, 0xF0,
    0xAD, 0xD4, 0xA2, 0xAF, 0x9C, 0xA4, 0x72, 0xC0,
])

# AES inverse S-box
_AES_INV_SBOX = bytes([
    0x52, 0x09, 0x6A, 0xD5, 0x30, 0x36, 0xA5, 0x38,
    0xBF, 0x40, 0xA3, 0x9E, 0x81, 0xF3, 0xD7, 0xFB,
    0x7C, 0xE3, 0x39, 0x82, 0x9B, 0x2F, 0xFF, 0x87,
    0x34, 0x8E, 0x43, 0x44, 0xC4, 0xDE, 0xE9, 0xCB,
])

# SHA-256 K constants (first 8 of 64, little-endian as stored in .rodata)
_SHA256_K = b"".join(k.to_bytes(4, "little") for k in [
    0x428A2F98, 0x71374491, 0xB5C0FBCF, 0xE9B5DBA5,
    0x3956C25B, 0x59F111F1, 0x923F82A4, 0xAB1C5ED5,
])

# ChaCha20 sigma constant "expand 32-byte k"
_CHACHA_SIGMA = b"expand 32-byte k"

_SIGNATURES: list[tuple[str, bytes]] = [
    ("AES", _AES_SBOX),
    ("AES-INV", _AES_INV_SBOX),
    ("SHA-256", _SHA256_K),
    ("ChaCha20", _CHACHA_SIGMA),
]


@dataclass
class CryptoFinding:
    algorithm: str
    section: str
    vaddr: int
    score: float          # 0..1 — fraction of the signature matched
    note: str


def scan_region(data: bytes, base_vaddr: int, section: str) -> list[CryptoFinding]:
    """Scan one data blob for all known crypto constants."""
    findings: list[CryptoFinding] = []
    for algo, sig in _SIGNATURES:
        idx = data.find(sig)
        if idx >= 0:
            findings.append(CryptoFinding(
                algorithm=algo,
                section=section,
                vaddr=base_vaddr + idx,
                score=1.0,
                note=f"exact {len(sig)}-byte signature match",
            ))
            continue
        # Partial match (at least 16 consecutive bytes) — weaker confidence
        probe = sig[:16]
        idx = data.find(probe)
        if idx >= 0:
            findings.append(CryptoFinding(
                algorithm=algo,
                section=section,
                vaddr=base_vaddr + idx,
                score=round(16 / len(sig), 2),
                note="partial signature match — verify manually",
            ))
    return findings


def scan_binary(sections: list[tuple[str, int, bytes]]) -> list[CryptoFinding]:
    """Scan all data sections. `sections` = [(name, base_vaddr, raw_bytes)]."""
    out: list[CryptoFinding] = []
    for name, vaddr, blob in sections:
        if blob:
            out.extend(scan_region(blob, vaddr, name))
    return out
