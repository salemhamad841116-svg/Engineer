/**
 * subdomainRouter.js
 * Phase 9 Strict Subdomain Isolation Middleware
 *
 * Guarantees that:
 * 1. The admin portal is ONLY accessible via an admin subdomain (e.g. admin.domain.com or admin.localhost).
 * 2. Any request on the main domain to /admin, /admin/*, /api/admin, or /api/admin/* receives an absolute,
 *    hard HTTP 404 Not Found (no redirects, no login pages, zero leakage).
 */

function parseHost(req) {
  const headers = req.headers || {};
  const rawHost = headers['x-forwarded-host'] || headers['host'] || headers['Host'] || req.hostname || '';
  return String(rawHost).split(':')[0].trim().toLowerCase();
}

function isAdminDomain(host) {
  if (!host) return false;
  const h = String(host).split(':')[0].trim().toLowerCase();
  const configuredAdminHost = (process.env.ADMIN_HOST || '').toLowerCase().trim();
  if (configuredAdminHost && h === configuredAdminHost) {
    return true;
  }
  // Dedicated engineer management domain & admin subdomains
  if (h === 'engineer-mgt.misruq.com' || h.startsWith('engineer-mgt.')) {
    return true;
  }
  return h.startsWith('admin.') || h === 'admin.localhost' || h === 'admin.local';
}

function subdomainRouterMiddleware(req, res, next) {
  const host = parseHost(req);
  const isAdmin = isAdminDomain(host);

  req.parsedHost = host;
  req.isAdminPortal = isAdmin;

  // Strict isolation rule: On non-admin domains, any admin path MUST return a pure 404
  if (!isAdmin) {
    const p = req.path.toLowerCase();
    if (p === '/admin' || p.startsWith('/admin/') || p === '/api/admin' || p.startsWith('/api/admin/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      return res.status(404).type('text/html').send(
        '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>404 Not Found</title></head><body><center><h1>404 Not Found</h1></center><hr><center>nginx</center></body></html>'
      );
    }
  }

  next();
}

module.exports = {
  parseHost,
  isAdminDomain,
  subdomainRouterMiddleware,
};
