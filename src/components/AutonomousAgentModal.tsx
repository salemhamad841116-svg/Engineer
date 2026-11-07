import React, { useState, useEffect } from 'react';
import {
  Bot,
  Zap,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  HardDrive,
  Cpu,
  Brain,
  Rocket,
  FolderDown,
  Sliders,
  Terminal,
  Activity,
  X,
  RefreshCw,
  Search,
  Check,
  Ban,
} from 'lucide-react';
import { Language } from '../types/platform';

interface AutonomousAgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  language?: Language;
  currentProjectId?: string;
}

interface AgentTaskStepLog {
  step: string;
  message: string;
  at?: string;
}

interface SelfHealingHistoryItem {
  attempt: number;
  targetFile: string;
  line: number;
  testStatus: string;
  rootCause: string;
  appliedFixDiff?: string;
  fixDescription?: string;
}

interface SelfHealingState {
  enabled: boolean;
  active: boolean;
  status: string;
  targetFile?: string;
  targetLine?: number;
  rootCause?: string;
  appliedFixDiff?: string;
  testsPassed?: boolean;
  attemptsCount?: number;
  maxAttempts?: number;
  history?: SelfHealingHistoryItem[];
  message?: string;
  resolved?: boolean;
  exhaustedExplanation?: {
    summary?: string;
    details?: string;
    suggestions?: string[];
  };
}

interface AutonomousTaskView {
  taskId?: string;
  status?: string;
  prompt?: string;
  stepsLog?: AgentTaskStepLog[];
  selfHealing?: SelfHealingState;
  [key: string]: unknown;
}

interface MemoryLessonItem {
  id?: string;
  scope?: string;
  projectId?: string | null;
  error_signature?: string;
  root_cause?: string;
  proven_fix?: string;
  confidence_score?: number;
  usage_count?: number;
  created_at?: string;
}

interface ApprovalItem {
  id: string;
  taskId?: string;
  operationType?: string;
  command?: string;
  filePath?: string;
  riskLevel?: string;
  status?: string;
  title?: string;
  action_type?: string;
  description?: string;
}

interface MemoryMetricsItem {
  usagePercent?: number;
  totalMb?: number;
  freeMb?: number;
  processRssMb?: number;
  processHeapUsedMb?: number;
}

interface DiskMetricsItem {
  freeMb?: number;
  usagePercent?: number;
  totalMb?: number;
}

interface ResourceMetricsItem {
  memory?: MemoryMetricsItem;
  disk?: DiskMetricsItem;
  pressureLevel?: string;
  ramUsedMb?: number;
  ramTotalMb?: number;
  ramUsagePercent?: number;
  diskUsedMb?: number;
  diskTotalMb?: number;
  diskUsagePercent?: number;
  tempCacheMb?: number;
}

interface DeploymentItem {
  id?: string;
  target?: string;
  status?: string;
}

export const AutonomousAgentModal: React.FC<AutonomousAgentModalProps> = ({
  isOpen,
  onClose,
  language: _language = 'ar',
  currentProjectId = 'proj-fintrack-erp',
}) => {
  const [activeTab, setActiveTab] = useState<
    'execute' | 'decisions' | 'healing' | 'resources' | 'memory' | 'deploy'
  >('execute');

  const [prompt, setPrompt] = useState('');
  const [autonomyLevel, setAutonomyLevel] = useState<'autonomous' | 'supervised'>('autonomous');
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [deployTarget, setDeployTarget] = useState<'local_preview' | 'staging_docker' | 'cloud_production'>('local_preview');

  const [isRunning, setIsRunning] = useState(false);
  const [currentTask, setCurrentTask] = useState<AutonomousTaskView | null>(null);
  const [pendingApprovals, setPendingApprovals] = useState<ApprovalItem[]>([]);
  const [resourceMetrics, setResourceMetrics] = useState<ResourceMetricsItem | null>(null);
  const [lessons, setLessons] = useState<MemoryLessonItem[]>([]);
  const [_deployments, _setDeployments] = useState<DeploymentItem[]>([]);
  const [searchMemoryQuery, setSearchMemoryQuery] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  useEffect(() => {
    if (isOpen) {
      fetchResources();
      fetchApprovals();
      fetchLessons();
    }
  }, [isOpen]);

  const fetchResources = async () => {
    try {
      const res = await fetch('/api/agent/resources');
      const data = await res.json();
      if (data.success) setResourceMetrics(data.metrics);
    } catch (_err) {
      // fallback
    }
  };

  const fetchApprovals = async () => {
    try {
      const res = await fetch('/api/agent/approvals');
      const data = await res.json();
      if (data.success) setPendingApprovals(data.approvals || []);
    } catch (_err) {
      // fallback
    }
  };

  const fetchLessons = async () => {
    try {
      const res = await fetch('/api/agent/memory/lessons');
      const data = await res.json();
      if (data.success) setLessons(data.lessons || []);
    } catch (_err) {
      // fallback
    }
  };

  const handleExecuteTask = async () => {
    if (!prompt.trim() || isRunning) return;
    setIsRunning(true);
    setFeedbackMsg(null);

    try {
      const res = await fetch('/api/agent/task/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: currentProjectId,
          prompt: prompt.trim(),
          autonomyLevel,
          autoDeploy,
          deployTarget,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setCurrentTask(data);
        if (data.status === 'waiting_approval') {
          setActiveTab('decisions');
          fetchApprovals();
        } else if (data.selfHealing) {
          setActiveTab('healing');
        }
        setFeedbackMsg({
          text: data.status === 'completed'
            ? 'اكتملت المهمة بنجاح واجتازت كافة الاختبارات والفحوصات!'
            : data.status === 'waiting_approval'
            ? 'توقفت المهمة مؤقتاً بانتظار موافقتك على العملية الحساسة.'
            : 'تم إنهاء محاولة التنفيذ وتحديث السجلات.',
          type: data.status === 'completed' ? 'success' : 'error',
        });
      } else {
        setFeedbackMsg({ text: data.error || 'حدث خطأ أثناء تشغيل المهمة', type: 'error' });
      }
    } catch (err: unknown) {
      setFeedbackMsg({ text: err instanceof Error ? err.message : String(err), type: 'error' });
    } finally {
      setIsRunning(false);
      fetchResources();
      fetchLessons();
    }
  };

  const handleResolveApproval = async (approvalId: string, decision: 'approved' | 'rejected') => {
    try {
      const res = await fetch(`/api/agent/approval/${approvalId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision }),
      });
      const data = await res.json();
      if (data.success) {
        fetchApprovals();
        setFeedbackMsg({
          text: decision === 'approved' ? 'تمت الموافقة واستئناف التنفيذ.' : 'تم رفض العملية وإيقاف الإجراء الحساس.',
          type: 'success',
        });
      }
    } catch (err: unknown) {
      setFeedbackMsg({ text: err instanceof Error ? err.message : String(err), type: 'error' });
    }
  };

  const handleChooseDecision = async (decisionId: string, optionId: string) => {
    if (!currentTask?.taskId) return;
    try {
      const res = await fetch(`/api/agent/decision/${decisionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: currentTask.taskId,
          chosenOptionId: optionId,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setFeedbackMsg({ text: `تم اعتماد الخيار المعماري (${optionId}) بنجاح!`, type: 'success' });
      }
    } catch (err: unknown) {
      setFeedbackMsg({ text: err instanceof Error ? err.message : String(err), type: 'error' });
    }
  };

  const handleUndo = async () => {
    if (!currentTask?.taskId) return;
    try {
      const res = await fetch(`/api/agent/task/${currentTask.taskId}/undo`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setFeedbackMsg({ text: 'تم التراجع الفوري عن تعديلات المهمة واستعادة الحالة السابقة!', type: 'success' });
      } else {
        setFeedbackMsg({ text: data.error || 'تعذر التراجع', type: 'error' });
      }
    } catch (err: unknown) {
      setFeedbackMsg({ text: err instanceof Error ? err.message : String(err), type: 'error' });
    }
  };

  const handleCleanResources = async () => {
    try {
      const res = await fetch('/api/agent/resources/cleanup', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setFeedbackMsg({ text: data.report.message, type: 'success' });
        fetchResources();
      }
    } catch (err: unknown) {
      setFeedbackMsg({ text: err instanceof Error ? err.message : String(err), type: 'error' });
    }
  };

  const handleExportZip = async () => {
    try {
      const res = await fetch('/api/agent/files/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: currentProjectId }),
      });
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `project_${currentProjectId}_export.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setFeedbackMsg({ text: 'تم تنزيل المشروع المضغوط ZIP بنجاح.', type: 'success' });
    } catch (err: unknown) {
      setFeedbackMsg({ text: err instanceof Error ? err.message : String(err), type: 'error' });
    }
  };

  const filteredLessons = lessons.filter((les) => {
    if (!searchMemoryQuery) return true;
    const q = searchMemoryQuery.toLowerCase();
    return (
      (les.error_signature || '').toLowerCase().includes(q) ||
      (les.root_cause || '').toLowerCase().includes(q) ||
      (les.proven_fix || '').toLowerCase().includes(q)
    );
  });

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 overflow-y-auto">
      <div data-testid="autonomous-agent-modal" className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl h-[88vh] flex flex-col shadow-2xl overflow-hidden text-slate-100">
        
        {/* Top Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Bot className="w-6 h-6 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white tracking-wide">
                  الوكيل البرمجي الذكي (Autonomous Coding Agent)
                </h2>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono border border-emerald-500/30 flex items-center gap-1">
                  <ShieldCheck className="w-3 h-3" />
                  محمي بالـ Safety Gate
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                تنفيذ مستقل • تعافي ذاتي جراحي • خيارات معمارية بالمزايا والعيوب • ذاكرة دائمة • إدارة مساحة ونشر مع تراجع
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleExportZip}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1.5 border border-slate-700 transition"
              title="تصدير كود المشروع بصيغة ZIP"
            >
              <FolderDown className="w-4 h-4 text-indigo-400" />
              تصدير ZIP
            </button>
            <button
              data-testid="agent-close-button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Global Feedback Banner */}
        {feedbackMsg && (
          <div
            data-testid="agent-feedback-msg"
            className={`px-6 py-2.5 text-xs font-medium flex items-center justify-between border-b ${
              feedbackMsg.type === 'success'
                ? 'bg-emerald-950/60 border-emerald-800/60 text-emerald-300'
                : 'bg-rose-950/60 border-rose-800/60 text-rose-300'
            }`}
          >
            <span className="flex items-center gap-2">
              {feedbackMsg.type === 'success' ? <Check className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              {feedbackMsg.text}
            </span>
            <button onClick={() => setFeedbackMsg(null)} className="text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1 px-6 border-b border-slate-800 bg-slate-950/50 overflow-x-auto text-xs font-medium">
          <button
            onClick={() => setActiveTab('execute')}
            className={`px-4 py-3 flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
              activeTab === 'execute'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Zap className="w-4 h-4" />
            التنفيذ المستقل (Autonomy)
          </button>

          <button
            data-testid="agent-tab-decisions"
            onClick={() => setActiveTab('decisions')}
            className={`px-4 py-3 flex items-center gap-2 border-b-2 transition whitespace-nowrap relative ${
              activeTab === 'decisions'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-4 h-4" />
            الخيارات المعمارية والموافقات
            {pendingApprovals.length > 0 && (
              <span className="w-2 h-2 rounded-full bg-rose-500 animate-ping absolute top-2 right-2" />
            )}
          </button>

          <button
            onClick={() => setActiveTab('healing')}
            className={`px-4 py-3 flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
              activeTab === 'healing'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-4 h-4" />
            التنقل الجراحي والتعافي (Self-Healing)
          </button>

          <button
            onClick={() => setActiveTab('resources')}
            className={`px-4 py-3 flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
              activeTab === 'resources'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <HardDrive className="w-4 h-4" />
            إدارة الموارد والمساحة
          </button>

          <button
            onClick={() => setActiveTab('memory')}
            className={`px-4 py-3 flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
              activeTab === 'memory'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Brain className="w-4 h-4" />
            الذاكرة الدائمة ({lessons.length})
          </button>

          <button
            onClick={() => setActiveTab('deploy')}
            className={`px-4 py-3 flex items-center gap-2 border-b-2 transition whitespace-nowrap ${
              activeTab === 'deploy'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Rocket className="w-4 h-4" />
            النشر والتراجع (Rollback)
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 p-6 overflow-y-auto">
          {/* TAB 1: EXECUTION */}
          {activeTab === 'execute' && (
            <div className="space-y-6">
              <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-800">
                <label className="block text-xs font-semibold text-slate-300 mb-2">
                  وصف المهمة البرمجية المطلوب تنفيذها بشكل مستقل:
                </label>
                <textarea
                  data-testid="agent-prompt-input"
                  rows={3}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="مثال: قم بإنشاء تطبيق إدارة مهام تفاعلي مع تصنيفات وفلترة وإحصائيات فورية وحفظ محلي بدون أي أخطاء كونسول..."
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500 transition resize-none"
                />

                {/* Quick Prompts */}
                <div className="flex flex-wrap gap-2 mt-3 text-xs">
                  <span className="text-slate-400">نماذج سريعة:</span>
                  <button
                    onClick={() => setPrompt('بناء واجهة متجر تفاعلية مع سلة شراء وحساب الإجمالي وحفظ محلي')}
                    className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                  >
                    متجر وسلة شراء
                  </button>
                  <button
                    onClick={() => setPrompt('إنشاء لوحة تحكم ومؤشرات أداء مالية مع رسوم بيانية وتصدير بيانات')}
                    className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                  >
                    لوحة تحكم تفاعلية
                  </button>
                  <button
                    onClick={() => setPrompt('فحص وتصحيح أي أخطاء ناتجة عن التعامل مع المتغيرات الفارغة في الأكواد')}
                    className="px-2.5 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                  >
                    تصحيح أخطاء تشغيل
                  </button>
                </div>

                {/* Autonomy Controls */}
                <div className="mt-4 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        name="autonomy"
                        checked={autonomyLevel === 'autonomous'}
                        onChange={() => setAutonomyLevel('autonomous')}
                        className="text-indigo-600 focus:ring-0"
                      />
                      <span>مستقل تام (Autonomous - تصحيح ونشر تلقائي)</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="radio"
                        name="autonomy"
                        checked={autonomyLevel === 'supervised'}
                        onChange={() => setAutonomyLevel('supervised')}
                        className="text-indigo-600 focus:ring-0"
                      />
                      <span>تحت الإشراف (Supervised - طلب موافقة قبل العمليات)</span>
                    </label>
                  </div>

                  <div className="flex items-center gap-3">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={autoDeploy}
                        onChange={(e) => setAutoDeploy(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-0"
                      />
                      <span>النشر التلقائي بعد اجتياز الاختبارات</span>
                    </label>

                    <button
                      data-testid="agent-execute-button"
                      onClick={handleExecuteTask}
                      disabled={isRunning || !prompt.trim()}
                      className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-500 to-purple-600 hover:from-indigo-600 hover:to-purple-700 text-white text-xs font-semibold shadow-lg shadow-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition"
                    >
                      {isRunning ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          جاري التنفيذ المستقل...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          تشغيل الوكيل الآن
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>

              {/* Execution Progress & Steps Log */}
              {currentTask && (
                <div data-testid="agent-steps-log" className="bg-slate-950 p-5 rounded-xl border border-slate-800 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal className="w-4 h-4 text-indigo-400" />
                      <h3 className="text-xs font-bold text-slate-200">
                        سجل التنفيذ المباشر (Audit Log)
                      </h3>
                    </div>
                    <div className="flex items-center gap-2">
                      <span data-testid="agent-task-status" className={`text-xs px-2.5 py-0.5 rounded-full font-mono ${
                        currentTask.status === 'completed'
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                          : currentTask.status === 'waiting_approval'
                          ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                          : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      }`}>
                        الحالة: {currentTask.status}
                      </span>
                      <button
                        data-testid="agent-undo-button"
                        onClick={handleUndo}
                        className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium flex items-center gap-1 border border-slate-700 transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                        تراجع (Undo)
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-56 overflow-y-auto font-mono text-xs text-slate-300 bg-slate-900/60 p-3 rounded-lg border border-slate-800/80">
                    {(currentTask.stepsLog || []).map((step: AgentTaskStepLog, idx: number) => (
                      <div key={idx} className="flex items-start gap-2">
                        <span className="text-slate-500 select-none">[{idx + 1}]</span>
                        <span className="text-indigo-400 font-semibold">{step.step}:</span>
                        <span className="flex-1">{step.message}</span>
                        <span className="text-[10px] text-slate-500">{step.at ? new Date(step.at).toLocaleTimeString() : ''}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: ARCHITECTURAL DECISIONS & APPROVALS */}
          {activeTab === 'decisions' && (
            <div className="space-y-6">
              {/* Pending Safety Approvals Banner */}
              {pendingApprovals.length > 0 && (
                <div data-testid="agent-pending-approvals" className="bg-rose-950/40 border border-rose-800/80 p-5 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                    <AlertTriangle className="w-5 h-5" />
                    طلبات موافقة أمنية معلقة (Safety Gate Approvals)
                  </div>
                  <p className="text-xs text-slate-300">
                    الوكيل توقف استباقياً عن تنفيذ العمليات التالية حفاظاً على سلامة المشروع وبياناتك:
                  </p>
                  <div className="space-y-3">
                    {pendingApprovals.map((appr) => (
                      <div key={appr.id} className="bg-slate-900/90 p-4 rounded-lg border border-slate-800 flex items-center justify-between gap-4">
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-2">
                            <span>{appr.title}</span>
                            <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[10px] font-mono">
                              {appr.action_type}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{appr.description}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            data-testid="agent-approval-approve"
                            onClick={() => handleResolveApproval(appr.id, 'approved')}
                            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 transition"
                          >
                            <Check className="w-3.5 h-3.5" />
                            موافقة
                          </button>
                          <button
                            data-testid="agent-approval-reject"
                            onClick={() => handleResolveApproval(appr.id, 'rejected')}
                            className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center gap-1 transition"
                          >
                            <Ban className="w-3.5 h-3.5" />
                            رفض العملية
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Architectural Decision Cards */}
              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-indigo-400" />
                  <h3 className="text-xs font-bold text-slate-200">
                    الخيارات المعمارية المتاحة (مع المزايا والعيوب والتأثير):
                  </h3>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Option 1 */}
                  <div className="bg-slate-800/40 p-5 rounded-xl border border-indigo-500/40 space-y-3 relative overflow-hidden">
                    <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30">
                      موصى به (Recommended)
                    </span>
                    <h4 className="text-sm font-bold text-white pt-2">
                      الهيكل المعياري التفاعلي (Modular Component Architecture)
                    </h4>
                    <p className="text-xs text-slate-300">
                      فصل الشاشات إلى مكونات مستقلة، إدارة حالة مركزية نظيفة، وعزل تام للأخطاء.
                    </p>

                    <div className="space-y-1.5 text-xs">
                      <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" />
                        المزايا (Pros):
                      </div>
                      <ul className="text-slate-300 list-disc list-inside space-y-0.5 text-[11px]">
                        <li>أعلى قابلية للصيانة والتوسع دون كسر القديم.</li>
                        <li>عزل المشاكل بحيث لا يعطل خطأ فرعي الصفحة بأكملها.</li>
                      </ul>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="font-semibold text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        العيوب والتأثير (Cons & Impact):
                      </div>
                      <p className="text-[11px] text-slate-400">
                        عدد ملفات أكثر قليلاً لكنه يوفر أداءً مثالياً وجاهزية تامة للنشر.
                      </p>
                    </div>

                    <button
                      onClick={() => handleChooseDecision('arch_1', 'opt_modular_components')}
                      className="w-full mt-2 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                    >
                      اعتماد هذا الخيار
                    </button>
                  </div>

                  {/* Option 2 */}
                  <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-800 space-y-3 relative overflow-hidden">
                    <h4 className="text-sm font-bold text-white pt-2">
                      الهيكل المدمج فائق الخفة (Zero-Build Lightweight)
                    </h4>
                    <p className="text-xs text-slate-300">
                      تطبيق متكامل وسريع، تجميع مرن للأكواد مع استهلاك ذاكرة منخفض للغاية.
                    </p>

                    <div className="space-y-1.5 text-xs">
                      <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" />
                        المزايا (Pros):
                      </div>
                      <ul className="text-slate-300 list-disc list-inside space-y-0.5 text-[11px]">
                        <li>إقلاع فوري وتشغيل مباشر في أي متصفح.</li>
                        <li>حجم بالغ الصغر ومناسب للموارد المحدودة.</li>
                      </ul>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="font-semibold text-amber-400 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        العيوب والتأثير (Cons & Impact):
                      </div>
                      <p className="text-[11px] text-slate-400">
                        أقل مرونة عند التوسع لمشاريع عملاقة بمئات الشاشات.
                      </p>
                    </div>

                    <button
                      onClick={() => handleChooseDecision('arch_1', 'opt_zero_build_rapid')}
                      className="w-full mt-2 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
                    >
                      اعتماد هذا الخيار
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: SURGICAL HEALING & CODE DIFF */}
          {activeTab === 'healing' && (
            <div className="space-y-6">
              <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-emerald-400" />
                    <h3 className="text-xs font-bold text-slate-200">
                      محرك التعافي الذاتي والتنقل الجراحي (Surgical Self-Healing)
                    </h3>
                  </div>
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-mono border border-emerald-500/30">
                    أقصى محاولات: 5 دورات
                  </span>
                </div>

                {currentTask?.selfHealing ? (
                  <div className="space-y-4">
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-indigo-400">نتيجة دورات التعافي:</span>
                        <span className="font-mono text-emerald-400">
                          {currentTask.selfHealing.resolved ? 'تم التعافي بنجاح ✅' : 'تعذر التعافي ❌'}
                        </span>
                      </div>
                      <p className="text-xs text-slate-300">
                        {currentTask.selfHealing.message || currentTask.selfHealing.exhaustedExplanation?.summary}
                      </p>
                    </div>

                    {/* Surgical History Steps */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-slate-400">سجل الخطوات الجراحية المطبقة:</h4>
                      {(currentTask.selfHealing.history || []).map((h: SelfHealingHistoryItem, idx: number) => (
                        <div key={idx} className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2 text-xs">
                          <div className="flex items-center justify-between font-mono">
                            <span className="text-amber-400 font-bold">
                              محاولة #{h.attempt} • {h.targetFile} (السطر: {h.line})
                            </span>
                            <span className={`px-2 py-0.5 rounded text-[10px] ${h.testStatus === 'passed' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                              {h.testStatus}
                            </span>
                          </div>
                          <div className="text-slate-300 font-medium">
                            <span className="text-slate-500">السبب الجذري:</span> {h.rootCause}
                          </div>
                          <div className="text-emerald-300 font-mono text-[11px] bg-emerald-950/30 p-2 rounded border border-emerald-900/40">
                            <span className="text-slate-500">التصحيح:</span> {h.fixDescription}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    لم تسجل أخطاء في دورة التشغيل الأخيرة — جميع الفحوصات سليمة ولم تتطلب تعافياً جراحياً.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 4: RESOURCES & STORAGE */}
          {activeTab === 'resources' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* RAM Card */}
                <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                      <Cpu className="w-4 h-4 text-indigo-400" />
                      الذاكرة العشوائية (RAM)
                    </div>
                    <span className="text-xs font-mono text-slate-400">
                      {resourceMetrics?.memory?.usagePercent || 0}% مستهلك
                    </span>
                  </div>

                  <div className="w-full h-2.5 rounded-full bg-slate-950 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                      style={{ width: `${resourceMetrics?.memory?.usagePercent || 0}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 pt-1">
                    <div>الإجمالي: {resourceMetrics?.memory?.totalMb || 0} MB</div>
                    <div>المتوفر: {resourceMetrics?.memory?.freeMb || 0} MB</div>
                    <div>استهلاك العملية: {resourceMetrics?.memory?.processRssMb || 0} MB</div>
                    <div>استهلاك الـ Heap: {resourceMetrics?.memory?.processHeapUsedMb || 0} MB</div>
                  </div>
                </div>

                {/* Disk Space Card */}
                <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                      <HardDrive className="w-4 h-4 text-emerald-400" />
                      مساحة التخزين (Disk Storage)
                    </div>
                    <span className="text-xs font-mono text-slate-400">
                      {resourceMetrics?.disk?.freeMb || 0} MB متوفرة
                    </span>
                  </div>

                  <div className="w-full h-2.5 rounded-full bg-slate-950 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-500"
                      style={{ width: `${resourceMetrics?.disk?.usagePercent || 50}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-400 pt-1">
                    <span>مستوى الضغط: <strong className="text-slate-200 font-mono">{resourceMetrics?.pressureLevel || 'normal'}</strong></span>
                    <button
                      onClick={handleCleanResources}
                      className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium border border-slate-700 transition"
                    >
                      تنظيف الكاش الآن
                    </button>
                  </div>
                </div>
              </div>

              {/* Safety Protection Notice */}
              <div className="bg-indigo-950/30 border border-indigo-900/60 p-4 rounded-xl flex items-start gap-3">
                <ShieldCheck className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                <div className="text-xs text-slate-300 space-y-1">
                  <strong className="text-white block">حماية البيانات الصارمة أثناء التنظيف:</strong>
                  <p>
                    نظام إدارة الموارد لا يقوم نهائياً بحذف أي ملفات كود مصدري أو قواعد بيانات أو تكوينات بيئية. التنظيف يقتصر حصرياً على مخلفات البناء المؤقتة (Build Artifacts) وملفات الـ Cache واللوغات القديمة.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 5: PERSISTENT MEMORY & LESSONS */}
          {activeTab === 'memory' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute top-2.5 right-3 text-slate-500" />
                  <input
                    type="text"
                    value={searchMemoryQuery}
                    onChange={(e) => setSearchMemoryQuery(e.target.value)}
                    placeholder="ابحث في ذاكرة الأخطاء والحلول المجرّبة..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl pr-9 pl-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button
                  onClick={fetchLessons}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
                >
                  تحديث الذاكرة
                </button>
              </div>

              <div className="space-y-3">
                {filteredLessons.length > 0 ? (
                  filteredLessons.map((les) => (
                    <div key={les.id} className="p-4 rounded-xl bg-slate-800/40 border border-slate-800 space-y-2 text-xs">
                      <div className="flex items-center justify-between font-mono">
                        <span className="text-indigo-400 font-bold flex items-center gap-1.5">
                          <Brain className="w-3.5 h-3.5" />
                          {les.error_signature}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 rounded text-[10px] ${
                            les.scope === 'project' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
                          }`}>
                            {les.scope === 'project' ? 'خاص بالمشروع' : 'معرفة عامة'}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px]">
                            استخدمت: {les.usage_count}x
                          </span>
                        </div>
                      </div>

                      <div className="text-slate-300">
                        <span className="text-slate-500 font-semibold">السبب الجذري:</span> {les.root_cause}
                      </div>

                      <div className="text-emerald-300 bg-emerald-950/20 p-2 rounded border border-emerald-900/30">
                        <span className="text-slate-400 font-semibold">الحل المجرّب:</span> {les.proven_fix}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-slate-500 text-xs">
                    لا توجد دروس مطابقة في الذاكرة الدائمة حالياً.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 6: DEPLOYMENT & ROLLBACK */}
          {activeTab === 'deploy' && (
            <div className="space-y-6">
              <div className="bg-slate-800/40 p-5 rounded-xl border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Rocket className="w-4 h-4 text-indigo-400" />
                    <h3 className="text-xs font-bold text-slate-200">
                      نشر المشروع مع فحص الصحة والتراجع التلقائي (Health Probe & Auto-Rollback)
                    </h3>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className={`p-4 rounded-xl border cursor-pointer transition ${
                    deployTarget === 'local_preview' ? 'bg-indigo-950/40 border-indigo-500' : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}>
                    <input
                      type="radio"
                      name="deployTarget"
                      className="hidden"
                      checked={deployTarget === 'local_preview'}
                      onChange={() => setDeployTarget('local_preview')}
                    />
                    <div className="text-xs font-bold text-white">معاينة محلية معزولة</div>
                    <div className="text-[11px] text-slate-400 mt-1">تشغيل محلي فوري وآمن بدون أي تكلفة.</div>
                  </label>

                  <label className={`p-4 rounded-xl border cursor-pointer transition ${
                    deployTarget === 'staging_docker' ? 'bg-indigo-950/40 border-indigo-500' : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}>
                    <input
                      type="radio"
                      name="deployTarget"
                      className="hidden"
                      checked={deployTarget === 'staging_docker'}
                      onChange={() => setDeployTarget('staging_docker')}
                    />
                    <div className="text-xs font-bold text-white">بيئة Staging تجريبية</div>
                    <div className="text-[11px] text-slate-400 mt-1">حاوية معزولة مطابقة لبيئة الإنتاج.</div>
                  </label>

                  <label className={`p-4 rounded-xl border cursor-pointer transition ${
                    deployTarget === 'cloud_production' ? 'bg-indigo-950/40 border-indigo-500' : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                  }`}>
                    <input
                      type="radio"
                      name="deployTarget"
                      className="hidden"
                      checked={deployTarget === 'cloud_production'}
                      onChange={() => setDeployTarget('cloud_production')}
                    />
                    <div className="text-xs font-bold text-white">بيئة الإنتاج الحية</div>
                    <div className="text-[11px] text-slate-400 mt-1">تتطلب موافقة صريحة عبر Safety Gate.</div>
                  </label>
                </div>

                <div className="flex items-center justify-end gap-3 pt-2">
                  <button
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/agent/deploy', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            projectId: currentProjectId,
                            targetPlatform: deployTarget,
                          }),
                        });
                        const data = await res.json();
                        if (data.success) {
                          setFeedbackMsg({ text: 'تم النشر بنجاح واجتياز الفحص الصحي!', type: 'success' });
                        } else {
                          setFeedbackMsg({ text: data.message || 'فشل النشر وتم التراجع التلقائي', type: 'error' });
                        }
                      } catch (err: unknown) {
                        setFeedbackMsg({ text: err instanceof Error ? err.message : String(err), type: 'error' });
                      }
                    }}
                    className="px-5 py-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-xs font-semibold shadow-lg shadow-emerald-500/20 flex items-center gap-2 transition"
                  >
                    <Rocket className="w-4 h-4" />
                    بدء النشر والفحص الصحي
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-800 bg-slate-950 flex items-center justify-between text-xs text-slate-400">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span>محرك الوكيل البرمجي جاهز للعمل المستقل</span>
          </div>
          <div className="font-mono text-[11px] text-slate-500">
            Project: {currentProjectId}
          </div>
        </div>

      </div>
    </div>
  );
};
