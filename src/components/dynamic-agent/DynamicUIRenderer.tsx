/**
 * DynamicUIRenderer.tsx
 * Phase 5: Dynamic UI Rendering Engine (React + TypeScript)
 *
 * Renders interactive UI components from UIPayload:
 * - 12-Column CSS Grid Layout (colSpan: 6 or 12) with full RTL Arabic support
 * - In-browser reactive Visibility Rule engine
 * - View Modes: FORM, TABLE, and DASHBOARD (with top KPI cards)
 * - Point-and-Prompt field selection highlighting
 */

import React, { useState } from 'react';
import {
  User,
  DollarSign,
  Calendar,
  Building,
  Phone,
  Mail,
  FileText,
  Tag,
  AlertCircle,
  CheckCircle2,
  TrendingUp,
  TrendingDown,
  Clock,
  Key,
  Server,
  Zap,
  Shield,
  List,
  Search,
  Plus,
  ArrowUpRight,
  ArrowDownRight,
  Database,
  Cpu,
  Layers,
  Sparkles,
} from 'lucide-react';
import { UiPayload, ViewType, ScreenField } from '../../contracts/uiJsonContract';
import { evaluateVisibilityRule } from './VisibilityEngine';

const ICON_MAP: Record<string, React.ElementType> = {
  User,
  DollarSign,
  Calendar,
  Building,
  Phone,
  Mail,
  FileText,
  Tag,
  AlertCircle,
  CheckCircle: CheckCircle2,
  TrendingUp,
  TrendingDown,
  Clock,
  Key,
  Server,
  Zap,
  Shield,
  List,
  Database,
  Cpu,
  Layers,
  Sparkles,
};

function renderIcon(iconName?: string, className = 'w-4 h-4') {
  const IconComponent = (iconName && ICON_MAP[iconName]) || FileText;
  return <IconComponent className={className} />;
}

interface DynamicUIRendererProps {
  payload: UiPayload;
  viewMode: ViewType;
  selectedFieldId?: string | null;
  onSelectField?: (field: ScreenField) => void;
  onSubmitRecord?: (recordData: Record<string, unknown>) => void;
  externalRecords?: Record<string, unknown>[];
}

export const DynamicUIRenderer: React.FC<DynamicUIRendererProps> = ({
  payload,
  viewMode,
  selectedFieldId,
  onSelectField,
  onSubmitRecord,
  externalRecords = [],
}) => {
  const [formValues, setFormValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const f of payload.fields || []) {
      if (f.defaultValue !== undefined) initial[f.name] = f.defaultValue;
    }
    return initial;
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedToast, setSubmittedToast] = useState(false);

  const allRecords = externalRecords.length > 0 ? externalRecords : (payload.mockRecords || []);

  const handleFieldChange = (fieldName: string, value: unknown) => {
    setFormValues((prev) => ({ ...prev, [fieldName]: value }));
    if (formErrors[fieldName]) {
      setFormErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors: Record<string, string> = {};

    for (const field of payload.fields || []) {
      const isVisible = evaluateVisibilityRule(field.visibilityRule, formValues);
      if (!isVisible) continue;

      const val = formValues[field.name];
      if (field.required && (val === undefined || val === null || String(val).trim() === '')) {
        errors[field.name] = `حقل "${field.label}" مطلوب.`;
      } else if (field.validation && val !== undefined && val !== '') {
        if (field.validation.min !== undefined && Number(val) < field.validation.min) {
          errors[field.name] = field.validation.message || `القيمة يجب ألا تقل عن ${field.validation.min}.`;
        }
        if (field.validation.max !== undefined && Number(val) > field.validation.max) {
          errors[field.name] = field.validation.message || `القيمة يجب ألا تزيد عن ${field.validation.max}.`;
        }
        if (field.validation.pattern && !new RegExp(field.validation.pattern).test(String(val))) {
          errors[field.name] = field.validation.message || 'الصيغة المدخلة غير صحيحة.';
        }
      }
    }

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    if (onSubmitRecord) {
      onSubmitRecord(formValues);
    }

    setSubmittedToast(true);
    setTimeout(() => setSubmittedToast(false), 3000);
  };

  const filteredRecords = allRecords.filter((rec) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return Object.values(rec).some((val) => String(val || '').toLowerCase().includes(query));
  });

  return (
    <div className="w-full h-full flex flex-col overflow-y-auto p-4 md:p-6 text-slate-100 font-sans" dir="rtl">
      {/* Toast Notification */}
      {submittedToast && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-950/80 border border-emerald-500/50 text-emerald-200 flex items-center gap-2 text-sm animate-fadeIn">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>تم تسجيل البيانات بنجاح في قاعدة البيانات وحفظ السجل التفاعلي.</span>
        </div>
      )}

      {/* KPI Cards Row (Always rendered in DASHBOARD, or if present) */}
      {(viewMode === 'DASHBOARD' || (payload.kpis && payload.kpis.length > 0)) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {(payload.kpis || []).map((kpi) => (
            <div
              key={kpi.id}
              className="p-4 rounded-xl bg-slate-900/70 border border-slate-800 shadow-md backdrop-blur-sm flex items-center justify-between"
            >
              <div>
                <p className="text-xs font-medium text-slate-400 mb-1">{kpi.label}</p>
                <h4 className="text-xl font-bold text-white tracking-tight">{kpi.value}</h4>
                {kpi.change && (
                  <div className="flex items-center gap-1 mt-1">
                    {kpi.trend === 'up' ? (
                      <ArrowUpRight className="w-3.5 h-3.5 text-emerald-400" />
                    ) : kpi.trend === 'down' ? (
                      <ArrowDownRight className="w-3.5 h-3.5 text-rose-400" />
                    ) : null}
                    <span
                      className={`text-xs font-semibold ${
                        kpi.trend === 'up'
                          ? 'text-emerald-400'
                          : kpi.trend === 'down'
                          ? 'text-rose-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {kpi.change}
                    </span>
                  </div>
                )}
              </div>
              <div className="w-10 h-10 rounded-lg bg-blue-600/15 border border-blue-500/30 flex items-center justify-center text-blue-400">
                {renderIcon(kpi.icon, 'w-5 h-5')}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Main View Mode Content */}
      {viewMode === 'FORM' && (
        <form onSubmit={handleSubmit} className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3 mb-5">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-400" />
                {payload.meta.title}
              </h3>
              {payload.meta.description && (
                <p className="text-xs text-slate-400 mt-0.5">{payload.meta.description}</p>
              )}
            </div>
            <span className="text-[11px] px-2.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 font-medium">
              نموذج إدخال تفاعلي
            </span>
          </div>

          {/* 12-Column Grid Fields */}
          <div className="grid grid-cols-12 gap-4">
            {(payload.fields || []).map((field) => {
              const isVisible = evaluateVisibilityRule(field.visibilityRule, formValues);
              if (!isVisible) return null;

              const isSelected = selectedFieldId === field.id;
              const hasError = formErrors[field.name];
              const spanClass = field.colSpan === 6 ? 'col-span-12 sm:col-span-6' : 'col-span-12';

              return (
                <div
                  key={field.id}
                  onClick={() => onSelectField && onSelectField(field)}
                  className={`${spanClass} p-2 rounded-lg transition-all cursor-pointer ${
                    isSelected
                      ? 'ring-2 ring-blue-500 bg-blue-500/10'
                      : 'hover:bg-slate-800/40'
                  }`}
                  title="انقر لتحديد هذا الحقل والتعديل عليه عبر المساعد الذكي"
                >
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5 flex items-center gap-1.5">
                    {renderIcon(field.icon, 'w-3.5 h-3.5 text-blue-400')}
                    <span>{field.label}</span>
                    {field.required && <span className="text-rose-400 text-xs">*</span>}
                    {isSelected && (
                      <span className="me-auto text-[10px] bg-blue-600 text-white px-1.5 py-0.5 rounded font-mono">
                        محدد للتعديل
                      </span>
                    )}
                  </label>

                  {/* Input Rendering based on Field Type */}
                  {field.type === 'select' ? (
                    <select
                      value={String(formValues[field.name] || field.defaultValue || '')}
                      onChange={(e) => handleFieldChange(field.name, e.target.value)}
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="">اختر...</option>
                      {(field.options || []).map((opt) => (
                        <option key={opt} value={opt} className="bg-slate-900 text-white">
                          {opt}
                        </option>
                      ))}
                    </select>
                  ) : field.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      value={String(formValues[field.name] || '')}
                      placeholder={field.placeholder || ''}
                      onChange={(e) => handleFieldChange(field.name, e.target.value)}
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-slate-500 resize-none"
                    />
                  ) : (
                    <input
                      type={
                        field.type === 'number' || field.type === 'currency'
                          ? 'number'
                          : field.type === 'date'
                          ? 'date'
                          : field.type === 'email'
                          ? 'email'
                          : field.type === 'phone'
                          ? 'tel'
                          : 'text'
                      }
                      value={String(formValues[field.name] || '')}
                      placeholder={field.placeholder || ''}
                      onChange={(e) => handleFieldChange(field.name, e.target.value)}
                      className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-slate-500"
                    />
                  )}

                  {hasError && <p className="text-[11px] text-rose-400 mt-1">{hasError}</p>}
                </div>
              );
            })}
          </div>

          {/* Form Actions */}
          <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
            <span className="text-xs text-slate-400">انقر على أي حقل للتعديل عليه عبر المساعد الذكي (Point-and-Prompt).</span>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs transition-colors flex items-center gap-1.5 shadow-md shadow-blue-600/20"
            >
              <Plus className="w-4 h-4" />
              <span>تسجيل البيانات</span>
            </button>
          </div>
        </form>
      )}

      {viewMode === 'TABLE' && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-800 pb-4 mb-4">
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <List className="w-4 h-4 text-blue-400" />
                {payload.meta.title} — جدول السجلات
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                إجمالي السجلات: {allRecords.length} سجلات
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 absolute start-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="بحث في السجلات..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-slate-950/80 border border-slate-700/80 rounded-lg ps-8 pe-3 py-1.5 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-slate-500"
              />
            </div>
          </div>

          {/* Table Element */}
          <div className="overflow-x-auto">
            <table className="w-full text-right text-xs">
              <thead className="bg-slate-950/70 text-slate-300 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">#</th>
                  {(payload.fields || []).slice(0, 5).map((f) => (
                    <th key={f.id} className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        {renderIcon(f.icon, 'w-3.5 h-3.5 text-blue-400')}
                        <span>{f.label}</span>
                      </div>
                    </th>
                  ))}
                  <th className="py-2.5 px-3 text-center">الحالة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {filteredRecords.length > 0 ? (
                  filteredRecords.map((rec, idx) => (
                    <tr key={idx} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3 px-3 text-slate-500">{idx + 1}</td>
                      {(payload.fields || []).slice(0, 5).map((f) => (
                        <td key={f.id} className="py-3 px-3 text-slate-200">
                          {String(rec[f.name] || '-')}
                        </td>
                      ))}
                      <td className="py-3 px-3 text-center">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          مؤكد
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={(payload.fields?.length || 5) + 2}
                      className="py-8 text-center text-slate-500"
                    >
                      لا توجد سجلات مطابقة لخيارات البحث.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === 'DASHBOARD' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-lg">
            <h4 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              أحدث العمليات والحركات المسجلة
            </h4>
            <div className="space-y-3">
              {allRecords.slice(0, 4).map((rec, i) => (
                <div
                  key={i}
                  className="p-3 rounded-lg bg-slate-950/60 border border-slate-800/80 flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-xs">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-white">
                        {String(rec.customer_name || rec.title || rec.employee_name || rec.key_name || 'سجل تفاعلي')}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {String(rec.phone_number || rec.department || rec.category || rec.environment || 'النشاط الرئيسي')}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-emerald-400">
                    {String(rec.invoice_amount ? `${rec.invoice_amount} AED` : rec.attendance_status || rec.status || 'نشط')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-4 bg-slate-900/60 border border-slate-800 rounded-xl p-5 shadow-lg flex flex-col justify-between">
            <div>
              <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <Shield className="w-4 h-4 text-blue-400" />
                ملخص النظام والحماية
              </h4>
              <ul className="text-xs text-slate-300 space-y-2.5">
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>التحقق الصارم من صحة البيانات (Zod Contract)</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>محرك القواعد الشرطية يعمل داخل المتصفح</span>
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>حفظ فوري في قاعدة بيانات SQLite المحلية</span>
                </li>
              </ul>
            </div>
            <div className="p-3 mt-4 rounded-lg bg-blue-950/40 border border-blue-800/40 text-blue-200 text-xs">
              💡 يمكنك في أي وقت استخدام المساعد التنفيذي لإضافة أو تعديل أي حقل بنقرة واحدة.
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
