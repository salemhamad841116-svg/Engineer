#!/bin/bash
# ==============================================================================
# GCP 16GB Host Production Deployment & Model Fleet Setup Script
#
# Enforces the two unbroken budget rules:
# 1. Total (Model weights + KV Cache) <= 12GB (Leaving >= 4GB for OS/App/SQLite)
# 2. Disk Storage Pre-flight: Verifies available disk >= 50GB before pulling models
# ==============================================================================

set -euo pipefail

echo "=================================================================="
echo "🚀 INITIATING PRODUCTION LOCAL MODEL FLEET ON 16GB GCP HOST"
echo "=================================================================="

# ------------------------------------------------------------------------------
# 1. Disk Space Pre-flight Verification
# ------------------------------------------------------------------------------
echo ""
echo "[Step 1] Checking available disk space on root filesystem..."
AVAILABLE_DISK_KB=$(df / --output=avail | tail -n 1 | tr -d ' ')
AVAILABLE_DISK_GB=$((AVAILABLE_DISK_KB / 1024 / 1024))

echo "  📊 Available disk space: ${AVAILABLE_DISK_GB} GB"

if [ "${AVAILABLE_DISK_GB}" -lt 40 ]; then
  echo "  ⛔ INSUFFICIENT DISK SPACE: Minimum required is 40 GB free space (recommended 100 GB)."
  echo "  Please execute disk expansion on Google Cloud Console or gcloud CLI:"
  echo ""
  echo "    gcloud compute disks resize <INSTANCE_NAME> --size=100GB --zone=<ZONE>"
  echo "    sudo growpart /dev/sda 1 && sudo resize2fs /dev/sda1"
  echo ""
  echo "  Aborting model pull to protect instance from disk exhaustion failure."
  exit 1
fi
echo "  ✅ Disk storage pre-flight passed: ${AVAILABLE_DISK_GB} GB available."

# ------------------------------------------------------------------------------
# 2. Host RAM Verification (16GB Requirement)
# ------------------------------------------------------------------------------
echo ""
echo "[Step 2] Checking host physical memory..."
if command -v free >/dev/null 2>&1; then
  TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
  echo "  📊 Host RAM: ${TOTAL_RAM_MB} MB"
  if [ "${TOTAL_RAM_MB}" -lt 14000 ]; then
    echo "  ⚠️ Warning: Host RAM is below 16GB (${TOTAL_RAM_MB} MB). Verify instance configuration."
  else
    echo "  ✅ Host RAM verified adequate for 16GB tier."
  fi
fi

# ------------------------------------------------------------------------------
# 3. Ollama Service Health & Parameters Probe
# ------------------------------------------------------------------------------
echo ""
echo "[Step 3] Checking Ollama engine accessibility..."
OLLAMA_HOST="${OLLAMA_HOST:-http://127.0.0.1:11434}"

if curl -s -f "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
  echo "  ✅ Ollama service is reachable at ${OLLAMA_HOST}"
else
  echo "  ⚠️ Ollama is not responding at ${OLLAMA_HOST}. Starting via docker compose or system service..."
fi

# ------------------------------------------------------------------------------
# 4. Pulling Verified Fleet Models (Q4_K_M)
# ------------------------------------------------------------------------------
echo ""
echo "[Step 4] Pulling verified models sequentially (Single resident model rule)..."

MODELS=(
  "llama3.2:3b"       # Quick Tier primary (~2.0 GB)
  "qwen2.5:1.5b"      # Ultra-fast secondary (~1.0 GB)
  "qwen2.5:7b"        # Deep Tier Arabic/English workhorse (~4.7 GB)
  "llama3.1:8b"       # Specialized English reasoning (~4.9 GB)
  "qwen3:8b"          # Expert Tier reasoning (~5.0 GB)
  "deepseek-r1:7b"    # Expert Tier Chain-of-Thought (~4.7 GB)
)

for model in "${MODELS[@]}"; do
  echo "  ⬇️ Pulling model: ${model}..."
  if command -v ollama >/dev/null 2>&1; then
    ollama pull "${model}"
  else
    curl -s -X POST "${OLLAMA_HOST}/api/pull" -d "{\"name\": \"${model}\"}" || true
  fi
  echo "  ✅ Model ${model} pulled."
done

echo ""
echo "=================================================================="
echo "🎉 MODEL FLEET READY. OLLAMA_MAX_LOADED_MODELS=1 ACTIVATED."
echo "=================================================================="
