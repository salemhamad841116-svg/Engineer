/**
 * uiJsonContract.js
 * Phase 2: Unified Standard Data Contract (Zod + TS Compatible)
 *
 * Implements strict runtime validation and automatic repair (Auto-Retry) for
 * action-oriented AI agent responses, enforcing the UI JSON Contract across all roles.
 */

// ----------------------------------------------------
// Lightweight, Zero-Dependency Zod-Compatible Core
// ----------------------------------------------------
class ZodType {
  constructor(validator, typeName = 'any') {
    this._validator = validator;
    this.typeName = typeName;
    this.isOptional = false;
  }

  optional() {
    const clone = new ZodType((val) => {
      if (val === undefined || val === null) return { success: true, data: val };
      return this._validator(val);
    }, this.typeName + '?');
    clone.isOptional = true;
    return clone;
  }

  parse(val) {
    const res = this._validator(val);
    if (!res.success) {
      throw new Error(`ZodValidationError: ${res.error}`);
    }
    return res.data !== undefined ? res.data : val;
  }

  safeParse(val) {
    try {
      const res = this._validator(val);
      if (res.success) {
        return { success: true, data: res.data !== undefined ? res.data : val };
      }
      return { success: false, error: new Error(res.error) };
    } catch (err) {
      return { success: false, error: err };
    }
  }
}

const z = {
  string: () => new ZodType((v) => typeof v === 'string' ? { success: true, data: v } : { success: false, error: `Expected string, received ${typeof v}` }, 'string'),
  number: () => new ZodType((v) => typeof v === 'number' && !isNaN(v) ? { success: true, data: v } : { success: false, error: `Expected number, received ${typeof v}` }, 'number'),
  boolean: () => new ZodType((v) => typeof v === 'boolean' ? { success: true, data: v } : { success: false, error: `Expected boolean, received ${typeof v}` }, 'boolean'),
  any: () => new ZodType((v) => ({ success: true, data: v }), 'any'),
  enum: (values) => new ZodType((v) => values.includes(v) ? { success: true, data: v } : { success: false, error: `Expected one of [${values.join(', ')}], received "${v}"` }, 'enum'),
  array: (itemType) => new ZodType((v) => {
    if (!Array.isArray(v)) return { success: false, error: `Expected array, received ${typeof v}` };
    const validated = [];
    for (let i = 0; i < v.length; i++) {
      const check = itemType.safeParse(v[i]);
      if (!check.success) return { success: false, error: `Array index ${i}: ${check.error.message}` };
      validated.push(check.data);
    }
    return { success: true, data: validated };
  }, 'array'),
  record: (valueType) => new ZodType((v) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { success: false, error: `Expected object, received ${typeof v}` };
    const validated = {};
    for (const [k, val] of Object.entries(v)) {
      const check = valueType.safeParse(val);
      if (!check.success) return { success: false, error: `Key "${k}": ${check.error.message}` };
      validated[k] = check.data;
    }
    return { success: true, data: validated };
  }, 'record'),
  object: (shape) => new ZodType((v) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return { success: false, error: `Expected object, received ${typeof v}` };
    const validated = {};
    for (const [k, schema] of Object.entries(shape)) {
      const check = schema.safeParse(v[k]);
      if (!check.success) {
        return { success: false, error: `Field "${k}": ${check.error.message}` };
      }
      if (check.data !== undefined) validated[k] = check.data;
    }
    return { success: true, data: { ...v, ...validated } };
  }, 'object')
};

// ----------------------------------------------------
// UI JSON Contract Zod Schemas
// ----------------------------------------------------

const ACTION_TYPES = ['CREATE_SCREEN', 'PATCH_SCREEN', 'REQUIRE_CONFIRMATION', 'CHAT_ONLY'];
const VIEW_TYPES = ['FORM', 'TABLE', 'DASHBOARD'];
const FIELD_TYPES = ['text', 'number', 'date', 'select', 'textarea', 'checkbox', 'currency', 'email', 'phone'];
const OPERATORS = ['==', '!=', '>', '<', 'contains'];
const OP_TYPES = ['ADD', 'UPDATE', 'REMOVE'];

const AssistantMessageSchema = z.object({
  confirmation: z.string(),
  highlight: z.string(),
  nextStepSuggestion: z.string()
});

const KpiCardSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.any(),
  change: z.string().optional(),
  trend: z.enum(['up', 'down', 'neutral']).optional(),
  icon: z.string().optional()
});

const VisibilityRuleSchema = z.object({
  field: z.string(),
  operator: z.enum(OPERATORS),
  value: z.any()
});

const FieldValidationSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  pattern: z.string().optional(),
  message: z.string().optional()
});

const ScreenFieldSchema = z.object({
  id: z.string(),
  name: z.string(),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  colSpan: z.enum([6, 12]),
  icon: z.string().optional(),
  placeholder: z.string().optional(),
  defaultValue: z.any().optional(),
  options: z.array(z.string()).optional(),
  required: z.boolean().optional(),
  validation: FieldValidationSchema.optional(),
  visibilityRule: VisibilityRuleSchema.optional()
});

const AutomationRuleSchema = z.object({
  id: z.string(),
  event: z.string(),
  condition: z.string().optional(),
  action: z.string(),
  notify: z.string().optional()
});

const ScreenMetaSchema = z.object({
  screenId: z.string(),
  title: z.string(),
  description: z.string().optional(),
  viewType: z.enum(VIEW_TYPES)
});

const UiPayloadSchema = z.object({
  meta: ScreenMetaSchema,
  kpis: z.array(KpiCardSchema).optional(),
  fields: z.array(ScreenFieldSchema),
  mockRecords: z.array(z.record(z.any())),
  automations: z.array(AutomationRuleSchema).optional()
});

const PatchOperationSchema = z.object({
  op: z.enum(OP_TYPES),
  targetFieldId: z.string(),
  value: z.any().optional()
});

const GuardrailPayloadSchema = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  operation: z.string(),
  message: z.string(),
  requiresExplicitPrompt: z.boolean()
});

const RootResponseEnvelopeSchema = z.object({
  actionType: z.enum(ACTION_TYPES),
  assistantMessage: AssistantMessageSchema,
  suggestedActions: z.array(z.string()),
  uiPayload: UiPayloadSchema.optional(),
  operations: z.array(PatchOperationSchema).optional(),
  guardrail: GuardrailPayloadSchema.optional()
});

// ----------------------------------------------------
// Auto-Retry Repair Engine
// ----------------------------------------------------

/**
 * Attempts to repair malformed or partial AI output to strictly satisfy the contract.
 */
function repairRawOutput(data = {}) {
  const repaired = { ...data };

  // 1. Ensure valid actionType
  if (!ACTION_TYPES.includes(repaired.actionType)) {
    if (repaired.guardrail) {
      repaired.actionType = 'REQUIRE_CONFIRMATION';
    } else if (repaired.operations && Array.isArray(repaired.operations) && repaired.operations.length > 0) {
      repaired.actionType = 'PATCH_SCREEN';
    } else if (repaired.uiPayload && repaired.uiPayload.fields) {
      repaired.actionType = 'CREATE_SCREEN';
    } else {
      repaired.actionType = 'CHAT_ONLY';
    }
  }

  // 2. Ensure assistantMessage has all 3 lines
  if (!repaired.assistantMessage || typeof repaired.assistantMessage !== 'object') {
    repaired.assistantMessage = {
      confirmation: 'تم تنفيذ طلبك وبناء الشاشة بنجاح.',
      highlight: 'تم تفعيل التنسيق الشبكي والتحقق التلقائي من الحقول.',
      nextStepSuggestion: 'هل تود إضافة حقول إضافية أو ربط الشاشة بقاعدة البيانات؟'
    };
  } else {
    repaired.assistantMessage = {
      confirmation: String(repaired.assistantMessage.confirmation || 'تم تنفيذ طلبك بنجاح.'),
      highlight: String(repaired.assistantMessage.highlight || 'تمت إضافة الحقول وتطبيق قواعد التحقق الذكية.'),
      nextStepSuggestion: String(repaired.assistantMessage.nextStepSuggestion || 'ما الخطوة التالية التي تريد تنفيذها؟')
    };
  }

  // 3. Ensure suggestedActions has 2-3 items
  if (!Array.isArray(repaired.suggestedActions) || repaired.suggestedActions.length < 2) {
    repaired.suggestedActions = [
      'عرض السجلات في وضع الجدول',
      'إضافة حقل تاريخ الاستحقاق',
      'حفظ الشاشة في النظام'
    ];
  } else if (repaired.suggestedActions.length > 3) {
    repaired.suggestedActions = repaired.suggestedActions.slice(0, 3);
  }

  // 4. Repair uiPayload if present
  if (repaired.uiPayload && typeof repaired.uiPayload === 'object') {
    const payload = { ...repaired.uiPayload };
    if (!payload.meta || typeof payload.meta !== 'object') {
      payload.meta = {
        screenId: 'screen_' + Date.now(),
        title: 'شاشة مخصصة جديدة',
        viewType: 'FORM'
      };
    } else {
      payload.meta.screenId = String(payload.meta.screenId || 'screen_' + Date.now());
      payload.meta.title = String(payload.meta.title || 'شاشة مخصصة');
      if (!VIEW_TYPES.includes(payload.meta.viewType)) {
        payload.meta.viewType = 'FORM';
      }
    }

    if (!Array.isArray(payload.fields)) {
      payload.fields = [];
    }

    payload.fields = payload.fields.map((f, idx) => ({
      id: String(f.id || `field_${idx + 1}`),
      name: String(f.name || `field_${idx + 1}`),
      label: String(f.label || `حقل ${idx + 1}`),
      type: FIELD_TYPES.includes(f.type) ? f.type : 'text',
      colSpan: (f.colSpan === 12 || f.colSpan === 6) ? f.colSpan : 12,
      icon: f.icon || 'FileText',
      placeholder: f.placeholder || '',
      defaultValue: f.defaultValue !== undefined ? f.defaultValue : '',
      options: Array.isArray(f.options) ? f.options : undefined,
      required: Boolean(f.required),
      validation: f.validation || undefined,
      visibilityRule: f.visibilityRule || undefined
    }));

    if (!Array.isArray(payload.mockRecords) || payload.mockRecords.length === 0) {
      payload.mockRecords = [
        { id: '1', title: 'سجل تجريبي أول', status: 'نشط', created_at: '2026-11-15' },
        { id: '2', title: 'سجل تجريبي ثانٍ', status: 'مكتمل', created_at: '2026-11-14' },
        { id: '3', title: 'سجل تجريبي ثالث', status: 'قيد التنفيذ', created_at: '2026-11-13' }
      ];
    }

    if (!Array.isArray(payload.kpis)) {
      payload.kpis = [
        { id: 'kpi_total', label: 'إجمالي السجلات', value: 3, change: '+100%', trend: 'up', icon: 'Database' }
      ];
    }

    repaired.uiPayload = payload;
  }

  // 5. Repair operations for PATCH_SCREEN
  if (repaired.actionType === 'PATCH_SCREEN') {
    if (!Array.isArray(repaired.operations) || repaired.operations.length === 0) {
      repaired.operations = [
        { op: 'UPDATE', targetFieldId: 'general', value: {} }
      ];
    }
  }

  // 6. Repair guardrail for REQUIRE_CONFIRMATION
  if (repaired.actionType === 'REQUIRE_CONFIRMATION' && !repaired.guardrail) {
    repaired.guardrail = {
      severity: 'high',
      operation: 'SENSITIVE_OPERATION',
      message: 'يتطلب هذا الإجراء تأكيداً صريحاً لحماية سلامة البيانات.',
      requiresExplicitPrompt: true
    };
  }

  return repaired;
}

/**
 * Validates data against the RootResponseEnvelopeSchema, applying 1 auto-retry repair if necessary.
 */
function validateUiResponse(data) {
  // First attempt: direct safeParse
  const firstCheck = RootResponseEnvelopeSchema.safeParse(data);
  if (firstCheck.success) {
    return {
      valid: true,
      data: firstCheck.data,
      errors: [],
      repaired: false
    };
  }

  // Auto-retry repair attempt
  const repairedData = repairRawOutput(data);
  const secondCheck = RootResponseEnvelopeSchema.safeParse(repairedData);

  if (secondCheck.success) {
    return {
      valid: true,
      data: secondCheck.data,
      errors: [firstCheck.error.message],
      repaired: true
    };
  }

  return {
    valid: false,
    data: null,
    errors: [firstCheck.error.message, secondCheck.error.message],
    repaired: false
  };
}

module.exports = {
  z,
  ACTION_TYPES,
  VIEW_TYPES,
  FIELD_TYPES,
  OPERATORS,
  OP_TYPES,
  RootResponseEnvelopeSchema,
  AssistantMessageSchema,
  ScreenMetaSchema,
  ScreenFieldSchema,
  KpiCardSchema,
  UiPayloadSchema,
  PatchOperationSchema,
  GuardrailPayloadSchema,
  repairRawOutput,
  validateUiResponse
};
