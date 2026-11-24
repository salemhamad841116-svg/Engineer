/**
 * costLedger.js — Phase-1 Feature Freeze: the honest cost book
 * (provider_cost_ledger, migration 042).
 *
 * Two kinds of rows, both provable from data:
 *  - SPEND: a real paid provider call happened (image generation in the
 *    frozen Phase-1 slice; local qwen is $0 and never billed).
 *  - SAVED: a cache hit short-circuited what WOULD have been a paid call —
 *    "Zero Duplicate Spend" is measured here, not asserted.
 *
 * Prices come from a deterministic local estimate table
 * (pricing_model='estimated') — never presented as billed invoices.
 */

import crypto from 'node:crypto';

/** Estimated unit prices (USD) — local table, revised in one place only. */
const UNIT_COST_USD = {
  'gemini:image_generate': 0.039, // gemini flash image, per image
  'gemini:prompt_enhance': 0.0001, // gemini-flash structured fallback, per call
  'gemini:clarify_dynamic': 0.0001,
  'qwen_local:prompt_enhance': 0, // local Ollama — free by construction
  'qwen_local:clarify_dynamic': 0,
  'deterministic:ocr_verify': 0, // local tesseract — free by construction
};

function unitCost(provider, operation) {
  return UNIT_COST_USD[`${provider}:${operation}`] ?? 0;
}

function insertRow(db, row) {
  db.prepare(`INSERT INTO provider_cost_ledger (
      id, owner_id, provider, operation, pricing_model,
      unit_cost_usd, units, cost_usd, saved_usd, cache_source, ref_id, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    row.id, row.owner_id, row.provider, row.operation, 'estimated',
    row.unit_cost_usd, row.units, row.cost_usd, row.saved_usd,
    row.cache_source || null, row.ref_id || null, row.created_at,
  );
}

/** Record a REAL provider call. Zero-cost providers are not booked. */
export function recordSpend(db, { ownerId, provider, operation, units = 1, refId = null }) {
  const unit = unitCost(provider, operation);
  if (!(unit > 0)) return null; // local/free providers never enter the book
  const id = `cost_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  insertRow(db, {
    id, owner_id: ownerId, provider, operation,
    unit_cost_usd: unit, units, cost_usd: unit * units, saved_usd: 0,
    ref_id: refId, created_at: new Date().toISOString(),
  });
  return { id, cost_usd: unit * units };
}

/** Record an AVOIDED call (cache hit) — the saving is the point. */
export function recordSaved(db, { ownerId, provider, operation, cacheSource, units = 1, refId = null }) {
  const unit = unitCost(provider, operation);
  if (!(unit > 0)) return null; // nothing would have been billed anyway
  const id = `cost_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  insertRow(db, {
    id, owner_id: ownerId, provider, operation,
    unit_cost_usd: unit, units, cost_usd: 0, saved_usd: unit * units,
    cache_source: cacheSource, ref_id: refId, created_at: new Date().toISOString(),
  });
  return { id, saved_usd: unit * units };
}

/** Owner-scoped totals + recent events for the telemetry endpoint. */
export function costSummary(db, ownerId, { limit = 20 } = {}) {
  const totals = db.prepare(`SELECT
      COALESCE(SUM(cost_usd), 0)  AS total_spend_usd,
      COALESCE(SUM(saved_usd), 0) AS total_saved_usd,
      SUM(CASE WHEN cost_usd > 0 THEN 1 ELSE 0 END)  AS paid_calls,
      SUM(CASE WHEN saved_usd > 0 THEN 1 ELSE 0 END) AS avoided_calls
    FROM provider_cost_ledger WHERE owner_id = ?`).get(ownerId);
  const byOperation = db.prepare(`SELECT operation,
      COALESCE(SUM(cost_usd), 0)  AS spend_usd,
      COALESCE(SUM(saved_usd), 0) AS saved_usd
    FROM provider_cost_ledger WHERE owner_id = ?
    GROUP BY operation ORDER BY operation`).all(ownerId);
  const events = db.prepare(`SELECT id, provider, operation, cost_usd, saved_usd,
      cache_source, ref_id, created_at
    FROM provider_cost_ledger WHERE owner_id = ?
    ORDER BY created_at DESC LIMIT ?`).all(ownerId, limit);
  return {
    pricing_model: 'estimated',
    total_spend_usd: Math.round(totals.total_spend_usd * 1e6) / 1e6,
    total_saved_usd: Math.round(totals.total_saved_usd * 1e6) / 1e6,
    paid_calls: totals.paid_calls || 0,
    avoided_calls: totals.avoided_calls || 0,
    by_operation: byOperation,
    events,
  };
}
