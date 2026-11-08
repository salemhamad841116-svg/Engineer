import React from 'react';
import { X, Shield, FileText, CheckCircle2 } from 'lucide-react';
import { Language } from '../types/platform';
import termsData from '../../content/legal/terms.json';
import privacyData from '../../content/legal/privacy.json';

interface LegalModalProps {
  isOpen: boolean;
  onClose: () => void;
  type: 'terms' | 'privacy';
  language: Language;
}

export const LegalModal: React.FC<LegalModalProps> = ({
  isOpen,
  onClose,
  type,
  language,
}) => {
  if (!isOpen) return null;

  const isAr = language === 'ar';
  const data = type === 'terms' ? termsData : privacyData;
  const title = isAr ? data.title.ar : data.title.en;

  return (
    <div
      data-testid={`legal-modal-${type}`}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-2xl bg-[#14151b] border border-white/10 shadow-2xl text-zinc-100 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/10 bg-white/[0.02]">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-xl ${type === 'terms' ? 'bg-indigo-500/10 text-indigo-400' : 'bg-emerald-500/10 text-emerald-400'}`}>
              {type === 'terms' ? <FileText className="w-5 h-5" /> : <Shield className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">{title}</h2>
              <div className="flex items-center gap-2 text-xs text-zinc-400 mt-0.5">
                <span>{isAr ? `الإصدار: ${data.version}` : `Version: ${data.version}`}</span>
                <span>•</span>
                <span>{isAr ? `آخر تحديث: ${data.last_updated}` : `Last Updated: ${data.last_updated}`}</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            data-testid="legal-modal-close"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm leading-relaxed text-zinc-300">
          {data.sections.map((section) => (
            <div key={section.id} className="space-y-2 border-b border-white/[0.04] pb-4 last:border-b-0 last:pb-0">
              <h3 className="font-semibold text-white text-base flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-indigo-400 shrink-0" />
                {isAr ? section.heading.ar : section.heading.en}
              </h3>
              <p className="text-zinc-300 text-xs sm:text-sm whitespace-pre-line pe-2">
                {isAr ? section.content.ar : section.content.en}
              </p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-white/[0.02] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm transition-colors cursor-pointer shadow-lg shadow-indigo-600/20"
          >
            {isAr ? 'فهمت وموافق' : 'Understood & Acknowledge'}
          </button>
        </div>
      </div>
    </div>
  );
};
