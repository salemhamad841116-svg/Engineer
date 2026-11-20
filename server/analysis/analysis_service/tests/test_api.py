"""End-to-end API test: compile a real ELF with embedded crypto constants,
upload it to /analyze, and verify the whole pipeline output."""
import subprocess
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.main import app

SAMPLE_C = r"""
#include <stdint.h>
#include <stdio.h>

/* AES S-box — must be detected by the crypto scanner in .rodata */
__attribute__((used)) static const uint8_t AES_SBOX[256] = {
  0x63,0x7c,0x77,0x7b,0xf2,0x6b,0x6f,0xc5,0x30,0x01,0x67,0x2b,0xfe,0xd7,0xab,0x76,
  0xca,0x82,0xc9,0x7d,0xfa,0x59,0x47,0xf0,0xad,0xd4,0xa2,0xaf,0x9c,0xa4,0x72,0xc0,
  0xb7,0xfd,0x93,0x26,0x36,0x3f,0xf7,0xcc,0x34,0xa5,0xe5,0xf1,0x71,0xd8,0x31,0x15,
  0x04,0xc7,0x23,0xc3,0x18,0x96,0x05,0x9a,0x07,0x12,0x80,0xe2,0xeb,0x27,0xb2,0x75,
  [64 ... 255] = 0
};

/* SHA-256 K constants (first 8) */
__attribute__((used)) static const uint32_t SHA256_K[8] = {
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5
};

__attribute__((noinline)) static int helper(int x) { return x * 2 + (int)SHA256_K[0]; }

int main(void) {
    volatile int v = helper(21);
    printf("%d %u %u\n", v, AES_SBOX[0], SHA256_K[1]);
    return 0;
}
"""


@pytest.fixture(scope="module")
def sample_elf(tmp_path_factory) -> bytes:
    tmp = tmp_path_factory.mktemp("bin")
    src = tmp / "sample.c"
    elf = tmp / "sample.elf"
    src.write_text(SAMPLE_C)
    subprocess.run(["gcc", "-O1", "-o", str(elf), str(src)], check=True)
    return elf.read_bytes()


def test_analyze_real_elf(sample_elf):
    client = TestClient(app)
    resp = client.post("/analyze", files={"file": ("sample.elf", sample_elf)})
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # Metadata
    assert body["status"] == "VERIFIED"
    assert body["fmt"] == "ELF"
    assert body["arch"] == "x86_64"
    assert body["instruction_count"] > 0

    # Sections: .text must be flagged executable
    exec_sections = [s for s in body["sections"] if s["is_executable"]]
    assert any(s["name"] == ".text" for s in exec_sections)

    # Functions: our named symbols must survive (gcc keeps them with -O1)
    names = {f["name"] for f in body["functions"]}
    assert "main" in names
    assert "helper" in names
    # The entrypoint address must map to an existing function entity
    entry_fns = [f for f in body["functions"] if f["address"] == body["entrypoint"]]
    assert entry_fns, "entrypoint has no function entity"

    # Crypto scanner must fire on the embedded constants
    algos = {f["algorithm"] for f in body["crypto_findings"]}
    assert "AES" in algos
    assert "SHA-256" in algos

    # Lazy disassembly paging
    job_id = body["job_id"]
    page = client.get("/disasm", params={"job_id": job_id, "start": 0, "count": 50})
    assert page.status_code == 200
    pd = page.json()
    assert pd["count"] == 50
    assert all(pd["instructions"][i]["address"] <= pd["instructions"][i + 1]["address"]
               for i in range(len(pd["instructions"]) - 1))

    # Job summary
    summary = client.get(f"/jobs/{job_id}")
    assert summary.status_code == 200
    assert summary.json()["function_count"] >= 2


def test_reject_empty_file():
    client = TestClient(app)
    resp = client.post("/analyze", files={"file": ("empty.bin", b"")})
    assert resp.status_code == 400


def test_reject_garbage_file():
    client = TestClient(app)
    resp = client.post("/analyze", files={"file": ("junk.bin", b"not a binary" * 100)})
    assert resp.status_code == 422
    assert resp.json()["status"] == "FAILED"
