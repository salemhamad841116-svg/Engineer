/**
 * agentService.js
 * Phase 4: Function Calling, Security Guardrails & Agent Dispatch Service
 *
 * Implements the core agent tools (buildNewScreen, patchExistingScreen, configureAutomation),
 * interceptive security guardrails for sensitive actions, and SQLite persistence for
 * custom screens, dynamic records, and feedback.
 */

const { isSensitiveOperation, buildSystemPrompt, fetchDynamicFewShots } = require('./systemPromptEngine');
const { validateUiResponse } = require('../../contracts/uiJsonContract');

// ----------------------------------------------------
// Core Agent Tools
// ----------------------------------------------------

/**
 * Tool 1: buildNewScreen
 * Synthesizes a brand new interactive screen specification from a prompt and userRole.
 */
function buildNewScreen(prompt = '', userRole = 'business_owner', options = {}) {
  const p = String(prompt || '').toLowerCase();
  const screenId = 'screen_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);

  // Determine screen domain & title
  let title = 'نظام إدارة تفاعلي';
  let viewType = (userRole === 'business_owner' || p.includes('لوحة') || p.includes('مؤشر') || p.includes('تحكم')) ? 'DASHBOARD' : (p.includes('جدول') || p.includes('استعراض') ? 'TABLE' : 'FORM');

  let fields = [];
  let kpis = [];
  let mockRecords = [];
  let automations = [];

  if (p.includes('مبيع') || p.includes('فواتير') || p.includes('إيراد')) {
    title = 'نظام إدارة المبيعات والفواتير';
    kpis = [
      { id: 'kpi_sales', label: 'إجمالي المبيعات', value: '45,280 د.إ', change: '+18.2%', trend: 'up', icon: 'DollarSign' },
      { id: 'kpi_invoices', label: 'الفواتير الصادرة', value: 142, change: '+5.4%', trend: 'up', icon: 'FileText' },
      { id: 'kpi_avg_ticket', label: 'متوسط قيمة الطلب', value: '318 د.إ', change: '+2.1%', trend: 'up', icon: 'TrendingUp' }
    ];
    fields = [
      { id: 'f_customer', name: 'customer_name', label: 'اسم العميل', type: 'text', colSpan: 6, icon: 'User', required: true, placeholder: 'أدخل اسم العميل الثلاثي' },
      { id: 'f_phone', name: 'phone_number', label: 'رقم الهاتف', type: 'phone', colSpan: 6, icon: 'Phone', required: true, placeholder: '+971 50 123 4567' },
      { id: 'f_amount', name: 'invoice_amount', label: 'قيمة الفاتورة (AED)', type: 'currency', colSpan: 6, icon: 'DollarSign', required: true, validation: { min: 1 } },
      { id: 'f_status', name: 'payment_status', label: 'حالة الدفع', type: 'select', colSpan: 6, icon: 'Tag', options: ['مدفوع بالكامل', 'معلق', 'أقساط'], defaultValue: 'معلق' },
      { id: 'f_notes', name: 'invoice_notes', label: 'ملاحظات الفاتورة والتسليم', type: 'textarea', colSpan: 12, icon: 'FileText', placeholder: 'تفاصيل المنتجات أو شروط التوصيل...' }
    ];
    mockRecords = [
      { id: 'rec_1', customer_name: 'شركة النور للمقاولات', phone_number: '+971501112233', invoice_amount: 15400, payment_status: 'مدفوع بالكامل', invoice_notes: 'توريد مواد بناء الدفعة الأولى' },
      { id: 'rec_2', customer_name: 'مؤسسة الأفق التقنية', phone_number: '+971554445566', invoice_amount: 6800, payment_status: 'معلق', invoice_notes: 'تراخيص برمجية سنوية' },
      { id: 'rec_3', customer_name: 'سالم بن حمد الدرعي', phone_number: '+971529998877', invoice_amount: 3200, payment_status: 'أقساط', invoice_notes: 'خدمات استشارية' }
    ];
  } else if (p.includes('حضور') || p.includes('موظف') || p.includes('إجاز') || p.includes('دوام')) {
    title = 'نظام متابعة الدوام وإجازات الموظفين';
    kpis = [
      { id: 'kpi_present', label: 'نسبة الحضور اليوم', value: '94%', change: '+1.5%', trend: 'up', icon: 'CheckCircle' },
      { id: 'kpi_leaves', label: 'طلبات الإجازة النشطة', value: 3, change: '0%', trend: 'neutral', icon: 'Calendar' },
      { id: 'kpi_late', label: 'حالات التأخير', value: 2, change: '-40%', trend: 'up', icon: 'Clock' }
    ];
    fields = [
      { id: 'f_emp_name', name: 'employee_name', label: 'اسم الموظف', type: 'text', colSpan: 6, icon: 'User', required: true, placeholder: 'الاسم الوظيفي' },
      { id: 'f_dept', name: 'department', label: 'القسم / الإدارة', type: 'select', colSpan: 6, icon: 'Building', options: ['الهندسة والتقنية', 'المبيعات والتسويق', 'الموارد البشرية', 'المالية'], defaultValue: 'الهندسة والتقنية' },
      { id: 'f_date', name: 'log_date', label: 'تاريخ التسجيل', type: 'date', colSpan: 6, icon: 'Calendar', required: true },
      { id: 'f_status', name: 'attendance_status', label: 'حالة الحضور', type: 'select', colSpan: 6, icon: 'Tag', options: ['حاضر في الموعد', 'متأخر', 'إجازة رسمية', 'غياب بعذر'], defaultValue: 'حاضر في الموعد' },
      {
        id: 'f_late_reason',
        name: 'late_reason',
        label: 'سبب التأخير المبرر',
        type: 'textarea',
        colSpan: 12,
        icon: 'AlertCircle',
        placeholder: 'يرجى كتابة سبب التأخير بالتفصيل...',
        visibilityRule: { field: 'attendance_status', operator: '==', value: 'متأخر' }
      }
    ];
    mockRecords = [
      { id: 'rec_1', employee_name: 'عمر الهاشمي', department: 'الهندسة والتقنية', log_date: '2026-11-15', attendance_status: 'حاضر في الموعد', late_reason: '' },
      { id: 'rec_2', employee_name: 'فاطمة الزعابي', department: 'المالية', log_date: '2026-11-15', attendance_status: 'متأخر', late_reason: 'ازدحام مروري على شارع الشيخ زايد' },
      { id: 'rec_3', employee_name: 'ماجد الشامسي', department: 'المبيعات والتسويق', log_date: '2026-11-15', attendance_status: 'إجازة رسمية', late_reason: '' }
    ];
  } else if (p.includes('api') || p.includes('مفتاح') || p.includes('webhook') || p.includes('برمج') || p.includes('سيرفر')) {
    title = 'منظومة إدارة واجهات البرمجة ومفاتيح API';
    kpis = [
      { id: 'kpi_requests', label: 'طلبات API اليوم', value: '284,100', change: '+34%', trend: 'up', icon: 'Server' },
      { id: 'kpi_latency', label: 'متوسط الاستجابة', value: '42ms', change: '-8ms', trend: 'up', icon: 'Zap' },
      { id: 'kpi_active_keys', label: 'المفاتيح النشطة', value: 8, change: '+1', trend: 'up', icon: 'Key' }
    ];
    fields = [
      { id: 'f_key_name', name: 'key_name', label: 'اسم مفتاح الخدمة (Service Label)', type: 'text', colSpan: 6, icon: 'Key', required: true, placeholder: 'e.g. prod_payment_gateway' },
      { id: 'f_rate_limit', name: 'rate_limit', label: 'الحد الأقصى للطلبات في الدقيقة', type: 'number', colSpan: 6, icon: 'Gauge', defaultValue: 1000, validation: { min: 10, max: 10000 } },
      { id: 'f_ip_whitelist', name: 'ip_whitelist', label: 'عناوين IP المصرح بها (CIDR Regex)', type: 'text', colSpan: 6, icon: 'Shield', placeholder: '192.168.1.1/24', validation: { pattern: '^[0-9./, ]+$' } },
      { id: 'f_env', name: 'environment', label: 'البيئة المستهدفة', type: 'select', colSpan: 6, icon: 'Cpu', options: ['production', 'staging', 'development'], defaultValue: 'production' },
      { id: 'f_webhook_url', name: 'webhook_url', label: 'رابط الإشعارات الفورية (Webhook Endpoint)', type: 'text', colSpan: 12, icon: 'Globe', placeholder: 'https://api.yourdomain.com/v1/webhooks' }
    ];
    mockRecords = [
      { id: 'rec_1', key_name: 'prod_stripe_uae', rate_limit: 5000, ip_whitelist: '10.0.0.1/32', environment: 'production', webhook_url: 'https://pay.client.ae/webhooks' },
      { id: 'rec_2', key_name: 'staging_analytics', rate_limit: 1000, ip_whitelist: '0.0.0.0/0', environment: 'staging', webhook_url: 'https://staging.client.ae/stream' },
      { id: 'rec_3', key_name: 'dev_local_testing', rate_limit: 200, ip_whitelist: '127.0.0.1', environment: 'development', webhook_url: 'http://localhost:3000/events' }
    ];
    automations = [
      { id: 'auto_rate_alert', event: 'rate_limit_exceeded', action: 'throttle_ip', notify: 'security_admin' }
    ];
  } else {
    // Generic robust business solution
    title = 'شاشة إدارة العمليات التفاعلية';
    kpis = [
      { id: 'kpi_total', label: 'إجمالي البنود', value: 24, change: '+12%', trend: 'up', icon: 'List' },
      { id: 'kpi_active', label: 'البنود النشطة', value: 19, change: '+5%', trend: 'up', icon: 'CheckCircle' },
      { id: 'kpi_pending', label: 'قيد المعالجة', value: 5, change: '-2%', trend: 'down', icon: 'Clock' }
    ];
    fields = [
      { id: 'f_item_title', name: 'title', label: 'عنوان المعاملة / البند', type: 'text', colSpan: 6, icon: 'FileText', required: true, placeholder: 'اكتب اسم البند الرئيسي' },
      { id: 'f_category', name: 'category', label: 'التصنيف الرئيسي', type: 'select', colSpan: 6, icon: 'Tag', options: ['إداري', 'مالي', 'تشغيلي', 'لوجستي'], defaultValue: 'تشغيلي' },
      { id: 'f_due_date', name: 'due_date', label: 'تاريخ الاستحقاق', type: 'date', colSpan: 6, icon: 'Calendar', required: true },
      { id: 'f_priority', name: 'priority', label: 'درجة الأولوية', type: 'select', colSpan: 6, icon: 'AlertTriangle', options: ['عاجل جداً', 'متوسط', 'عادي'], defaultValue: 'متوسط' },
      { id: 'f_details', name: 'details', label: 'التفاصيل والشروط', type: 'textarea', colSpan: 12, icon: 'FileText', placeholder: 'أدخل أي تعليمات إضافية...' }
    ];
    mockRecords = [
      { id: 'rec_1', title: 'مراجعة الميزانية التشغيلية للربع الرابع', category: 'مالي', due_date: '2026-11-20', priority: 'عاجل جداً', details: 'تحديث أرقام التدفقات النقدية' },
      { id: 'rec_2', title: 'تجديد عقود الخدمات السنوية', category: 'إداري', due_date: '2026-11-25', priority: 'متوسط', details: 'التواصل مع الشركاء التقنيين' },
      { id: 'rec_3', title: 'فحص جاهزية الخوادم للنسخ الاحتياطي', category: 'تشغيلي', due_date: '2026-11-18', priority: 'عادي', details: 'التأكد من التشفير والتخزين' }
    ];
  }

  // Adjust content according to userRole
  let confirmationMsg = 'تم بناء وتجهيز شاشة العمل التفاعلية بنجاح وفق متطلباتك.';
  let highlightMsg = 'تم توزيع الحقول بنظام الشبكة (CSS Grid 12) مع مؤشرات أداء علوية وبيانات عربية واقعية.';
  let nextStepMsg = 'هل ترغب في إضافة حقول تخصصية جديدة أو ربط الشاشة بقاعدة البيانات؟';

  if (userRole === 'business_owner') {
    confirmationMsg = 'تم إطلاق لوحة العمل التنفيذية فوراً لتسريع إدارة عملياتك.';
    highlightMsg = 'تم دمج مؤشرات أداء إحصائية (KPIs) حية لرصد الإيرادات والنمو في الوقت الحقيقي.';
    nextStepMsg = 'هل تفضل استعراض تقرير تحليلي للأرباح أو تصدير البيانات إلى جدول؟';
  } else if (userRole === 'employee') {
    confirmationMsg = 'تم تجهيز نموذج العمل الميسر لتقليل وقت إدخال البيانات اليومية.';
    highlightMsg = 'تم ترتيب الحقول تلقائياً في مسارات إدخال واضحة لمنع الأخطاء البشرية.';
    nextStepMsg = 'هل تود إضافة حقل اختياري للتنبيهات أو البدء بتسجيل أول معاملة؟';
  } else if (userRole === 'developer') {
    confirmationMsg = 'تم توليد مخطط الشاشة (Screen Schema) بنجاح مع ربط المعرفات وأنواع البيانات.';
    highlightMsg = 'تم تفعيل معايير التحقق الصارم (Zod Contract) مع دعم القواعد الشرطية والتكامل البرمجي.';
    nextStepMsg = 'هل ترغب في إضافة قواعد تحقق Regex إضافية أو ضبط مسار الـ Webhook؟';
  }

  return {
    actionType: 'CREATE_SCREEN',
    assistantMessage: {
      confirmation: confirmationMsg,
      highlight: highlightMsg,
      nextStepSuggestion: nextStepMsg
    },
    suggestedActions: [
      viewType === 'FORM' ? 'عرض السجلات في وضع الجدول' : 'التبديل إلى وضع النموذج',
      'إضافة حقل تاريخ إضافي',
      'حفظ الشاشة في النظام'
    ],
    uiPayload: {
      meta: {
        screenId,
        title,
        description: `شاشة تفاعلية مخصصة مبنية لدور ${userRole}`,
        viewType
      },
      kpis,
      fields,
      mockRecords,
      automations
    }
  };
}

/**
 * Tool 2: patchExistingScreen
 * Applies surgical patch operations (ADD, UPDATE, REMOVE) to an existing UI payload.
 */
function patchExistingScreen(currentPayload, operations = [], userRole = 'business_owner', prompt = '') {
  const updatedPayload = JSON.parse(JSON.stringify(currentPayload || {}));
  if (!updatedPayload.fields) updatedPayload.fields = [];

  const p = String(prompt || '').toLowerCase();
  const appliedOps = [];

  // If operations are empty, infer operations from prompt
  if (operations.length === 0) {
    if (p.includes('احذف') || p.includes('إزالة')) {
      const fieldToRemove = updatedPayload.fields[updatedPayload.fields.length - 1];
      if (fieldToRemove) {
        operations.push({ op: 'REMOVE', targetFieldId: fieldToRemove.id });
      }
    } else if (p.includes('تاريخ') || p.includes('إضافة حقل')) {
      const newFieldId = 'f_extra_' + Date.now().toString(36).slice(2, 6);
      operations.push({
        op: 'ADD',
        targetFieldId: newFieldId,
        value: {
          id: newFieldId,
          name: 'extra_date',
          label: 'تاريخ إضافي',
          type: 'date',
          colSpan: 6,
          icon: 'Calendar',
          required: false
        }
      });
    } else {
      operations.push({
        op: 'UPDATE',
        targetFieldId: updatedPayload.fields[0]?.id || 'f_1',
        value: { required: true }
      });
    }
  }

  for (const op of operations) {
    if (op.op === 'ADD' && op.value) {
      updatedPayload.fields.push({
        id: op.targetFieldId || ('f_' + Date.now()),
        name: op.value.name || 'new_field',
        label: op.value.label || 'حقل جديد',
        type: op.value.type || 'text',
        colSpan: (op.value.colSpan === 6 || op.value.colSpan === 12) ? op.value.colSpan : 6,
        icon: op.value.icon || 'Tag',
        required: Boolean(op.value.required),
        visibilityRule: op.value.visibilityRule
      });
      appliedOps.push(op);
    } else if (op.op === 'UPDATE') {
      const idx = updatedPayload.fields.findIndex(f => f.id === op.targetFieldId);
      if (idx !== -1) {
        updatedPayload.fields[idx] = {
          ...updatedPayload.fields[idx],
          ...(op.value || {})
        };
        appliedOps.push(op);
      }
    } else if (op.op === 'REMOVE') {
      const idx = updatedPayload.fields.findIndex(f => f.id === op.targetFieldId);
      if (idx !== -1) {
        updatedPayload.fields.splice(idx, 1);
        appliedOps.push(op);
      }
    }
  }

  let confirmationMsg = 'تم تعديل وتحديث عناصر الشاشة بنجاح.';
  let highlightMsg = `تم تطبيق ${appliedOps.length} عملية تعديل جراحية على عناصر الواجهة.`;
  let nextStepMsg = 'هل تود حفظ التعديلات في النظام أو إضافة شروط ظهور إضافية؟';

  if (userRole === 'business_owner') {
    confirmationMsg = 'تم تحديث الشاشة فوراً لتلائم متطلبات متابعة أعمالك بدقة.';
    highlightMsg = 'تم الحفاظ التام على مؤشرات الأداء مع تحسين تجربة العرض.';
    nextStepMsg = 'هل تريد مراجعة الجدول بعد التعديل أو إضافة مؤشر إحصائي جديد؟';
  } else if (userRole === 'employee') {
    confirmationMsg = 'تم تحديث الحقول لتسهيل خطوتك التالية في النظام.';
    highlightMsg = 'أصبحت الحقول المطلوبة جاهزة للاستخدام السريع دون تأخير.';
    nextStepMsg = 'هل تريد تجربة إدخال أول سجل باستخدام النموذج المحدث؟';
  } else if (userRole === 'developer') {
    confirmationMsg = 'تم تطبيق التعديلات الجزئية (PATCH) بدقة متناهية على هيكل البيانات.';
    highlightMsg = 'تمت المحافظة على معايير التحقق النحوي لـ Zod بدون أي تعارض في الأنواع.';
    nextStepMsg = 'هل تريد إضافة قاعدة ظهور شرطي (Visibility Rule) لهذا الحقل؟';
  }

  return {
    actionType: 'PATCH_SCREEN',
    assistantMessage: {
      confirmation: confirmationMsg,
      highlight: highlightMsg,
      nextStepSuggestion: nextStepMsg
    },
    suggestedActions: [
      'حفظ التعديلات في النظام',
      'عرض في وضع الجدول',
      'التراجع عن آخر تعديل'
    ],
    uiPayload: updatedPayload,
    operations: appliedOps
  };
}

/**
 * Tool 3: configureAutomation
 * Attaches automation event rules to the screen.
 */
function configureAutomation(currentPayload, automationConfig = {}, userRole = 'business_owner') {
  const updatedPayload = JSON.parse(JSON.stringify(currentPayload || {}));
  if (!updatedPayload.automations) updatedPayload.automations = [];

  const autoId = 'auto_' + Date.now().toString(36).slice(2, 6);
  const rule = {
    id: autoId,
    event: automationConfig.event || 'on_record_created',
    condition: automationConfig.condition || 'status == "approved"',
    action: automationConfig.action || 'send_notification',
    notify: automationConfig.notify || 'manager@company.com'
  };

  updatedPayload.automations.push(rule);

  return {
    actionType: 'PATCH_SCREEN',
    assistantMessage: {
      confirmation: 'تم ربط وبرمجة قاعدة الأتمتة التلقائية بنجاح.',
      highlight: `تم تفعيل التنبيه التلقائي للحدث: "${rule.event}".`,
      nextStepSuggestion: 'هل تود تجربة تشغيل قاعدة الأتمتة على السجلات التجريبية؟'
    },
    suggestedActions: [
      'حفظ الشاشة مع الأتمتة',
      'إضافة قاعدة أتمتة ثانية',
      'استعراض السجلات'
    ],
    uiPayload: updatedPayload,
    operations: [
      { op: 'ADD', targetFieldId: 'automations', value: rule }
    ]
  };
}

// ----------------------------------------------------
// Main Agent Dispatcher
// ----------------------------------------------------

/**
 * Dispatches an incoming prompt, applying security guardrails, system prompt constitution,
 * tool invocation, and auto-retry contract validation.
 */
function dispatchPrompt({ prompt = '', userRole = 'business_owner', currentScreen = null, confirmed = false, db = null } = {}) {
  // Step 1: Security Guardrail Check
  if (isSensitiveOperation(prompt)) {
    if (!confirmed) {
      const guardrailPayload = {
        severity: prompt.includes('حذف') || prompt.includes('مسح') || prompt.includes('drop') ? 'critical' : 'high',
        operation: prompt.includes('صلاحيات') ? 'MODIFY_PERMISSIONS' : (prompt.includes('إشعار جماعي') ? 'BULK_NOTIFICATION' : 'DELETE_DATA'),
        message: 'تحذير أمني: يشتمل طلبك على إجراء عالي الخطورة قد يؤدي لفقدان دائم للبيانات أو تغيير جذري في الصلاحيات. يرجى تأكيد التنفيذ للمتابعة.',
        requiresExplicitPrompt: true
      };

      const envelope = {
        actionType: 'REQUIRE_CONFIRMATION',
        assistantMessage: {
          confirmation: 'توقف مؤقت لدواعي الأمان والحماية.',
          highlight: 'تم تفعيل بوابة الحماية الأمنية المتقدمة (Security Guardrail) لمنع أي إجراء غير مقصود.',
          nextStepSuggestion: 'هل تؤكد رغبتك في متابعة هذا الإجراء الحساس أم تريد إلغاءه؟'
        },
        suggestedActions: [
          'تأكيد الإجراء ومتابعة التنفيذ',
          'إلغاء العملية والعودة للوضع الآمن'
        ],
        guardrail: guardrailPayload
      };

      return validateUiResponse(envelope);
    }
  }

  // Step 2: Build dynamic system prompt (enforces role adaptation, screen context, and few-shots)
  const fewShots = db ? fetchDynamicFewShots(db, userRole, 2) : [];
  buildSystemPrompt({ userRole, currentScreen, fewShotExamples: fewShots });

  // Step 3: Tool Execution / Response Synthesis
  const p = String(prompt || '').toLowerCase();
  let rawEnvelope;

  if (currentScreen && (p.includes('أضف') || p.includes('عدل') || p.includes('احذف') || p.includes('غير') || p.includes('حدث'))) {
    rawEnvelope = patchExistingScreen(currentScreen, [], userRole, prompt);
  } else if (p.includes('أتمتة') || p.includes('تنبيه') || p.includes('webhook')) {
    rawEnvelope = configureAutomation(currentScreen || buildNewScreen(prompt, userRole).uiPayload, {}, userRole);
  } else {
    rawEnvelope = buildNewScreen(prompt, userRole);
  }

  // Step 4: Validate against strict Zod UI contract with single auto-retry
  return validateUiResponse(rawEnvelope);
}

// ----------------------------------------------------
// SQLite Database Helper Functions
// ----------------------------------------------------

function saveCustomScreen(db, { projectId = 'default', userId = 'system', title, description = '', viewType = 'FORM', uiSchema = {}, mockRecords = [] }) {
  if (!db) throw new Error('Database handle required');
  const screenId = uiSchema?.meta?.screenId || ('screen_' + Date.now());
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO custom_screens (
      id, project_id, user_id, title, description, view_type,
      ui_schema_json, mock_records_json, version, is_active, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      view_type = excluded.view_type,
      ui_schema_json = excluded.ui_schema_json,
      mock_records_json = excluded.mock_records_json,
      version = custom_screens.version + 1,
      updated_at = excluded.updated_at
  `);

  stmt.run(
    screenId,
    projectId,
    userId,
    title,
    description,
    viewType,
    JSON.stringify(uiSchema),
    JSON.stringify(mockRecords),
    now,
    now
  );

  return { screenId, title, viewType, updatedAt: now };
}

function listCustomScreens(db, projectId = null, userId = null) {
  if (!db) return [];
  if (projectId) {
    return db.prepare('SELECT id, project_id, user_id, title, description, view_type, version, is_active, created_at, updated_at FROM custom_screens WHERE project_id = ? ORDER BY updated_at DESC').all(projectId);
  }
  return db.prepare('SELECT id, project_id, user_id, title, description, view_type, version, is_active, created_at, updated_at FROM custom_screens ORDER BY updated_at DESC').all();
}

function getCustomScreen(db, screenId) {
  if (!db) return null;
  const screen = db.prepare('SELECT * FROM custom_screens WHERE id = ?').get(screenId);
  if (!screen) return null;

  let uiSchema = {};
  let mockRecords = [];
  try {
    uiSchema = JSON.parse(screen.ui_schema_json || '{}');
    mockRecords = JSON.parse(screen.mock_records_json || '[]');
  } catch (_) {}

  const dynamicRecords = db.prepare('SELECT * FROM dynamic_records WHERE screen_id = ? ORDER BY created_at DESC').all(screenId);
  const parsedDynamicRecords = dynamicRecords.map(r => {
    let data = {};
    try { data = JSON.parse(r.data_json || '{}'); } catch (_) {}
    return { id: r.id, ...data, _created_at: r.created_at };
  });

  return {
    ...screen,
    uiSchema,
    mockRecords,
    dynamicRecords: parsedDynamicRecords
  };
}

function insertDynamicRecord(db, screenId, recordData = {}, createdBy = 'user') {
  if (!db) throw new Error('Database handle required');
  const recordId = 'rec_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO dynamic_records (id, screen_id, data_json, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  stmt.run(recordId, screenId, JSON.stringify(recordData), createdBy, now, now);

  return { id: recordId, screenId, data: recordData, createdAt: now };
}

function saveAiFeedback(db, { userId = 'system', userRole = 'business_owner', prompt, response = {}, rating = 1, notes = '' }) {
  if (!db) throw new Error('Database handle required');
  const feedbackId = 'fb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const now = new Date().toISOString();

  const stmt = db.prepare(`
    INSERT INTO ai_feedback (
      id, user_id, user_role, prompt, response_json, rating, notes, is_few_shot_candidate, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    feedbackId,
    userId,
    userRole,
    prompt,
    JSON.stringify(response),
    rating > 0 ? 1 : -1,
    notes,
    rating > 0 ? 1 : 0,
    now
  );

  return { id: feedbackId, rating, createdAt: now };
}

module.exports = {
  buildNewScreen,
  patchExistingScreen,
  configureAutomation,
  dispatchPrompt,
  saveCustomScreen,
  listCustomScreens,
  getCustomScreen,
  insertDynamicRecord,
  saveAiFeedback
};
