export type Language = 'ar' | 'en';
export type ThemeMode = 'dark' | 'light';

export type ProjectCategory = 'website' | 'slides' | 'app' | 'prototype';
export type TechStack = 'react-ts-vite' | 'nextjs-fullstack' | 'express-api' | 'vue-vite' | 'python-fastapi';
export type DatabaseEngine = 'postgresql' | 'sqlite' | 'firestore' | 'none';
export type DeployTarget = 'cloud-run-eu' | 'cloud-run-us' | 'edge-global';

export interface ProjectFile {
  id: string;
  path: string;
  name: string;
  folder: string;
  content: string;
  previousContent?: string;
  language: 'typescript' | 'javascript' | 'css' | 'html' | 'json' | 'markdown' | 'sql';
  size: number;
  updatedAt: string;
  isDirty?: boolean;
  isAttachment?: boolean;
  mimeType?: string;
}

export interface DiagnosticIssue {
  id: string;
  filePath: string;
  line: number;
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  rootCause: string;
  suggestedFix: string;
  originalSnippet: string;
  fixedSnippet: string;
  fixed: boolean;
}

export interface TestCaseResult {
  id: string;
  name: string;
  category: 'unit' | 'integration' | 'api' | 'playwright' | 'mobile' | 'database' | 'security' | 'performance' | 'regression';
  targetFile: string;
  status: 'idle' | 'running' | 'passed' | 'failed';
  durationMs: number;
  assertionCount: number;
  evidenceLog: string[];
  failureDetail?: string;
  errorSnapshotSvg?: string;
  traceSteps: { timestamp: string; action: string; domTarget: string; status: 'ok' | 'fail'; latencyMs: number }[];
  lastRunAt?: string;
}

export interface DbColumn {
  name: string;
  type: 'UUID' | 'TEXT' | 'INTEGER' | 'BOOLEAN' | 'TIMESTAMP' | 'JSONB';
  primaryKey?: boolean;
  nullable?: boolean;
  indexed?: boolean;
  references?: string;
}

export interface DbTable {
  id: string;
  name: string;
  columns: DbColumn[];
  rows: Record<string, unknown>[];
  indexes: string[];
  rlsEnabled: boolean;
  updatedAt: string;
}

export interface DbBackup {
  id: string;
  label: string;
  createdAt: string;
  sizeBytes: number;
  tablesSnapshot: DbTable[];
}

export interface GitCommit {
  id: string;
  hash: string;
  branch: string;
  message: string;
  author: string;
  timestamp: string;
  changedFiles: { path: string; additions: number; deletions: number }[];
  filesSnapshot: ProjectFile[];
}

export interface DeploymentStep {
  stepNumber: number;
  id: string;
  titleAr: string;
  titleEn: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  detailLog: string;
  durationMs?: number;
}

export interface DeploymentRecord {
  id: string;
  projectId: string;
  version: string;
  environment: 'staging' | 'production';
  appName: string;
  domain: string;
  region: string;
  cpuRam: string;
  status: 'running' | 'stopped' | 'building' | 'failed';
  url: string;
  createdAt: string;
  healthScore: number;
  visitsCount: number;
  avgLatencyMs: number;
  envVars: { key: string; value: string }[];
  dbLinked: boolean;
  storageLinked: boolean;
  logs: string[];
}

export interface AIAgentProfile {
  id: string;
  roleKey: 'chief' | 'planner' | 'frontend' | 'backend' | 'database' | 'qa' | 'debugger' | 'security' | 'reviewer' | 'devops';
  nameAr: string;
  nameEn: string;
  missionAr: string;
  missionEn: string;
  permissions: string[];
  model: string;
  tools: string[];
  status: 'idle' | 'working' | 'completed' | 'error';
  currentTaskAr: string;
  currentTaskEn: string;
  operationsLog: { time: string; action: string; result: string }[];
  modifiedFiles: string[];
  lastOutputSummary: string;
}

export interface ExecutionPipelineStage {
  id: string;
  labelAr: string;
  labelEn: string;
  status: 'pending' | 'running' | 'done' | 'error';
  agentId: string;
  detail: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  model?: string;
  thinkingMode?: 'standard' | 'deep' | 'plan';
  agentId?: string;
  attachments?: { name: string; type: string; size: number }[];
  pipelineStages?: ExecutionPipelineStage[];
  modifiedFiles?: string[];
}

export interface ChatThread {
  id: string;
  title: string;
  updatedAt: string;
  messages: ChatMessage[];
}

export interface Project {
  id: string;
  name: string;
  description: string;
  category: ProjectCategory;
  appType: string;
  techStack: TechStack;
  template: string;
  language: Language;
  direction: 'rtl' | 'ltr';
  databaseEngine: DatabaseEngine;
  deployTarget: DeployTarget;
  starred: boolean;
  archived: boolean;
  sharedWithYou?: boolean;
  status: 'ready' | 'running' | 'building' | 'deployed' | 'error';
  updatedAt: string;
  createdAt: string;
  storageUsedBytes: number;
  storageQuotaBytes: number;
  files: ProjectFile[];
  openFileIds: string[];
  activeFileId: string;
  diagnostics: DiagnosticIssue[];
  tests: TestCaseResult[];
  dbTables: DbTable[];
  dbBackups: DbBackup[];
  dbRoles: { id: string; username: string; role: 'admin' | 'readwrite' | 'readonly'; activeConnections: number }[];
  gitRepoUrl: string;
  gitCurrentBranch: string;
  gitBranches: string[];
  gitCommits: GitCommit[];
  deployments: DeploymentRecord[];
  chatThreads: ChatThread[];
  activeChatId: string;
  serverLogs: { time: string; level: 'info' | 'warn' | 'error' | 'success'; message: string }[];
}

export interface ButtonRegistryEntry {
  id: string;
  nameAr: string;
  nameEn: string;
  section: string;
  pageLocation: string;
  purposeAr: string;
  purposeEn: string;
  actionOnClick: string;
  targetModalOrMenu: string;
  executedOperation: string;
  apiEndpoint: string;
  requiredRole: 'owner' | 'editor' | 'viewer';
  statesSupported: ('loading' | 'success' | 'error' | 'disabled-guard')[];
  acceptanceTestName: string;
  lastVerifiedAt?: string;
  verificationStatus: 'verified' | 'running' | 'failed';
  proofReceipt?: string;
}
