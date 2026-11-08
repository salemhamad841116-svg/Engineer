// ==============================================================================
// TenantGuard Middleware: Application-Level Row-Level Security (RLS)
// Strictly enforces tenant isolation across all Book and Knowledge APIs.
// Rejects cross-tenant access attempts with HTTP 403 Forbidden.
// ==============================================================================

const { AccessDeniedError } = require('../dal/knowledgeDal');

/**
 * Extracts and verifies tenant identity from request headers, session, or body.
 */
function extractTenantContext(req) {
  // 1. Direct custom header
  const headerTenant = req.headers['x-tenant-id'];

  // 2. Authenticated user or session
  const userTenant = req.user?.tenant_id || req.user?.tenantId || req.user?.id;
  const userRole = req.user?.role || 'user';

  // 3. Body or query parameter
  const bodyTenant = req.body?.tenantId;
  const queryTenant = req.query?.tenantId;

  const resolvedTenantId = headerTenant || userTenant || bodyTenant || queryTenant || 'default_tenant';

  // Cross-tenant mismatch validation: if header and body/query specify different tenants
  if (headerTenant && bodyTenant && headerTenant !== bodyTenant) {
    throw new AccessDeniedError(`Tenant mismatch detected: Header [${headerTenant}] does not match Body [${bodyTenant}]`, 403);
  }

  // Non-admin authenticated user cannot claim or access a foreign tenant
  if (userTenant && !['admin'].includes(userRole) && !req.user?.is_admin) {
    if (headerTenant && headerTenant !== userTenant) {
      throw new AccessDeniedError(`Cross-tenant violation: user [${userTenant}] cannot access foreign tenant [${headerTenant}]`, 403);
    }
    if (bodyTenant && bodyTenant !== userTenant) {
      throw new AccessDeniedError(`Cross-tenant violation: user [${userTenant}] cannot access foreign tenant [${bodyTenant}]`, 403);
    }
    if (queryTenant && queryTenant !== userTenant) {
      throw new AccessDeniedError(`Cross-tenant violation: user [${userTenant}] cannot access foreign tenant [${queryTenant}]`, 403);
    }
  }

  return {
    tenantId: String(resolvedTenantId).trim(),
    userId: String(userTenant || headerTenant || 'anonymous_user').trim(),
    role: userRole,
    isSuperAdmin: userRole === 'admin' || Boolean(req.user?.is_admin),
  };
}

/**
 * Express middleware that populates and validates req.tenantContext.
 */
function tenantGuard(req, res, next) {
  try {
    req.tenantContext = extractTenantContext(req);
    next();
  } catch (err) {
    if (err instanceof AccessDeniedError || err.statusCode === 403) {
      return res.status(403).json({
        error: 'Forbidden: Cross-tenant access violation',
        message: err.message,
        code: 'CROSS_TENANT_FORBIDDEN',
        statusCode: 403,
      });
    }
    return res.status(401).json({
      error: 'Unauthorized: Tenant authentication failed',
      message: err.message,
      code: 'TENANT_AUTH_REQUIRED',
      statusCode: 401,
    });
  }
}

/**
 * Strict variant: strictly rejects any request without an explicit tenant identifier.
 */
function requireStrictTenant(req, res, next) {
  try {
    const ctx = extractTenantContext(req);
    if (!ctx.tenantId || ctx.tenantId === 'default_tenant' && !req.headers['x-tenant-id']) {
      return res.status(403).json({
        error: 'Forbidden: Explicit tenant authentication required for this operation',
        code: 'EXPLICIT_TENANT_REQUIRED',
        statusCode: 403,
      });
    }
    req.tenantContext = ctx;
    next();
  } catch (err) {
    return res.status(403).json({
      error: 'Forbidden: Tenant isolation guard rejection',
      message: err.message,
      code: 'TENANT_GUARD_REJECTION',
      statusCode: 403,
    });
  }
}

module.exports = {
  tenantGuard,
  requireStrictTenant,
  extractTenantContext,
};
