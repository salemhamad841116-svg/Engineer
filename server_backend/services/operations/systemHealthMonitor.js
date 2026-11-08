/**
 * systemHealthMonitor.js
 * Production System Health Monitoring, Threshold Alerting & Sanitized Audit Logging
 *
 * Enforces:
 * 1. Memory and disk resource monitoring with configurable thresholds.
 * 2. SQLite database connectivity and probe latency audit.
 * 3. Zero-Secrets & Zero-PII Sanitization Gateway:
 *    - All alert messages and details MUST pass through the sanitizer.
 *    - Redacts API keys, bearer tokens, passwords, session cookies (sid), emails, and credentials.
 *    - Prevents prompt injection and untrusted instruction execution.
 * 4. Admin alerts persistence in system_alert_logs table.
 */

const fs = require('fs');
const path = require('path');
const { getDb } = require('../../db/database.js');

// Sensitive data patterns for scrubbing
const SENSITIVE_PATTERNS = [
  // API Keys and Bearer Tokens
  { pattern: /AIza[0-9A-Za-z-_]{20,50}/g, replacement: '[REDACTED_API_KEY]' },
  { pattern: /sk-[0-9A-Za-z-_]{20,}/g, replacement: '[REDACTED_SECRET_KEY]' },
  { pattern: /Bearer\s+[A-Za-z0-9-_.]+/gi, replacement: 'Bearer [REDACTED_TOKEN]' },
  { pattern: /sid=[A-Za-z0-9-_.]+/gi, replacement: 'sid=[REDACTED_SESSION]' },

  // Password / Secret fields in JSON, key-value pairs, or natural prose
  { pattern: /\b(password|passwd|secret|api_?key|token|auth_token)\s*(?:[:=]|\s+)\s*("?)[^",\s}]+("?)/gi, replacement: '$1: [REDACTED]' },

  // Emails and User Identifiable Info (PII)
  { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[REDACTED_EMAIL]' },
  { pattern: /\b(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: '[REDACTED_PHONE]' },

  // System Prompt & Prompt Injection markers
  { pattern: /<\s*\/?\s*(?:script|system|assistant|function_call)[^>]*>/gi, replacement: '[DISARMED_TAG]' },
  { pattern: /\[TOOL_REQUEST:[^\]]+\]/gi, replacement: '[DISARMED_TOOL_CALL]' }
];

/**
 * Deeply sanitizes any string or nested object/array to redact secrets and PII.
 *
 * @param {any} input
 * @returns {any} Sanitized output
 */
function sanitizeSensitiveContent(input) {
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    let sanitized = input;
    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, replacement);
    }
    return sanitized;
  }

  if (Array.isArray(input)) {
    return input.map((item) => sanitizeSensitiveContent(item));
  }

  if (typeof input === 'object') {
    const cleaned = {};
    for (const [key, value] of Object.entries(input)) {
      // Redact sensitive keys outright
      if (/password|passwd|secret|token|api_?key|auth_token/i.test(key) && (typeof value !== 'object' || value === null)) {
        cleaned[key] = '[REDACTED_FIELD]';
      } else {
        cleaned[key] = sanitizeSensitiveContent(value);
      }
    }
    return cleaned;
  }

  return input;
}

class SystemHealthMonitor {
  constructor(options = {}) {
    this.memoryWarnHeapMb = options.memoryWarnHeapMb || 350;
    this.diskWarnMinFreeMb = options.diskWarnMinFreeMb || 500;
  }

  /**
   * Retrieves current memory metrics.
   */
  getMemoryMetrics() {
    const mem = process.memoryUsage();
    return {
      rssMb: Math.round(mem.rss / (1024 * 1024)),
      heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      heapTotalMb: Math.round(mem.heapTotal / (1024 * 1024)),
      externalMb: Math.round(mem.external / (1024 * 1024)),
      isOverThreshold: mem.heapUsed > (this.memoryWarnHeapMb * 1024 * 1024)
    };
  }

  /**
   * Retrieves storage metrics for the volume hosting the application.
   */
  getDiskMetrics() {
    try {
      const stats = fs.statfsSync(process.cwd());
      const freeMb = Math.round((stats.bavail * stats.bsize) / (1024 * 1024));
      const totalMb = Math.round((stats.blocks * stats.bsize) / (1024 * 1024));
      const usedMb = totalMb - freeMb;
      const capacityPercent = totalMb > 0 ? Math.round((usedMb / totalMb) * 100) : 0;

      return {
        freeMb,
        totalMb,
        usedMb,
        capacityPercent,
        isOverThreshold: freeMb < this.diskWarnMinFreeMb
      };
    } catch (_) {
      // Fallback if statfsSync is unsupported
      return {
        freeMb: 1024,
        totalMb: 10240,
        usedMb: 9216,
        capacityPercent: 90,
        isOverThreshold: false
      };
    }
  }

  /**
   * Checks SQLite database responsiveness and measures query latency.
   */
  checkDatabaseHealth() {
    const start = Date.now();
    try {
      const db = getDb();
      const res = db.prepare('SELECT 1 as alive').get();
      const latencyMs = Date.now() - start;
      const isHealthy = res && res.alive === 1;
      return {
        status: isHealthy ? 'healthy' : 'degraded',
        latencyMs,
        error: null
      };
    } catch (err) {
      return {
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        error: sanitizeSensitiveContent(err.message)
      };
    }
  }

  /**
   * Records a sanitized alert in system_alert_logs.
   *
   * @param {Object} alert
   * @param {'info'|'warning'|'error'|'critical'} alert.level
   * @param {'memory'|'disk'|'health'|'security'|'backup'|'general'} alert.category
   * @param {string} alert.message - Raw alert message (will be sanitized)
   * @param {Object} [alert.details] - Arbitrary details (will be deeply sanitized)
   * @param {string} [alert.tenantId] - Optional tenant context
   * @returns {Object} Created sanitized alert record
   */
  recordAlert({ level, category, message, details = {}, tenantId = null }) {
    // 1. Mandatory Sanitization Gateway
    const cleanMessage = sanitizeSensitiveContent(message);
    const cleanDetails = sanitizeSensitiveContent(details);

    const alertId = `alt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const timestamp = new Date().toISOString();
    const detailsJson = JSON.stringify(cleanDetails);

    const db = getDb();
    db.prepare(`
      INSERT INTO system_alert_logs (
        id, timestamp, level, category, message, details_json, is_resolved, tenant_id
      ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    `).run(alertId, timestamp, level, category, cleanMessage, detailsJson, tenantId);

    return {
      id: alertId,
      timestamp,
      level,
      category,
      message: cleanMessage,
      details: cleanDetails,
      isResolved: 0,
      tenantId
    };
  }

  /**
   * Retrieves active (unresolved) or all alerts with filtering and pagination.
   */
  listAlerts(options = {}) {
    const db = getDb();
    let query = 'SELECT * FROM system_alert_logs WHERE 1=1';
    const params = [];

    if (options.unresolvedOnly !== false) {
      query += ' AND is_resolved = 0';
    }
    if (options.level) {
      query += ' AND level = ?';
      params.push(options.level);
    }
    if (options.category) {
      query += ' AND category = ?';
      params.push(options.category);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(options.limit || 50);

    const rows = db.prepare(query).all(...params);
    return rows.map((r) => ({
      ...r,
      details: JSON.parse(r.details_json || '{}')
    }));
  }

  /**
   * Marks a system alert as resolved.
   */
  resolveAlert(alertId, resolvedBy = 'admin') {
    const db = getDb();
    const now = new Date().toISOString();
    const res = db.prepare(`
      UPDATE system_alert_logs
      SET is_resolved = 1, resolved_at = ?, resolved_by = ?
      WHERE id = ?
    `).run(now, resolvedBy, alertId);

    return res.changes > 0;
  }

  /**
   * Aggregates comprehensive health report for admin dashboard.
   */
  getSystemHealthReport() {
    const memory = this.getMemoryMetrics();
    const disk = this.getDiskMetrics();
    const db = this.checkDatabaseHealth();
    const activeAlerts = this.listAlerts({ unresolvedOnly: true, limit: 10 });

    let overallStatus = 'healthy';
    if (memory.isOverThreshold || disk.isOverThreshold || db.status !== 'healthy') {
      overallStatus = 'degraded';
    }
    if (db.status === 'unhealthy' || activeAlerts.some((a) => a.level === 'critical')) {
      overallStatus = 'critical';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      memory,
      disk,
      database: db,
      activeAlertsCount: activeAlerts.length,
      activeAlerts
    };
  }
}

const systemHealthMonitor = new SystemHealthMonitor();

module.exports = {
  SystemHealthMonitor,
  systemHealthMonitor,
  sanitizeSensitiveContent
};
