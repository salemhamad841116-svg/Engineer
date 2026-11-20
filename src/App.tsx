import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Home,
  LayoutGrid,
  BookOpen,
  Settings as SettingsIcon,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  Code2,
  Rocket,
  ShieldCheck,
  Globe2,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Bot,
  Server,
  Sparkles,
  Image as ImageIcon,
  Layers,
} from 'lucide-react';
import {
  AIAgentProfile,
  ButtonRegistryEntry,
  ChatAttachmentMeta,
  ChatMessage,
  ExecutionPipelineStage,
  Language,
  Project,
  ProjectCategory,
} from './types/platform';
import {
  createSeedProjects,
  createDefaultAIAgents,
  createNewProjectFromSpec,
} from './utils/platformEngine';
import { getInitialButtonRegistry, runAutomatedRegistryVerification } from './utils/buttonRegistry';
import { PromptMode } from './utils/intentRouter';
import { HomeLaunchpad } from './components/HomeLaunchpad';
import { IdeWorkspace } from './components/IdeWorkspace';
import { ModalsHub, type SettingsState } from './components/ModalsHub';
import { PublishedAppsView, ButtonRegistryView } from './components/PublishedAndRegistryViews';
import { ServersView } from './components/ServersView';
import DeepResearchModal from './components/DeepResearchModal';
import { AutonomousAgentModal } from './components/AutonomousAgentModal';
import { AuthModal } from './components/AuthModal';
import { UserProfileAndSettingsModal } from './components/UserProfileAndSettingsModal';
import { LegalModal } from './components/LegalModal';
import { OnboardingTour } from './components/OnboardingTour';
import { AdminPortalView } from './components/AdminPortalView';

import { DynamicAgentWorkspace } from './components/dynamic-agent/DynamicAgentWorkspace';
import MediaStudio from './components/media/MediaStudio';
import Flashcards from './components/cards/Flashcards';

/** Client-side hard ceiling for one chat request (server model timeout is shorter). */
const CHAT_REQUEST_TIMEOUT_MS = 120_000;
const MODEL_SELECTION_STORAGE_KEY = 'engineer:selected-model';

export interface ExecutePromptResult {
  status: 'COMPLETED' | 'FAILED' | 'CANCELLED';
  intent?: string;
  errorCode?: string;
  newProjectId?: string;
}

/**
 * Merge messages by stable id only. Two different replies with identical text are both kept
 * (the old role+content key silently dropped legitimate repeated answers).
 */
function dedupeMessages<T extends { id: string }>(list: T[]): T[] {
  const index = new Map<string, number>();
  const out: T[] = [];
  for (const m of list) {
    const at = index.get(m.id);
    if (at === undefined) {
      index.set(m.id, out.length);
      out.push(m);
    } else {
      out[at] = m;
    }
  }
  return out;
}

export default function App() {
  // Primary State
  const [projects, setProjects] = useState<Project[]>(() => createSeedProjects());
  const [activeProjectId, setActiveProjectId] = useState<string>('proj-fintrack-erp');
  const [agents, setAgents] = useState<AIAgentProfile[]>(() => createDefaultAIAgents());
  const [buttonRegistry, setButtonRegistry] = useState<ButtonRegistryEntry[]>(() => getInitialButtonRegistry());
  const [settings, setSettings] = useState<SettingsState>({
    userName: 'Salemalderei84',
    userEmail: 'salemhamad841116@gmail.com',
    planName: 'Cloud Studio Pro — Enterprise Tier',
    aiTokensUsed: 148200,
    aiTokensLimit: 2000000,
    defaultModel: '',
    thinkingMode: 'standard' as 'standard' | 'deep' | 'plan',
    language: 'en' as Language,
    theme: 'dark' as 'dark' | 'light',
    notificationsEnabled: true,
    privacyTelemetryOptOut: true,
    teamMembers: [
      { id: 'tm-1', name: 'Salem Al-Derei', email: 'salemhamad841116@gmail.com', role: 'Owner' as const, status: 'Active' },
      { id: 'tm-2', name: 'Noura Al-Mansoori', email: 'noura.eng@cloudstudio.dev', role: 'Admin' as const, status: 'Active' },
      { id: 'tm-3', name: 'Tariq Al-Harbi', email: 'tariq.qa@cloudstudio.dev', role: 'Editor' as const, status: 'Active' },
    ],
    invoices: [
      { id: 'INV-2026-1101', date: '2026-11-01', amount: '$49.00', status: 'Paid' as const, plan: 'Pro Cloud Workspace' },
      { id: 'INV-2026-1001', date: '2026-10-01', amount: '$49.00', status: 'Paid' as const, plan: 'Pro Cloud Workspace' },
    ],
    activityLog: [
      { id: 'act-1', time: new Date().toISOString(), actor: 'Salemalderei84', action: 'Initialized Cloud IDE & 10 AI Agents', target: 'System' },
    ],
  });

  // Navigation & UI State
  const [activeView, setActiveView] = useState<'home' | 'ide' | 'published' | 'registry' | 'servers' | 'dynamic-agent' | 'media' | 'cards'>('home');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [modalPayload, setModalPayload] = useState<unknown>(null);
  const [infoDrawer, setInfoDrawer] = useState<'help' | 'releases' | 'status' | 'referral' | null>(null);
  const [currentUser, setCurrentUser] = useState<{ id: string; name: string; email: string } | null>(null);
  const [userProfileModalOpen, setUserProfileModalOpen] = useState(false);
  const [userProfileInitialTab, setUserProfileInitialTab] = useState<'profile' | 'activity' | 'security' | 'settings' | 'danger'>('profile');

  // AI Execution Pipeline State
  const [isGenerating, setIsGenerating] = useState(false);
  const [pipelineStages, setPipelineStages] = useState<ExecutionPipelineStage[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  // Phase 12 Launch Pack: Onboarding Tour & Legal Modals State
  const [showOnboardingTour, setShowOnboardingTour] = useState(false);
  const [activeLegalModal, setActiveLegalModal] = useState<'terms' | 'privacy' | null>(() => {
    if (typeof window !== 'undefined') {
      const p = window.location.pathname.toLowerCase();
      if (p === '/terms' || window.location.hash === '#/terms') return 'terms';
      if (p === '/privacy' || window.location.hash === '#/privacy') return 'privacy';
    }
    return null;
  });

  // Toast Notification
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [availableAiModels, setAvailableAiModels] = useState<Array<{ id: string; name: string; provider: string; available: boolean; local?: boolean; providerLabel?: string; configured?: boolean; statusLabel?: string; statusLabelAr?: string }>>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/ai/models')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data?.defaultModelId) return;
        if (Array.isArray(data.models)) {
          setAvailableAiModels(data.models.filter((m: { local?: boolean; provider?: string }) => !m.local && ['openai', 'gemini', 'claude', 'anthropic'].includes(String(m.provider || '').toLowerCase())));
        }
        const persistedModel = typeof window !== 'undefined' ? window.localStorage.getItem(MODEL_SELECTION_STORAGE_KEY) : null;
        setSettings((prev) => ({
          ...prev,
          defaultModel: persistedModel || prev.defaultModel || data.defaultModelId,
        }));
      })
      .catch(() => { });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSelectedModelChange = useCallback((modelId: string) => {
    if (!modelId) return;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(MODEL_SELECTION_STORAGE_KEY, modelId);
    }
    setSettings((prev) => ({ ...prev, defaultModel: modelId }));
  }, []);

  const notify = useCallback((type: 'success' | 'error' | 'info', message: string) => {
    setToast({ type, message });
    setTimeout(() => {
      setToast((prev) => (prev?.message === message ? null : prev));
    }, 4000);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // offline / ignored
    }
    setCurrentUser(null);
    setUserProfileModalOpen(false);
    notify('info', settings.language === 'ar' ? 'تم تسجيل الخروج بنجاح' : 'Logged out successfully');
  }, [notify, settings.language]);

  // Check current session on mount
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.user) {
          setCurrentUser(data.user);
        }
      })
      .catch(() => { });
  }, []);

  // Load persisted state from server on mount
  useEffect(() => {
    fetch('/api/state')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.projects?.length) {
          setProjects(data.projects);
          setActiveProjectId(data.projects[0].id);
        }
        if (data?.agents?.length) setAgents(data.agents);
        if (data?.buttonRegistry?.length) setButtonRegistry(data.buttonRegistry);
        if (data?.settings) {
          setSettings((prev) => ({ ...prev, ...data.settings }));
        }
      })
      .catch(() => {
        // Offline / seed state already initialized
      });
  }, []);

  // Sync HTML dir and theme
  const language = settings.language;
  const isAr = language === 'ar';
  useEffect(() => {
    document.documentElement.dir = isAr ? 'rtl' : 'ltr';
    document.documentElement.lang = language;
    if (settings.theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isAr, language, settings.theme]);

  // Global ⌘K shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setActiveModal('command-palette');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const activeProject = projects.find((p) => p.id === activeProjectId) || projects[0];

  const handleOpenModal = (modal: string, payload?: unknown) => {
    if (modal === 'user-profile' || modal === 'profile' || modal === 'user-settings') {
      const initial =
        payload && typeof payload === 'object' && 'tab' in payload && typeof (payload as { tab: unknown }).tab === 'string'
          ? ((payload as { tab: string }).tab as 'profile' | 'activity' | 'security' | 'settings' | 'danger')
          : (modal === 'user-settings' ? 'settings' : 'profile');
      setUserProfileInitialTab(initial);
      setUserProfileModalOpen(true);
      return;
    }
    setModalPayload(payload || null);
    setActiveModal(modal);
  };

  const handleSelectProject = (proj: Project, openIde = true) => {
    setActiveProjectId(proj.id);
    if (openIde) {
      setActiveView('ide');
    }
    notify('info', isAr ? `تم فتح المشروع: ${proj.name}` : `Switched to project: ${proj.name}`);
  };

  const handleCreateProject = async (specOrProject: Partial<Project> | Record<string, unknown>) => {
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(specOrProject),
      });
      if (res.ok) {
        const { project: created } = await res.json();
        setProjects((prev) => [created, ...prev]);
        setActiveProjectId(created.id);
        setActiveView('ide');
        notify('success', isAr ? `تم إنشاء المشروع "${created.name}" وحفظه في حسابك` : `Created & saved project "${created.name}"`);
        return;
      }
    } catch {
      // fallback below
    }
    const localProj: Project =
      'files' in specOrProject && Array.isArray((specOrProject as Project).files)
        ? (specOrProject as Project)
        : createNewProjectFromSpec(specOrProject as Parameters<typeof createNewProjectFromSpec>[0]);
    setProjects((prev) => [localProj, ...prev]);
    setActiveProjectId(localProj.id);
    setActiveView('ide');
    notify('success', isAr ? `تم إنشاء المشروع "${localProj.name}" بنجاح` : `Created project "${localProj.name}"`);
  };

  const handleUpdateProject = async (updated: Project, toastMsg?: string) => {
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    if (toastMsg) notify('success', toastMsg);
    try {
      await fetch(`/api/projects/${updated.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      });
    } catch {
      // local state updated
    }
  };

  const handleDuplicateProject = async (projectId: string) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/duplicate`, { method: 'POST' });
      if (res.ok) {
        const { project: copy } = await res.json();
        setProjects((prev) => [copy, ...prev]);
        notify('success', isAr ? `تم نسخ المشروع: ${copy.name}` : `Duplicated project: ${copy.name}`);
        return;
      }
    } catch {
      // fallback
    }
    const src = projects.find((p) => p.id === projectId);
    if (!src) return;
    const copy: Project = JSON.parse(JSON.stringify(src));
    copy.id = `proj-${Date.now()}`;
    copy.name = `${src.name} (Copy)`;
    setProjects((prev) => [copy, ...prev]);
    notify('success', isAr ? `تم نسخ المشروع: ${copy.name}` : `Duplicated project: ${copy.name}`);
  };

  const handleDeleteProject = async (projectId: string) => {
    if (projects.length <= 1) {
      notify('error', isAr ? 'يجب الإبقاء على مشروع واحد على الأقل' : 'At least one project must remain');
      return;
    }
    const remaining = projects.filter((p) => p.id !== projectId);
    setProjects(remaining);
    if (activeProjectId === projectId) {
      setActiveProjectId(remaining[0].id);
    }
    notify('success', isAr ? 'تم حذف المشروع نهائياً' : 'Project deleted');
    try {
      await fetch(`/api/projects/${projectId}`, { method: 'DELETE' });
    } catch {
      // ignore
    }
  };

  const handleUpdateSettings = async (partial: Partial<SettingsState> | Record<string, unknown>) => {
    const merged = { ...settings, ...partial } as SettingsState;
    setSettings(merged);
    notify('success', isAr ? 'تم حفظ الإعدادات' : 'Settings updated');
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      });
    } catch {
      // ignore
    }
  };

  // Workspace Chat Engine — reliable message lifecycle:
  // SENDING → PROCESSING → STREAMING → COMPLETED | FAILED | CANCELLED.
  // Messages are merged by id (never by content), errors are always visible with a
  // retry action, and Stop really aborts the HTTP request (and the server-side model call).
  const handleExecutePrompt = async (
    prompt: string,
    options: {
      model: string;
      thinkingMode: 'standard' | 'deep' | 'plan';
      agentId?: string;
      category?: ProjectCategory;
      attachments?: ChatAttachmentMeta[];
      attachmentIds?: string[];
      mode?: PromptMode;
      retryOfClientId?: string;
    }
  ): Promise<ExecutePromptResult> => {
    const text = String(prompt || '').trim();
    if (!text) return { status: 'FAILED', errorCode: 'EMPTY_PROMPT' };
    if (inFlightRef.current) {
      notify('info', isAr ? 'ما زال الطلب السابق قيد التنفيذ. انتظر اكتماله أو اضغط إيقاف.' : 'The previous request is still running. Wait or press Stop.');
      return { status: 'FAILED', errorCode: 'BUSY' };
    }
    inFlightRef.current = true;
    setIsGenerating(true);
    setActiveView('ide');
    setSidebarOpen(false);

    const project = activeProject;
    const projectId = project.id;
    const threadId = project.activeChatId || project.chatThreads[0]?.id || 'default-chat';
    const clientId = options.retryOfClientId || `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const localUserId = `local-u-${clientId}`;
    const localAssistantId = `local-a-${clientId}`;
    const now = new Date().toISOString();

    const patchThread = (fn: (messages: ChatMessage[]) => ChatMessage[]) => {
      setProjects((prev) =>
        prev.map((p) => {
          if (p.id !== projectId) return p;
          const hasThread = p.chatThreads.some((th) => th.id === threadId);
          const threads = hasThread
            ? p.chatThreads.map((th) => (th.id === threadId ? { ...th, messages: fn(th.messages), updatedAt: new Date().toISOString() } : th))
            : [{ id: threadId, title: isAr ? 'محادثة' : 'Chat', updatedAt: now, messages: fn([]) }, ...p.chatThreads];
          return { ...p, chatThreads: threads };
        })
      );
    };
    const patchMessage = (id: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>)) =>
      patchThread((msgs) => msgs.map((m) => (m.id === id ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m)));

    // Optimistic user message (or re-activation of the original one on retry) + assistant placeholder.
    patchThread((msgs) => {
      let list = msgs;
      if (options.retryOfClientId) {
        const original = list.find((m) => m.role === 'user' && m.clientId === options.retryOfClientId);
        list = list.filter(
          (m) => !(m.role === 'assistant' && (m.status === 'FAILED' || m.status === 'CANCELLED') && (m.clientId === options.retryOfClientId || (original && m.replyTo === original.id)))
        );
        if (original) {
          list = list.map((m) => (m.id === original.id ? { ...m, status: 'SENDING' as const } : m));
        }
      }
      const hasUser = list.some((m) => m.role === 'user' && m.clientId === clientId);
      const userMessage: ChatMessage = {
        id: localUserId,
        clientId,
        role: 'user',
        content: text,
        timestamp: now,
        model: options.model,
        thinkingMode: options.thinkingMode,
        agentId: options.agentId || 'agent-chief',
        attachments: options.attachments,
        status: 'SENDING',
      };
      const placeholder: ChatMessage = {
        id: localAssistantId,
        clientId,
        role: 'assistant',
        content: '',
        timestamp: now,
        model: options.model,
        status: 'PROCESSING',
      };
      return dedupeMessages([...list, ...(hasUser ? [] : [userMessage]), placeholder]);
    });

    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CHAT_REQUEST_TIMEOUT_MS);

    const markUserDelivered = () =>
      patchThread((msgs) => msgs.map((m) => (m.role === 'user' && m.clientId === clientId ? { ...m, status: 'COMPLETED' as const } : m)));

    type StreamEvent = {
      type: 'stage' | 'delta' | 'done' | 'error';
      stage?: string;
      text?: string;
      status?: string;
      requestId?: string;
      errorCode?: string;
      userMessage?: string;
      reply?: string;
      intent?: string;
      project?: Project;
      sourceProject?: Project;
      newProjectId?: string;
      agent?: AIAgentProfile;
      modelUsed?: { id: string; provider: string };
    };

    let final: StreamEvent | null = null;
    let networkFailure = false;
    try {
      const res = await fetch('/api/ai/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({
          projectId,
          project,
          prompt: text,
          model: options.model,
          thinkingMode: options.thinkingMode,
          agentId: options.agentId || 'agent-chief',
          clientMessageId: clientId,
          attachmentIds: options.attachmentIds,
        }),
        signal: controller.signal,
      });
      markUserDelivered();
      const ctype = res.headers.get('content-type') || '';
      if (ctype.includes('application/x-ndjson') && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let streamed = '';
        for (; ;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, nl).trim();
            buffer = buffer.slice(nl + 1);
            if (!line) continue;
            let ev: StreamEvent;
            try {
              ev = JSON.parse(line) as StreamEvent;
            } catch {
              continue;
            }
            if (ev.type === 'stage') {
              patchMessage(localAssistantId, { requestId: ev.requestId });
            } else if (ev.type === 'delta' && ev.text) {
              streamed += ev.text;
              const snapshot = streamed;
              patchMessage(localAssistantId, { content: snapshot, status: 'STREAMING' });
            } else if (ev.type === 'done' || ev.type === 'error') {
              final = ev;
            }
          }
        }
      } else {
        const data = (await res.json().catch(() => null)) as StreamEvent | null;
        if (data) final = { ...data, type: res.ok && data.status !== 'FAILED' ? 'done' : 'error' };
        else final = { type: 'error', errorCode: `HTTP_${res.status}`, userMessage: isAr ? `استجاب الخادم بخطأ (${res.status}).` : `Server error (${res.status}).` };
      }
      if (!final) {
        final = { type: 'error', errorCode: 'STREAM_INTERRUPTED', userMessage: isAr ? 'انقطع الاتصال قبل اكتمال الرد.' : 'The connection dropped before the reply completed.' };
      }
    } catch (err: unknown) {
      const aborted = controller.signal.aborted;
      if (aborted && !timedOut) {
        final = { type: 'error', status: 'CANCELLED', errorCode: 'CANCELLED', userMessage: isAr ? 'تم إيقاف التوليد بناءً على طلبك.' : 'Generation stopped.' };
      } else if (timedOut) {
        final = { type: 'error', errorCode: 'CLIENT_TIMEOUT', userMessage: isAr ? 'استغرق الرد وقتاً أطول من المسموح فتم إيقافه. أعد المحاولة.' : 'The reply took too long and was stopped. Please retry.' };
      } else {
        networkFailure = true;
        final = {
          type: 'error',
          errorCode: 'NETWORK_ERROR',
          userMessage: isAr ? 'تعذر الاتصال بالخادم. تحقق من الاتصال ثم أعد المحاولة.' : 'Could not reach the server. Check your connection and retry.',
        };
        console.warn('[Chat] network failure', err);
      }
    } finally {
      window.clearTimeout(timeoutId);
      abortRef.current = null;
    }

    const result: ExecutePromptResult = { status: 'FAILED' };
    const ev = final as StreamEvent;
    if (ev.type === 'done' && ev.project) {
      const serverProject = ev.project;
      const sourceProject = ev.sourceProject;
      setProjects((prev) => {
        const merged = prev.map((p) => {
          if (sourceProject && p.id === sourceProject.id) return sourceProject;
          if (p.id === serverProject.id) {
            return {
              ...serverProject,
              chatThreads: serverProject.chatThreads.map((th) => ({ ...th, messages: dedupeMessages(th.messages) })),
            };
          }
          return p;
        });
        return merged.some((p) => p.id === serverProject.id) ? merged : [serverProject, ...merged];
      });
      if (ev.newProjectId) setActiveProjectId(ev.newProjectId);
      if (ev.agent) {
        const agent = ev.agent;
        setAgents((prev) => prev.map((a) => (a.id === agent.id ? agent : a)));
      }
      const detectedIntent: 'chat' | 'build' = ev.intent === 'build' ? 'build' : 'chat';
      if (detectedIntent === 'build') {
        notify('success', isAr ? 'اكتمل تنفيذ التعديلات وتحديث المعاينة' : 'Completed code updates & refreshed preview');
      }
      result.status = 'COMPLETED';
      result.intent = detectedIntent;
      result.newProjectId = ev.newProjectId;
    } else {
      const cancelled = ev.status === 'CANCELLED' || ev.errorCode === 'CANCELLED';
      patchThread((msgs) =>
        msgs.map((m) => {
          if (m.id === localAssistantId) {
            return {
              ...m,
              content: ev.userMessage || (isAr ? 'تعذر إكمال الطلب. أعد المحاولة.' : 'The request could not be completed. Please retry.'),
              status: cancelled ? ('CANCELLED' as const) : ('FAILED' as const),
              errorCode: ev.errorCode,
              requestId: ev.requestId || m.requestId,
            };
          }
          if (networkFailure && m.role === 'user' && m.clientId === clientId) return { ...m, status: 'FAILED' as const };
          return m;
        })
      );
      result.status = cancelled ? 'CANCELLED' : 'FAILED';
      result.errorCode = ev.errorCode;
    }

    inFlightRef.current = false;
    setIsGenerating(false);
    return result;
  };

  const handleStopGeneration = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
    setPipelineStages((prev) =>
      prev.map((st) => (st.status === 'running' ? { ...st, status: 'done' } : st))
    );
  };

  const handleVerifyAllRegistry = async () => {
    try {
      const res = await fetch('/api/registry/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: activeProject.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setButtonRegistry(data.updatedEntries);
        notify('success', isAr ? `تم التحقق من جميع الأزرار (${data.passedCount}/${data.totalCount}) بنجاح` : data.summaryReport);
        return;
      }
    } catch {
      // fallback
    }
    const localVerify = runAutomatedRegistryVerification(buttonRegistry, activeProject);
    setButtonRegistry(localVerify.updatedEntries);
    notify('success', localVerify.summaryReport);
  };

  const handleTriggerRegistryWorkflow = (entry: ButtonRegistryEntry) => {
    switch (entry.id) {
      case 'btn-nav-home':
        setActiveView('home');
        break;
      case 'btn-nav-ide':
        setActiveView('ide');
        break;
      case 'btn-cmd-search':
        handleOpenModal('command-palette');
        break;
      case 'btn-project-new':
        handleOpenModal('new-project');
        break;
      case 'btn-project-open':
        handleOpenModal('open-project');
        break;
      case 'btn-project-import':
        handleOpenModal('import-project');
        break;
      case 'btn-tests-center':
        handleOpenModal('tests');
        break;
      case 'btn-error-fixer':
        handleOpenModal('diagnostics');
        break;
      case 'btn-database-manager':
        handleOpenModal('database');
        break;
      case 'btn-cloud-deploy':
        handleOpenModal('deploy');
        break;
      case 'btn-git-version-control':
        handleOpenModal('git');
        break;
      case 'btn-settings-accounts':
        handleOpenModal('settings');
        break;
      case 'btn-published-apps-center':
        setActiveView('published');
        break;
      case 'btn-ai-agents-team':
        handleOpenModal('agents');
        break;
      default:
        setActiveView('ide');
        break;
    }
    notify('success', isAr ? `تم تشغيل الإجراء: ${entry.nameAr}` : `Executed workflow: ${entry.nameEn}`);
  };

  // Host-based Domain Isolation: On engineer-mgt.misruq.com or admin.* render dedicated Super Admin Portal
  const isAdminHost = typeof window !== 'undefined' && (
    window.location.hostname === 'engineer-mgt.misruq.com' ||
    window.location.hostname.startsWith('engineer-mgt.') ||
    window.location.hostname.startsWith('admin.') ||
    window.location.search.includes('view=admin')
  );

  if (isAdminHost) {
    return <AdminPortalView language={language} />;
  }

  return (
    <div className="min-h-screen flex bg-[#090D18] text-zinc-100 overflow-hidden">
      {/* Collapsible Left Sidebar with Premium Glass Styling */}
      <aside
        aria-label="Workspace Sidebar Navigation"
        className={`${sidebarOpen ? 'w-[272px] min-w-[272px]' : 'w-14 min-w-[56px]'
          } shrink-0 bg-[#0B0F19] border-e border-white/15 flex flex-col justify-between transition-all duration-200 z-30 select-none`}
      >
        {/* Top Brand, Search ⌘K, Collapse Toggle & User Profile */}
        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            {sidebarOpen && (
              <button
                type="button"
                onClick={() => setActiveView('home')}
                className="flex items-center gap-2 text-base font-extrabold tracking-tight text-white cursor-pointer group"
                title={isAr ? 'منصة Engineer' : 'Engineer Platform'}
              >
                <div className="w-6 h-6 rounded-lg bg-gradient-to-tr from-blue-600 via-indigo-600 to-violet-600 flex items-center justify-center shadow-[0_0_12px_rgba(59,130,246,0.5)]">
                  <Sparkles className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="font-extrabold tracking-tight text-white group-hover:text-blue-400 transition-colors">
                  Engineer
                </span>
              </button>
            )}

            {sidebarOpen && (
              <button
                type="button"
                onClick={() => handleOpenModal('command-palette')}
                aria-label={isAr ? 'بحث ⌘K' : 'Search ⌘K'}
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] hover:bg-white/[0.09] text-[11px] text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <span>{isAr ? 'بحث' : 'Search'}</span>
                <kbd className="font-mono text-[10px] text-zinc-500">⌘K</kbd>
                <Search className="w-3 h-3" />
              </button>
            )}

            <button
              type="button"
              onClick={() => setSidebarOpen(!sidebarOpen)}
              aria-label={
                sidebarOpen
                  ? isAr
                    ? 'طي الشريط الجانبي'
                    : 'Collapse sidebar'
                  : isAr
                    ? 'توسيع الشريط الجانبي'
                    : 'Expand sidebar'
              }
              title={
                sidebarOpen
                  ? isAr
                    ? 'طي الشريط الجانبي'
                    : 'Collapse sidebar'
                  : isAr
                    ? 'توسيع الشريط الجانبي'
                    : 'Expand sidebar'
              }
              className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeftOpen className="w-4 h-4" />}
            </button>
          </div>

          {/* User Profile Selector Pill */}
          {sidebarOpen && (
            <button
              type="button"
              id="sidebar-user-profile-btn"
              data-testid="sidebar-user-profile-btn"
              onClick={() => {
                setUserProfileInitialTab('profile');
                setUserProfileModalOpen(true);
              }}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl glass-card transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="w-6 h-6 rounded-md bg-sky-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                  {currentUser?.name ? currentUser.name.charAt(0).toUpperCase() : (settings.userName ? settings.userName.charAt(0).toUpperCase() : 'S')}
                </div>
                <span className="text-xs font-semibold text-zinc-100 truncate">{currentUser?.name || settings.userName}</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[11px] font-medium text-zinc-300 bg-white/8 px-2 py-0.5 rounded-md">
                  {isAr ? 'مجاني' : 'Free'}
                </span>
                <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
              </div>
            </button>
          )}

          {/* Primary Navigation Items */}
          <nav className="space-y-1.5 pt-1">
            {[
              {
                id: 'home',
                labelEn: 'Home',
                labelAr: 'الرئيسية',
                icon: Home,
                active: activeView === 'home',
                onClick: () => {
                  setActiveView('home');
                  setInfoDrawer(null);
                },
              },
              {
                id: 'ide',
                labelEn: 'Cloud IDE Workspace',
                labelAr: 'بيئة البرمجة',
                icon: Code2,
                active: activeView === 'ide',
                onClick: () => {
                  setActiveView('ide');
                  setInfoDrawer(null);
                },
              },
              {
                id: 'dynamic-agent',
                labelEn: 'Executive AI Agent & UI',
                labelAr: 'المساعد التنفيذي والواجهات',
                icon: Sparkles,
                active: activeView === 'dynamic-agent',
                onClick: () => {
                  setActiveView('dynamic-agent');
                  setInfoDrawer(null);
                },
              },
              {
                id: 'media',
                labelEn: 'Media Studio',
                labelAr: 'استوديو الوسائط',
                icon: ImageIcon,
                active: activeView === 'media',
                onClick: () => {
                  setActiveView('media');
                  setInfoDrawer(null);
                },
              },
              {
                id: 'cards',
                labelEn: 'Flashcards',
                labelAr: 'بطاقات المراجعة',
                icon: Layers,
                active: activeView === 'cards',
                onClick: () => {
                  setActiveView('cards');
                  setInfoDrawer(null);
                },
              },
              {
                id: 'projects',
                labelEn: 'Projects',
                labelAr: 'المشاريع',
                icon: LayoutGrid,
                active: activeModal === 'open-project',
                onClick: () => handleOpenModal('open-project'),
              },
              {
                id: 'servers',
                labelEn: 'Cloud Servers',
                labelAr: 'الخوادم السحابية',
                icon: Server,
                active: activeView === 'servers',
                onClick: () => {
                  setActiveView('servers');
                  setInfoDrawer(null);
                },
              },
              {
                id: 'published',
                labelEn: 'Published Apps',
                labelAr: 'التطبيقات المنشورة',
                icon: Rocket,
                active: activeView === 'published',
                onClick: () => {
                  setActiveView('published');
                  setInfoDrawer(null);
                },
              },
              {
                id: 'autonomous-agent',
                labelEn: 'Autonomous Agent',
                labelAr: 'الوكيل البرمجي الذكي',
                icon: Bot,
                active: activeModal === 'autonomous-agent',
                onClick: () => handleOpenModal('autonomous-agent'),
              },
              {
                id: 'deep-research',
                labelEn: 'Deep Research & Books',
                labelAr: 'البحث المعرفي ودراسة الكتب',
                icon: BookOpen,
                active: activeModal === 'deep-research',
                onClick: () => handleOpenModal('deep-research'),
              },
              {
                id: 'registry',
                labelEn: 'Button Registry',
                labelAr: 'سجل واختبار الأزرار',
                icon: ShieldCheck,
                active: activeView === 'registry',
                onClick: () => {
                  setActiveView('registry');
                  setInfoDrawer(null);
                },
              },
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onClick}
                  title={isAr ? item.labelAr : item.labelEn}
                  className={`w-full flex items-center transition-all duration-200 relative cursor-pointer ${sidebarOpen
                    ? 'px-4 py-3 gap-3.5 rounded-xl text-[15px] leading-6 font-semibold'
                    : 'p-0 justify-center w-10 h-10 mx-auto rounded-xl text-xs'
                    } ${item.active
                      ? 'bg-blue-600/25 border border-blue-400/50 text-white font-bold shadow-sm border-s-4 border-s-blue-400'
                      : 'text-[#F1F5F9] hover:bg-white/10 hover:text-white'
                    }`}
                >
                  <Icon
                    className={`shrink-0 ${sidebarOpen ? 'w-5 h-5 stroke-[2.2]' : 'w-4 h-4 stroke-[2]'
                      } ${item.active ? 'text-blue-400' : 'text-slate-200'}`}
                  />
                  {sidebarOpen && <span className="truncate">{isAr ? item.labelAr : item.labelEn}</span>}
                </button>
              );
            })}
          </nav>

          {/* Quick Help Center */}
          <div className="pt-3 border-t border-white/10 space-y-1">
            <button
              type="button"
              onClick={() => setInfoDrawer(infoDrawer === 'help' ? null : 'help')}
              title={isAr ? 'مركز المساعدة والدليل' : 'Help & Docs'}
              className={`w-full flex items-center transition-colors cursor-pointer rounded-xl ${sidebarOpen
                ? 'px-4 py-2.5 gap-3.5 text-[15px] font-semibold text-[#F1F5F9] hover:text-white hover:bg-white/10'
                : 'p-0 justify-center w-10 h-10 mx-auto text-slate-300'
                }`}
            >
              <BookOpen className={`shrink-0 text-sky-400 stroke-[2.2] ${sidebarOpen ? 'w-5 h-5' : 'w-4 h-4'}`} />
              {sidebarOpen && <span>{isAr ? 'مركز المساعدة والدليل' : 'Help & Docs'}</span>}
            </button>
          </div>
        </div>

        {/* Bottom Section: Language Switcher & Settings */}
        <div className="p-3 space-y-2 border-t border-white/10">
          {/* Language Toggle Button (زر تبديل اللغة) */}
          <button
            type="button"
            onClick={() =>
              handleUpdateSettings({
                language: language === 'ar' ? 'en' : 'ar',
              })
            }
            title={language === 'ar' ? 'Switch to English (LTR)' : 'التبديل إلى العربية (RTL)'}
            className={`w-full flex items-center transition-colors cursor-pointer border border-white/5 rounded-xl ${sidebarOpen
              ? 'px-4 py-3 gap-3.5 text-[15px] font-semibold text-[#F1F5F9] hover:text-white hover:bg-white/10'
              : 'p-0 justify-center w-10 h-10 mx-auto text-slate-300'
              }`}
          >
            <Globe2 className={`shrink-0 text-sky-400 stroke-[2.2] ${sidebarOpen ? 'w-5 h-5' : 'w-4 h-4'}`} />
            {sidebarOpen && (
              <div className="flex items-center justify-between w-full">
                <span>{language === 'ar' ? 'اللغة: العربية' : 'Language: English'}</span>
                <span className="text-[11px] bg-sky-500/15 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-md font-mono">
                  {language === 'ar' ? 'English' : 'عربي'}
                </span>
              </div>
            )}
          </button>

          {/* Settings Button (زر الإعدادات) */}
          <button
            type="button"
            id="sidebar-settings-btn"
            data-testid="sidebar-settings-btn"
            onClick={() => {
              setUserProfileInitialTab('settings');
              setUserProfileModalOpen(true);
            }}
            title={isAr ? 'الإعدادات والحساب' : 'Settings'}
            className={`w-full flex items-center transition-colors cursor-pointer border border-white/5 rounded-xl ${sidebarOpen
              ? 'px-4 py-3 gap-3.5 text-[15px] font-semibold text-[#F1F5F9] hover:text-white hover:bg-white/10'
              : 'p-0 justify-center w-10 h-10 mx-auto text-slate-300'
              }`}
          >
            <SettingsIcon className={`shrink-0 text-blue-400 stroke-[2.2] ${sidebarOpen ? 'w-5 h-5' : 'w-4 h-4'}`} />
            {sidebarOpen && <span>{isAr ? 'الإعدادات والحساب' : 'Settings'}</span>}
          </button>
        </div>
      </aside>

      {/* Info Drawer for Help Center / Release Notes / Status / Referral */}
      {infoDrawer && (
        <div className="w-72 bg-[#12151f] border-e border-white/10 p-4 flex flex-col justify-between text-xs z-20">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-white/10 pb-2">
              <span className="font-bold text-white text-sm">
                {infoDrawer === 'help' && (isAr ? 'مركز المساعدة والدليل' : 'Help Center & Docs')}
                {infoDrawer === 'releases' && (isAr ? 'ملاحظات الإصدار v4.2' : 'Release Notes v4.2')}
                {infoDrawer === 'status' && (isAr ? 'حالة الخدمات السحابية' : 'Cloud Systems Status')}
                {infoDrawer === 'referral' && (isAr ? 'برنامج دعوة المطورين ($50)' : 'Referral Program ($50)')}
              </span>
              <button
                type="button"
                onClick={() => setInfoDrawer(null)}
                className="text-zinc-400 hover:text-white px-1.5"
              >
                ×
              </button>
            </div>

            {infoDrawer === 'help' && (
              <div className="space-y-2 text-zinc-300 leading-relaxed">
                <p>
                  {isAr
                    ? 'جميع الأزرار في المنصة مرتبطة بوظائف فعلية، يمكنك بدء مشروع، تحرير الكود، تشغيل الاختبارات، إدارة قاعدة البيانات، والنشر السحابي.'
                    : 'Every button in Bolt.new Studio is wired to real backend, AST, database, and deployment handlers.'}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setInfoDrawer(null);
                    setActiveView('registry');
                  }}
                  className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold"
                >
                  {isAr ? 'استعراض سجل الأزرار الكامل' : 'Open Button Registry'}
                </button>
              </div>
            )}

            {infoDrawer === 'releases' && (
              <div className="space-y-2 text-zinc-300 font-mono text-[11px]">
                <div className="p-2 rounded bg-black/40 border border-white/8">
                  <div className="text-sky-400 font-bold">v4.2.0 — Full Cloud IDE</div>
                  <div>• Added 10 Specialized AI Engineering Agents</div>
                  <div>• Added 17-Step Cloud Run Deployment Pipeline</div>
                  <div>• Added 9-Category Automated Testing & Trace Center</div>
                </div>
              </div>
            )}

            {infoDrawer === 'status' && (
              <div className="space-y-2 font-mono text-[11px]">
                <div className="p-2 rounded bg-emerald-950/30 border border-emerald-500/30 text-emerald-300">
                  ✓ Gemini 3.8 AI Engine: 100% Operational
                </div>
                <div className="p-2 rounded bg-emerald-950/30 border border-emerald-500/30 text-emerald-300">
                  ✓ Cloud Run Deployment API: Operational
                </div>
                <div className="p-2 rounded bg-emerald-950/30 border border-emerald-500/30 text-emerald-300">
                  ✓ Database & Storage Vault: Operational
                </div>
              </div>
            )}

            {infoDrawer === 'referral' && (
              <div className="space-y-3 text-zinc-300">
                <p>
                  {isAr
                    ? 'شارك رابط الدعوة الخاص بك مع فريقك واحصل على 50$ رصيد استهلاك ذكاء اصطناعي ونشر سحابي فوري.'
                    : 'Share your invite link with engineering peers to earn $50 in AI tokens and Cloud Run compute credits.'}
                </p>
                <div className="p-2 rounded bg-black font-mono text-[11px] text-sky-300 select-all">
                  https://bolt.new/invite/salemalderei84
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText('https://bolt.new/invite/salemalderei84');
                    notify('success', isAr ? 'تم نسخ رابط الدعوة وتفعيل مكافأة الحساب' : 'Copied invite link to clipboard');
                  }}
                  className="w-full py-2 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer"
                >
                  {isAr ? 'نسخ رابط الدعوة' : 'Copy Referral Link'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Main Content Viewport */}
      {activeView === 'home' && (
        <HomeLaunchpad
          language={language}
          sidebarOpen={sidebarOpen}
          projects={projects}
          activeProject={activeProject}
          isGenerating={isGenerating}
          currentUser={currentUser}
          onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
          onToggleLanguage={() =>
            handleUpdateSettings({
              language: language === 'ar' ? 'en' : 'ar',
            })
          }
          onSelectProject={handleSelectProject}
          onUpdateProject={handleUpdateProject}
          onDuplicateProject={handleDuplicateProject}
          onDeleteProject={handleDeleteProject}
          onExecutePrompt={handleExecutePrompt}
          onOpenModal={handleOpenModal}
          onSwitchView={setActiveView}
          onNotify={notify}
          defaultModel={settings.defaultModel}
          availableModels={availableAiModels}
          onSelectModel={handleSelectedModelChange}
        />
      )}

      {activeView === 'ide' && (
        <IdeWorkspace
          language={language}
          project={activeProject}
          defaultModel={settings.defaultModel}
          availableModels={availableAiModels}
          onSelectModel={handleSelectedModelChange}
          agents={agents}
          isGenerating={isGenerating}
          pipelineStages={pipelineStages}
          onUpdateProject={handleUpdateProject}
          onExecutePrompt={handleExecutePrompt}
          onStopGeneration={handleStopGeneration}
          onOpenModal={handleOpenModal}
          onNotify={notify}
        />
      )}

      {activeView === 'published' && (
        <PublishedAppsView
          language={language}
          projects={projects}
          onSelectProject={handleSelectProject}
          onUpdateProject={handleUpdateProject}
          onOpenModal={handleOpenModal}
          onNotify={notify}
        />
      )}

      {activeView === 'servers' && (
        <ServersView
          language={language}
          onOpenModal={handleOpenModal}
          onNotify={notify}
        />
      )}

      {activeView === 'registry' && (
        <ButtonRegistryView
          language={language}
          registry={buttonRegistry}
          activeProject={activeProject}
          onVerifyAll={handleVerifyAllRegistry}
          onTriggerWorkflow={handleTriggerRegistryWorkflow}
        />
      )}

      {activeView === 'dynamic-agent' && (
        <DynamicAgentWorkspace />
      )}

      {activeView === 'media' && (
        <div className="flex-1 overflow-auto bg-[#131316]">
          <MediaStudio />
        </div>
      )}

      {activeView === 'cards' && (
        <div className="flex-1 overflow-auto bg-[#131316]">
          <Flashcards />
        </div>
      )}

      {/* Modals Hub */}
      <ModalsHub
        activeModal={activeModal}
        modalPayload={modalPayload}
        language={language}
        projects={projects}
        activeProject={activeProject}
        agents={agents}
        settings={settings}
        onClose={() => setActiveModal(null)}
        onCreateProject={handleCreateProject}
        onUpdateProject={handleUpdateProject}
        onSelectProject={handleSelectProject}
        onDuplicateProject={handleDuplicateProject}
        onDeleteProject={handleDeleteProject}
        onUpdateSettings={handleUpdateSettings}
        onNotify={notify}
      />

      {/* Deep Research & Book Intelligence Modal */}
      <DeepResearchModal
        isOpen={activeModal === 'deep-research'}
        onClose={() => setActiveModal((curr) => (curr === 'deep-research' ? null : curr))}
        language={language}
      />

      {/* Autonomous Coding Agent Modal */}
      <AutonomousAgentModal
        isOpen={activeModal === 'autonomous-agent'}
        onClose={() => setActiveModal((curr) => (curr === 'autonomous-agent' ? null : curr))}
        language={language}
        currentProjectId={activeProjectId}
      />

      {/* User Authentication Modal (Register / Login) */}
      <AuthModal
        isOpen={activeModal === 'auth'}
        onClose={() => setActiveModal((curr) => (curr === 'auth' ? null : curr))}
        language={language}
        onAuthSuccess={(user) => {
          setCurrentUser(user);
          setSettings((prev) => ({
            ...prev,
            userName: user.name,
            userEmail: user.email,
          }));
          notify('success', language === 'ar' ? `مرحباً بك ${user.name}` : `Welcome ${user.name}`);
          setShowOnboardingTour(true);
        }}
      />

      {/* User Profile & App Settings Modal (Phase 10) */}
      <UserProfileAndSettingsModal
        isOpen={userProfileModalOpen}
        initialTab={userProfileInitialTab}
        language={language}
        onClose={() => setUserProfileModalOpen(false)}
        onLogout={handleLogout}
        onNotify={notify}
        onProfileUpdated={(updated) => {
          if (updated.name) {
            setCurrentUser((prev) => (prev ? { ...prev, name: updated.name! } : null));
            setSettings((prev) => ({ ...prev, userName: updated.name! }));
          }
        }}
      />

      {/* Phase 12: Onboarding Tour (First Experience) */}
      <OnboardingTour
        isOpen={showOnboardingTour}
        language={language}
        onClose={() => setShowOnboardingTour(false)}
        onComplete={() => setShowOnboardingTour(false)}
      />

      {/* Phase 12: Legal Modals (Terms & Privacy) */}
      {activeLegalModal && (
        <LegalModal
          isOpen={Boolean(activeLegalModal)}
          type={activeLegalModal}
          language={language}
          onClose={() => setActiveLegalModal(null)}
        />
      )}

      {/* Global Toast Notification Banner */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-5 end-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl text-xs font-semibold transition-all ${toast.type === 'error'
            ? 'bg-rose-950/95 border-rose-500/50 text-rose-200'
            : toast.type === 'info'
              ? 'bg-slate-900/95 border-sky-500/40 text-sky-200'
              : 'bg-emerald-950/95 border-emerald-500/50 text-emerald-200'
            }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </div>
  );
}
