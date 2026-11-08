import React, { useState } from 'react';
import {
  BookOpen,
  Search,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Coins,
} from 'lucide-react';
import { Language } from '../types/platform';

interface OnboardingTourProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onComplete?: () => void;
}

export const OnboardingTour: React.FC<OnboardingTourProps> = ({
  isOpen,
  onClose,
  language,
  onComplete,
}) => {
  const [currentStep, setCurrentStep] = useState(0);
  const isAr = language === 'ar';

  if (!isOpen) return null;

  const steps = [
    {
      id: 'step-library',
      icon: <BookOpen className="w-8 h-8 text-indigo-400" />,
      title: isAr ? '١. ارفع مراجعك أو اختر من المكتبة' : '1. Upload Books or Browse Library',
      description: isAr
        ? 'تحتوي المنصة على مراجع محققة، ويمكنك رفع كتبك ومصادرك الخاصة بأمان تام مع عزل كامل للبيانات (Tenant Isolation).'
        : 'Access verified scholarly books or upload your private research documents with guaranteed strict tenant isolation.',
      badge: isAr ? 'الخطوة الأولى' : 'Step 1',
    },
    {
      id: 'step-search',
      icon: <Search className="w-8 h-8 text-blue-400" />,
      title: isAr ? '٢. حدد مستوى البحث وصغ سؤالك' : '2. Select Research Tier & Formulate Query',
      description: isAr
        ? 'اختر من بين ثلاثة مستويات: الإجابة السريعة (نقطة واحدة)، البحث العميق (3 نقاط)، أو التحليل الخبير الشامل (10 نقاط).'
        : 'Choose from 3 specialized tiers: Quick Answer (1 pt), Deep Research (3 pts), or Exhaustive Expert Synthesis (10 pts).',
      badge: isAr ? 'الخطوة الثانية' : 'Step 2',
    },
    {
      id: 'step-citations-quota',
      icon: <Coins className="w-8 h-8 text-amber-400" />,
      title: isAr ? '٣. اقتباسات حرفية وحصة يومية متجددة' : '3. Verbatim Citations & Daily Quota',
      description: isAr
        ? 'تتضمن كل إجابة نصوصاً مقتبسة حرفياً بأرقام الصفحات الدقيقة. يتجدد رصيدك المجاني (10 نقاط يومياً) تلقائياً عند منتصف الليل بتوقيت غرينتش (00:00:00 UTC).'
        : 'Every insight is verified by verbatim text and exact page numbers. Your free daily quota (10 pts/day) resets automatically at 00:00:00 UTC.',
      badge: isAr ? 'الخطوة الثالثة' : 'Step 3',
    },
  ];

  const persistCompletion = async () => {
    try {
      await fetch('/api/user/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ completed: true, step: currentStep + 1 }),
      });
    } catch (_) {
      // Non-blocking
    }
  };

  const handleNext = async () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      await persistCompletion();
      if (onComplete) onComplete();
      onClose();
    }
  };

  const handleSkip = async () => {
    await persistCompletion();
    if (onComplete) onComplete();
    onClose();
  };

  const step = steps[currentStep];

  return (
    <div
      data-testid="onboarding-tour-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="relative w-full max-w-lg rounded-2xl bg-[#13141c] border border-white/10 shadow-2xl p-6 text-zinc-100 overflow-hidden">
        {/* Progress header */}
        <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
          <div className="flex items-center gap-2">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              {step.badge}
            </span>
            <span className="text-xs text-zinc-400">
              {currentStep + 1} / {steps.length}
            </span>
          </div>

          <button
            type="button"
            data-testid="onboarding-skip-button"
            onClick={handleSkip}
            className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer px-2 py-1 rounded hover:bg-white/5"
          >
            {isAr ? 'تخطي الجولة' : 'Skip Tour'}
          </button>
        </div>

        {/* Step Content */}
        <div className="py-8 text-center space-y-4">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center shadow-inner">
            {step.icon}
          </div>

          <h3 className="text-lg font-bold text-white tracking-tight">{step.title}</h3>

          <p className="text-sm text-zinc-300 leading-relaxed max-w-md mx-auto px-4">
            {step.description}
          </p>

          {/* Step indicators */}
          <div className="flex items-center justify-center gap-1.5 pt-4">
            {steps.map((_, idx) => (
              <div
                key={idx}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  idx === currentStep ? 'w-6 bg-indigo-500' : 'w-2 bg-white/20'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Action Controls */}
        <div className="pt-4 border-t border-white/[0.08] flex items-center justify-between">
          <button
            type="button"
            disabled={currentStep === 0}
            onClick={() => setCurrentStep((prev) => Math.max(0, prev - 1))}
            className="px-3.5 py-2 text-xs font-medium text-zinc-400 hover:text-white disabled:opacity-0 transition-opacity cursor-pointer flex items-center gap-1"
          >
            {isAr ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            <span>{isAr ? 'السابق' : 'Previous'}</span>
          </button>

          <button
            type="button"
            data-testid="onboarding-next-button"
            onClick={handleNext}
            className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs sm:text-sm transition-all shadow-lg shadow-indigo-600/30 flex items-center gap-1.5 cursor-pointer"
          >
            <span>
              {currentStep === steps.length - 1
                ? isAr
                  ? 'ابدأ الاستخدام الآن'
                  : 'Start Exploring'
                : isAr
                ? 'التالي'
                : 'Next'}
            </span>
            {currentStep === steps.length - 1 ? (
              <Sparkles className="w-4 h-4" />
            ) : isAr ? (
              <ChevronLeft className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
