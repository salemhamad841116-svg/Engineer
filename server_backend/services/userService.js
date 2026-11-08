// server_backend/services/userService.js
// Phase 10: User Profile, Settings Synchronization, Session Auditing & Cascade Deletion Service
const { get, all, run, tx } = require('../db/database');
const { nowIso, nowMs } = require('../utils/clock');
const { AppError } = require('../utils/errors');
const { verifyPassword, validatePasswordStrength, hashPassword } = require('../auth/password');
const audit = require('./auditService');
const { endSession } = require('../auth/authService');

const DEFAULT_STORAGE_QUOTA = 104857600; // 100 MB

function getDbUser(userId) {
  const user = get('SELECT * FROM users WHERE id = ?', userId);
  if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'User account does not exist.');
  return user;
}

function getUserProfile(userId) {
  const user = getDbUser(userId);
  const quota = user.storage_quota_bytes || DEFAULT_STORAGE_QUOTA;

  // Aggregate document storage & counts
  const docStats = get(
    `SELECT COUNT(*) AS docs_count, COALESCE(SUM(size_bytes), 0) AS total_bytes 
     FROM documents 
     WHERE owner_id = ? OR tenant_id = ?`,
    userId,
    userId
  ) || { docs_count: 0, total_bytes: 0 };

  const chunkStats = get(
    `SELECT COALESCE(SUM(LENGTH(c.text)), 0) AS chunk_bytes 
     FROM chunks c 
     JOIN documents d ON c.document_id = d.id 
     WHERE d.owner_id = ? OR d.tenant_id = ?`,
    userId,
    userId
  ) || { chunk_bytes: 0 };

  const totalUsedBytes = Number(docStats.total_bytes) + Number(chunkStats.chunk_bytes);
  const usedPercentage = Math.min(100, Math.round((totalUsedBytes / quota) * 1000) / 10);

  const searchesCount = get(
    'SELECT COUNT(*) AS c FROM research_sessions WHERE user_id = ? OR tenant_id = ?',
    userId,
    userId
  )?.c || 0;

  const feedbacksCount = get(
    'SELECT COUNT(*) AS c FROM research_feedback WHERE tenant_id = ?',
    userId
  )?.c || 0;

  const lastLoginSession = get(
    'SELECT ip, created_at FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    userId
  );

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatar_url || null,
    role: user.role,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at || lastLoginSession?.created_at || null,
    lastLoginIp: lastLoginSession?.ip || null,
    booksCount: Number(docStats.docs_count),
    searchesCount: Number(searchesCount),
    feedbacksCount: Number(feedbacksCount),
    storageQuotaBytes: Number(quota),
    storageUsedBytes: Number(totalUsedBytes),
    storageUsedPercentage: Number(usedPercentage),
  };
}

function updateUserProfile(userId, { name, avatarUrl }) {
  const user = getDbUser(userId);
  const cleanName = name !== undefined ? String(name).trim() : user.name;
  if (!cleanName) throw new AppError(400, 'INVALID_NAME', 'Name cannot be empty.');

  let cleanAvatar = avatarUrl !== undefined ? avatarUrl : user.avatar_url;
  if (cleanAvatar !== null && typeof cleanAvatar === 'string') {
    cleanAvatar = cleanAvatar.trim();
    if (cleanAvatar.length > 2500000) {
      throw new AppError(400, 'AVATAR_TOO_LARGE', 'Avatar image exceeds size limit of 2MB.');
    }
  }

  run('UPDATE users SET name = ?, avatar_url = ? WHERE id = ?', cleanName, cleanAvatar, userId);

  audit.record({
    action: 'account.profile_updated',
    actor: { id: user.id, name: cleanName, role: user.role },
    detail: { previousName: user.name, newName: cleanName, avatarChanged: cleanAvatar !== user.avatar_url },
  });

  return getUserProfile(userId);
}

function getUserSettings(userId) {
  getDbUser(userId);
  let row = get('SELECT * FROM user_settings WHERE user_id = ?', userId);
  const now = nowIso();

  if (!row) {
    run(
      `INSERT OR IGNORE INTO user_settings 
       (user_id, language, theme, default_research_tier, show_page_numbers, answer_length, show_quality_badges, retain_search_history, created_at, updated_at)
       VALUES (?, 'ar', 'dark', 'deep', 1, 'detailed', 1, 1, ?, ?)`,
      userId,
      now,
      now
    );
    row = get('SELECT * FROM user_settings WHERE user_id = ?', userId);
  }

  return {
    userId: row.user_id,
    language: row.language,
    theme: row.theme,
    defaultResearchTier: row.default_research_tier,
    showPageNumbers: Boolean(row.show_page_numbers),
    answerLength: row.answer_length,
    showQualityBadges: Boolean(row.show_quality_badges),
    retainSearchHistory: Boolean(row.retain_search_history),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function updateUserSettings(userId, patch) {
  const current = getUserSettings(userId);
  const now = nowIso();

  const language = patch.language !== undefined ? String(patch.language) : current.language;
  if (!['ar', 'en'].includes(language)) throw new AppError(400, 'INVALID_LANGUAGE', 'Language must be "ar" or "en".');

  const theme = patch.theme !== undefined ? String(patch.theme) : current.theme;
  if (!['dark', 'light', 'system'].includes(theme)) throw new AppError(400, 'INVALID_THEME', 'Theme must be "dark", "light", or "system".');

  const defaultResearchTier = patch.defaultResearchTier !== undefined ? String(patch.defaultResearchTier) : current.defaultResearchTier;
  if (!['quick', 'deep', 'expert'].includes(defaultResearchTier)) {
    throw new AppError(400, 'INVALID_RESEARCH_TIER', 'Tier must be "quick", "deep", or "expert".');
  }

  const answerLength = patch.answerLength !== undefined ? String(patch.answerLength) : current.answerLength;
  if (!['concise', 'detailed'].includes(answerLength)) {
    throw new AppError(400, 'INVALID_ANSWER_LENGTH', 'Answer length must be "concise" or "detailed".');
  }

  const showPageNumbers = patch.showPageNumbers !== undefined ? (patch.showPageNumbers ? 1 : 0) : (current.showPageNumbers ? 1 : 0);
  const showQualityBadges = patch.showQualityBadges !== undefined ? (patch.showQualityBadges ? 1 : 0) : (current.showQualityBadges ? 1 : 0);
  const retainSearchHistory = patch.retainSearchHistory !== undefined ? (patch.retainSearchHistory ? 1 : 0) : (current.retainSearchHistory ? 1 : 0);

  run(
    `INSERT INTO user_settings 
     (user_id, language, theme, default_research_tier, show_page_numbers, answer_length, show_quality_badges, retain_search_history, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       language = excluded.language,
       theme = excluded.theme,
       default_research_tier = excluded.default_research_tier,
       show_page_numbers = excluded.show_page_numbers,
       answer_length = excluded.answer_length,
       show_quality_badges = excluded.show_quality_badges,
       retain_search_history = excluded.retain_search_history,
       updated_at = excluded.updated_at`,
    userId,
    language,
    theme,
    defaultResearchTier,
    showPageNumbers,
    answerLength,
    showQualityBadges,
    retainSearchHistory,
    current.createdAt || now,
    now
  );

  audit.record({
    action: 'account.settings_updated',
    actor: { id: userId, name: 'user', role: 'supervisor' },
    detail: { patch },
  });

  return getUserSettings(userId);
}

function getUserSessions(userId, currentSessionId) {
  getDbUser(userId);
  const rows = all(
    'SELECT * FROM sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY last_activity_at DESC',
    userId
  );

  return rows.map((s) => ({
    id: s.id,
    client: s.client || 'web',
    ip: s.ip || null,
    userAgent: s.user_agent || null,
    createdAt: s.created_at,
    lastSeenAt: s.last_seen_at,
    lastActivityAt: s.last_activity_at,
    isCurrent: s.id === currentSessionId,
  }));
}

function revokeUserSession(userId, sessionIdToRevoke, currentSessionId) {
  const session = get('SELECT * FROM sessions WHERE id = ? AND user_id = ?', sessionIdToRevoke, userId);
  if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'Session was not found or already ended.');

  const now = nowIso();
  run("UPDATE sessions SET ended_at = ?, ended_reason = 'revoked' WHERE id = ?", now, sessionIdToRevoke);

  audit.record({
    action: 'auth.session_revoked',
    actor: { id: userId, name: 'user', role: 'supervisor' },
    detail: { sessionId: sessionIdToRevoke, isCurrent: sessionIdToRevoke === currentSessionId },
  });

  return { success: true, revokedSessionId: sessionIdToRevoke, wasCurrent: sessionIdToRevoke === currentSessionId };
}

function changeUserPassword(userId, currentSessionId, currentPassword, newPassword) {
  const user = getDbUser(userId);

  if (!verifyPassword(currentPassword || '', user.password_hash)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  }

  const weak = validatePasswordStrength(newPassword);
  if (weak) throw new AppError(400, 'PASSWORD_WEAK', weak);

  const newHash = hashPassword(newPassword);
  const now = nowIso();

  tx(() => {
    run('UPDATE users SET password_hash = ? WHERE id = ?', newHash, userId);
    // Revoke all other active sessions while preserving current session
    run(
      "UPDATE sessions SET ended_at = ?, ended_reason = 'revoked' WHERE user_id = ? AND ended_at IS NULL AND id != ?",
      now,
      userId,
      currentSessionId
    );
  });

  audit.record({
    action: 'account.password_changed',
    actor: { id: user.id, email: user.email, name: user.name, role: user.role },
    detail: { otherSessionsRevoked: true },
  });

  return { success: true, message: 'Password changed successfully. All other active sessions have been terminated.' };
}

function getUserActivity(userId) {
  getDbUser(userId);

  const books = all(
    `SELECT id, title, file_type, size_bytes, pages_total, upload_status, index_status, uploaded_at 
     FROM documents 
     WHERE owner_id = ? OR tenant_id = ? 
     ORDER BY uploaded_at DESC`,
    userId,
    userId
  );

  const searches = all(
    `SELECT id, title, query, research_level, current_stage, token_count, cost_estimate, created_at, updated_at 
     FROM research_sessions 
     WHERE user_id = ? OR tenant_id = ? 
     ORDER BY created_at DESC LIMIT 30`,
    userId,
    userId
  );

  const feedbacks = all(
    `SELECT rf.id, rf.session_id, rf.feedback_type, rf.user_comment, rf.created_at, rs.title, rs.query 
     FROM research_feedback rf 
     LEFT JOIN research_sessions rs ON rf.session_id = rs.id 
     WHERE rf.tenant_id = ? 
     ORDER BY rf.created_at DESC LIMIT 30`,
    userId
  );

  return { books, searches, feedbacks };
}

function exportUserData(userId) {
  const profile = getUserProfile(userId);
  const settings = getUserSettings(userId);
  const activity = getUserActivity(userId);

  audit.record({
    action: 'account.data_exported',
    actor: { id: userId, name: profile.name, role: profile.role },
    detail: { booksCount: activity.books.length, searchesCount: activity.searches.length },
  });

  return {
    user: profile,
    settings,
    books: activity.books,
    researchSessions: activity.searches,
    feedbacks: activity.feedbacks,
    exportedAt: nowIso(),
  };
}

function deleteUserAccountCascade(userId, currentSessionId, password, confirmationPhrase, clientIp) {
  const user = getDbUser(userId);

  // 1. Password verification
  if (!verifyPassword(password || '', user.password_hash)) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Password confirmation failed.');
  }

  // 2. Strict Confirmation Phrase verification
  const normalizedPhrase = String(confirmationPhrase || '').trim();
  if (normalizedPhrase !== 'احذف حسابي نهائياً' && normalizedPhrase !== 'DELETE MY ACCOUNT') {
    throw new AppError(400, 'CONFIRMATION_PHRASE_MISMATCH', 'Confirmation phrase does not match "احذف حسابي نهائياً" or "DELETE MY ACCOUNT".');
  }

  const now = nowIso();

  // 3. Execute atomic cascade deletion
  tx(() => {
    // Record audit event before deleting user row
    audit.record({
      action: 'account.deleted_by_user',
      actor: { id: user.id, email: user.email, name: user.name, role: user.role },
      ip: clientIp,
      detail: { cascadePurge: true, deletedAt: now },
    });

    // Sub-records attached to research sessions
    run(
      `DELETE FROM research_citations 
       WHERE tenant_id = ? OR session_id IN (SELECT id FROM research_sessions WHERE user_id = ? OR tenant_id = ?)`,
      userId,
      userId,
      userId
    );

    run(
      `DELETE FROM research_evidence 
       WHERE tenant_id = ? OR session_id IN (SELECT id FROM research_sessions WHERE user_id = ? OR tenant_id = ?)`,
      userId,
      userId,
      userId
    );

    run(
      `DELETE FROM research_feedback 
       WHERE tenant_id = ? OR session_id IN (SELECT id FROM research_sessions WHERE user_id = ? OR tenant_id = ?)`,
      userId,
      userId,
      userId
    );

    run('DELETE FROM research_sessions WHERE user_id = ? OR tenant_id = ?', userId, userId);

    // Document structures, tables, figures, chunks and documents
    run(
      `DELETE FROM document_tables 
       WHERE tenant_id = ? OR document_id IN (SELECT id FROM documents WHERE owner_id = ? OR tenant_id = ?)`,
      userId,
      userId,
      userId
    );

    run(
      `DELETE FROM document_figures 
       WHERE tenant_id = ? OR document_id IN (SELECT id FROM documents WHERE owner_id = ? OR tenant_id = ?)`,
      userId,
      userId,
      userId
    );

    run(
      `DELETE FROM chunks 
       WHERE document_id IN (SELECT id FROM documents WHERE owner_id = ? OR tenant_id = ?)`,
      userId,
      userId
    );

    run('DELETE FROM documents WHERE owner_id = ? OR tenant_id = ?', userId, userId);
    run('DELETE FROM book_structures WHERE tenant_id = ?', userId);

    // App Projects
    run('DELETE FROM app_projects WHERE user_id = ?', userId);

    // Settings, sessions, events, invitations
    run('DELETE FROM user_settings WHERE user_id = ?', userId);
    run('DELETE FROM session_events WHERE user_id = ?', userId);
    run('DELETE FROM sessions WHERE user_id = ?', userId);
    run('DELETE FROM invitations WHERE user_id = ?', userId);

    // Finally delete user row
    run('DELETE FROM users WHERE id = ?', userId);
  });

  return { success: true, message: 'Account and all associated resources permanently deleted.' };
}

function checkStorageQuota(userId, incomingSizeBytes = 0) {
  const profile = getUserProfile(userId);
  if (profile.storageUsedBytes + incomingSizeBytes > profile.storageQuotaBytes) {
    throw new AppError(
      413,
      'STORAGE_QUOTA_EXCEEDED',
      `Storage quota exceeded: Current usage (${(profile.storageUsedBytes / (1024 * 1024)).toFixed(1)} MB) + Incoming (${(incomingSizeBytes / (1024 * 1024)).toFixed(1)} MB) exceeds allowed limit of ${(profile.storageQuotaBytes / (1024 * 1024)).toFixed(0)} MB.`
    );
  }
  return true;
}

module.exports = {
  DEFAULT_STORAGE_QUOTA,
  getUserProfile,
  updateUserProfile,
  getUserSettings,
  updateUserSettings,
  getUserSessions,
  revokeUserSession,
  changeUserPassword,
  getUserActivity,
  exportUserData,
  deleteUserAccountCascade,
  checkStorageQuota,
};
