/**
 * DynamicAgentWorkspace.tsx
 * Phase 6: Live Split-Screen Workspace, Direct Interaction & Persistence
 *
 * Implements:
 * - Split-Screen layout: AI Copilot Sidebar + Live Interactive Canvas
 * - Point-and-Prompt direct field selection (targetFieldId)
 * - In-memory Undo / Redo history stack
 * - Security Guardrail modal interceptor
 * - Publish to SQLite DB & Thumbs up/down feedback
 */

import React, { useState, useEffect } from 'react';
import {
  Bot,
  Send,
  Sparkles,
  Undo2,
  Redo2,
  Save,
  ThumbsUp,
  ThumbsDown,
  Layout,
  Table as TableIcon,
  LayoutDashboard,
  Briefcase,
  UserCheck,
  Code2,
  MousePointerClick,
  CheckCircle2,
  X,
  Loader2,
} from 'lucide-react';
import {
  UiPayload,
  ViewType,
  UserRole,
  ScreenField,
  RootResponseEnvelope,
  GuardrailPayload,
  AssistantMessage,
} from '../../contracts/uiJsonContract';
import { DynamicUIRenderer } from './DynamicUIRenderer';
import { GuardrailModal } from './GuardrailModal';

interface ChatMessage {
  id: string;
  sender: 'user' | 'agent';
  text?: string;
  assistantMessage?: AssistantMessage;
  suggestedActions?: string[];
  timestamp: string;
}

const DEFAULT_SAMPLE_PAYLOAD: UiPayload = {
  meta: {
    screenId: 'screen_default_erp',
    title: 'نظام إدارة المبيعات والفواتير التنفيذي',
    description: 'منظومة تفاعلية متكاملة لإصدار الفواتير ورصد المدفوعات',
    viewType: 'DASHBOARD',
  },
  kpis: [
    { id: 'kpi_rev', label: 'إجمالي إيرادات الشهر', value: '128,450 د.إ', change: '+24.5%', trend: 'up', icon: 'DollarSign' },
    { id: 'kpi_inv', label: 'الفواتير المحصلة', value: '96 / 102', change: '+94%', trend: 'up', icon: 'CheckCircle' },
    { id: 'kpi_avg', label: 'متوسط قيمة المعاملة', value: '1,338 د.إ', change: '+3.2%', trend: 'up', icon: 'TrendingUp' },
  ],
  fields: [
    { id: 'f_client', name: 'client_name', label: 'اسم العميل / المؤسسة', type: 'text', colSpan: 6, icon: 'User', required: true, placeholder: 'شركة الاتحاد للخدمات' },
    { id: 'f_phone', name: 'client_phone', label: 'رقم هاتف الاتصال', type: 'phone', colSpan: 6, icon: 'Phone', required: true, placeholder: '+971 50 000 0000' },
    { id: 'f_amount', name: 'invoice_amount', label: 'مبلغ الفاتورة (AED)', type: 'currency', colSpan: 6, icon: 'DollarSign', required: true, defaultValue: 2500 },
    { id: 'f_status', name: 'invoice_status', label: 'حالة التحصيل', type: 'select', colSpan: 6, icon: 'Tag', options: ['مدفوع بالكامل', 'معلق', 'أقساط'], defaultValue: 'معلق' },
    {
      id: 'f_late_notes',
      name: 'delay_notes',
      label: 'ملاحظات التأخير في السداد',
      type: 'textarea',
      colSpan: 12,
      icon: 'AlertCircle',
      placeholder: 'أدخل تفاصيل التنسيق مع العميل لسداد الدفعة...',
      visibilityRule: { field: 'invoice_status', operator: '==', value: 'معلق' },
    },
  ],
  mockRecords: [
    { id: '1', client_name: 'مجموعة الفطيم القابضة', client_phone: '+971501112233', invoice_amount: 45000, invoice_status: 'مدفوع بالكامل', delay_notes: '' },
    { id: '2', client_name: 'شركة الإمارات للتكنولوجيا', client_phone: '+971554445566', invoice_amount: 18500, invoice_status: 'معلق', delay_notes: 'التحويل البنكي قيد المعالجة' },
    { id: '3', client_name: 'مؤسسة الصقر للتجارة', client_phone: '+971529998877', invoice_amount: 8200, invoice_status: 'أقساط', delay_notes: 'استحقاق القسط الثاني في نهاية الشهر' },
  ],
};

export const DynamicAgentWorkspace: React.FC = () => {
  // Role & UI state
  const [userRole, setUserRole] = useState<UserRole>('business_owner');
  const [promptInput, setPromptInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedField, setSelectedField] = useState<ScreenField | null>(null);

  // Undo / Redo History Stack
  const [historyStack, setHistoryStack] = useState<UiPayload[]>([DEFAULT_SAMPLE_PAYLOAD]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const currentPayload = historyStack[historyIndex] || DEFAULT_SAMPLE_PAYLOAD;
  const [viewMode, setViewMode] = useState<ViewType>(currentPayload.meta.viewType || 'DASHBOARD');

  // Guardrail Modal State
  const [guardrailModalOpen, setGuardrailModalOpen] = useState(false);
  const [pendingGuardrail, setPendingGuardrail] = useState<GuardrailPayload | null>(null);
  const [pendingSensitivePrompt, setPendingSensitivePrompt] = useState<string | null>(null);

  // Persistence & Feedback Toast
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [statusToast, setStatusToast] = useState<string | null>(null);
  const [liveRecords, setLiveRecords] = useState<Record<string, unknown>[]>([]);

  // Chat conversation
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'init_1',
      sender: 'agent',
      assistantMessage: {
        confirmation: 'مرحباً بك! أنا مساعدك التنفيذي الذكي ومهندس الأنظمة المعتمد.',
        highlight: 'أنا جاهز لبناء وتعديل الشاشات وأتمتة العمليات لحظياً بنظام الشبكة (Grid 12).',
        nextStepSuggestion: 'ما التطبيق أو الشاشة التي تريد أن أصممها أو أعدلها لك اليوم؟',
      },
      suggestedActions: [
        'أريد نظام مبيعات وفواتير متكامل',
        'نموذج تسجيل دوام وإجازات الموظفين',
        'واجهة إدارة مفاتيح API والخوادم',
      ],
      timestamp: new Date().toLocaleTimeString('ar-AE', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  useEffect(() => {
    if (currentPayload.meta.viewType) {
      setViewMode(currentPayload.meta.viewType);
    }
  }, [currentPayload.meta.screenId]);

  const showToast = (msg: string) => {
    setStatusToast(msg);
    setTimeout(() => setStatusToast(null), 3500);
  };

  // Push new UI state to History Stack for Undo/Redo
  const pushToHistory = (newPayload: UiPayload) => {
    setHistoryStack((prev) => {
      const next = prev.slice(0, historyIndex + 1);
      next.push(newPayload);
      return next;
    });
    setHistoryIndex((prev) => prev + 1);
  };

  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex((prev) => prev - 1);
      showToast('تم التراجع عن التعديل السابق بنجاح.');
    }
  };

  const handleRedo = () => {
    if (historyIndex < historyStack.length - 1) {
      setHistoryIndex((prev) => prev + 1);
      showToast('تمت إعادة تطبيق التعديل بنجاح.');
    }
  };

  // Send Prompt to Agent Backend
  const handleSendPrompt = async (explicitPrompt?: string, isConfirmed = false) => {
    const promptToSend = explicitPrompt || promptInput;
    if (!promptToSend.trim() || isLoading) return;

    // Attach targetFieldId if point-and-prompt selection is active
    let formattedPrompt = promptToSend;
    if (selectedField && !promptToSend.includes(selectedField.name)) {
      formattedPrompt = `[تعديل على الحقل: ${selectedField.label} (${selectedField.name})]: ${promptToSend}`;
    }

    const userMsg: ChatMessage = {
      id: 'usr_' + Date.now(),
      sender: 'user',
      text: promptToSend,
      timestamp: new Date().toLocaleTimeString('ar-AE', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setPromptInput('');
    setIsLoading(true);

    try {
      const res = await fetch('/api/agent/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: formattedPrompt,
          userRole,
          currentScreen: currentPayload,
          confirmed: isConfirmed,
        }),
      });

      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error || 'تعذر معالجة الطلب');
      }

      const envelope: RootResponseEnvelope = json.data;

      // Check if security guardrail triggered
      if (envelope.actionType === 'REQUIRE_CONFIRMATION' && envelope.guardrail) {
        setPendingGuardrail(envelope.guardrail);
        setPendingSensitivePrompt(formattedPrompt);
        setGuardrailModalOpen(true);
      } else if (envelope.uiPayload) {
        pushToHistory(envelope.uiPayload);
        if (envelope.uiPayload.meta?.viewType) {
          setViewMode(envelope.uiPayload.meta.viewType);
        }
      }

      const agentMsg: ChatMessage = {
        id: 'agent_' + Date.now(),
        sender: 'agent',
        assistantMessage: envelope.assistantMessage,
        suggestedActions: envelope.suggestedActions,
        timestamp: new Date().toLocaleTimeString('ar-AE', { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, agentMsg]);
      setSelectedField(null);
    } catch (err: unknown) {
      const errorMsg: ChatMessage = {
        id: 'err_' + Date.now(),
        sender: 'agent',
        assistantMessage: {
          confirmation: 'تنبيه: حدث خطأ أثناء معالجة الطلب.',
          highlight: err instanceof Error ? err.message : 'يرجى التحقق من صياغة الأمر.',
          nextStepSuggestion: 'هل تريد إعادة المحاولة أو تجربة أمر آخر؟',
        },
        timestamp: new Date().toLocaleTimeString('ar-AE', { hour: '2-digit', minute: '2-digit' }),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  // Confirm sensitive action from Guardrail Modal
  const handleConfirmGuardrail = () => {
    setGuardrailModalOpen(false);
    if (pendingSensitivePrompt) {
      handleSendPrompt(pendingSensitivePrompt, true);
      setPendingSensitivePrompt(null);
      setPendingGuardrail(null);
    }
  };

  // Publish to Database
  const handlePublishScreen = async () => {
    try {
      const res = await fetch('/api/agent/screens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: 'main_project',
          userId: 'user_active',
          title: currentPayload.meta.title,
          description: currentPayload.meta.description,
          viewType: viewMode,
          uiSchema: currentPayload,
          mockRecords: currentPayload.mockRecords,
        }),
      });

      const json = await res.json();
      if (json.success) {
        showToast('🎉 تم نشر وحفظ الشاشة بنجاح في قاعدة بيانات SQLite!');
      } else {
        showToast('⚠️ حدث خطأ أثناء حفظ الشاشة: ' + (json.error || ''));
      }
    } catch (e: unknown) {
      showToast('⚠️ تعذر الاتصال بالخادم لحفظ الشاشة: ' + (e instanceof Error ? e.message : ''));
    }
  };

  // Submit dynamic record from form
  const handleSubmitRecord = async (data: Record<string, unknown>) => {
    setLiveRecords((prev) => [data, ...prev]);
    try {
      await fetch(`/api/agent/screens/${currentPayload.meta.screenId}/records`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, userId: 'active_operator' }),
      });
      showToast('✅ تم حفظ السجل الجديد بنجاح في SQLite.');
    } catch (err) {
      console.warn('[DynamicAgentWorkspace] Record submit failed:', err);
    }
  };

  // Submit Feedback (Thumbs up / down)
  const handleFeedback = async (rating: number) => {
    setFeedbackRating(rating);
    try {
      await fetch('/api/agent/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: 'operator_1',
          userRole,
          prompt: messages[messages.length - 2]?.text || 'تفاعل عام',
          response: currentPayload,
          rating,
          notes: rating > 0 ? 'تقييم إيجابي' : 'تقييم يحتاج تحسين',
        }),
      });
      showToast(rating > 0 ? 'شكراً لتقييمك الإيجابي! تم حفظ النموذج للتعلم المستمر.' : 'شكراً لملاحظتك! سنقوم بتحسين الاستجابة.');
    } catch (err) {
      console.warn('[DynamicAgentWorkspace] Feedback submit failed:', err);
    }
  };

  return (
    <div className="w-full h-full flex flex-col md:flex-row bg-[#080B11] text-slate-100 overflow-hidden font-sans" dir="rtl">
      {/* Toast Alert */}
      {statusToast && (
        <div className="fixed bottom-6 start-6 z-50 p-3 px-4 rounded-xl bg-slate-900 border border-blue-500/50 shadow-2xl text-xs text-white flex items-center gap-2 animate-fadeIn">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{statusToast}</span>
        </div>
      )}

      {/* Guardrail Modal */}
      <GuardrailModal
        isOpen={guardrailModalOpen}
        guardrail={pendingGuardrail}
        onConfirm={handleConfirmGuardrail}
        onCancel={() => {
          setGuardrailModalOpen(false);
          setPendingGuardrail(null);
          setPendingSensitivePrompt(null);
          showToast('تم إلغاء الأمر الحساس بنجاح والعودة للوضع الآمن.');
        }}
      />

      {/* ---------------------------------------------------- */}
      {/* SIDEBAR: AI Copilot Panel                            */}
      {/* ---------------------------------------------------- */}
      <div className="w-full md:w-[380px] lg:w-[420px] shrink-0 border-e border-slate-800 bg-[#0B0F19] flex flex-col h-full shadow-2xl z-20">
        {/* Copilot Header & Role Selector */}
        <div className="p-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
                <Bot className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  المساعد التنفيذي الذكي
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                </h3>
                <p className="text-[11px] text-slate-400">Action-Oriented AI Agent</p>
              </div>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
              8B Model
            </span>
          </div>

          {/* User Role Segmented Control */}
          <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setUserRole('business_owner')}
              className={`py-1.5 px-2 rounded-md font-semibold transition-all flex items-center justify-center gap-1.5 ${
                userRole === 'business_owner'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>صاحب عمل</span>
            </button>
            <button
              type="button"
              onClick={() => setUserRole('employee')}
              className={`py-1.5 px-2 rounded-md font-semibold transition-all flex items-center justify-center gap-1.5 ${
                userRole === 'employee'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>موظف</span>
            </button>
            <button
              type="button"
              onClick={() => setUserRole('developer')}
              className={`py-1.5 px-2 rounded-md font-semibold transition-all flex items-center justify-center gap-1.5 ${
                userRole === 'developer'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" />
              <span>مبرمج</span>
            </button>
          </div>
        </div>

        {/* Chat History Stream */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col ${msg.sender === 'user' ? 'items-start' : 'items-end'}`}
            >
              {msg.sender === 'user' ? (
                <div className="max-w-[85%] rounded-2xl rounded-tr-none bg-blue-600 text-white px-4 py-2.5 text-xs shadow-md">
                  <p>{msg.text}</p>
                  <span className="text-[10px] text-blue-200 mt-1 block text-start font-mono">
                    {msg.timestamp}
                  </span>
                </div>
              ) : (
                <div className="max-w-[95%] w-full rounded-2xl rounded-tl-none bg-slate-900 border border-slate-800 p-3.5 text-xs shadow-lg space-y-2">
                  {msg.assistantMessage && (
                    <div className="space-y-1.5">
                      <div className="p-2 rounded-lg bg-emerald-950/30 border border-emerald-500/20 text-emerald-200">
                        <p className="font-semibold">{msg.assistantMessage.confirmation}</p>
                      </div>
                      <div className="p-2 rounded-lg bg-blue-950/30 border border-blue-500/20 text-blue-200">
                        <p>{msg.assistantMessage.highlight}</p>
                      </div>
                      <div className="p-2 rounded-lg bg-purple-950/30 border border-purple-500/20 text-purple-200 font-medium">
                        <p>{msg.assistantMessage.nextStepSuggestion}</p>
                      </div>
                      {msg.assistantMessage.details && (
                        <details className="mt-2 text-xs bg-slate-950/70 border border-slate-800 rounded-lg p-2.5 text-slate-300">
                          <summary className="cursor-pointer text-slate-400 hover:text-white font-medium select-none flex items-center justify-between">
                            <span>عرض التفاصيل والتقرير الهندسي الكامل</span>
                            <span className="text-[10px] text-blue-400 font-mono">انقر للتوسيع</span>
                          </summary>
                          <div className="mt-2 pt-2 border-t border-slate-800/80 whitespace-pre-wrap leading-relaxed font-sans text-slate-200">
                            {msg.assistantMessage.details}
                          </div>
                        </details>
                      )}
                    </div>
                  )}

                  {/* Suggested Actions Pills */}
                  {msg.suggestedActions && msg.suggestedActions.length > 0 && (
                    <div className="pt-2 border-t border-slate-800/80 flex flex-wrap gap-1.5">
                      {msg.suggestedActions.map((act, i) => (
                        <button
                          key={i}
                          onClick={() => handleSendPrompt(act)}
                          className="px-2.5 py-1 rounded-full bg-slate-800 hover:bg-blue-600/30 text-slate-300 hover:text-white border border-slate-700/60 text-[11px] transition-all flex items-center gap-1"
                        >
                          <Sparkles className="w-3 h-3 text-blue-400" />
                          <span>{act}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  <span className="text-[10px] text-slate-500 block text-end font-mono">
                    {msg.timestamp}
                  </span>
                </div>
              )}
            </div>
          ))}

          {isLoading && (
            <div className="flex items-center gap-2 text-xs text-blue-400 bg-blue-950/40 border border-blue-800/40 p-3 rounded-xl animate-pulse">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>جاري تحليل الطلب وبناء الواجهة بدقة Zod...</span>
            </div>
          )}
        </div>

        {/* Selected Field Indicator (Point-and-Prompt) */}
        {selectedField && (
          <div className="mx-4 mb-2 p-2 px-3 rounded-lg bg-blue-950/70 border border-blue-500/40 flex items-center justify-between text-xs text-blue-200">
            <div className="flex items-center gap-2">
              <MousePointerClick className="w-4 h-4 text-blue-400 shrink-0" />
              <span>
                محدد للتعديل: <strong>{selectedField.label}</strong> ({selectedField.name})
              </span>
            </div>
            <button
              onClick={() => setSelectedField(null)}
              className="text-slate-400 hover:text-white p-0.5 rounded hover:bg-blue-900/50"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Prompt Input Form */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendPrompt();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={promptInput}
              onChange={(e) => setPromptInput(e.target.value)}
              placeholder={
                selectedField
                  ? `أدخل تعديلك على حقل "${selectedField.label}"...`
                  : 'اطلب شاشة جديدة أو تعديلاً (مثال: أضف حقل تاريخ)...'
              }
              className="flex-1 bg-slate-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-slate-500"
            />
            <button
              type="submit"
              disabled={isLoading || !promptInput.trim()}
              className="w-10 h-10 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white flex items-center justify-center transition-colors shadow-md shadow-blue-600/30"
            >
              {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </button>
          </form>
        </div>
      </div>

      {/* ---------------------------------------------------- */}
      {/* MAIN CANVAS: Live Interactive Canvas                 */}
      {/* ---------------------------------------------------- */}
      <div className="flex-1 flex flex-col h-full bg-[#080B11] overflow-hidden">
        {/* Canvas Toolbar */}
        <div className="h-14 px-5 border-b border-slate-800 bg-[#0B0F19]/90 backdrop-blur-md flex items-center justify-between gap-4 z-10 shrink-0">
          {/* View Mode Toggle */}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800 text-xs">
            <button
              onClick={() => setViewMode('FORM')}
              className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 transition-all ${
                viewMode === 'FORM'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layout className="w-3.5 h-3.5" />
              <span>النموذج (FORM)</span>
            </button>
            <button
              onClick={() => setViewMode('TABLE')}
              className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 transition-all ${
                viewMode === 'TABLE'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <TableIcon className="w-3.5 h-3.5" />
              <span>الجدول (TABLE)</span>
            </button>
            <button
              onClick={() => setViewMode('DASHBOARD')}
              className={`px-3 py-1.5 rounded-md font-semibold flex items-center gap-1.5 transition-all ${
                viewMode === 'DASHBOARD'
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <LayoutDashboard className="w-3.5 h-3.5" />
              <span>لوحة المؤشرات (DASHBOARD)</span>
            </button>
          </div>

          {/* Canvas Actions: Undo, Redo, Publish, Feedback */}
          <div className="flex items-center gap-2">
            {/* Undo / Redo */}
            <div className="flex items-center gap-1 border-e border-slate-800 pe-2 me-1">
              <button
                onClick={handleUndo}
                disabled={historyIndex <= 0}
                title="تراجع عن آخر تعديل"
                className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30 flex items-center justify-center hover:bg-slate-800 transition-colors"
              >
                <Undo2 className="w-4 h-4" />
              </button>
              <button
                onClick={handleRedo}
                disabled={historyIndex >= historyStack.length - 1}
                title="إعادة تطبيق التعديل"
                className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:text-white disabled:opacity-30 flex items-center justify-center hover:bg-slate-800 transition-colors"
              >
                <Redo2 className="w-4 h-4" />
              </button>
            </div>

            {/* Quick Feedback Buttons (👍 / 👎) */}
            <div className="flex items-center gap-1 border-e border-slate-800 pe-2 me-1">
              <button
                onClick={() => handleFeedback(1)}
                title="تقييم إيجابي (حفظ كنموذج مرجعي)"
                className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
                  feedbackRating === 1
                    ? 'bg-emerald-600 border-emerald-500 text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-emerald-400 hover:bg-slate-800'
                }`}
              >
                <ThumbsUp className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleFeedback(-1)}
                title="تقييم سلبي"
                className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-colors ${
                  feedbackRating === -1
                    ? 'bg-rose-600 border-rose-500 text-white'
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-rose-400 hover:bg-slate-800'
                }`}
              >
                <ThumbsDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Publish to SQLite Button */}
            <button
              onClick={handlePublishScreen}
              className="px-4 py-2 rounded-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold text-xs flex items-center gap-2 shadow-lg shadow-blue-600/25 transition-all"
            >
              <Save className="w-4 h-4" />
              <span>نشر في النظام (Publish to DB)</span>
            </button>
          </div>
        </div>

        {/* Live Canvas Content */}
        <div className="flex-1 overflow-hidden relative">
          <DynamicUIRenderer
            payload={currentPayload}
            viewMode={viewMode}
            selectedFieldId={selectedField?.id}
            onSelectField={(f) => {
              setSelectedField(f);
              showToast(`تم تحديد الحقل "${f.label}". يمكنك كتابة أمرك لتعديله مباشرة.`);
            }}
            onSubmitRecord={handleSubmitRecord}
            externalRecords={liveRecords}
          />
        </div>
      </div>
    </div>
  );
};
