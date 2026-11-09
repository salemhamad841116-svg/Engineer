/**
 * src/contracts/externalIngestContracts.ts
 * Phase 13: TypeScript Contracts for Service API Keys & External Book Ingestion
 *
 * Defines strictly-typed request, response, and error schemas for legacy
 * ingestion integration without any "any" types.
 */

export type ServiceApiKeyScope = 'books:crud' | '*';

export type ExternalBookStatus = 'pending' | 'indexing' | 'ready' | 'failed';

export interface ServiceApiKeyContract {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ServiceApiKeyScope[];
  rateLimitRpm: number;
  isRevoked: boolean;
  revokedAt?: string | null;
  createdBy?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
}

export interface CreateServiceKeyRequest {
  name: string;
  scopes?: ServiceApiKeyScope[];
  rateLimitRpm?: number;
}

export interface CreateServiceKeyResponse {
  success: boolean;
  serviceKey: ServiceApiKeyContract & { rawKey: string };
  warning: string;
}

export interface RevokeServiceKeyResponse {
  success: boolean;
  revoked: boolean;
  id: string;
  revokedAt: string;
}

export interface RotateServiceKeyResponse {
  success: boolean;
  rotatedFrom: string;
  serviceKey: ServiceApiKeyContract & { rawKey: string };
  warning: string;
}

export interface ExternalDelegatedTokenContract {
  id: string;
  tokenPrefix: string;
  userId: string;
  userName?: string;
  userEmail?: string;
  serviceKeyId?: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string;
  revokedAt?: string | null;
  isRevoked: boolean;
  isExpired: boolean;
  lastUsedAt?: string | null;
}

export interface IssueDelegatedTokenRequest {
  userId: string;
  ttlMinutes?: number;
  scopes?: string[];
}

export interface IssueDelegatedTokenResponse {
  success: boolean;
  delegatedToken: string;
  token: string;
  id: string;
  tokenPrefix: string;
  userId: string;
  expiresAt: string;
  ttlSeconds: number;
  ttlMinutes: number;
  warning?: string;
}

export interface RevokeDelegatedTokenResponse {
  success: boolean;
  revoked: boolean;
  id: string;
}

export interface ExternalBookChapterContract {
  title: string;
  page?: number;
  subchapters?: ExternalBookChapterContract[];
}

export interface ExternalBookIngestHeaders {
  'x-service-key': string;
  'x-delegated-token'?: string;
  'x-user-id'?: string;
  'idempotency-key'?: string;
  'x-timestamp'?: string;
  'x-signature'?: string;
}

export interface ExternalBookCreatePayload {
  title?: string;
  author?: string;
  edition?: string;
  publication_year?: number;
  language?: string;
  category_id?: string;
  content_type?: 'application/pdf' | 'text/plain' | 'text/markdown' | string;
  chapters?: string | ExternalBookChapterContract[];
  text?: string;
}

export interface ExternalBookCreateResponse {
  success: boolean;
  book_id: string;
  title: string;
  status: ExternalBookStatus;
  chunks_count: number;
  pages_count: number;
  created_at: string;
}

export interface ExternalBookUpdatePayload {
  title?: string;
  author?: string;
  edition?: string;
  publication_year?: number;
  language?: string;
  category_id?: string;
  chapters?: ExternalBookChapterContract[];
}

export interface ExternalBookUpdateResponse {
  success: boolean;
  book_id: string;
  updated?: boolean;
  title: string;
  author: string;
  edition: string;
  publication_year: number;
  language: string;
  category_id?: string;
  chapters: ExternalBookChapterContract[];
  updated_at: string;
}

export interface ExternalBookReplaceResponse {
  success: boolean;
  book_id: string;
  replaced: boolean;
  title: string;
  status: 'ready';
  chunks_count: number;
  pages_count: number;
  updated_at: string;
}

export interface ExternalBookDeleteResponse {
  success: boolean;
  book_id: string;
  deleted: boolean;
  purged_tables: string[];
  timestamp: string;
}

export interface ExternalBookStatusResponse {
  book_id: string;
  title: string;
  status: ExternalBookStatus;
  failure_reason?: string | null;
  pages_total: number;
  chunks_count: number;
  created_at: string;
  updated_at: string;
}

export interface ExternalApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    status: number;
    retryAfter?: number;
  };
}
