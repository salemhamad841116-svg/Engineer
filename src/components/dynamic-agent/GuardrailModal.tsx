/**
 * GuardrailModal.tsx
 * Phase 6: Security Guardrail Confirmation Modal
 *
 * Displays a high-contrast warning dialog when an agent action requires explicit human confirmation
 * (e.g. data deletion, permission modifications, mass messaging).
 */

import React from 'react';
import { AlertTriangle, ShieldAlert, X, Check } from 'lucide-react';
import { GuardrailPayload } from '../../contracts/uiJsonContract';

interface GuardrailModalProps {
  guardrail: GuardrailPayload | null;
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const GuardrailModal: React.FC<GuardrailModalProps> = ({
  guardrail,
  isOpen,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen || !guardrail) return null;

  const isCritical = guardrail.severity === 'critical';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn" dir="rtl">
      <div className="w-full max-w-lg rounded-2xl bg-[#0D111A] border border-rose-500/40 shadow-2xl p-6 text-slate-100 flex flex-col gap-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
              isCritical ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}>
              {isCritical ? <ShieldAlert className="w-6 h-6" /> : <AlertTriangle className="w-6 h-6" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-white">
                {isCritical ? 'تحذير أمني عالي الخطورة' : 'إجراء يتطلب تأكيداً صريحاً'}
              </h3>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                نوع العملية: {guardrail.operation} | مستوى الخطورة: {guardrail.severity.toUpperCase()}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800/60 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Message Body */}
        <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-800/30 text-xs text-rose-200 leading-relaxed">
          <p className="font-semibold mb-1">تنبيه حماية النظام:</p>
          <p>{guardrail.message}</p>
        </div>

        <p className="text-xs text-slate-400">
          تم تفعيل طبقة الحماية الفولاذية (Security Guardrails) لمنع أي مسح للبيانات أو تغيير في صلاحيات الأمان دون موافقة المشرف.
        </p>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/80">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors"
          >
            إلغاء الأمر والعودة للوضع الآمن
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-5 py-2 rounded-lg text-xs font-bold text-white transition-colors flex items-center gap-1.5 shadow-lg ${
              isCritical
                ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30'
                : 'bg-amber-600 hover:bg-amber-500 shadow-amber-600/30'
            }`}
          >
            <Check className="w-4 h-4" />
            <span>تأكيد التنفيذ والمتابعة</span>
          </button>
        </div>
      </div>
    </div>
  );
};
