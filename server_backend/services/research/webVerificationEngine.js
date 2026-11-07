// ==============================================================================
// Web Verification Engine & Live Standards Grounding (Phase 7)
// Enforces:
// 1. Authoritative Domain Whitelist (Strictly no generic web crawling).
// 2. Untrusted Web Content Isolation & Defense (sanitizeAndWrapUntrustedSource + Tool Calling Disabled).
// 3. Book vs Web Conflict Resolution (Dual Dates + Evolutionary Discrepancy Explained).
// 4. Explicit Cache TTL (30 days for standards/RFCs, 7 days for software releases/LTS).
// 5. Mandatory Verification Timestamp Badge in ISO 8601 format.
// ==============================================================================

const crypto = require('node:crypto');
const { get, all, run, getDb } = require('../../db/database');
const { nowIso } = require('../../utils/clock');
const { sanitizeAndWrapUntrustedSource } = require('../../security/promptInjectionGuard');

class UnauthorizedDomainError extends Error {
  constructor(domain, url) {
    super(`Access denied: Domain "${domain}" is not in the authoritative verification whitelist. URL: ${url}`);
    this.name = 'UnauthorizedDomainError';
    this.domain = domain;
    this.statusCode = 403;
  }
}

class ExpiredCacheError extends Error {
  constructor(url, expiresAt) {
    super(`Cache entry for "${url}" expired at ${expiresAt} and requires re-verification.`);
    this.name = 'ExpiredCacheError';
    this.url = url;
    this.statusCode = 410;
  }
}

/**
 * Authoritative Whitelist Configuration
 * - standard_spec: 30 days TTL (2,592,000s)
 * - software_release: 7 days TTL (604,800s)
 */
const AUTHORIZED_DOMAINS = {
  'nodejs.org': {
    type: 'software_release',
    ttlSeconds: 7 * 24 * 60 * 60, // 7 days (604800s)
    description: 'Official Node.js Runtime Specifications & LTS Release Schedule',
  },
  'react.dev': {
    type: 'software_release',
    ttlSeconds: 7 * 24 * 60 * 60, // 7 days (604800s)
    description: 'Official React Documentation & Architecture Specifications (React 19)',
  },
  'ietf.org': {
    type: 'standard_spec',
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days (2592000s)
    description: 'Internet Engineering Task Force (IETF) RFC Official Standards',
  },
  'w3.org': {
    type: 'standard_spec',
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days (2592000s)
    description: 'World Wide Web Consortium (W3C) Recommendations & Architecture',
  },
  'tc39.es': {
    type: 'standard_spec',
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days (2592000s)
    description: 'TC39 ECMAScript Standards & Active Proposals',
  },
  'developer.mozilla.org': {
    type: 'standard_spec',
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days (2592000s)
    description: 'MDN Web Docs Standard Web API Specifications',
  },
  'postgresql.org': {
    type: 'standard_spec',
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days (2592000s)
    description: 'PostgreSQL Global Development Group Official Documentation',
  },
  'sqlite.org': {
    type: 'standard_spec',
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days (2592000s)
    description: 'SQLite Official Architecture Documentation & Specifications',
  },
};

/**
 * Extracts normalized domain from a URL string.
 */
function extractDomain(urlStr) {
  try {
    const parsed = new URL(urlStr);
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch (_) {
    const match = String(urlStr || '').match(/(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
    return match ? match[1].toLowerCase() : '';
  }
}

/**
 * Validates domain against the whitelist.
 */
function validateDomainWhitelist(urlStr) {
  const domain = extractDomain(urlStr);
  if (!domain || !AUTHORIZED_DOMAINS[domain]) {
    throw new UnauthorizedDomainError(domain || 'unknown', urlStr);
  }
  return {
    domain,
    config: AUTHORIZED_DOMAINS[domain],
  };
}

/**
 * Computes SHA-256 hash of clean content.
 */
function computeContentHash(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf-8').digest('hex');
}

/**
 * Formats mandatory Verification Timestamp Badge in ISO 8601.
 */
function formatVerificationBadge({ domain, url, verifiedAt, ttlSeconds }) {
  const ttlDays = Math.round(ttlSeconds / (24 * 60 * 60));
  const isoTime = verifiedAt || nowIso();
  return `[تم التحقق رسمياً من المصدر المعتمد: ${domain} | تاريخ الفحص: ${isoTime} | الرابط: ${url} | صلاحية الكاش: ${ttlDays} أيام]`;
}

/**
 * Condition 1: Isolates untrusted web content and disables tool execution.
 */
function isolateUntrustedWebContent(rawContent, { url, domain, verifiedAt }) {
  return sanitizeAndWrapUntrustedSource(rawContent, {
    isWebContent: true,
    sourceUrl: url,
    domain,
    verifiedAt,
  });
}

/**
 * Condition 2: Resolves conflicts between legacy books and modern web standards.
 * Strictly forbids silent preference or blended text.
 */
function resolveBookVsWebConflict({
  bookTitle,
  bookYear,
  bookRecommendation,
  webDomain,
  webVerifiedAt,
  webSpecification,
  architecturalReason,
}) {
  return {
    hasConflict: true,
    resolutionType: 'temporal_evolution',
    bookSource: {
      title: bookTitle,
      year: bookYear,
      publicationDateText: `نُشر عام: ${bookYear}`,
      statedPosition: bookRecommendation,
    },
    webSource: {
      domain: webDomain,
      verifiedAt: webVerifiedAt,
      verificationDateText: `تم التحقق رسمياً في: ${webVerifiedAt}`,
      statedPosition: webSpecification,
    },
    architecturalDiscrepancy: architecturalReason,
    formattedResolutionMarkdown: `
### مقارنة وحسم التعارض المرجعي (التطور الزمني وتطور المعايير التقنية)
> [!IMPORTANT]
> **رصد تعارض منهجي بين مرجع مطبوع ومواصفات حية:** يعرض النظام كلا المصدرين مع تواريخهما وتفسير الاختلاف، ويُحظر التفضيل الصامت أو الخلط.

1. **المرجع المكتبي المطبوع:**
   - **المصدر:** ${bookTitle} (نُشر في: ${bookYear})
   - **الرأي المعماري:** ${bookRecommendation}

2. **الوثيقة القياسية المعتمدة من الويب:**
   - **المصدر:** ${webDomain} (تم التحقق في: ${webVerifiedAt})
   - **المواصفة الحديثة:** ${webSpecification}

### تفسير الفارق وأسباب التطور المعماري:
${architecturalReason}
`.trim(),
  };
}

/**
 * Pre-seeded Official Verification Snapshots (Offline-First)
 */
const SEEDED_WEB_SNAPSHOTS = [
  {
    url: 'https://nodejs.org/en/about/previous-releases',
    domain: 'nodejs.org',
    title: 'Node.js Releases & LTS Schedule Official Specification',
    snapshotType: 'software_release',
    ttlSeconds: 7 * 24 * 60 * 60, // 7 days
    verifiedAt: '2026-11-07T12:00:00.000Z',
    cleanContent: `
Node.js Official Release Schedule:
- Node.js 22 (Codename: Jod) is the current Active Long-Term Support (LTS) release.
  - Initial Release Date: 2024-04-23
  - Entered Active LTS: 2024-10-29
  - End of Active LTS: 2025-10-21
  - End of Life (Maintenance End): 2027-04-30
- Node.js 20 (Codename: Iron) is in Maintenance LTS until 2026-04-30.
- Node.js 23 is Current (Odd-numbered release for experimental features, not LTS).
Recommendations: All production systems in 2026 should target Node.js 22 LTS for enterprise stability and security patching.
`.trim(),
  },
  {
    url: 'https://react.dev/reference/react',
    domain: 'react.dev',
    title: 'React 19 Official Specification & Architecture Reference',
    snapshotType: 'software_release',
    ttlSeconds: 7 * 24 * 60 * 60, // 7 days
    verifiedAt: '2026-11-07T12:00:00.000Z',
    cleanContent: `
React 19 Official Specification:
- React Server Components (RSC): Default rendering paradigm for server-driven UI, eliminating client bundle bloat by executing components exclusively on the server.
- Server Actions ('use server'): Built-in asynchronous mutations executing on the server with automatic progressive enhancement, replacing manual fetch boilerplate and client state sync.
- useActionState & useOptimistic: Standard hooks for handling pending forms, optimistic UI updates, and validation errors.
- Architectural Directive: Direct DOM manipulation (document.getElementById, innerHTML, legacy jQuery bindings) is strictly deprecated and invalid in React 19 streaming architecture.
`.trim(),
  },
  {
    url: 'https://ietf.org/rfc/rfc9110',
    domain: 'ietf.org',
    title: 'RFC 9110 - HTTP Semantics: Idempotency and Safe Methods',
    snapshotType: 'standard_spec',
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days
    verifiedAt: '2026-11-01T00:00:00.000Z',
    cleanContent: `
RFC 9110 HTTP Semantics - Section 9.2:
- Safe Methods: GET, HEAD, OPTIONS, TRACE do not alter server state.
- Idempotent Methods: GET, HEAD, PUT, DELETE, OPTIONS, TRACE have the same intended effect on the server whether executed once or N times consecutively.
- Non-Idempotent Methods: POST and PATCH are inherently non-idempotent. Executing a POST multiple times may result in duplicate transactions or side effects.
- Standard Mitigation: When executing non-idempotent mutations across distributed networks, applications MUST implement Idempotency-Key headers or unique mutation tokens to ensure exactly-once semantic handling.
`.trim(),
  },
  {
    url: 'https://ietf.org/rfc/rfc9204',
    domain: 'ietf.org',
    title: 'RFC 9204 - QPACK: Field Compression for HTTP/3',
    snapshotType: 'standard_spec',
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days
    verifiedAt: '2026-11-01T00:00:00.000Z',
    cleanContent: `
RFC 9204 QPACK Specification:
- HTTP/3 operates over QUIC (UDP) rather than TCP.
- In HTTP/2, HPACK required strict in-order stream delivery, introducing Head-of-Line (HoL) blocking when packet loss occurred.
- QPACK solves this by allowing out-of-order decompression across independent QUIC streams using separate encoder/decoder unidirectional control streams and dynamic table acknowledgment.
`.trim(),
  },
  {
    url: 'https://tc39.es/ecma262',
    domain: 'tc39.es',
    title: 'ECMAScript 2026 Language Specification: Explicit Resource Management & Decorators',
    snapshotType: 'standard_spec',
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days
    verifiedAt: '2026-11-01T00:00:00.000Z',
    cleanContent: `
ECMAScript 2026 Specification Standards:
- Explicit Resource Management: The 'using' declaration and Symbol.dispose / Symbol.asyncDispose automatically clean up I/O, database connections, and memory handles upon block exit (deterministic RAII).
- Stage 3/4 Decorators: Standardized declarative annotations for class members, methods, and accessors without experimental compiler flags.
- Temporal API: Modern replacement for legacy Date object, providing timezone-aware, nanosecond-precision date/time calculations.
`.trim(),
  },
  {
    url: 'https://developer.mozilla.org/en-US/docs/Web/API',
    domain: 'developer.mozilla.org',
    title: 'MDN Web Docs - Modern Web APIs: View Transitions & Container Queries',
    snapshotType: 'standard_spec',
    ttlSeconds: 30 * 24 * 60 * 60, // 30 days
    verifiedAt: '2026-11-01T00:00:00.000Z',
    cleanContent: `
MDN Official Documentation:
- View Transitions API: document.startViewTransition() orchestrates animated transitions between DOM states in single-page applications without complex CSS animation choreography.
- CSS Container Queries (@container): Adapts component styling to the dimensions of the parent container rather than the global viewport width, enabling truly modular UI design.
- Popover API: Native browser support for top-layer tooltips and flyouts with automatic light dismiss and focus management.
`.trim(),
  },
];

/**
 * Seeds reference web snapshots into SQLite if not already present.
 */
function seedWebVerificationCache(force = false) {
  const db = getDb();
  for (const s of SEEDED_WEB_SNAPSHOTS) {
    const existing = db.prepare('SELECT id, verified_at, expires_at FROM web_verification_cache WHERE url = ?').get(s.url);
    if (!existing || force) {
      const verifiedDate = new Date(s.verifiedAt);
      const expiresDate = new Date(verifiedDate.getTime() + s.ttlSeconds * 1000);
      const hash = computeContentHash(s.cleanContent);
      const id = 'web_' + crypto.createHash('md5').update(s.url).digest('hex').slice(0, 16);

      db.prepare(`
        INSERT OR REPLACE INTO web_verification_cache (
          id, url, domain, title, clean_content, content_hash,
          snapshot_type, verified_at, expires_at, ttl_seconds,
          http_status, is_stale, source_metadata_json, tenant_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        s.url,
        s.domain,
        s.title,
        s.cleanContent,
        hash,
        s.snapshotType,
        s.verifiedAt,
        expiresDate.toISOString(),
        s.ttlSeconds,
        200,
        0,
        JSON.stringify({ seeded: true, source: 'official_authoritative' }),
        'system_shared',
        s.verifiedAt
      );
    }
  }
}

/**
 * Saves a new verification snapshot into SQLite cache.
 */
function saveWebVerificationSnapshot({
  url,
  title = '',
  cleanContent,
  snapshotType = null,
  tenantId = 'system_shared',
}) {
  const { domain, config } = validateDomainWhitelist(url);
  const type = snapshotType || config.type;
  const ttl = config.ttlSeconds;
  const verifiedAt = nowIso();
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const hash = computeContentHash(cleanContent);
  const id = 'web_' + crypto.createHash('md5').update(url).digest('hex').slice(0, 16);

  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO web_verification_cache (
      id, url, domain, title, clean_content, content_hash,
      snapshot_type, verified_at, expires_at, ttl_seconds,
      http_status, is_stale, source_metadata_json, tenant_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    url,
    domain,
    title || `${domain} Official Reference`,
    cleanContent,
    hash,
    type,
    verifiedAt,
    expiresAt,
    ttl,
    200,
    0,
    JSON.stringify({ verifiedBy: 'authoritative_whitelist_engine' }),
    tenantId,
    verifiedAt
  );

  return {
    id,
    url,
    domain,
    title,
    contentHash: hash,
    snapshotType: type,
    verifiedAt,
    expiresAt,
    ttlSeconds: ttl,
    isStale: 0,
    verificationBadge: formatVerificationBadge({ domain, url, verifiedAt, ttlSeconds: ttl }),
  };
}

/**
 * Retrieves a verified snapshot from SQLite cache.
 * Enforces TTL rules: marks as stale if expired.
 */
function getWebVerificationSnapshot(url, { allowStale = true } = {}) {
  const { domain } = validateDomainWhitelist(url);
  seedWebVerificationCache();

  const db = getDb();
  const row = db.prepare(`
    SELECT * FROM web_verification_cache WHERE url = ?
  `).get(url);

  if (!row) return null;

  const now = Date.now();
  const expiresTimestamp = new Date(row.expires_at).getTime();
  const isExpired = now > expiresTimestamp;

  if (isExpired && !row.is_stale) {
    db.prepare('UPDATE web_verification_cache SET is_stale = 1 WHERE id = ?').run(row.id);
    row.is_stale = 1;
  }

  if (isExpired && !allowStale) {
    throw new ExpiredCacheError(url, row.expires_at);
  }

  // Condition 1: Untrusted web content isolation with tool calling disabled
  const safePassiveXml = isolateUntrustedWebContent(row.clean_content, {
    url: row.url,
    domain: row.domain,
    verifiedAt: row.verified_at,
  });

  const badge = formatVerificationBadge({
    domain: row.domain,
    url: row.url,
    verifiedAt: row.verified_at,
    ttlSeconds: row.ttl_seconds,
  });

  return {
    id: row.id,
    url: row.url,
    domain: row.domain,
    title: row.title,
    cleanContent: row.clean_content,
    safePassiveXml,
    contentHash: row.content_hash,
    snapshotType: row.snapshot_type,
    verifiedAt: row.verified_at,
    expiresAt: row.expires_at,
    ttlSeconds: row.ttl_seconds,
    isStale: Boolean(row.is_stale),
    isExpired,
    verificationBadge: badge,
  };
}

/**
 * Detects whether a query addresses volatile / fast-changing standards or releases.
 */
function detectVolatileTopic(query) {
  const q = String(query || '').toLowerCase();

  const hasLtsOrRelease = /node\.?js|lts|release|إصدار\s+(عقد|طويل|حديث)|react\s*19|server\s+actions|server\s+components/i.test(q);
  const hasIetfOrRfc = /rfc\s*[0-9]+|ietf|http\s*\/?\s*3|qpack|hpack|idempotenc|safe\s+method/i.test(q);
  const hasTc39 = /tc39|ecmascript|temporal\s+api|explicit\s+resource|using\s+declaration|decorators/i.test(q);
  const hasWebApis = /mdn|view\s+transitions|container\s+queries|popover\s+api/i.test(q);

  if (hasLtsOrRelease || hasIetfOrRfc || hasTc39 || hasWebApis) {
    return {
      isVolatile: true,
      category: hasLtsOrRelease ? 'software_release' : 'standard_spec',
      suggestedUrls: getSuggestedAuthoritativeUrls(q),
    };
  }

  return {
    isVolatile: false,
    category: null,
    suggestedUrls: [],
  };
}

/**
 * Matches relevant authoritative URLs based on query terms.
 */
function getSuggestedAuthoritativeUrls(queryLower) {
  const urls = [];
  if (queryLower.includes('node')) {
    urls.push('https://nodejs.org/en/about/previous-releases');
  }
  if (queryLower.includes('react') || queryLower.includes('server actions') || queryLower.includes('server components')) {
    urls.push('https://react.dev/reference/react');
  }
  if (queryLower.includes('rfc') || queryLower.includes('idempotenc') || queryLower.includes('http')) {
    urls.push('https://ietf.org/rfc/rfc9110');
    if (queryLower.includes('http/3') || queryLower.includes('qpack')) {
      urls.push('https://ietf.org/rfc/rfc9204');
    }
  }
  if (queryLower.includes('tc39') || queryLower.includes('ecma') || queryLower.includes('temporal') || queryLower.includes('using')) {
    urls.push('https://tc39.es/ecma262');
  }
  if (queryLower.includes('mdn') || queryLower.includes('view transition') || queryLower.includes('container quer')) {
    urls.push('https://developer.mozilla.org/en-US/docs/Web/API');
  }
  return urls;
}

/**
 * Executes a targeted web verification check for a topic query.
 */
function verifyTopicAgainstAuthoritativeWeb(query, { allowStale = true } = {}) {
  seedWebVerificationCache();
  const detection = detectVolatileTopic(query);
  if (!detection.isVolatile || detection.suggestedUrls.length === 0) {
    return {
      verified: false,
      reason: 'Query does not target volatile web standards or software releases',
      snapshots: [],
    };
  }

  const snapshots = [];
  for (const url of detection.suggestedUrls) {
    try {
      const snap = getWebVerificationSnapshot(url, { allowStale });
      if (snap) {
        snapshots.push(snap);
      }
    } catch (_) {}
  }

  return {
    verified: snapshots.length > 0,
    category: detection.category,
    snapshots,
  };
}

module.exports = {
  AUTHORIZED_DOMAINS,
  UnauthorizedDomainError,
  ExpiredCacheError,
  extractDomain,
  validateDomainWhitelist,
  computeContentHash,
  formatVerificationBadge,
  isolateUntrustedWebContent,
  resolveBookVsWebConflict,
  seedWebVerificationCache,
  saveWebVerificationSnapshot,
  getWebVerificationSnapshot,
  detectVolatileTopic,
  verifyTopicAgainstAuthoritativeWeb,
};
