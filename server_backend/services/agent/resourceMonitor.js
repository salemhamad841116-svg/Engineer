// ==============================================================================
// Resource & Disk Space Management Service
// Real-time monitoring of RAM & storage. Safely cleans build artifacts & caches
// during disk pressure, while strictly protecting user code and personal files.
// ==============================================================================

const os = require('os');
const fs = require('fs');
const path = require('path');

const DISK_WARNING_THRESHOLD_MB = 1000; // 1 GB
const DISK_CRITICAL_THRESHOLD_MB = 300;  // 300 MB

/**
 * Returns current memory & disk usage metrics.
 */
function getSystemResourceMetrics(workspaceRoot = process.cwd()) {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const memUsage = process.memoryUsage();

  let diskFreeMb = 10240; // Default estimate
  let diskTotalMb = 50000;

  try {
    if (typeof fs.statfsSync === 'function') {
      const stats = fs.statfsSync(workspaceRoot);
      diskFreeMb = Math.round((stats.bavail * stats.bsize) / (1024 * 1024));
      diskTotalMb = Math.round((stats.blocks * stats.bsize) / (1024 * 1024));
    }
  } catch (_) {
    // Fallback if statfs is unavailable on older kernel or restricted container
  }

  const memUsagePercent = Math.round(((totalMem - freeMem) / totalMem) * 100);
  const diskUsagePercent = diskTotalMb > 0 ? Math.round(((diskTotalMb - diskFreeMb) / diskTotalMb) * 100) : 50;

  let pressureLevel = 'normal';
  if (diskFreeMb < DISK_CRITICAL_THRESHOLD_MB || memUsagePercent > 92) {
    pressureLevel = 'critical';
  } else if (diskFreeMb < DISK_WARNING_THRESHOLD_MB || memUsagePercent > 80) {
    pressureLevel = 'warning';
  }

  return {
    memory: {
      totalMb: Math.round(totalMem / (1024 * 1024)),
      freeMb: Math.round(freeMem / (1024 * 1024)),
      processRssMb: Math.round(memUsage.rss / (1024 * 1024)),
      processHeapUsedMb: Math.round(memUsage.heapUsed / (1024 * 1024)),
      usagePercent: memUsagePercent,
    },
    disk: {
      totalMb: diskTotalMb,
      freeMb: diskFreeMb,
      usagePercent: diskUsagePercent,
    },
    pressureLevel,
    isCleanRecommended: pressureLevel !== 'normal',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Scans workspace for safe-to-clean ephemeral build caches and logs.
 * STRIKE RULE: User source code, databases (.db), and .env are NEVER cleanable.
 */
function scanCleanableArtifacts(workspaceRoot = process.cwd()) {
  const candidates = [
    { relPath: 'dist', category: 'build_output', safeAuto: true },
    { relPath: '.vite', category: 'bundler_cache', safeAuto: true },
    { relPath: '.cache', category: 'tool_cache', safeAuto: true },
    { relPath: 'temp', category: 'temp_files', safeAuto: true },
    { relPath: 'tmp', category: 'temp_files', safeAuto: true },
    { relPath: '.turbo', category: 'build_cache', safeAuto: true },
  ];

  const foundItems = [];
  let totalBytes = 0;

  for (const c of candidates) {
    const fullPath = path.resolve(workspaceRoot, c.relPath);
    if (fs.existsSync(fullPath)) {
      try {
        const size = getDirectorySizeBytes(fullPath);
        if (size > 0) {
          foundItems.push({
            name: c.relPath,
            fullPath,
            category: c.category,
            safeAuto: c.safeAuto,
            sizeBytes: size,
            sizeFormatted: formatBytes(size),
          });
          totalBytes += size;
        }
      } catch (_) {}
    }
  }

  return {
    cleanableCount: foundItems.length,
    totalSizeBytes: totalBytes,
    totalSizeFormatted: formatBytes(totalBytes),
    items: foundItems,
  };
}

/**
 * Executes safe automated cleanup of ephemeral files only.
 */
function performSafeCleanup({ workspaceRoot = process.cwd(), requireConfirmation = false }) {
  const scan = scanCleanableArtifacts(workspaceRoot);
  const freedItems = [];
  let bytesFreed = 0;

  for (const item of scan.items) {
    if (!item.safeAuto) continue; // Skip anything not strictly marked as safe ephemeral cache

    try {
      if (fs.statSync(item.fullPath).isDirectory()) {
        fs.rmSync(item.fullPath, { recursive: true, force: true });
      } else {
        fs.unlinkSync(item.fullPath);
      }
      freedItems.push(item.name);
      bytesFreed += item.sizeBytes;
    } catch (err) {
      console.warn(`[resourceMonitor] Could not delete ${item.fullPath}:`, err.message);
    }
  }

  const postMetrics = getSystemResourceMetrics(workspaceRoot);
  const isSufficient = postMetrics.disk.freeMb >= DISK_WARNING_THRESHOLD_MB;

  return {
    success: true,
    bytesFreed,
    freedFormatted: formatBytes(bytesFreed),
    freedItems,
    postCleanupMetrics: postMetrics,
    isSufficient,
    message: isSufficient
      ? `تم تنظيف ${formatBytes(bytesFreed)} من مخلفات البناء والكاش بنجاح والمساحة كافية.`
      : `تم إفراغ ${formatBytes(bytesFreed)}، لكن المساحة ما زالت منخفضة (${postMetrics.disk.freeMb} MB متوفرة). يرجى تحرير مساحة إضافية على الجهاز.`,
  };
}

/**
 * Recursive directory size calculator with depth safety limit.
 */
function getDirectorySizeBytes(dirPath, currentDepth = 0) {
  if (currentDepth > 8) return 0;
  let total = 0;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const ent of entries) {
      const full = path.join(dirPath, ent.name);
      if (ent.isDirectory()) {
        total += getDirectorySizeBytes(full, currentDepth + 1);
      } else if (ent.isFile()) {
        try {
          total += fs.statSync(full).size;
        } catch (_) {}
      }
    }
  } catch (_) {}
  return total;
}

function formatBytes(bytes = 0) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

module.exports = {
  getSystemResourceMetrics,
  scanCleanableArtifacts,
  performSafeCleanup,
  formatBytes,
};
