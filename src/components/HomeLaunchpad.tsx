import React, { useState, useRef } from 'react';
import {
  Plus,
  Palette,
  Lightbulb,
  Mic,
  ArrowUp,
  Globe,
  Presentation,
  Smartphone,
  FlaskConical,
  Figma,
  Github,
  Users,
  ArrowRight,
  Code2,
  CheckCircle2,
  Loader2,
  ChevronDown,
  Paperclip,
  Image as ImageIcon,
  FileCode,
  BookOpen,
  Bot,
  BrainCircuit,
  Copy,
  Edit3,
  Trash2,
  FolderOpen,
  Check,
  X,
  Briefcase,
  Sparkles,
  User,
} from 'lucide-react';
import { Language, Project, ProjectCategory } from '../types/platform';
import { PromptMode } from '../utils/intentRouter';

interface SpeechRecognitionResultItem {
  transcript: string;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: {
    [index: number]: SpeechRecognitionResultItem;
  };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionInstance {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort?: () => void;
}
interface WindowWithSpeech {
  SpeechRecognition?: new () => SpeechRecognitionInstance;
  webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
}

interface HomeLaunchpadProps {
  language: Language;
  sidebarOpen: boolean;
  projects: Project[];
  activeProject: Project;
  isGenerating: boolean;
  currentUser?: { name?: string; email?: string } | null;
  onToggleSidebar: () => void;
  onToggleLanguage: () => void;
  onSelectProject: (project: Project, openIde?: boolean) => void;
  onUpdateProject: (updated: Project, toastMsg?: string) => Promise<void>;
  onDuplicateProject: (projectId: string) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onExecutePrompt: (
    prompt: string,
    options: {
      model: string;
      thinkingMode: 'standard' | 'deep' | 'plan';
      category?: ProjectCategory;
      attachments?: { name: string; type: string; size: number }[];
      mode?: PromptMode;
    }
  ) => Promise<{ intent?: string } | void>;
  onOpenModal: (modal: string, payload?: unknown) => void;
  onSwitchView: (view: 'home' | 'ide' | 'published' | 'registry') => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  defaultModel?: string;
  availableModels?: Array<{ id: string; name: string; provider: string; available: boolean; configured?: boolean; statusLabel?: string; statusLabelAr?: string; providerLabel?: string }>;
  onSelectModel?: (modelId: string) => void;
}

const AI_MODELS = [
  {
    id: 'Gemini 2.5 Pro',
    nameEn: 'Gemini 2.5 Pro',
    nameAr: 'Gemini 2.5 Pro (هندسة متقدمة)',
    badge: '2M Context',
    descEn: 'Deep architectural reasoning & full-stack code synthesis',
    descAr: 'تحليل معماري عميق وبناء الأنظمة المتكاملة',
  },
  {
    id: 'Gemini 2.5 Flash',
    nameEn: 'Gemini 2.5 Flash',
    nameAr: 'Gemini 2.5 Flash (فائق السرعة)',
    badge: 'Low Latency',
    descEn: 'High-speed UI generation & instant live preview updates',
    descAr: 'توليد فائق السرعة للواجهات والتعديلات الفورية',
  },
  {
    id: 'Claude 3.7 Sonnet',
    nameEn: 'Claude 3.7 Sonnet',
    nameAr: 'Claude 3.7 Sonnet (دقة برمجية)',
    badge: 'Hybrid Think',
    descEn: 'Precision frontend design systems & TypeScript refactoring',
    descAr: 'دقة عالية في هندسة الواجهات وهيكلة TypeScript',
  },
  {
    id: 'GPT-4o',
    nameEn: 'GPT-4o',
    nameAr: 'GPT-4o (متعدد الوسائط)',
    badge: 'Omni',
    descEn: 'Multimodal vision-to-code & database schema generation',
    descAr: 'تحويل التصاميم والصور إلى كود وقواعد بيانات',
  },
];

interface GoldenBlueprint {
  id: string;
  category: 'website' | 'slides' | 'app' | 'prototype';
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  badgeAr: string;
  badgeEn: string;
  promptAr: string;
  promptEn: string;
  tag: string;
}

const GOLDEN_BLUEPRINTS: GoldenBlueprint[] = [
  {
    id: 'trading_quant_terminal',
    category: 'app',
    titleAr: 'منصة التداول والتحليل المالي الكمي',
    titleEn: 'Trading & Quant Financial Terminal',
    descAr: 'رسوم بيانية حية، دفاتر أوامر السوق، وإدارة دقيقة للمخاطر وحجم الصفقات.',
    descEn: 'Live candlestick charting, real-time order book, and risk sizing metrics.',
    badgeAr: 'تداول كمي',
    badgeEn: 'Quant Trading',
    promptAr: 'ابنِ منصة تداول كمي وتحليل مالي فوري مع دفاتر أوامر حية وحاسبة مخاطر الصفقات',
    promptEn: 'Build a quantitative financial trading terminal with real-time orderbook and position sizing',
    tag: 'Trading'
  },
  {
    id: 'live_auction_marketplace',
    category: 'prototype',
    titleAr: 'منصة المزادات والأسواق الحية',
    titleEn: 'Live Auction Marketplace',
    descAr: 'عد تنازلي لحظي، مزايدات تفاعلية متزامنة، ومعاينة المعروضات الفاخرة.',
    descEn: 'Dynamic countdown timer, live bidding increments, and luxury item lots.',
    badgeAr: 'مزادات فورية',
    badgeEn: 'Live Bidding',
    promptAr: 'ابنِ منصة مزادات حية مع عد تنازلي فوري ونظام مزايدات تفاعلي متزامن',
    promptEn: 'Build a live auction marketplace with real-time bidding countdown and lot showcase',
    tag: 'Marketplace'
  },
  {
    id: 'ecommerce_pos_store',
    category: 'app',
    titleAr: 'المتجر ونقاط البيع السحابية (POS ضريبة 5%)',
    titleEn: 'E-Commerce Store & Cloud POS (5% VAT)',
    descAr: 'كاشير متكامل مع باركود وسلة مشتريات وضريبة 5% معتمدة وطباعة الفاتورة.',
    descEn: 'Complete cashier POS with catalog, shopping cart, UAE 5% VAT, and receipt printer.',
    badgeAr: 'ضريبة 5% معتمدة',
    badgeEn: 'UAE 5% VAT',
    promptAr: 'ابنِ متجر ونقاط بيع سحابية POS مع احتساب ضريبة القيمة المضافة 5% وإصدار الفاتورة الضريبية',
    promptEn: 'Build an e-commerce cloud POS store with UAE 5% VAT calculation and printable tax invoice',
    tag: 'Retail'
  },
  {
    id: 'enterprise_erp_crm',
    category: 'app',
    titleAr: 'منظومة إدارة الأعمال والمبيعات (ERP & CRM)',
    titleEn: 'Enterprise ERP, Sales Pipeline & Invoicing',
    descAr: 'إدارة دورة المبيعات الكاملة، العملاء، ومتابعة الفواتير المحصلة والمعلقة.',
    descEn: 'Full sales pipeline kanban, client leads, revenue tracking, and invoice management.',
    badgeAr: 'إدارة مؤسسية',
    badgeEn: 'Enterprise ERP',
    promptAr: 'ابنِ منظومة إدارة أعمال ومبيعات وفواتير ERP & CRM مع تتبع خط الصفقات',
    promptEn: 'Build an enterprise ERP and CRM sales pipeline with lead tracking and revenue analytics',
    tag: 'Enterprise'
  },
  {
    id: 'booking_appointments_system',
    category: 'prototype',
    titleAr: 'منظومة الحجوزات والمواعيد الذكية',
    titleEn: 'Smart Appointments & Booking Scheduler',
    descAr: 'جدولة مواعيد للعيادات والاستشارات مع اختيار الخدمات والأوقات المتاحة والتأكيد الفوري.',
    descEn: 'Interactive calendar scheduler for clinics, service selections, and instant confirmations.',
    badgeAr: 'حجوزات عيادات',
    badgeEn: 'Scheduler',
    promptAr: 'ابنِ منظومة حجوزات ومواعيد ذكية مع جدول زمني لاختيار الأوقات وتأكيد الحجز',
    promptEn: 'Build a smart appointments and booking scheduler with live time slots and service picker',
    tag: 'Booking'
  },
  {
    id: 'smart_library_knowledge',
    category: 'website',
    titleAr: 'المكتبة الذكية وإدارة المعرفة والأرشفة',
    titleEn: 'Smart Library & Knowledge Archive',
    descAr: 'أرشفة الكتب والوثائق والأبحاث مع محرك بحث فوري وتصنيف متعدد الوسوم.',
    descEn: 'Document indexing, book archiving, instant full-text search, and tag filters.',
    badgeAr: 'أرشفة ذكية',
    badgeEn: 'Knowledge',
    promptAr: 'ابنِ مكتبة ذكية وإدارة معرفة وأرشفة مع محرك بحث فوري وتصنيف بالوسوم',
    promptEn: 'Build a smart library and knowledge archive with instant search and category tags',
    tag: 'Knowledge'
  },
  {
    id: 'ai_saas_dashboard',
    category: 'slides',
    titleAr: 'لوحة الذكاء الاصطناعي وإدارة الاشتراكات (AI SaaS)',
    titleEn: 'AI SaaS Dashboard & Token Analytics',
    descAr: 'متابعة استهلاك التوكنز والنماذج، إدارة المفاتيح API، ومختبر تجربة الأوامر.',
    descEn: 'Monitor token usage, manage API keys, subscription tiers, and prompt playground.',
    badgeAr: 'ذكاء اصطناعي SaaS',
    badgeEn: 'AI SaaS',
    promptAr: 'ابنِ لوحة تحكم ذكاء اصطناعي AI SaaS مع متابعة التوكنز ومختبر النماذج السريع',
    promptEn: 'Build an AI SaaS dashboard with token consumption metrics and interactive prompt playground',
    tag: 'AI SaaS'
  },
  {
    id: 'luxury_landing_portfolio',
    category: 'website',
    titleAr: 'المواقع التعريفية والعروض التقديمية الفاخرة',
    titleEn: 'Luxury Landing & Executive Presentation',
    descAr: 'تصميم زجاجي داكن فاخر مع مؤثرات إضاءة متقدمة، عرض إنجازات، واستمارة تواصل.',
    descEn: 'Ultra-modern dark glassmorphism showcase, feature cards, and high-impact pitch deck.',
    badgeAr: 'عرض فاخر',
    badgeEn: 'Luxury Landing',
    promptAr: 'ابنِ موقعاً تعريفياً وعرضاً تقديمياً فاخراً بتصميم زجاجي داكن ومؤثرات حديثة',
    promptEn: 'Build a luxury dark glassmorphism landing page and executive presentation showcase',
    tag: 'Showcase'
  }
];

export const HomeLaunchpad: React.FC<HomeLaunchpadProps> = ({
  language,
  sidebarOpen: _sidebarOpen,
  projects,
  activeProject,
  isGenerating,
  currentUser,
  onToggleSidebar: _onToggleSidebar,
  onToggleLanguage: _onToggleLanguage,
  onSelectProject,
  onUpdateProject,
  onDuplicateProject,
  onDeleteProject,
  onExecutePrompt,
  onOpenModal,
  onSwitchView,
  onNotify,
  defaultModel = '',
  availableModels = [],
  onSelectModel,
}) => {
  const isAr = language === 'ar';
  const [prompt, setPrompt] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<ProjectCategory>('app');
  const [selectedModel, setSelectedModel] = useState<string>(defaultModel || availableModels.find((m) => m.available)?.id || '');
  const [deepThink32k, setDeepThink32k] = useState<boolean>(false);
  const [planMode, setPlanMode] = useState<boolean>(false);
  const [designStyle, setDesignStyle] = useState<'cosmic-dark' | 'clean-slate' | 'enterprise-blue'>('cosmic-dark');

  // Menus & popovers
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [showStyleMenu, setShowStyleMenu] = useState(false);
  const [showNavDropdown, setShowNavDropdown] = useState<string | null>(null);

  // Voice Recording (Web Speech API)
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceStatusText, setVoiceStatusText] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Attachments
  const [attachedItems, setAttachedItems] = useState<{ name: string; type: string; size: number }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Recently Viewed inline rename & delete states
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState<string>('');
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [cloningProjectId, setCloningProjectId] = useState<string | null>(null);

  const modelMenuItems = availableModels.length > 0 ? availableModels : AI_MODELS.map((m) => ({
    id: m.id,
    name: isAr ? m.nameAr : m.nameEn,
    provider: m.nameEn.split(' ')[0].toLowerCase(),
    available: true,
    configured: true,
    statusLabel: 'Connected',
    statusLabelAr: 'متصل',
    providerLabel: m.badge,
  }));

  React.useEffect(() => {
    const fallback = modelMenuItems.find((m) => m.available)?.id || modelMenuItems[0]?.id || '';
    if (defaultModel) {
      setSelectedModel(defaultModel);
      return;
    }
    setSelectedModel((prev) => prev || fallback);
  }, [defaultModel, modelMenuItems]);

  const effectiveThinkingMode: 'standard' | 'deep' | 'plan' = planMode
    ? 'plan'
    : deepThink32k
      ? 'deep'
      : 'standard';

  const handlePromptSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isGenerating) return;
    const text = prompt.trim();
    if (!text) return;
    await onExecutePrompt(text, {
      model: selectedModel,
      thinkingMode: effectiveThinkingMode,
      category: selectedCategory,
      attachments: attachedItems,
      mode: 'auto',
    });
    setPrompt('');
    setAttachedItems([]);
  };

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setAttachedItems((prev) => [
      ...prev,
      ...files.map((f) => ({ name: f.name, type: f.type || 'file', size: f.size })),
    ]);
    setShowAttachMenu(false);
    onNotify(
      'info',
      isAr ? `تم إرفاق ${files.length} ملف بنجاح` : `Attached ${files.length} file(s) to prompt`
    );
  };

  const [isBlueprintsModalOpen, setIsBlueprintsModalOpen] = useState(false);
  const [blueprintCategoryFilter, setBlueprintCategoryFilter] = useState<'all' | 'website' | 'slides' | 'app' | 'prototype'>('all');

  const handleQuickCategorySelect = (
    cat: ProjectCategory,
    samplePromptEn: string,
    samplePromptAr: string
  ) => {
    setSelectedCategory(cat);
    setPrompt(isAr ? samplePromptAr : samplePromptEn);
    setBlueprintCategoryFilter(cat as 'all' | 'website' | 'slides' | 'app' | 'prototype');
    setIsBlueprintsModalOpen(true);
  };

  const handleLaunchBlueprint = (bp: GoldenBlueprint) => {
    setIsBlueprintsModalOpen(false);
    const p = isAr ? bp.promptAr : bp.promptEn;
    setPrompt(p);
    setSelectedCategory(bp.category);
    onExecutePrompt(p, {
      model: selectedModel,
      thinkingMode: effectiveThinkingMode,
      category: bp.category,
      mode: 'build'
    });
  };

  const toggleVoiceRecording = () => {
    if (isRecordingVoice) {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // ignore
        }
      }
      setIsRecordingVoice(false);
      setVoiceStatusText(null);
      setPrompt((prev) =>
        prev
          ? `${prev} — ${isAr
            ? 'مع ربط قاعدة البيانات والاختبارات الآلية (Web Speech API)'
            : 'with connected database and automated tests (Web Speech API)'
          }`
          : isAr
            ? 'أنشئ منصة إدارة مشاريع سحابية متكاملة مع قاعدة بيانات ولوحة تحكم تفاعلية'
            : 'Create a full-stack cloud project management platform with database and live analytics'
      );
      onNotify(
        'success',
        isAr
          ? 'تم تحويل التسجيل الصوتي الحي (Web Speech API) إلى أمر برمجي'
          : 'Converted live voice recording (Web Speech API) to prompt'
      );
      return;
    }

    setIsRecordingVoice(true);
    setVoiceStatusText(
      isAr
        ? 'جاري الاستماع عبر Web Speech API... اضغط مرة أخرى للإيقاف'
        : 'Listening via Web Speech API... Click Mic again to finish'
    );

    const speechWindow = window as unknown as WindowWithSpeech;
    const SpeechRecognitionAPI =
      speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;

    if (SpeechRecognitionAPI) {
      try {
        const recognition = new SpeechRecognitionAPI();
        recognition.lang = isAr ? 'ar-SA' : 'en-US';
        recognition.interimResults = true;
        recognition.continuous = true;
        recognition.onresult = (event: SpeechRecognitionEventLike) => {
          let transcript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            transcript += event.results[i][0].transcript;
          }
          if (transcript.trim()) {
            setPrompt((prev) => (prev ? `${prev} ${transcript.trim()}` : transcript.trim()));
          }
        };
        recognition.onerror = () => {
          // Keep recording state active so user can click to finish deterministically
        };
        recognitionRef.current = recognition;
        recognition.start();
      } catch {
        // Fallback handled when stopping
      }
    }
  };

  const handleStartRename = (proj: Project) => {
    setRenamingProjectId(proj.id);
    setRenameDraft(proj.name);
    setDeletingProjectId(null);
  };

  const handleConfirmRename = async (proj: Project) => {
    const trimmed = renameDraft.trim();
    if (!trimmed) {
      onNotify('error', isAr ? 'لا يمكن ترك اسم المشروع فارغاً' : 'Project name cannot be empty');
      return;
    }
    const updated: Project = {
      ...proj,
      name: trimmed,
      updatedAt: new Date().toISOString(),
    };
    setRenamingProjectId(null);
    await onUpdateProject(
      updated,
      isAr ? `تم تغيير اسم المشروع إلى "${trimmed}"` : `Renamed project to "${trimmed}"`
    );
  };

  const handleCloneCard = async (projectId: string) => {
    if (cloningProjectId === projectId) return;
    setCloningProjectId(projectId);
    try {
      await onDuplicateProject(projectId);
    } finally {
      setCloningProjectId(null);
    }
  };

  return (
    <div className="relative flex-1 min-h-screen overflow-y-auto bg-[#08090d] text-zinc-100 flex flex-col justify-between select-none">
      {/* Bolt.new Cosmic Radial Blue Atmospheric Glow */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          background:
            designStyle === 'cosmic-dark'
              ? 'radial-gradient(ellipse 75% 58% at 50% 34%, rgba(29, 78, 216, 0.36) 0%, rgba(14, 42, 128, 0.22) 42%, rgba(8, 9, 13, 0.96) 78%)'
              : designStyle === 'enterprise-blue'
                ? 'radial-gradient(ellipse 75% 58% at 50% 34%, rgba(14, 116, 144, 0.34) 0%, rgba(15, 23, 42, 0.85) 65%, rgba(8, 9, 13, 0.98) 85%)'
                : 'radial-gradient(ellipse 75% 58% at 50% 34%, rgba(71, 85, 105, 0.26) 0%, rgba(8, 9, 13, 0.96) 78%)',
        }}
      />

      {/* Top Navigation Header: bolt.new logo, Sidebar Collapse/Expand, Solutions, Resources, Careers, Pricing, Cloud Server Health Indicator, Settings & Language */}
      <header className="relative z-20 flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 max-w-7xl w-full mx-auto">
        {/* Left: Open Cloud IDE */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => onSwitchView('ide')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-sky-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>{isAr ? 'بيئة البرمجة' : 'Cloud IDE'}</span>
          </button>
        </div>

        {/* Center Navigation Links: Solutions, Resources, Careers, Pricing */}
        <nav
          aria-label="Primary Solutions Navigation"
          className="flex items-center gap-5 sm:gap-6 text-xs sm:text-sm font-medium text-zinc-300"
        >
          {/* Solutions / الحلول */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowNavDropdown(showNavDropdown === 'solutions' ? null : 'solutions');
              }}
              className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{isAr ? 'الحلول' : 'Solutions'}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </button>
            {showNavDropdown === 'solutions' && (
              <div className="absolute top-8 start-0 w-68 rounded-xl bg-[#13151c] border border-white/10 shadow-2xl p-2 z-50 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowNavDropdown(null);
                    onOpenModal('new-project', { category: 'app' });
                  }}
                  className="w-full text-start px-3 py-2 rounded-lg hover:bg-white/5 text-xs flex items-center justify-between"
                >
                  <span>{isAr ? 'بناء تطبيقات متكاملة' : 'Full-Stack App Builder'}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNavDropdown(null);
                    onOpenModal('database');
                  }}
                  className="w-full text-start px-3 py-2 rounded-lg hover:bg-white/5 text-xs flex items-center justify-between"
                >
                  <span>{isAr ? 'قواعد البيانات السحابية' : 'Cloud Database'}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNavDropdown(null);
                    onOpenModal('deploy');
                  }}
                  className="w-full text-start px-3 py-2 rounded-lg hover:bg-white/5 text-xs flex items-center justify-between"
                >
                  <span>{isAr ? 'النشر السحابي' : 'Cloud Deployment'}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
                </button>
              </div>
            )}
          </div>

          {/* Resources / الموارد */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowNavDropdown(showNavDropdown === 'resources' ? null : 'resources');
              }}
              className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{isAr ? 'الموارد' : 'Resources'}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </button>
            {showNavDropdown === 'resources' && (
              <div className="absolute top-8 start-0 w-68 rounded-xl bg-[#13151c] border border-white/10 shadow-2xl p-2 z-50 space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    setShowNavDropdown(null);
                    onSwitchView('registry');
                  }}
                  className="w-full text-start px-3 py-2 rounded-lg hover:bg-white/5 text-xs flex items-center justify-between"
                >
                  <span>{isAr ? 'سجل الأزرار واختبارات القبول' : 'Button Registry'}</span>
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNavDropdown(null);
                    onOpenModal('tests');
                  }}
                  className="w-full text-start px-3 py-2 rounded-lg hover:bg-white/5 text-xs flex items-center justify-between"
                >
                  <span>{isAr ? 'مركز الاختبارات والجودة' : 'Automated Test Center'}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNavDropdown(null);
                    onOpenModal('agents');
                  }}
                  className="w-full text-start px-3 py-2 rounded-lg hover:bg-white/5 text-xs flex items-center justify-between"
                >
                  <span>{isAr ? 'فريق المهندسين' : 'AI Engineers Team'}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
                </button>
              </div>
            )}
          </div>

          {/* Careers / التوظيف */}
          <div className="relative">
            <button
              type="button"
              onClick={() => {
                setShowNavDropdown(showNavDropdown === 'careers' ? null : 'careers');
              }}
              className="flex items-center gap-1 hover:text-white transition-colors cursor-pointer whitespace-nowrap"
            >
              <span>{isAr ? 'التوظيف' : 'Careers'}</span>
              <ChevronDown className="w-3.5 h-3.5 opacity-70" />
            </button>
            {showNavDropdown === 'careers' && (
              <div className="absolute top-8 start-0 w-72 rounded-xl bg-[#13151c] border border-white/10 shadow-2xl p-3 z-50 space-y-2 text-xs">
                <div className="flex items-center justify-between border-b border-white/10 pb-2">
                  <span className="font-bold text-white flex items-center gap-1.5">
                    <Briefcase className="w-3.5 h-3.5 text-sky-400" />
                    <span>{isAr ? 'الوظائف وفريق العمل' : 'Careers & Team'}</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowNavDropdown(null);
                    onOpenModal('agents');
                  }}
                  className="w-full text-start px-2.5 py-2 rounded-lg hover:bg-white/5 flex items-center justify-between text-zinc-200"
                >
                  <span>{isAr ? 'فريق الوكلاء' : 'AI Engineers'}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowNavDropdown(null);
                    onOpenModal('settings', { tab: 'team' });
                  }}
                  className="w-full text-start px-2.5 py-2 rounded-lg hover:bg-white/5 flex items-center justify-between text-zinc-200"
                >
                  <span>{isAr ? 'أعضاء الفريق' : 'Team Members'}</span>
                  <ArrowRight className="w-3.5 h-3.5 text-blue-400" />
                </button>
              </div>
            )}
          </div>

          {/* Pricing / الأسعار */}
          <button
            type="button"
            onClick={() => onOpenModal('settings', { tab: 'billing' })}
            className="hover:text-white transition-colors cursor-pointer whitespace-nowrap"
          >
            <span>{isAr ? 'الأسعار' : 'Pricing'}</span>
          </button>
        </nav>

        {/* Right Controls: User Auth Badge & Clean New Project CTA */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="auth-open-button"
            onClick={() => onOpenModal('auth')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-xs font-medium text-zinc-300 transition-colors cursor-pointer whitespace-nowrap"
          >
            <User className="w-3.5 h-3.5 text-blue-400" />
            <span data-testid="auth-user-badge">
              {currentUser?.name || currentUser?.email?.split('@')[0] || (isAr ? 'تسجيل الدخول' : 'Sign In')}
            </span>
          </button>
          <button
            type="button"
            onClick={() => onOpenModal('new-project')}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap shadow-sm shadow-blue-900/40"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isAr ? 'مشروع جديد' : 'New Project'}</span>
          </button>
        </div>
      </header>

      {/* Center Hero Section matching Bolt.new screenshot */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-6 max-w-4xl w-full mx-auto">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white text-center mb-3 text-balance">
          {isAr ? 'ماذا ستبني اليوم؟' : 'What will you build today?'}
        </h1>
        <p className="text-base sm:text-lg text-zinc-300/90 text-center mb-7">
          {isAr
            ? 'أنشئ تطبيقات ومواقع وعروضاً تقديمية متكاملة بالمحادثة بالعربية أو الإنجليزية مع الذكاء الاصطناعي.'
            : 'Create stunning apps & websites by chatting with AI in English or Arabic.'}
        </p>

        {/* Advanced Smart Prompt Composer Box */}
        <form
          onSubmit={handlePromptSubmit}
          className="w-full"
        >
          {/* Prompt Box Container (صندوق الكتابة مع زر + وزر السهم للإرسال داخله) */}
          <div className="w-full rounded-2xl bg-[#18191e]/95 border border-white/12 shadow-[0_24px_60px_rgba(0,0,0,0.65)] p-4 transition-all focus-within:border-blue-500/60">
            {/* Active Settings Pill Header */}
            {(deepThink32k || planMode) && (
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5 pb-2 border-b border-white/[0.06] text-[11px]">
                <div className="flex items-center gap-2 text-zinc-400">
                  {deepThink32k && (
                    <span className="px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 font-mono">
                      {isAr ? 'التفكير العميق' : 'Deep Think 32k'}
                    </span>
                  )}
                  {planMode && (
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono">
                      {isAr ? 'الخطة المعمارية' : 'Architecture Plan'}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Attached Files Bar */}
            {attachedItems.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-3 pb-2 border-b border-white/10">
                {attachedItems.map((att, i) => (
                  <div
                    key={`${att.name}-${i}`}
                    className="inline-flex items-center gap-2 text-xs bg-white/5 border border-white/10 rounded-lg px-2.5 py-1 text-zinc-200"
                  >
                    <Paperclip className="w-3 h-3 text-blue-400" />
                    <span>{att.name}</span>
                    <button
                      type="button"
                      onClick={() => setAttachedItems((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-zinc-400 hover:text-rose-400 ms-1"
                      aria-label={`Remove attachment ${att.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Live Voice Status Banner */}
            {voiceStatusText && (
              <div className="mb-2 px-3 py-1.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mic className="w-3.5 h-3.5 text-rose-400" />
                  <span>{voiceStatusText}</span>
                </div>
                <button
                  type="button"
                  onClick={toggleVoiceRecording}
                  className="px-2 py-0.5 rounded bg-rose-600 text-white text-[11px] font-semibold cursor-pointer"
                >
                  {isAr ? 'إنهاء التسجيل' : 'Finish Recording'}
                </button>
              </div>
            )}

            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handlePromptSubmit();
                }
              }}
              rows={3}
              placeholder={
                isAr
                  ? 'ما الذي تود بناءه اليوم؟ اكتب فكرتك أو أمرك البرمجي هنا...'
                  : 'What will you build today? Type your idea or prompt here...'
              }
              className="w-full bg-transparent text-zinc-100 placeholder-zinc-400 text-sm sm:text-base resize-none focus:outline-none leading-relaxed"
            />

            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={handleFileAttach}
            />

            {/* Inside-Box Action Row: + button on start side, Send Arrow button on end side */}
            <div className="flex items-center justify-between pt-2 mt-1">
              {/* + Attachment Button (داخل الصندوق) */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowAttachMenu(!showAttachMenu);
                    setShowModelMenu(false);
                    setShowStyleMenu(false);
                  }}
                  aria-label={isAr ? 'إرفاق ملف أو صورة' : 'Attach file or image'}
                  className="w-8 h-8 rounded-full bg-white/[0.07] hover:bg-white/[0.14] border border-white/10 flex items-center justify-center text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                </button>
                {showAttachMenu && (
                  <div className="absolute bottom-10 start-0 w-64 rounded-xl bg-[#14161d] border border-white/12 shadow-2xl p-1.5 z-50 space-y-1 text-xs">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/8 text-zinc-200 cursor-pointer"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-sky-400" />
                      <span>{isAr ? 'رفع صورة أو تصميم واجهة' : 'Upload Image / UI Mockup'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/8 text-zinc-200 cursor-pointer"
                    >
                      <Paperclip className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{isAr ? 'إرفاق ملف من جهازك' : 'Upload Local File'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAttachedItems((prev) => [
                          ...prev,
                          {
                            name: activeProject.files[0]?.path || '/src/App.tsx',
                            type: 'project-file',
                            size: 2048,
                          },
                        ]);
                        setShowAttachMenu(false);
                        onNotify(
                          'success',
                          isAr
                            ? 'تم إرفاق ملفات المشروع النشط'
                            : 'Attached active project files to context'
                        );
                      }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-white/8 text-zinc-200 cursor-pointer"
                    >
                      <FileCode className="w-3.5 h-3.5 text-amber-400" />
                      <span>{isAr ? 'إرفاق ملفات المشروع الحالي' : 'Attach Active Project Files'}</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Send Button: Arrow Icon ONLY (زر سهم بدون كلمة إرسال) */}
              <button
                type="submit"
                disabled={isGenerating}
                aria-label={isAr ? 'إرسال' : 'Send'}
                className="w-8 h-8 rounded-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white flex items-center justify-center shadow-md transition-transform active:scale-95 cursor-pointer"
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowUp className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Under-the-box Controls (باقي الأزرار تحت وبحجم أصغر) */}
          <div className="w-full flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 mt-2.5 px-1">
            {/* Left side helper buttons */}
            <div className="flex flex-wrap items-center gap-1.5">
              {/* AI Model Selector */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowModelMenu(!showModelMenu);
                    setShowAttachMenu(false);
                    setShowStyleMenu(false);
                  }}
                  aria-label={isAr ? 'النموذج الذكي' : 'AI Model'}
                  className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-[11px] font-medium text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-blue-400" />
                  <span>{isAr ? 'النموذج الذكي' : 'AI Model'}</span>
                  <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                </button>
                {showModelMenu && (
                  <div className="absolute top-8 start-0 w-72 rounded-xl bg-[#14161d] border border-white/15 shadow-2xl p-1.5 z-50 space-y-1 text-xs">
                    <div className="px-2.5 py-1 text-[11px] font-semibold text-zinc-400 border-b border-white/8">
                      {isAr ? 'اختر نموذج الذكاء الاصطناعي' : 'Select AI Model'}
                    </div>
                    {modelMenuItems.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        disabled={!m.available}
                        onClick={() => {
                          setSelectedModel(m.id);
                          onSelectModel?.(m.id);
                          setShowModelMenu(false);
                          onNotify(
                            'info',
                            isAr ? `تم اختيار النموذج: ${m.name}` : `Selected model: ${m.name}`
                          );
                        }}
                        className={`w-full text-start px-2.5 py-1.5 rounded-lg flex items-start justify-between gap-2 text-zinc-200 ${m.available ? 'hover:bg-white/8 cursor-pointer' : 'opacity-50 cursor-not-allowed'}`}
                      >
                        <div>
                          <div className="font-semibold text-white flex items-center gap-2 text-xs">
                            <span className="inline-flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${m.available ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                              <span>{m.name}</span>
                            </span>
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300">
                              {m.providerLabel || m.provider}
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-400 mt-0.5">
                            {m.available ? (isAr ? 'متصل وجاهز للاستخدام' : 'Connected and ready') : (isAr ? (m.statusLabelAr || 'غير مفعل - يحتاج مفتاح حقيقي') : (m.statusLabel || 'Unconfigured / No Valid Key'))}
                          </div>
                        </div>
                        {selectedModel === m.id && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-blue-400 shrink-0 mt-0.5" />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Autonomous Coding Agent Button */}
              <button
                type="button"
                data-testid="autonomous-agent-open-button"
                onClick={() => onOpenModal('autonomous-agent')}
                aria-label={isAr ? 'الوكيل البرمجي الذكي' : 'Autonomous Agent'}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/35 text-[11px] font-semibold text-purple-300 transition-colors cursor-pointer"
              >
                <Bot className="w-3 h-3 text-purple-400" />
                <span>{isAr ? 'الوكيل البرمجي الذكي' : 'Autonomous Agent'}</span>
              </button>

              {/* Deep Research & Books Intelligence Button */}
              <button
                type="button"
                data-testid="deep-research-open-button"
                onClick={() => onOpenModal('deep-research')}
                aria-label={isAr ? 'البحث ودراسة الكتب' : 'Deep Research & Books'}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/35 text-[11px] font-semibold text-indigo-300 transition-colors cursor-pointer"
              >
                <BookOpen className="w-3 h-3 text-indigo-400" />
                <span>{isAr ? 'البحث ودراسة الكتب' : 'Deep Research & Books'}</span>
              </button>

              {/* Deep Think 32k Toggle Button */}
              <button
                type="button"
                onClick={() => {
                  const next = !deepThink32k;
                  setDeepThink32k(next);
                  onNotify(
                    'info',
                    next
                      ? isAr
                        ? 'تم تفعيل وضع التفكير العميق'
                        : 'Enabled Deep Think 32k mode'
                      : isAr
                        ? 'تم إيقاف وضع التفكير العميق'
                        : 'Disabled Deep Think 32k mode'
                  );
                }}
                aria-pressed={deepThink32k}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer border ${deepThink32k
                  ? 'bg-purple-500/20 text-purple-200 border-purple-500/45 shadow-[0_0_12px_rgba(168,85,247,0.25)]'
                  : 'bg-white/[0.04] border-white/10 text-zinc-300 hover:text-white hover:bg-white/[0.08]'
                  }`}
              >
                <BrainCircuit className="w-3 h-3 text-purple-400" />
                <span>{isAr ? 'التفكير العميق' : 'Deep Think 32k'}</span>
              </button>

              {/* Theme Palette */}
              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    setShowStyleMenu(!showStyleMenu);
                    setShowAttachMenu(false);
                    setShowModelMenu(false);
                  }}
                  aria-label={isAr ? 'نمط التصميم والألوان' : 'Theme palette'}
                  className="inline-flex items-center gap-1 h-7 px-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] border border-white/10 text-[11px] text-zinc-300 hover:text-white transition-colors cursor-pointer"
                >
                  <Palette className="w-3 h-3" />
                  <ChevronDown className="w-2.5 h-2.5 opacity-60" />
                </button>
                {showStyleMenu && (
                  <div className="absolute top-8 start-0 w-52 rounded-xl bg-[#14161d] border border-white/12 shadow-2xl p-1.5 z-50 space-y-1 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setDesignStyle('cosmic-dark');
                        setShowStyleMenu(false);
                      }}
                      className="w-full text-start px-3 py-2 rounded-lg hover:bg-white/8 flex items-center justify-between cursor-pointer"
                    >
                      <span>Bolt Cosmic Blue</span>
                      {designStyle === 'cosmic-dark' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDesignStyle('enterprise-blue');
                        setShowStyleMenu(false);
                      }}
                      className="w-full text-start px-3 py-2 rounded-lg hover:bg-white/8 flex items-center justify-between cursor-pointer"
                    >
                      <span>Enterprise Cyan Slate</span>
                      {designStyle === 'enterprise-blue' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDesignStyle('clean-slate');
                        setShowStyleMenu(false);
                      }}
                      className="w-full text-start px-3 py-2 rounded-lg hover:bg-white/8 flex items-center justify-between cursor-pointer"
                    >
                      <span>Minimal Obsidian</span>
                      {designStyle === 'clean-slate' && <CheckCircle2 className="w-3.5 h-3.5 text-blue-400" />}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right side helper buttons: Plan Mode, Voice Recording */}
            <div className="flex items-center gap-1.5">
              {/* Plan Mode Button */}
              <button
                type="button"
                onClick={() => {
                  const next = !planMode;
                  setPlanMode(next);
                  onNotify(
                    'info',
                    next
                      ? isAr
                        ? 'تم تفعيل وضع الخطة المعمارية'
                        : 'Enabled Architectural Plan mode'
                      : isAr
                        ? 'تم إيقاف وضع الخطة المعمارية'
                        : 'Disabled Architectural Plan mode'
                  );
                }}
                aria-pressed={planMode}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer border ${planMode
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  : 'bg-white/[0.04] border-white/10 text-zinc-300 hover:text-white hover:bg-white/[0.08]'
                  }`}
              >
                <Lightbulb className="w-3 h-3 text-amber-400" />
                <span>{isAr ? 'الخطة المعمارية' : 'Plan'}</span>
              </button>

              {/* Voice Recording Button */}
              <button
                type="button"
                onClick={toggleVoiceRecording}
                aria-label={isAr ? 'التسجيل الصوتي' : 'Voice Recording'}
                className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-lg text-[11px] font-medium transition-colors cursor-pointer border ${isRecordingVoice
                  ? 'bg-rose-500/25 text-rose-200 border-rose-500/45'
                  : 'bg-white/[0.04] border-white/10 text-zinc-300 hover:text-white hover:bg-white/[0.08]'
                  }`}
              >
                <Mic className="w-3 h-3 text-rose-400" />
                <span>
                  {isRecordingVoice
                    ? isAr
                      ? 'إيقاف التسجيل'
                      : 'Stop Mic'
                    : isAr
                      ? 'صوتي'
                      : 'Voice'}
                </span>
              </button>
            </div>
          </div>
        </form>

        {/* 4 Quick Starters (بطاقات البدء السريع): Website, Slides (New), App, Prototype */}
        <div className="flex flex-wrap items-center justify-center gap-5 mt-8">
          {[
            {
              id: 'website' as ProjectCategory,
              labelEn: 'Website',
              labelAr: 'مواقع الويب',
              icon: Globe,
              promptEn:
                'Build a modern SaaS marketing website with interactive pricing calculator and customer portal',
              promptAr:
                'ابنِ موقع ويب احترافي متكامل مع حاسبة أسعار تفاعلية وبوابة عملاء باللغتين العربية والإنجليزية',
            },
            {
              id: 'slides' as ProjectCategory,
              labelEn: 'Slides',
              labelAr: 'العروض التقديمية',
              icon: Presentation,
              isNew: true,
              promptEn:
                'Create an interactive executive pitch deck with live financial metrics and cohort charts',
              promptAr:
                'أنشئ عرضاً تقديمياً تفاعلياً للمستثمرين مع مؤشرات مالية ورسوم بيانية حية',
            },
            {
              id: 'app' as ProjectCategory,
              labelEn: 'App',
              labelAr: 'التطبيقات المتكاملة',
              icon: Smartphone,
              promptEn:
                'Build a full-stack ERP & inventory management web app with PostgreSQL tables and role permissions',
              promptAr:
                'ابنِ تطبيق إدارة موارد ومخزون سحابي متكامل مع جداول قاعدة بيانات وصلاحيات المستخدمين',
            },
            {
              id: 'prototype' as ProjectCategory,
              labelEn: 'Prototype',
              labelAr: 'النماذج الأولية',
              icon: FlaskConical,
              promptEn:
                'Create an interactive clinical workflow prototype with real-time patient queue simulation',
              promptAr:
                'أنشئ نموذجاً أولياً تفاعلياً لإدارة العيادات مع محاكاة فورية لطوابير المراجعين',
            },
          ].map((item) => {
            const Icon = item.icon;
            const active = selectedCategory === item.id;
            return (
              <div key={item.id} className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleQuickCategorySelect(item.id, item.promptEn, item.promptAr)}
                  aria-label={isAr ? item.labelAr : item.labelEn}
                  className={`relative w-16 h-16 rounded-2xl flex items-center justify-center border transition-all cursor-pointer ${active
                    ? 'bg-blue-600/20 border-blue-500/60 text-white shadow-[0_0_25px_rgba(37,99,235,0.25)]'
                    : 'bg-[#12141c]/90 border-white/10 text-zinc-300 hover:border-white/25 hover:text-white'
                    }`}
                >
                  {item.isNew && (
                    <span className="absolute -top-2 -end-2 bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md shadow">
                      {isAr ? 'جديد' : 'New'}
                    </span>
                  )}
                  <Icon className="w-6 h-6 stroke-[1.75]" />
                </button>
                <span className="text-xs font-medium text-zinc-300">
                  {isAr ? item.labelAr : item.labelEn}
                </span>
              </div>
            );
          })}
        </div>

        {/* Start From Options (خيارات البدء من): Figma, GitHub, Team template */}
        <div className="flex flex-wrap items-center justify-center gap-2.5 mt-7 text-xs text-zinc-400">
          <span>{isAr ? 'أو ابدأ من:' : 'or start from'}</span>
          <button
            type="button"
            onClick={() => onOpenModal('import-project', { source: 'figma' })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#151720] hover:bg-[#1e212d] border border-white/10 text-zinc-200 font-medium transition-colors cursor-pointer"
          >
            <Figma className="w-3.5 h-3.5 text-pink-400" />
            <span>{isAr ? 'تصاميم Figma' : 'Figma'}</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenModal('import-project', { source: 'github' })}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#151720] hover:bg-[#1e212d] border border-white/10 text-zinc-200 font-medium transition-colors cursor-pointer"
          >
            <Github className="w-3.5 h-3.5 text-zinc-100" />
            <span>{isAr ? 'مستودعات GitHub' : 'GitHub'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setBlueprintCategoryFilter('all');
              setIsBlueprintsModalOpen(true);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#151720] hover:bg-[#1e212d] border border-white/10 text-zinc-200 font-medium transition-colors cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-sky-400" />
            <span>{isAr ? 'قوالب الفريق' : 'Team template'}</span>
          </button>
        </div>
      </main>

      {/* Bottom Recently Viewed Projects Section */}
      <section
        aria-label="Recently viewed projects"
        className="relative z-10 max-w-6xl w-full mx-auto px-6 pt-6 pb-8"
      >
        <div className="rounded-2xl bg-[#101116]/95 border border-white/10 p-6 shadow-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold text-white">
                {isAr ? 'المشاريع الحديثة' : 'Recently viewed'}
              </h2>
              <button
                type="button"
                onClick={() => onOpenModal('open-project')}
                className="inline-flex items-center gap-1 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
              >
                <span>{isAr ? 'عرض جميع المشاريع' : 'View all'}</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => onSwitchView('published')}
                className="text-xs text-zinc-300 hover:text-white px-2.5 py-1 rounded-lg bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
              >
                {isAr ? 'التطبيقات المنشورة' : 'Published Apps'} (
                {projects.filter((p) => p.status === 'deployed').length})
              </button>
              <button
                type="button"
                onClick={() => onSwitchView('registry')}
                className="text-xs text-emerald-400 hover:text-emerald-300 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 transition-colors cursor-pointer"
              >
                {isAr ? 'سجل واختبار الأزرار (22/22)' : 'Button Registry (22/22)'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {projects
              .filter((p) => !p.archived)
              .slice(0, 3)
              .map((proj) => {
                const isRenaming = renamingProjectId === proj.id;
                const isConfirmingDelete = deletingProjectId === proj.id;
                const isCloning = cloningProjectId === proj.id;

                return (
                  <div
                    key={proj.id}
                    className="group rounded-xl bg-[#161821] border border-white/10 hover:border-blue-500/40 p-4 flex flex-col justify-between transition-all"
                  >
                    <div>
                      {/* Live Project Card Preview Header with Tech Stack & Status */}
                      <div className="h-28 rounded-lg bg-gradient-to-br from-blue-950/70 via-slate-900 to-zinc-950 border border-white/10 p-3 mb-3 flex flex-col justify-between">
                        <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                          <span className="px-2 py-0.5 rounded bg-white/8 text-sky-300 truncate">
                            {proj.techStack}
                          </span>
                          <span className="px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400 uppercase shrink-0">
                            {proj.status}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <div className="text-xs font-bold text-white truncate">{proj.name}</div>
                          <div className="text-[11px] text-zinc-400 font-mono truncate">
                            {proj.deployments[0]?.url || `https://${proj.id}.bolt.new.app`}
                          </div>
                        </div>
                      </div>

                      {/* Inline Rename Form if active */}
                      {isRenaming ? (
                        <div className="mb-3 p-2 rounded-lg bg-black/50 border border-blue-500/40 space-y-2">
                          <label className="block text-[11px] text-zinc-300">
                            {isAr ? 'الاسم الجديد للمشروع:' : 'New project name:'}
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="text"
                              value={renameDraft}
                              onChange={(e) => setRenameDraft(e.target.value)}
                              aria-label={isAr ? 'اسم المشروع الجديد' : 'New project name'}
                              className="flex-1 bg-[#12141c] border border-white/15 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-blue-400"
                            />
                            <button
                              type="button"
                              onClick={() => handleConfirmRename(proj)}
                              className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1 cursor-pointer"
                            >
                              <Check className="w-3 h-3" />
                              <span>{isAr ? 'حفظ' : 'Save'}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => setRenamingProjectId(null)}
                              className="px-2 py-1 rounded bg-white/10 hover:bg-white/15 text-zinc-300 text-xs cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-zinc-400 line-clamp-2 mb-3">{proj.description}</p>
                      )}

                      {/* Inline Delete Confirmation if active */}
                      {isConfirmingDelete && (
                        <div className="mb-3 p-2.5 rounded-lg bg-rose-950/60 border border-rose-500/40 flex items-center justify-between gap-2 text-xs">
                          <span className="text-rose-200 font-medium">
                            {isAr ? 'تأكيد حذف هذا المشروع؟' : 'Confirm deleting this project?'}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setDeletingProjectId(null);
                                onDeleteProject(proj.id);
                              }}
                              className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white font-semibold cursor-pointer"
                            >
                              {isAr ? 'تأكيد الحذف' : 'Confirm'}
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeletingProjectId(null)}
                              className="px-2 py-1 rounded bg-white/10 text-zinc-200 cursor-pointer"
                            >
                              {isAr ? 'إلغاء' : 'Cancel'}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Metadata & 4 Direct Card Action Buttons: Open (فتح), Clone (استنساخ), Rename (تغيير الاسم), Delete (حذف) */}
                    <div className="pt-2.5 border-t border-white/10 space-y-2.5">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400 font-mono tabular-nums">
                        <span>
                          {proj.files.length} {isAr ? 'ملفات' : 'files'} · {proj.dbTables.length}{' '}
                          {isAr ? 'جداول' : 'tables'}
                        </span>
                        <span>{new Date(proj.updatedAt).toLocaleDateString()}</span>
                      </div>

                      <div className="grid grid-cols-4 gap-1.5 text-[11px]">
                        {/* 1. Open (فتح) */}
                        <button
                          type="button"
                          onClick={() => onSelectProject(proj, true)}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors cursor-pointer"
                        >
                          <FolderOpen className="w-3 h-3 shrink-0" />
                          <span className="truncate">{isAr ? 'فتح' : 'Open'}</span>
                        </button>

                        {/* 2. Clone / Duplicate (استنساخ) */}
                        <button
                          type="button"
                          disabled={isCloning}
                          onClick={() => handleCloneCard(proj.id)}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-zinc-200 font-medium transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {isCloning ? (
                            <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                          ) : (
                            <Copy className="w-3 h-3 text-sky-400 shrink-0" />
                          )}
                          <span className="truncate">{isAr ? 'استنساخ' : 'Clone'}</span>
                        </button>

                        {/* 3. Rename (تغيير الاسم) */}
                        <button
                          type="button"
                          onClick={() => handleStartRename(proj)}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/10 text-zinc-200 font-medium transition-colors cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3 text-amber-400 shrink-0" />
                          <span className="truncate">{isAr ? 'تسمية' : 'Rename'}</span>
                        </button>

                        {/* 4. Delete (حذف) */}
                        <button
                          type="button"
                          onClick={() => {
                            setDeletingProjectId(proj.id);
                            setRenamingProjectId(null);
                          }}
                          className="inline-flex items-center justify-center gap-1 px-2 py-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 text-rose-300 font-medium transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3 h-3 text-rose-400 shrink-0" />
                          <span className="truncate">{isAr ? 'حذف' : 'Delete'}</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      </section>

      {/* 8 Golden Blueprints Modal */}
      {isBlueprintsModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn"
          role="dialog"
          aria-modal="true"
          aria-label={isAr ? 'القوالب الذهبية الثمانية' : '8 Golden Blueprints'}
        >
          <div className="relative w-full max-w-4xl max-h-[90vh] bg-[#0E131F] border border-white/15 rounded-2xl p-6 shadow-2xl flex flex-col overflow-hidden text-white">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-white/10 shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center text-blue-400">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    {isAr ? 'القوالب الذهبية الثمانية المعمارية' : '8 Golden Architectural Blueprints'}
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30">
                      {isAr ? 'جاهزة للتشغيل الفوري' : 'Ready to Run'}
                    </span>
                  </h3>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {isAr
                      ? 'اختر أحد النماذج الهندسية الثمانية لبنائها وتشغيلها مباشرة بكامل ميزاتها وقاعدة بياناتها'
                      : 'Select any of the 8 production blueprints to synthesize and launch with live preview and database'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBlueprintsModalOpen(false)}
                aria-label={isAr ? 'إغلاق' : 'Close'}
                className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-400 hover:text-white flex items-center justify-center cursor-pointer transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-2 py-3 overflow-x-auto shrink-0 border-b border-white/5">
              {[
                { id: 'all', labelAr: 'جميع القوالب (8)', labelEn: 'All Blueprints (8)' },
                { id: 'app', labelAr: 'التطبيقات المتكاملة (3)', labelEn: 'Full Apps (3)' },
                { id: 'prototype', labelAr: 'النماذج والمزادات (2)', labelEn: 'Prototypes (2)' },
                { id: 'website', labelAr: 'المواقع والأرشيف (2)', labelEn: 'Websites & Archive (2)' },
                { id: 'slides', labelAr: 'الذكاء الاصطناعي وSaaS (1)', labelEn: 'AI & SaaS (1)' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setBlueprintCategoryFilter(tab.id as typeof blueprintCategoryFilter)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${blueprintCategoryFilter === tab.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'
                    }`}
                >
                  {isAr ? tab.labelAr : tab.labelEn}
                </button>
              ))}
            </div>

            {/* Blueprints Cards Grid */}
            <div className="flex-1 overflow-y-auto py-4 grid grid-cols-1 md:grid-cols-2 gap-3.5 pr-1">
              {GOLDEN_BLUEPRINTS.filter(
                (bp) => blueprintCategoryFilter === 'all' || bp.category === blueprintCategoryFilter
              ).map((bp) => (
                <div
                  key={bp.id}
                  className="p-4 rounded-xl bg-[#131826] border border-white/10 hover:border-blue-500/50 transition-all flex flex-col justify-between group"
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-blue-500/15 text-blue-300 border border-blue-500/20">
                        {isAr ? bp.badgeAr : bp.badgeEn}
                      </span>
                      <span className="text-[10px] text-zinc-500 font-mono uppercase">{bp.tag}</span>
                    </div>
                    <h4 className="text-sm font-bold text-white group-hover:text-blue-400 transition-colors">
                      {isAr ? bp.titleAr : bp.titleEn}
                    </h4>
                    <p className="text-xs text-zinc-400 mt-1.5 line-clamp-2 leading-relaxed">
                      {isAr ? bp.descAr : bp.descEn}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => handleLaunchBlueprint(bp)}
                      className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition-all shadow-md cursor-pointer"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>{isAr ? 'تشغيل هذا القالب فوراً' : 'Launch Blueprint Now'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
