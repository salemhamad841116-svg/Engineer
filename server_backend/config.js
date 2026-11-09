const path = require('path');

function int(name, def) {
  const v = parseInt(process.env[name], 10);
  return Number.isFinite(v) && v > 0 ? v : def;
}

/**
 * Central runtime configuration. Values are read lazily so tests can set env vars before use.
 */
const config = {
  get dataDir() {
    return process.env.DATA_DIR || path.join(__dirname, '../data');
  },
  get dbPath() {
    return process.env.DB_PATH || path.join(this.dataDir, 'app.db');
  },
  get vaultDir() {
    return process.env.DATA_VAULT_PATH || path.join(this.dataDir, 'vault');
  },
  get tempUploadDir() {
    return process.env.TEMP_UPLOAD_DIR || path.join(this.dataDir, 'tmp_uploads');
  },
  get legacyVectorStorePath() {
    return process.env.VECTOR_DB_PATH || path.join(this.dataDir, 'vector_store.json');
  },
  get legacyCategoriesPath() {
    return process.env.CATEGORIES_FILE_PATH || path.join(this.dataDir, 'categories.json');
  },
  // Presence & session policy (seconds unless noted)
  get heartbeatIntervalSec() { return int('HEARTBEAT_INTERVAL_SECONDS', 30); },
  get offlineAfterSec() { return int('PRESENCE_OFFLINE_SECONDS', 120); },
  get awayAfterSec() { return int('PRESENCE_AWAY_SECONDS', 300); },
  get sessionIdleMinutes() { return int('SESSION_IDLE_MINUTES', 120); },
  get sessionAbsoluteHours() { return int('SESSION_ABSOLUTE_HOURS', 24); },
  get invitationHours() { return int('INVITATION_HOURS', 72); },
  get maxFailedLogins() { return int('MAX_FAILED_LOGINS', 5); },
  get lockoutMinutes() { return int('LOCKOUT_MINUTES', 15); },
  get jobConcurrency() { return int('JOB_CONCURRENCY', 2); },
  get embeddingRetries() { return int('EMBEDDING_RETRIES', 2); },
  get auditRetentionDays() { return parseInt(process.env.AUDIT_RETENTION_DAYS, 10) || 0; },
  get maxFileMb() { return int('MAX_FILE_MB', 1024); },
  get maxMediaMb() { return int('MAX_MEDIA_MB', 1024); },
  /** 'mock' (tests only) or the live open-source stack (any other value; 'openai' is the documented one). */
  get aiProvider() {
    const v = (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || 'openai').toLowerCase();
    if (v === 'mock') return 'mock';
    if (v === 'gemini') return 'gemini';
    if (v === 'vllm') return 'vllm';
    if (v === 'ollama') return 'ollama';
    return 'openai';
  },
  get llmProvider() {
    return (process.env.LLM_PROVIDER || process.env.AI_PROVIDER || 'ollama').toLowerCase().trim();
  },
  get llmBaseUrl() {
    if (process.env.LLM_BASE_URL) return process.env.LLM_BASE_URL.replace(/\/+$/, '');
    if (process.env.LOCAL_AI_BASE_URL) return process.env.LOCAL_AI_BASE_URL.replace(/\/+$/, '');
    const p = this.llmProvider;
    if (p === 'vllm') return 'http://localhost:8000/v1';
    if (p === 'openai') return 'https://api.openai.com/v1';
    if (p === 'gemini') return 'https://generativelanguage.googleapis.com/v1beta/openai';
    if (p === 'mock') return 'http://mock-model-engine/v1';
    return 'http://localhost:11434/v1';
  },
  get llmModel() {
    if (process.env.LLM_MODEL) return process.env.LLM_MODEL.trim();
    if (process.env.LOCAL_AI_MODEL) return process.env.LOCAL_AI_MODEL.trim();
    const p = this.llmProvider;
    if (p === 'vllm') return 'Qwen/Qwen2.5-32B-Instruct-AWQ';
    if (p === 'openai') return 'gpt-4o-mini';
    if (p === 'gemini') return 'gemini-3.8-flash';
    if (p === 'mock') return 'deterministic-grounded-qwen';
    return 'qwen2.5:7b';
  },
  get allowCloudFallback() {
    return process.env.ALLOW_CLOUD_FALLBACK === 'true' || process.env.ALLOW_CLOUD_FALLBACK === '1';
  },
  get aiTmpDir() { return path.join(this.tempUploadDir, 'ai-work'); },
  get cookieName() { return 'sid'; },
  get displayTimeZone() { return 'Asia/Dubai'; },
  get isProduction() { return process.env.NODE_ENV === 'production'; },
  /**
   * Cloud AI provider key from the environment (last fallback after the System Settings keys).
   * LLM_API_KEY, with GROQ_API_KEY / TOGETHER_API_KEY accepted as aliases. Surrounding quotes,
   * whitespace and Windows CR are removed (common when pasted into an env_file).
   */
  get cloudApiKey() {
    const raw = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || process.env.TOGETHER_API_KEY || '';
    return String(raw).replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '').trim();
  },
  get cloudKeyUsable() {
    const k = this.cloudApiKey;
    return Boolean(k) && !/your_|_here|placeholder|changeme/i.test(k);
  },
  /** Optional key for the local endpoint (Ollama needs none; vLLM can be started with --api-key). */
  get localApiKey() {
    return String(process.env.LOCAL_AI_API_KEY || '').replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '').trim();
  },
  get geminiApiKey() {
    const raw = process.env.GEMINI_API_KEY || '';
    return String(raw).replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '').trim();
  },
  get geminiKeyUsable() {
    const k = this.geminiApiKey;
    return Boolean(k) && !/your_|_here|placeholder|changeme/i.test(k);
  },
  // Phase 12: Launch Pack, Email, Quota & Domain Configuration
  get appUrl() {
    return (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
  },
  get emailProvider() {
    return (process.env.EMAIL_PROVIDER || 'console').toLowerCase().trim();
  },
  get resendApiKey() {
    const raw = process.env.RESEND_API_KEY || '';
    return String(raw).replace(/\r/g, '').trim().replace(/^['"]|['"]$/g, '').trim();
  },
  get emailFrom() {
    return process.env.EMAIL_FROM || 'noreply@misruq.com';
  },
  get passwordResetMinutes() {
    return int('PASSWORD_RESET_MINUTES', 15);
  },
  get emailVerificationHours() {
    return int('EMAIL_VERIFICATION_HOURS', 24);
  },
  get dailyFreeQuotaPoints() {
    return int('DAILY_FREE_QUOTA_POINTS', 10);
  },
  // Phase 12-B: 16GB Host Local Model Fleet & Budget Controls
  get llmModelQuick() {
    return process.env.LLM_MODEL_QUICK || 'llama3.2:3b';
  },
  get llmModelDeep() {
    return process.env.LLM_MODEL_DEEP || 'qwen2.5:7b';
  },
  get llmModelExpert() {
    return process.env.LLM_MODEL_EXPERT || 'deepseek-r1:7b';
  },
  get llmModelSpecializedEn() {
    return process.env.LLM_MODEL_EN || 'llama3.1:8b';
  },
  get memoryBudgetMaxMb() {
    return int('MEMORY_BUDGET_MAX_MB', 12288); // 12GB
  },
  get diskRequiredFreeMb() {
    return int('DISK_REQUIRED_FREE_MB', 35000); // 35GB
  },
  get defaultContextTokens() {
    return int('DEFAULT_CONTEXT_TOKENS', 8192); // 8192 num_ctx
  },
  // Phase 14: Subscriptions, Stripe UAE & Payments
  get stripeSecretKey() {
    return process.env.STRIPE_SECRET_KEY || 'sk_test_mock_secret_key_uae';
  },
  get stripeWebhookSecret() {
    return process.env.STRIPE_WEBHOOK_SECRET || 'whsec_mock_webhook_secret_uae';
  },
  get stripeTaxRatePercent() {
    return 5.0; // UAE VAT 5%
  },
  get paymentGracePeriodDays() {
    return int('PAYMENT_GRACE_PERIOD_DAYS', 3);
  },
  get trialPeriodDays() {
    return int('TRIAL_PERIOD_DAYS', 7);
  },
};

module.exports = config;
