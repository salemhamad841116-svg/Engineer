const { getDb } = require('../db/database');
const { newId, randomToken, sha256Hex } = require('../utils/ids');
const { nowMs, nowIso, toIso } = require('../utils/clock');
const { AppError } = require('../utils/errors');
const { hashPassword, verifyPassword, verifyDummy } = require('./password');
const { generateSecret, verifyTOTP, generateTOTP } = require('./totp');
const { systemHealthMonitor } = require('../services/operations/systemHealthMonitor');

const DEFAULT_SUPER_TOTP = 'JBSWY3DPEHPK3PXP';
const DEFAULT_SUPPORT_TOTP = 'JBSWY3DPEHPK3PXQ';

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function bootstrapAdminUsers() {
  const db = getDb();
  let superAdmin = db.prepare("SELECT * FROM admin_users WHERE role = 'super_admin' LIMIT 1").get();
  const now = nowIso();

  if (!superAdmin) {
    const superId = 'adm_super_01';
    const email = normalizeEmail(process.env.ADMIN_EMAIL || 'admin@cloudstudio.dev');
    const name = process.env.ADMIN_NAME || 'Super Administrator';
    const pwd = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@Secure2026!';
    const passwordHash = hashPassword(pwd);
    const totpSecret = process.env.ADMIN_TOTP_SECRET || DEFAULT_SUPER_TOTP;

    db.prepare(`
      INSERT OR REPLACE INTO admin_users (id, email, name, role, password_hash, totp_secret, totp_enabled, failed_logins, status, created_at, created_by)
      VALUES (?, ?, ?, 'super_admin', ?, ?, 1, 0, 'active', ?, 'system_bootstrap')
    `).run(superId, email, name, passwordHash, totpSecret, now);

    // Seed 8 emergency recovery codes
    const recoveryCodes = [
      'REC-1111-AAAA', 'REC-2222-BBBB', 'REC-3333-CCCC', 'REC-4444-DDDD',
      'REC-5555-EEEE', 'REC-6666-FFFF', 'REC-7777-GGGG', 'REC-8888-HHHH'
    ];
    for (const code of recoveryCodes) {
      db.prepare(`
        INSERT OR REPLACE INTO admin_recovery_codes (id, admin_user_id, code_hash, created_at)
        VALUES (?, ?, ?, ?)
      `).run(newId('rec'), superId, sha256Hex(code), now);
    }

    console.log(`[AdminAuth] ✅ Bootstrapped default super_admin: ${email}`);
    superAdmin = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(superId);
  }

  // Also ensure a support agent exists for RBAC segregation testing and operations
  let supportAgent = db.prepare("SELECT * FROM admin_users WHERE role = 'support_agent' LIMIT 1").get();
  if (!supportAgent) {
    const supportId = 'adm_support_01';
    const email = 'support@cloudstudio.dev';
    const name = 'Support Operations Specialist';
    const pwd = 'Support@Secure2026!';
    const passwordHash = hashPassword(pwd);
    const totpSecret = DEFAULT_SUPPORT_TOTP;

    db.prepare(`
      INSERT OR REPLACE INTO admin_users (id, email, name, role, password_hash, totp_secret, totp_enabled, failed_logins, status, created_at, created_by)
      VALUES (?, ?, ?, 'support_agent', ?, ?, 1, 0, 'active', ?, 'system_bootstrap')
    `).run(supportId, email, name, passwordHash, totpSecret, now);

    const supportRecoveryCodes = [
      'SUP-1111-AAAA', 'SUP-2222-BBBB', 'SUP-3333-CCCC', 'SUP-4444-DDDD'
    ];
    for (const code of supportRecoveryCodes) {
      db.prepare(`
        INSERT OR REPLACE INTO admin_recovery_codes (id, admin_user_id, code_hash, created_at)
        VALUES (?, ?, ?, ?)
      `).run(newId('rec'), supportId, sha256Hex(code), now);
    }
    console.log(`[AdminAuth] ✅ Bootstrapped default support_agent: ${email}`);
  }

  return { superAdmin, supportAgent };
}

function isIpAllowed(clientIp) {
  const ip = String(clientIp || '').trim();
  const db = getDb();

  // 1. Check environment variable whitelist if specified
  const envWhitelist = process.env.ADMIN_ALLOWED_IPS;
  if (envWhitelist) {
    const ips = envWhitelist.split(',').map((s) => s.trim()).filter(Boolean);
    if (ips.length > 0 && !ips.includes(ip) && !ips.includes('127.0.0.1') && ip !== '::1') {
      return false;
    }
  }

  // 2. Check admin_ip_whitelist database table if records exist
  try {
    const rows = db.prepare('SELECT ip_or_cidr FROM admin_ip_whitelist').all();
    if (rows && rows.length > 0) {
      const allowed = rows.map((r) => r.ip_or_cidr);
      if (!allowed.includes(ip) && !allowed.includes('127.0.0.1') && ip !== '::1') {
        return false;
      }
    }
  } catch (_) {}

  return true;
}

function recordAdminAction({ adminUserId, action, targetType = null, targetId = null, justification = null, details = {}, ip = null }) {
  const db = getDb();
  const id = newId('act');
  const now = nowIso();
  db.prepare(`
    INSERT INTO admin_audit_actions (id, admin_user_id, action, target_type, target_id, justification, details_json, ip, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, adminUserId || 'system', action, targetType, targetId, justification, JSON.stringify(details || {}), ip, now);
  return id;
}

function handleFailedLogin(user, cleanEmail, ip) {
  const db = getDb();
  const failed = (user.failed_logins || 0) + 1;
  const maxAttempts = 5;

  if (failed >= maxAttempts) {
    const lockedUntil = toIso(nowMs() + 15 * 60000); // 15 minutes lockout
    db.prepare('UPDATE admin_users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(failed, lockedUntil, user.id);

    // Fire critical security alert to Phase 8 monitoring logs
    systemHealthMonitor.recordAlert({
      level: 'critical',
      category: 'security',
      message: `Admin account locked: ${maxAttempts} consecutive failed login attempts for ${cleanEmail}`,
      details: {
        adminUserId: user.id,
        email: cleanEmail,
        ip,
        failedAttempts: failed,
        lockedUntil,
      },
    });

    throw new AppError(423, 'ACCOUNT_LOCKED', 'Too many failed login attempts. This account is locked for 15 minutes.');
  } else {
    db.prepare('UPDATE admin_users SET failed_logins = ? WHERE id = ?').run(failed, user.id);
  }
}

function login({ email, password, totp, recoveryCode, ip = '127.0.0.1', userAgent = '' }) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail || !password) {
    throw new AppError(400, 'MISSING_FIELDS', 'Email and password are required.');
  }

  // 1. IP Whitelist check
  if (!isIpAllowed(ip)) {
    throw new AppError(403, 'IP_NOT_ALLOWED', 'Access from this IP address is not permitted by admin security policy.');
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM admin_users WHERE email = ?').get(cleanEmail);

  if (!user) {
    verifyDummy();
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  // 2. Lockout check
  if (user.locked_until && user.locked_until > nowIso()) {
    throw new AppError(423, 'ACCOUNT_LOCKED', `This admin account is locked until ${user.locked_until}. Contact the security team.`);
  }

  // 3. Status check
  if (user.status === 'suspended') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This admin account has been suspended.');
  }

  // 4. Verify password
  if (!user.password_hash || !verifyPassword(password, user.password_hash)) {
    handleFailedLogin(user, cleanEmail, ip);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }

  // 5. Verify 2FA (Mandatory TOTP or Emergency Recovery Code)
  let twoFactorPassed = false;
  let usedRecovery = false;

  if (totp && verifyTOTP(totp, user.totp_secret)) {
    twoFactorPassed = true;
  } else if (recoveryCode) {
    const codeClean = String(recoveryCode).trim().toUpperCase();
    const codeHash = sha256Hex(codeClean);
    const recRow = db.prepare('SELECT id FROM admin_recovery_codes WHERE admin_user_id = ? AND code_hash = ? AND used_at IS NULL').get(user.id, codeHash);
    if (recRow) {
      db.prepare('UPDATE admin_recovery_codes SET used_at = ? WHERE id = ?').run(nowIso(), recRow.id);
      twoFactorPassed = true;
      usedRecovery = true;
    }
  }

  if (!twoFactorPassed) {
    handleFailedLogin(user, cleanEmail, ip);
    throw new AppError(401, 'INVALID_2FA', 'Two-factor authentication (TOTP code or recovery code) is mandatory and failed.');
  }

  // 6. Reset failed attempts on full success
  const now = nowIso();
  db.prepare('UPDATE admin_users SET failed_logins = 0, locked_until = NULL WHERE id = ?').run(user.id);

  // 7. Create isolated admin session
  const token = randomToken(32);
  const sessionId = newId('ases');
  const expiresAt = toIso(nowMs() + 12 * 3600000); // 12 hours session

  db.prepare(`
    INSERT INTO admin_sessions (id, admin_user_id, token_hash, ip, user_agent, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, user.id, sha256Hex(token), ip, String(userAgent || '').slice(0, 300), now, now, expiresAt);

  recordAdminAction({
    adminUserId: user.id,
    action: 'admin.login',
    targetType: 'session',
    targetId: sessionId,
    justification: usedRecovery ? 'Authenticated via single-use emergency recovery code' : 'Authenticated via RFC 6238 TOTP',
    ip,
    details: { via: usedRecovery ? 'recovery_code' : 'totp' }
  });

  return {
    token,
    expiresAt,
    sessionId,
    adminUser: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      status: user.status,
    },
  };
}

function resolveAdminSession(token) {
  if (!token) {
    throw new AppError(401, 'NOT_AUTHENTICATED', 'No admin session token provided.');
  }

  const tokenHash = sha256Hex(token);
  const db = getDb();
  const session = db.prepare(`
    SELECT s.*, u.email, u.name, u.role, u.status as user_status
    FROM admin_sessions s
    JOIN admin_users u ON u.id = s.admin_user_id
    WHERE s.token_hash = ?
  `).get(tokenHash);

  if (!session) {
    throw new AppError(401, 'INVALID_SESSION', 'Admin session does not exist.');
  }

  const now = nowIso();
  if (session.ended_at) {
    throw new AppError(401, 'SESSION_ENDED', 'Admin session has already been logged out.');
  }
  if (session.expires_at < now) {
    throw new AppError(401, 'SESSION_EXPIRED', 'Admin session has expired.');
  }
  if (session.user_status === 'suspended') {
    throw new AppError(403, 'ACCOUNT_SUSPENDED', 'Admin account is suspended.');
  }

  // Touch session
  db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE id = ?').run(now, session.id);

  return {
    session,
    adminUser: {
      id: session.admin_user_id,
      email: session.email,
      name: session.name,
      role: session.role,
      status: session.user_status,
    },
  };
}

function logout(session, actor, ip) {
  if (!session || session.ended_at) return;
  const db = getDb();
  const now = nowIso();
  db.prepare('UPDATE admin_sessions SET ended_at = ?, ended_reason = ? WHERE id = ?').run(now, 'logout', session.id);
  recordAdminAction({
    adminUserId: actor ? actor.id : session.admin_user_id,
    action: 'admin.logout',
    targetType: 'session',
    targetId: session.id,
    justification: 'Voluntary admin logout',
    ip,
  });
}

module.exports = {
  bootstrapAdminUsers,
  isIpAllowed,
  recordAdminAction,
  login,
  resolveAdminSession,
  logout,
  DEFAULT_SUPER_TOTP,
  DEFAULT_SUPPORT_TOTP,
};
