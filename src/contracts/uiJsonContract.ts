/**
 * uiJsonContract.ts
 * Phase 2: Unified Standard Data Contract (TypeScript Client Types)
 *
 * Defines the TypeScript types and interfaces for the Action-Oriented AI Agent
 * and Dynamic UI rendering engine on the frontend.
 */

export type ActionType = 'CREATE_SCREEN' | 'PATCH_SCREEN' | 'REQUIRE_CONFIRMATION' | 'REQUIRES_CONFIRMATION' | 'CHAT_ONLY';
export type ViewType = 'FORM' | 'TABLE' | 'DASHBOARD';
export type FieldType = 'text' | 'number' | 'date' | 'select' | 'textarea' | 'checkbox' | 'currency' | 'email' | 'phone';
export type VisibilityOperator = '==' | '!=' | '>' | '<' | 'contains';
export type PatchOp = 'ADD' | 'UPDATE' | 'REMOVE';
export type UserRole = 'business_owner' | 'employee' | 'developer';

export interface AssistantMessage {
  confirmation: string;
  highlight: string;
  nextStepSuggestion: string;
  details?: string;
}

export interface KpiCard {
  id: string;
  label: string;
  value: string | number;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  icon?: string;
}

export interface VisibilityRule {
  field: string;
  operator: VisibilityOperator;
  value: unknown;
}

export interface FieldValidation {
  min?: number;
  max?: number;
  pattern?: string;
  message?: string;
}

export interface ScreenField {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  colSpan: 6 | 12;
  icon?: string;
  placeholder?: string;
  defaultValue?: unknown;
  options?: string[];
  required?: boolean;
  validation?: FieldValidation;
  visibilityRule?: VisibilityRule;
}

export interface AutomationRule {
  id: string;
  event: string;
  condition?: string;
  action: string;
  notify?: string;
}

export interface ScreenMeta {
  screenId: string;
  title: string;
  description?: string;
  viewType: ViewType;
}

export interface UiPayload {
  meta: ScreenMeta;
  kpis?: KpiCard[];
  fields: ScreenField[];
  mockRecords: Record<string, unknown>[];
  automations?: AutomationRule[];
}

export interface PatchOperation {
  op: PatchOp;
  targetFieldId: string;
  value?: unknown;
}

export interface GuardrailPayload {
  severity: 'low' | 'medium' | 'high' | 'critical';
  operation: string;
  message: string;
  requiresExplicitPrompt: boolean;
}

export interface RootResponseEnvelope {
  actionType: ActionType;
  assistantMessage: AssistantMessage;
  suggestedActions: string[];
  uiPayload?: UiPayload;
  operations?: PatchOperation[];
  guardrail?: GuardrailPayload;
}
