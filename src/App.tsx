import React, { useState, useEffect, useCallback } from 'react';
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
} from 'lucide-react';
import {
  AIAgentProfile,
  ButtonRegistryEntry,
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
import {
  getInitialButtonRegistry,
  runAutomatedRegistryVerification,
} from './utils/buttonRegistry';
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
    defaultModel: 'gemini-3.8-flash',
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
  const [activeView, setActiveView] = useState<'home' | 'ide' | 'published' | 'registry' | 'servers'>('home');
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
      .catch(() => {});
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

  // 9-Stage AI Engineering Execution Engine
  const handleExecutePrompt = async (
    prompt: string,
    options: {
      model: string;
      thinkingMode: 'standard' | 'deep' | 'plan';
      agentId?: string;
      category?: ProjectCategory;
      attachments?: { name: string; type: string; size: number }[];
    }
  ) => {
    if (isGenerating) return;
    setIsGenerating(true);
    setActiveView('ide');

    const stages: ExecutionPipelineStage[] = [
      { id: 's1', labelAr: '1. تحليل الطلب', labelEn: '1. Analyze Request', status: 'running', agentId: 'agent-chief', detail: 'Parsing prompt' },
      { id: 's2', labelAr: '2. إعداد خطة العمل', labelEn: '2. Work Plan', status: 'pending', agentId: 'agent-planner', detail: 'Drafting architecture' },
      { id: 's3', labelAr: '3. توزيع المهام', labelEn: '3. Assign Tasks', status: 'pending', agentId: 'agent-chief', detail: 'Routing to specialists' },
      { id: 's4', labelAr: '4. إنشاء الملفات', labelEn: '4. Create Files', status: 'pending', agentId: 'agent-frontend', detail: 'Scaffolding modules' },
      { id: 's5', labelAr: '5. تعديل الأكواد', labelEn: '5. Modify Code', status: 'pending', agentId: 'agent-backend', detail: 'Applying AST changes' },
      { id: 's6', labelAr: '6. تشغيل البناء', labelEn: '6. Run Build', status: 'pending', agentId: 'agent-devops', detail: 'Compiling bundle' },
      { id: 's7', labelAr: '7. الاختبارات', labelEn: '7. Run Tests', status: 'pending', agentId: 'agent-qa', detail: 'Executing 9 suites' },
      { id: 's8', labelAr: '8. إصلاح الأخطاء', labelEn: '8. Fix Errors', status: 'pending', agentId: 'agent-debugger', detail: 'Zero errors' },
      { id: 's9', labelAr: '9. نتيجة التنفيذ', labelEn: '9. Final Result', status: 'pending', agentId: 'agent-reviewer', detail: 'Ready in preview' },
    ];
    setPipelineStages(stages);

    const now = new Date().toISOString();
    const userMessage = {
      id: `msg-u-${Date.now()}`,
      role: 'user' as const,
      content: prompt,
      timestamp: now,
      model: options.model,
      thinkingMode: options.thinkingMode,
      agentId: options.agentId || 'agent-chief',
      attachments: options.attachments,
    };

    // Append user message immediately
    const threadId = activeProject.activeChatId || activeProject.chatThreads[0]?.id;
    const updatedThreadsWithUser = activeProject.chatThreads.map((th) =>
      th.id === threadId ? { ...th, messages: [...th.messages, userMessage], updatedAt: now } : th
    );
    const projectWithUserMsg = { ...activeProject, chatThreads: updatedThreadsWithUser };
    setProjects((prev) => prev.map((p) => (p.id === activeProject.id ? projectWithUserMsg : p)));

    // Progress through stages visually while calling server-side Gemini API
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 90));
      setPipelineStages((prev) =>
        prev.map((st, idx) => ({
          ...st,
          status: idx <= i ? 'done' : idx === i + 1 ? 'running' : 'pending',
        }))
      );
    }

    let replyContent = '';
    let updatedServerProject: Project | null = null;

    try {
      const res = await fetch('/api/ai/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: activeProject.id,
          prompt,
          model: options.model,
          thinkingMode: options.thinkingMode,
          agentId: options.agentId || 'agent-chief',
        }),
      });
      if (res.ok) {
        const data = await res.json();
        replyContent = data.reply;
        updatedServerProject = data.project;
        if (data.agent) {
          setAgents((prev) => prev.map((a) => (a.id === data.agent.id ? data.agent : a)));
        }
      }
    } catch {
      // fallback below
    }

    setPipelineStages((prev) => prev.map((st) => ({ ...st, status: 'done' })));

    const assistantMsg = {
      id: `msg-a-${Date.now()}`,
      role: 'assistant' as const,
      content:
        replyContent ||
        (isAr
          ? `تم تنفيذ طلبك البرمجي بنجاح وتحديث ملفات المشروع والمعاينة الحية.`
          : `Executed your engineering request and updated project files & live preview.`),
      timestamp: new Date().toISOString(),
      model: options.model,
      thinkingMode: options.thinkingMode,
      agentId: options.agentId || 'agent-chief',
    };

    const baseProj = updatedServerProject || projectWithUserMsg;
    const finalThreads = baseProj.chatThreads.map((th) =>
      th.id === threadId
        ? {
            ...th,
            messages: [...th.messages.filter((m) => m.id !== userMessage.id), userMessage, assistantMsg],
            updatedAt: new Date().toISOString(),
          }
        : th
    );

    const finalProject: Project = {
      ...baseProj,
      chatThreads: finalThreads,
      updatedAt: new Date().toISOString(),
    };

    await handleUpdateProject(
      finalProject,
      isAr ? 'اكتمل التنفيذ الهندسي وتحديث الكود والمعاينة' : 'Completed AI engineering execution & updated preview'
    );
    setIsGenerating(false);
  };

  const handleStopGeneration = () => {
    setIsGenerating(false);
    setPipelineStages((prev) =>
      prev.map((st) => (st.status === 'running' ? { ...st, status: 'done' } : st))
    );
    notify('info', isAr ? 'تم إيقاف عملية التوليد بناءً على طلبك' : 'Stopped generation task');
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

  return (
    <div className="min-h-screen flex bg-[#08090d] text-zinc-100 overflow-hidden">
      {/* Bolt.new Collapsible Left Sidebar */}
      <aside
        aria-label="Workspace Sidebar Navigation"
        className={`${
          sidebarOpen ? 'w-60' : 'w-14'
        } shrink-0 bg-[#0d0e12] border-e border-white/10 flex flex-col justify-between transition-all duration-200 z-30 select-none`}
      >
        {/* Top Brand, Search ⌘K, Collapse Toggle & User Profile */}
        <div className="p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            {sidebarOpen && (
              <button
                type="button"
                onClick={() => setActiveView('home')}
                className="flex items-center gap-0.5 text-lg font-extrabold tracking-tight text-white cursor-pointer"
              >
                <span className="italic font-black">bolt</span>
                <span className="text-xs font-semibold text-blue-400">.new</span>
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

          {/* User Profile Selector Pill matching Bolt.new screenshot */}
          {sidebarOpen && (
            <button
              type="button"
              id="sidebar-user-profile-btn"
              data-testid="sidebar-user-profile-btn"
              onClick={() => {
                setUserProfileInitialTab('profile');
                setUserProfileModalOpen(true);
              }}
              className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl bg-[#161820] hover:bg-[#1c1f2a] border border-white/10 transition-colors cursor-pointer"
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
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                    item.active
                      ? 'bg-blue-600/20 text-blue-300 font-semibold border border-blue-500/30'
                      : 'text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04]'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
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
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.04] cursor-pointer"
            >
              <BookOpen className="w-4 h-4 shrink-0 text-sky-400" />
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
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer border border-white/5"
          >
            <Globe2 className="w-4 h-4 shrink-0 text-sky-400" />
            {sidebarOpen && (
              <div className="flex items-center justify-between w-full">
                <span>{language === 'ar' ? 'اللغة: العربية' : 'Language: English'}</span>
                <span className="text-[10px] bg-sky-500/15 text-sky-300 border border-sky-500/30 px-2 py-0.5 rounded-md font-mono">
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
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold text-zinc-300 hover:text-white hover:bg-white/[0.06] transition-colors cursor-pointer border border-white/5"
          >
            <SettingsIcon className="w-4 h-4 shrink-0 text-blue-400" />
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
        />
      )}

      {activeView === 'ide' && (
        <IdeWorkspace
          language={language}
          project={activeProject}
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
          className={`fixed bottom-5 end-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-2xl text-xs font-semibold transition-all ${
            toast.type === 'error'
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
