"""Unit tests for the analysis core (no network needed)."""
from app.normalize import Arch, normalize_address, is_thumb_address, thumb2_is_32bit
from app.functions import FunctionManager
from app.crypto_scan import scan_region, _AES_SBOX, _SHA256_K


def test_thumb_mode_bit_is_cleared():
    # Same Thumb function referenced as 0x1000 (even) and 0x1001 (Thumb bit set)
    assert normalize_address(0x1001, Arch.THUMB) == 0x1000
    assert normalize_address(0x1000, Arch.ARM) == 0x1000
    assert is_thumb_address(0x1001) and not is_thumb_address(0x1000)


def test_arm64_top_byte_tag_stripped():
    tagged = 0x3F00_0000_0040_1000  # TBI tag in bits 63:56
    assert normalize_address(tagged, Arch.ARM64) == 0x401000


def test_x86_identity():
    assert normalize_address(0x401000, Arch.X86_64) == 0x401000


def test_thumb2_32bit_framing():
    # 0xF000.. is a 32-bit Thumb-2 prefix (e.g. BL); 0x2001 is 16-bit MOV
    assert thumb2_is_32bit(0xF000)
    assert thumb2_is_32bit(0xE800)
    assert not thumb2_is_32bit(0x2001)


def test_function_dedup_aliases():
    mgr = FunctionManager(Arch.THUMB)
    a = mgr.add(0x1000, name="sub_1000")
    b = mgr.add(0x1001)            # alias with Thumb bit set — must NOT create a new fn
    assert len(mgr) == 1
    assert a is b


def test_xref_links_single_entity():
    mgr = FunctionManager(Arch.ARM)
    mgr.add(0x2000, name="main")
    mgr.link_xref(0x2000, 0x3001)  # call to aliased Thumb target
    mgr.link_xref(0x2100, 0x3000)  # same target, even alias
    target = mgr.get(0x3000)
    assert target is not None
    assert sorted(target.xrefs_to) == [0x2000, 0x2100]
    assert len(mgr) == 2            # target created once despite two aliases


def test_crypto_scan_finds_aes():
    blob = b"\x00" * 64 + _AES_SBOX + b"\xff" * 64
    hits = scan_region(blob, base_vaddr=0x5000, section=".rodata")
    assert any(h.algorithm == "AES" and h.vaddr == 0x5040 and h.score == 1.0 for h in hits)


def test_crypto_scan_finds_sha256():
    blob = _SHA256_K + b"\x90" * 32
    hits = scan_region(blob, base_vaddr=0x6000, section=".rodata")
    assert any(h.algorithm == "SHA-256" and h.vaddr == 0x6000 for h in hits)


def test_crypto_scan_clean_blob():
    assert scan_region(b"\x41" * 256, 0x0, ".data") == []
