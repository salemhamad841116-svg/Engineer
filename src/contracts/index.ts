// src/contracts/index.ts
// ==============================================================================
// Unified Shared TypeScript Contracts & Schemas
// The Single Source of Truth for API Requests/Responses, Database Rows, and UI Entities.
// Strictly typed without any "any" bypasses.
// ==============================================================================

// ------------------------------------------------------------------------------
// 1. Error Utilities & Type Guards
// ------------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function extractErrorMessage(error: unknown, fallback = 'An unexpected error occurred'): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (isRecord(error) && typeof error.message === 'string') {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  return fallback;
}

// ------------------------------------------------------------------------------
// 2. Authentication Contracts
// ------------------------------------------------------------------------------

export interface AuthUserContract {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'supervisor' | 'user';
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface AuthSessionContract {
  id: string;
  expiresAt: string;
}

export interface AuthRegisterRequestContract {
  name: string;
  email: string;
  password: string;
  client?: 'web' | 'mobile';
}

export interface AuthLoginRequestContract {
  email: string;
  password: string;
  client?: 'web' | 'mobile';
}

export interface AuthResponseContract {
  success: boolean;
  user?: AuthUserContract;
  session?: AuthSessionContract;
  error?: string;
  message?: string;
  token?: string;
}

export interface MeResponseContract {
  success: boolean;
  user: AuthUserContract;
  session: AuthSessionContract;
}

// ------------------------------------------------------------------------------
// 3. Knowledge & Deep Research Contracts
// ------------------------------------------------------------------------------

export interface ChapterTocEntryContract {
  chapter: number;
  title: string;
  page: number;
}

export interface ChapterContentContract {
  title: string;
  pageStart: number;
  pageEnd: number;
  content: string;
}

export interface BookItemContract {
  id: string;
  tenantId?: string;
  title: string;
  author: string;
  edition: string;
  publicationYear: number;
  language: string;
  totalPages: number;
  isSharedLibrary?: boolean;
  chunksCount?: number;
  toc?: ChapterTocEntryContract[];
  chapters?: ChapterContentContract[];
  createdAt?: string;
}

export interface CitationContract {
  id: string;
  bookId?: string;
  bookTitle: string;
  author: string;
  edition?: string;
  chapter: string;
  pageNumber: number;
  sourceUrl?: string | null;
  quoteExact: string;
  quoteContextBefore?: string;
  quoteContextAfter?: string;
  verifiedGrounded: boolean;
  matchConfidence?: number;
}

export interface QualityCheckItemContract {
  passed: boolean;
  evidence: string;
}

export interface QualityGateReportContract {
  passed: boolean;
  score: string;
  decision: string;
  checklist: Record<string, QualityCheckItemContract>;
  failureReasons: string[];
}

export interface ResearchStageLogContract {
  stage: string;
  name: string;
  status: 'pending' | 'running' | 'completed';
  detail: string;
  timestamp?: string;
  durationMs?: number;
}

export interface ResearchSessionContract {
  id: string;
  userId?: string | null;
  tenantId: string;
  title: string;
  query: string;
  researchLevel: 'quick' | 'deep' | 'expert';
  currentStage?: string;
  summary?: string;
  answerMarkdown?: string;
  uncertainties?: string;
  tokenCount?: number;
  costEstimate?: number;
  qualityGate?: QualityGateReportContract;
  stages?: ResearchStageLogContract[];
  createdAt?: string;
  updatedAt?: string;
}

export interface DeepResearchExecuteRequestContract {
  query: string;
  level?: 'quick' | 'deep' | 'expert';
  bookIds?: string[] | null;
  sessionId?: string | null;
  userId?: string | null;
  tenantId?: string | null;
}

export interface DeepResearchExecuteResponseContract {
  success: boolean;
  session?: ResearchSessionContract;
  citations?: CitationContract[];
  stages?: ResearchStageLogContract[];
  qualityGate?: QualityGateReportContract;
  error?: string;
  message?: string;
}

export interface BookUploadPdfRequestContract {
  title?: string;
  author?: string;
  pdfBase64: string;
  filename?: string;
}

export interface BookIngestRequestContract {
  id?: string;
  title: string;
  author?: string;
  edition?: string;
  publicationYear?: number;
  language?: string;
  pagesTotal?: number;
  fullText?: string;
  toc?: ChapterTocEntryContract[];
  chapters?: ChapterContentContract[];
  isSharedLibrary?: boolean;
}

// ------------------------------------------------------------------------------
// 4. Database Row Contracts (SQLite & PostgreSQL Readiness)
// ------------------------------------------------------------------------------

export interface UserRowContract {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'supervisor';
  password_hash: string | null;
  status: 'invited' | 'active' | 'disabled';
  failed_logins: number;
  locked_until: string | null;
  created_at: string;
  created_by: string | null;
  last_login_at: string | null;
  last_logout_at: string | null;
  disabled_at: string | null;
}

export interface SessionRowContract {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
  last_activity_at: string;
  expires_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  ip: string | null;
  user_agent: string | null;
  client: string | null;
}

export interface DocumentRowContract {
  id: string;
  batch_id: string | null;
  owner_id: string | null;
  actor_id: string | null;
  tenant_id: string | null;
  title: string;
  original_filename: string | null;
  kind: 'document' | 'image' | 'raw_text' | 'media' | 'url';
  file_type: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  language: string;
  upload_status: string;
  ocr_status: string;
  index_status: string;
  pages_total: number | null;
  page_count: number;
  raw_text: string | null;
  is_shared_library: number;
  uploaded_at: string | null;
}

export interface BookStructureRowContract {
  id: string;
  book_id: string;
  tenant_id: string | null;
  toc_json: string | null;
  chapters_json: string | null;
  author: string | null;
  edition: string | null;
  publication_year: number | null;
  language: string | null;
  total_pages: number | null;
  created_at: string;
  updated_at: string;
}

export interface ChunkRowContract {
  id: string;
  document_id: string;
  idx: number;
  page: number | null;
  text: string;
  verbatim_raw_chunk: string;
  embedding: Buffer | null;
  embed_model: string | null;
  created_at: string;
}

export interface CitationRowContract {
  id: string;
  session_id: string;
  tenant_id: string | null;
  book_id: string | null;
  book_title: string;
  author: string | null;
  edition: string | null;
  chapter: string | null;
  page_number: number | null;
  source_url: string | null;
  quote_exact: string;
  quote_context_before: string | null;
  quote_context_after: string | null;
  verified_grounded: number;
  created_at: string;
}

export interface AppProjectRowContract {
  id: string;
  user_id: string;
  name: string;
  description: string;
  prompt: string;
  slug: string;
  html: string | null;
  quality_status: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface BenchmarkResultRowContract {
  id: string;
  benchmark_name: string;
  model_name: string;
  status: string;
  pass_rate: number;
  duration_ms: number;
  tokens_used: number;
  cost_estimate: number;
  report_json: string;
  created_at: string;
}

// ------------------------------------------------------------------------------
// 5. Autonomous Coding Agent Contracts
// ------------------------------------------------------------------------------

export interface AgentTaskStepContract {
  id: string;
  stepNumber: number;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'repaired';
  file?: string;
  line?: number;
  timestamp: string;
}

export interface AgentTaskContract {
  id: string;
  projectId: string;
  prompt: string;
  status: 'idle' | 'running' | 'awaiting_approval' | 'completed' | 'failed';
  currentStepIndex: number;
  totalSteps: number;
  steps: AgentTaskStepContract[];
  diagnosticsRepaired: number;
  created_at: string;
  completed_at?: string | null;
}

export interface AgentApprovalContract {
  id: string;
  taskId: string;
  operationType: string;
  command?: string;
  filePath?: string;
  riskLevel: 'high' | 'critical' | 'moderate';
  status: 'pending' | 'approved' | 'rejected';
  reason?: string;
  createdAt: string;
}

export interface AgentDecisionOptionContract {
  id: string;
  title: string;
  description: string;
  pros: string[];
  cons: string[];
  impact: string;
  isRecommended?: boolean;
}

export interface AgentDecisionContract {
  id: string;
  taskId: string;
  topic: string;
  question: string;
  options: AgentDecisionOptionContract[];
  status: 'pending' | 'decided';
  chosenOptionId?: string;
  createdAt: string;
}

export interface AgentLessonContract {
  id: string;
  scope: 'general' | 'project';
  projectId?: string | null;
  errorSignature: string;
  rootCause: string;
  verifiedSolution: string;
  confidenceScore: number;
  createdAt: string;
}

export interface AgentResourcesContract {
  ramUsedMb: number;
  ramTotalMb: number;
  ramUsagePercent: number;
  diskUsedMb: number;
  diskTotalMb: number;
  diskUsagePercent: number;
  tempCacheMb: number;
}

// ------------------------------------------------------------------------------
// 6. UI Navigation & Modal Payload Map
// ------------------------------------------------------------------------------

export interface BillingInvoiceContract {
  id: string;
  date: string;
  amount: string;
  status: 'Paid' | 'Pending';
  plan: string;
}

export interface TeamMemberContract {
  id: string;
  name: string;
  email: string;
  role: 'Owner' | 'Admin' | 'Editor' | 'Viewer';
  status: string;
}

export interface ActivityLogEntryContract {
  id: string;
  time: string;
  actor: string;
  action: string;
  target: string;
}

export interface PlatformSettingsContract {
  userName: string;
  userEmail: string;
  planName: string;
  aiTokensUsed: number;
  aiTokensLimit: number;
  defaultModel: string;
  thinkingMode: 'standard' | 'deep' | 'plan';
  language: 'ar' | 'en';
  theme: 'dark' | 'light';
  notificationsEnabled: boolean;
  privacyTelemetryOptOut: boolean;
  teamMembers: TeamMemberContract[];
  invoices: BillingInvoiceContract[];
  activityLog: ActivityLogEntryContract[];
}

export interface ModalPayloadMap {
  settings?: { tab?: 'general' | 'models' | 'api-keys' | 'database' | 'audit' | 'team' | 'billing' | 'advanced' | 'profile' | 'activity' | 'security' | 'danger' };
  'export-code'?: { project?: unknown; files?: unknown[] };
  'import-code'?: { targetProjectId?: string };
  diagnostics?: { project?: unknown; issues?: unknown[] };
  'new-project'?: { initialCategory?: string };
  auth?: { mode?: 'login' | 'register' };
  'deep-research'?: { initialQuery?: string };
  'autonomous-agent'?: { initialTask?: string };
  'user-profile'?: { tab?: 'profile' | 'activity' | 'security' | 'settings' | 'danger' };
  [key: string]: Record<string, unknown> | undefined;
}

// ------------------------------------------------------------------------------
// 7. Phase 10: User Profile, App Settings & Account Lifecycle Contracts
// ------------------------------------------------------------------------------

export interface UserProfileContract {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
  role: 'admin' | 'supervisor' | 'user';
  createdAt: string;
  lastLoginAt?: string | null;
  lastLoginIp?: string | null;
  booksCount: number;
  searchesCount: number;
  feedbacksCount: number;
  storageQuotaBytes: number;
  storageUsedBytes: number;
  storageUsedPercentage: number;
}

export interface UserSettingsContract {
  userId: string;
  language: 'ar' | 'en';
  theme: 'dark' | 'light' | 'system';
  defaultResearchTier: 'quick' | 'deep' | 'expert';
  showPageNumbers: boolean;
  answerLength: 'concise' | 'detailed';
  showQualityBadges: boolean;
  retainSearchHistory: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface ActiveSessionContract {
  id: string;
  client: string;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
  lastSeenAt: string;
  lastActivityAt: string;
  isCurrent: boolean;
}

export interface ChangePasswordRequestContract {
  currentPassword: string;
  newPassword: string;
}

export interface DeleteAccountRequestContract {
  password: string;
  confirmationPhrase: string;
}

export interface UserFeedbackExportItemContract {
  id: string;
  sessionId: string;
  rating: number;
  comment?: string | null;
  createdAt: string;
}

export interface UserDataExportContract {
  user: UserProfileContract;
  settings: UserSettingsContract;
  books: BookItemContract[];
  researchSessions: ResearchSessionContract[];
  feedbacks: UserFeedbackExportItemContract[];
  exportedAt: string;
}

