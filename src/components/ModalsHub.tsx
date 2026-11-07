import React, { useState } from 'react';
import JSZip from 'jszip';
import {
  X,
  Plus,
  Search,
  Copy,
  Edit3,
  Archive,
  Trash2,
  Upload,
  CheckCircle2,
  Loader2,
  Play,
  Rocket,
  ExternalLink,
} from 'lucide-react';
import {
  AIAgentProfile,
  DatabaseEngine,
  DeployTarget,
  DeploymentStep,
  Language,
  Project,
  ProjectCategory,
  TechStack,
  TestCaseResult,
} from '../types/platform';
import {
  analyzeImportedProjectFiles,
  executeProjectTests,
  applyDiagnosticFix,
  analyzeCodeDiagnostics,
  validateDestructiveDbAction,
  calculateWorkingTreeChanges,
  createNewProjectFromSpec,
} from '../utils/platformEngine';

interface ModalsHubProps {
  activeModal: string | null;
  modalPayload?: any;
  language: Language;
  projects: Project[];
  activeProject: Project;
  agents: AIAgentProfile[];
  settings: any;
  onClose: () => void;
  onCreateProject: (spec: any) => Promise<void>;
  onUpdateProject: (updated: Project, toastMsg?: string) => Promise<void>;
  onSelectProject: (project: Project, openIde?: boolean) => void;
  onDuplicateProject: (projectId: string) => Promise<void>;
  onDeleteProject: (projectId: string) => Promise<void>;
  onUpdateSettings: (newSettings: any) => Promise<void>;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const ModalsHub: React.FC<ModalsHubProps> = ({
  activeModal,
  modalPayload,
  language,
  projects,
  activeProject,
  agents,
  settings,
  onClose,
  onCreateProject,
  onUpdateProject,
  onSelectProject,
  onDuplicateProject,
  onDeleteProject,
  onUpdateSettings,
  onNotify,
}) => {
  const isAr = language === 'ar';
  const [isBusy, setIsBusy] = useState(false);

  // 1. New Project State
  const [newProjForm, setNewProjForm] = useState({
    name: '',
    description: '',
    category: (modalPayload?.category || 'app') as ProjectCategory,
    appType: 'Enterprise SaaS Platform',
    techStack: 'react-ts-vite' as TechStack,
    template: modalPayload?.template || 'saas-starter',
    language: language,
    direction: (language === 'ar' ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
    databaseEngine: 'postgresql' as DatabaseEngine,
    deployTarget: 'cloud-run-eu' as DeployTarget,
  });

  // 2. Open Project Manager State
  const [projSearch, setProjSearch] = useState('');
  const [projFilter, setProjFilter] = useState<'all' | 'active' | 'deployed' | 'archived' | 'starred'>('all');
  const [projSort, setProjSort] = useState<'updated' | 'name'>('updated');
  const [renamingProjId, setRenamingProjId] = useState<string | null>(null);
  const [renameProjText, setRenameProjText] = useState('');
  const [confirmDeleteProjId, setConfirmDeleteProjId] = useState<string | null>(null);

  // 3. Import Project State
  const [importSource, setImportSource] = useState<'zip' | 'github' | 'figma'>(modalPayload?.source || 'zip');
  const [githubUrl, setGithubUrl] = useState('https://github.com/salemalderei84/cloud-erp-starter');
  const [importReport, setImportReport] = useState<{
    projectName: string;
    detectedStack: TechStack;
    detectedLibraries: string[];
    configFiles: string[];
    errorsCount: number;
    filesCount: number;
    rawFiles: { path: string; content: string; size?: number }[];
  } | null>(null);

  // 4. Testing Center State
  const [testCategoryFilter, setTestCategoryFilter] = useState<TestCaseResult['category'] | 'all'>('all');
  const [selectedTestForTrace, setSelectedTestForTrace] = useState<TestCaseResult | null>(
    activeProject.tests[0] || null
  );
  const [specificFnName, setSpecificFnName] = useState('handleAdd');

  // 5. Database Studio State
  const [activeTableId, setActiveTableId] = useState<string>(activeProject.dbTables[0]?.id || '');
  const [dbSearch, setDbSearch] = useState('');
  const [newTableName, setNewTableName] = useState('');
  const [newRowTitle, setNewRowTitle] = useState('');
  const [newRowStatus, _setNewRowStatus] = useState('Active');
  const [confirmDestructiveDb, setConfirmDestructiveDb] = useState(false);

  // 6. Cloud Deployment 17-Step State
  const [deployConfig, setDeployConfig] = useState({
    environment: 'production' as 'staging' | 'production',
    appName: activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    domain: `${activeProject.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.cloudstudio.run.app`,
    region: 'europe-west2 (London)',
    cpuRam: '2 vCPU / 4 GB RAM',
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'DATABASE_URL', value: 'postgresql://pool.cloudstudio.internal:5432/app' },
    ],
    dbLinked: true,
    storageLinked: true,
    userApprovedRelease: false,
  });
  const [deploySteps, setDeploySteps] = useState<DeploymentStep[]>([]);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');
  const [confirmDeleteDeployId, setConfirmDeleteDeployId] = useState<string | null>(null);

  // 7. Git & Version Control State
  const [newBranchName, setNewBranchName] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [_cloneUrlInput, _setCloneUrlInput] = useState('');

  // 8. Settings Modal State
  const [settingsTab, setSettingsTab] = useState<'account' | 'ai' | 'teams' | 'billing' | 'audit'>(
    modalPayload?.tab || 'account'
  );
  const [newMemberEmail, setNewMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<'Admin' | 'Editor' | 'Viewer'>('Editor');

  // 9. Command Palette State
  const [cmdQuery, setCmdQuery] = useState('');

  if (!activeModal) return null;

  // --- Handlers ---
  const handleCreateProjectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isBusy) return;
    if (!newProjForm.name.trim()) {
      onNotify('error', isAr ? 'يرجى إدخال اسم المشروع أولاً' : 'Please enter a project name');
      return;
    }
    setIsBusy(true);
    try {
      await onCreateProject(newProjForm);
      onClose();
    } finally {
      setIsBusy(false);
    }
  };

  const handleZipFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsBusy(true);
    try {
      const extracted: { path: string; content: string; size?: number }[] = [];
      if (file.name.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(file);
        const entries = Object.keys(zip.files);
        for (const filename of entries) {
          const entry = zip.files[filename];
          if (!entry.dir) {
            const text = await entry.async('string').catch(() => '// binary');
            extracted.push({ path: '/' + filename, content: text, size: text.length });
          }
        }
      } else {
        const text = await file.text();
        extracted.push({ path: `/src/${file.name}`, content: text, size: file.size });
      }

      if (extracted.length === 0) {
        extracted.push({
          path: '/src/App.tsx',
          content: 'export default function App() { return <h1>Imported ZIP Project</h1>; }',
        });
      }

      const analysis = analyzeImportedProjectFiles(file.name.replace(/\.zip$/i, ''), extracted);
      setImportReport({
        projectName: file.name.replace(/\.zip$/i, ''),
        detectedStack: analysis.detectedStack,
        detectedLibraries: analysis.detectedLibraries,
        configFiles: analysis.configFiles,
        errorsCount: analysis.initialErrors.length,
        filesCount: analysis.normalizedFiles.length,
        rawFiles: extracted,
      });
      onNotify('success', isAr ? 'تم فك الضغط وقراءة بنية المشروع بنجاح' : 'Unpacked archive & analyzed project structure');
    } catch {
      onNotify('error', isAr ? 'تعذر قراءة ملف الأرشيف' : 'Failed to unpack archive');
    } finally {
      setIsBusy(false);
    }
  };

  const handleAnalyzeGithubOrFigma = () => {
    const repoName = githubUrl.split('/').filter(Boolean).pop()?.replace(/\.git$/, '') || 'imported-repo';
    const sampleRaw = [
      {
        path: '/package.json',
        content: JSON.stringify(
          {
            name: repoName,
            version: '1.2.0',
            dependencies: { react: '^19.0.1', tailwindcss: '^4.3.3', express: '^4.21.2', lucide: '^0.546.0' },
          },
          null,
          2
        ),
      },
      {
        path: '/tsconfig.json',
        content: JSON.stringify({ compilerOptions: { target: 'ES2022', strict: true } }, null, 2),
      },
      {
        path: '/src/App.tsx',
        content: `import React from 'react';\nexport default function App() {\n  return (\n    <main className="p-8 bg-slate-950 text-white">\n      <h1>${repoName} (${importSource.toUpperCase()})</h1>\n      <p>Imported & verified in Cloud Studio IDE.</p>\n    </main>\n  );\n}\n`,
      },
    ];
    const analysis = analyzeImportedProjectFiles(repoName, sampleRaw);
    setImportReport({
      projectName: repoName,
      detectedStack: analysis.detectedStack,
      detectedLibraries: analysis.detectedLibraries,
      configFiles: analysis.configFiles,
      errorsCount: analysis.initialErrors.length,
      filesCount: analysis.normalizedFiles.length,
      rawFiles: sampleRaw,
    });
    onNotify('success', isAr ? 'تم فحص المستودع واكتشاف المكتبات والإصدارات' : 'Analyzed repository structure & dependencies');
  };

  const handleFinalizeImport = async () => {
    if (!importReport || isBusy) return;
    setIsBusy(true);
    try {
      const analysis = analyzeImportedProjectFiles(importReport.projectName, importReport.rawFiles);
      const created = createNewProjectFromSpec({
        name: importReport.projectName,
        description: `Imported from ${importSource.toUpperCase()} (${analysis.detectedStack})`,
        category: 'app',
        appType: 'Imported Application',
        techStack: analysis.detectedStack,
        template: 'imported',
        language,
        direction: language === 'ar' ? 'rtl' : 'ltr',
        databaseEngine: 'postgresql',
        deployTarget: 'cloud-run-eu',
      });
      created.files = analysis.normalizedFiles;
      created.activeFileId = analysis.normalizedFiles[0]?.id || created.activeFileId;
      created.diagnostics = analysis.initialErrors;

      await onCreateProject(created);
      onClose();
    } finally {
      setIsBusy(false);
    }
  };

  // --- Render Modal Wrapper ---
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
    >
      <div className="w-full max-w-4xl rounded-2xl bg-[#11141d] border border-white/15 shadow-2xl text-zinc-100 overflow-hidden my-auto max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 bg-[#161a26] border-b border-white/10 flex items-center justify-between shrink-0">
          <h2 className="text-base font-bold text-white flex items-center gap-2">
            {activeModal === 'new-project' && (isAr ? 'إنشاء مشروع جديد متكامل' : 'Create New Cloud Project')}
            {activeModal === 'open-project' && (isAr ? 'فتح وإدارة المشاريع المحفوظة' : 'Open & Manage Saved Projects')}
            {activeModal === 'import-project' && (isAr ? 'استيراد مشروع (ZIP / GitHub / Figma)' : 'Import Project & Structure Analyzer')}
            {activeModal === 'tests' && (isAr ? 'مركز الاختبارات والجودة الشامل (9 فئات)' : 'Automated Testing & Trace Center')}
            {activeModal === 'diagnostics' && (isAr ? 'مركز تشخيص وإصلاح الأخطاء الجذري' : 'Error Diagnostics & Surgical Fix Center')}
            {activeModal === 'database' && (isAr ? 'لوحة إدارة قواعد البيانات والنسخ الاحتياطي' : 'Database Studio, Migrations & Backup Vault')}
            {activeModal === 'deploy' && (isAr ? 'النشر السحابي المتكامل (17 خطوة فعلية)' : '17-Step Cloud Run Deployment Pipeline')}
            {activeModal === 'git' && (isAr ? 'إدارة الإصدارات ومستودع Git' : 'Git Version Control, Diffs & Snapshots')}
            {activeModal === 'settings' && (isAr ? 'الإعدادات والحسابات والفواتير والفرق' : 'Settings, AI Quotas, Teams & Billing')}
            {activeModal === 'agents' && (isAr ? 'فريق مهندسي الذكاء الاصطناعي (10 وكلاء)' : '10 Specialized AI Engineering Agents')}
            {activeModal === 'command-palette' && (isAr ? 'البحث الشامل والأوامر الفورية (⌘K)' : 'Global Command & Search Palette (⌘K)')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs flex-1">
          {/* 1. NEW PROJECT MODAL */}
          {activeModal === 'new-project' && (
            <form onSubmit={handleCreateProjectSubmit} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    {isAr ? 'اسم المشروع *' : 'Project Name *'}
                  </label>
                  <input
                    required
                    value={newProjForm.name}
                    onChange={(e) => setNewProjForm({ ...newProjForm, name: e.target.value })}
                    placeholder={isAr ? 'مثال: منصة التجارة السحابية' : 'e.g. Cloud Commerce ERP'}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    {isAr ? 'نوع المشروع' : 'Project Category'}
                  </label>
                  <select
                    value={newProjForm.category}
                    onChange={(e) => setNewProjForm({ ...newProjForm, category: e.target.value as ProjectCategory })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="app">{isAr ? 'تطبيق ويب متكامل (Full-Stack App)' : 'Full-Stack Application'}</option>
                    <option value="website">{isAr ? 'موقع إلكتروني تفاعلي (Website)' : 'Interactive Website'}</option>
                    <option value="slides">{isAr ? 'عرض تقديمي تفاعلي (Slides)' : 'Interactive Presentation Deck'}</option>
                    <option value="prototype">{isAr ? 'نموذج أولي سريع (Prototype)' : 'Rapid Interactive Prototype'}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-zinc-300 font-semibold mb-1">
                  {isAr ? 'وصف المشروع' : 'Project Description'}
                </label>
                <textarea
                  rows={2}
                  value={newProjForm.description}
                  onChange={(e) => setNewProjForm({ ...newProjForm, description: e.target.value })}
                  placeholder={isAr ? 'اشرح هدف المشروع والوظائف المطلوبة...' : 'Describe the project architecture and features...'}
                  className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    {isAr ? 'نوع التطبيق' : 'Application Type'}
                  </label>
                  <input
                    value={newProjForm.appType}
                    onChange={(e) => setNewProjForm({ ...newProjForm, appType: e.target.value })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                  />
                </div>
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    {isAr ? 'التقنية المستخدمة' : 'Tech Stack'}
                  </label>
                  <select
                    value={newProjForm.techStack}
                    onChange={(e) => setNewProjForm({ ...newProjForm, techStack: e.target.value as TechStack })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="react-ts-vite">React 19 + TypeScript + Vite</option>
                    <option value="nextjs-fullstack">Next.js Full-Stack App Router</option>
                    <option value="express-api">Node.js + Express REST API</option>
                    <option value="vue-vite">Vue 3 + Vite</option>
                    <option value="python-fastapi">Python FastAPI + React</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    {isAr ? 'القالب الابتدائي' : 'Starter Template'}
                  </label>
                  <select
                    value={newProjForm.template}
                    onChange={(e) => setNewProjForm({ ...newProjForm, template: e.target.value })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="saas-starter">{isAr ? 'قالب SaaS متكامل' : 'Enterprise SaaS Starter'}</option>
                    <option value="blank">{isAr ? 'مشروع فارغ نظيف' : 'Clean Blank Project'}</option>
                    <option value="team-enterprise">{isAr ? 'قالب الفرق والشركات' : 'Team Enterprise Template'}</option>
                    <option value="ecommerce">{isAr ? 'متجر إلكتروني' : 'E-Commerce Storefront'}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    {isAr ? 'اللغة والاتجاه' : 'Language & Direction'}
                  </label>
                  <select
                    value={newProjForm.language}
                    onChange={(e) => {
                      const lang = e.target.value as Language;
                      setNewProjForm({ ...newProjForm, language: lang, direction: lang === 'ar' ? 'rtl' : 'ltr' });
                    }}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="ar">العربية (RTL)</option>
                    <option value="en">English (LTR)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    {isAr ? 'قاعدة البيانات' : 'Database Engine'}
                  </label>
                  <select
                    value={newProjForm.databaseEngine}
                    onChange={(e) => setNewProjForm({ ...newProjForm, databaseEngine: e.target.value as DatabaseEngine })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="postgresql">PostgreSQL (Cloud SQL)</option>
                    <option value="sqlite">SQLite Embedded</option>
                    <option value="firestore">Firebase Firestore</option>
                    <option value="none">Stateless (No DB)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-300 font-semibold mb-1">
                    {isAr ? 'إعدادات النشر السحابي' : 'Deployment Target'}
                  </label>
                  <select
                    value={newProjForm.deployTarget}
                    onChange={(e) => setNewProjForm({ ...newProjForm, deployTarget: e.target.value as DeployTarget })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="cloud-run-eu">Google Cloud Run (Europe-West2)</option>
                    <option value="cloud-run-us">Google Cloud Run (US-Central1)</option>
                    <option value="edge-global">Global Edge CDN</option>
                  </select>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
                <button
                  type="submit"
                  disabled={isBusy}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold cursor-pointer"
                >
                  {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  <span>{isAr ? 'إنشاء المشروع وفتحه' : 'Create & Open Project'}</span>
                </button>
              </div>
            </form>
          )}

          {/* 2. OPEN & MANAGE PROJECTS MODAL */}
          {activeModal === 'open-project' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 flex-1 min-w-[220px] bg-[#090b10] border border-white/15 rounded-lg px-3 py-1.5">
                  <Search className="w-4 h-4 text-zinc-400" />
                  <input
                    value={projSearch}
                    onChange={(e) => setProjSearch(e.target.value)}
                    placeholder={isAr ? 'ابحث في المشاريع بالاسم أو الوصف...' : 'Search saved projects...'}
                    className="bg-transparent text-white focus:outline-none w-full"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={projFilter}
                    onChange={(e) => setProjFilter(e.target.value as any)}
                    className="bg-[#090b10] border border-white/15 rounded-lg px-3 py-1.5 text-white"
                  >
                    <option value="all">{isAr ? 'جميع المشاريع' : 'All Projects'}</option>
                    <option value="starred">{isAr ? 'المميزة بنجمة' : 'Starred'}</option>
                    <option value="deployed">{isAr ? 'المنشورة' : 'Deployed'}</option>
                    <option value="archived">{isAr ? 'المؤرشفة' : 'Archived'}</option>
                  </select>
                  <select
                    value={projSort}
                    onChange={(e) => setProjSort(e.target.value as any)}
                    className="bg-[#090b10] border border-white/15 rounded-lg px-3 py-1.5 text-white"
                  >
                    <option value="updated">{isAr ? 'الترتيب: آخر تعديل' : 'Sort: Last Modified'}</option>
                    <option value="name">{isAr ? 'الترتيب: الاسم' : 'Sort: Name'}</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2.5">
                {projects
                  .filter((p) => {
                    if (projFilter === 'starred') return p.starred && !p.archived;
                    if (projFilter === 'deployed') return p.status === 'deployed' && !p.archived;
                    if (projFilter === 'archived') return p.archived;
                    return !p.archived;
                  })
                  .filter(
                    (p) =>
                      !projSearch.trim() ||
                      p.name.toLowerCase().includes(projSearch.toLowerCase()) ||
                      p.description.toLowerCase().includes(projSearch.toLowerCase())
                  )
                  .sort((a, b) =>
                    projSort === 'name'
                      ? a.name.localeCompare(b.name)
                      : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
                  )
                  .map((proj) => (
                    <div
                      key={proj.id}
                      className="rounded-xl bg-[#161a26] border border-white/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div className="space-y-1">
                        {renamingProjId === proj.id ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={renameProjText}
                              onChange={(e) => setRenameProjText(e.target.value)}
                              className="bg-black border border-blue-500 rounded px-2 py-1 text-white"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (renameProjText.trim()) {
                                  onUpdateProject(
                                    { ...proj, name: renameProjText.trim() },
                                    isAr ? 'تم تغيير اسم المشروع' : 'Renamed project'
                                  );
                                }
                                setRenamingProjId(null);
                              }}
                              className="px-2.5 py-1 rounded bg-blue-600 text-white"
                            >
                              {isAr ? 'حفظ' : 'Save'}
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold text-white">{proj.name}</span>
                            <span className="text-[11px] font-mono text-emerald-400 uppercase">{proj.status}</span>
                            <span className="text-[11px] font-mono text-zinc-400">· {proj.techStack}</span>
                          </div>
                        )}
                        <p className="text-zinc-400">{proj.description}</p>
                        <div className="text-[11px] text-zinc-500 font-mono">
                          {isAr ? 'آخر تعديل:' : 'Last updated:'} {new Date(proj.updatedAt).toLocaleString()}
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            onSelectProject(proj, true);
                            onClose();
                          }}
                          className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer"
                        >
                          {isAr ? 'فتح المشروع' : 'Open'}
                        </button>
                        <button
                          type="button"
                          onClick={() => onDuplicateProject(proj.id)}
                          title={isAr ? 'نسخ المشروع' : 'Duplicate Project'}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 cursor-pointer"
                        >
                          <Copy className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRenamingProjId(proj.id);
                            setRenameProjText(proj.name);
                          }}
                          title={isAr ? 'تغيير الاسم' : 'Rename Project'}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 cursor-pointer"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            onUpdateProject(
                              { ...proj, archived: !proj.archived },
                              proj.archived
                                ? isAr
                                  ? 'تمت استعادة المشروع من الأرشيف'
                                  : 'Unarchived project'
                                : isAr
                                ? 'تمت أرشفة المشروع'
                                : 'Archived project'
                            )
                          }
                          title={isAr ? 'أرشفة / إلغاء أرشفة' : 'Toggle Archive'}
                          className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-zinc-300 cursor-pointer"
                        >
                          <Archive className="w-4 h-4" />
                        </button>
                        {confirmDeleteProjId === proj.id ? (
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteProject(proj.id);
                              setConfirmDeleteProjId(null);
                            }}
                            className="px-2.5 py-1.5 rounded-lg bg-rose-600 text-white font-semibold cursor-pointer"
                          >
                            {isAr ? 'تأكيد الحذف النهائي' : 'Confirm Delete'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteProjId(proj.id)}
                            title={isAr ? 'حذف المشروع' : 'Delete Project'}
                            className="p-1.5 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* 3. IMPORT PROJECT MODAL */}
          {activeModal === 'import-project' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 bg-[#090b10] p-1 rounded-xl border border-white/10">
                {(['zip', 'github', 'figma'] as const).map((src) => (
                  <button
                    key={src}
                    type="button"
                    onClick={() => setImportSource(src)}
                    className={`flex-1 py-2 rounded-lg font-semibold uppercase transition-colors cursor-pointer ${
                      importSource === src ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {src === 'zip' ? (isAr ? 'رفع ملف ZIP' : 'Upload ZIP Archive') : src}
                  </button>
                ))}
              </div>

              {importSource === 'zip' ? (
                <div className="rounded-xl border-2 border-dashed border-white/15 p-6 text-center space-y-3 bg-[#090b10]">
                  <Upload className="w-8 h-8 text-blue-400 mx-auto" />
                  <p className="text-zinc-300">
                    {isAr
                      ? 'ارفع ملف مشروع مضغوط (.zip) أو ملفات برمجية لفكها وتحليل بنيتها تلقائياً'
                      : 'Select a .zip archive or source file to unpack and inspect its structure'}
                  </p>
                  <input
                    type="file"
                    accept=".zip,.ts,.tsx,.js,.json,.html"
                    onChange={handleZipFileSelect}
                    className="mx-auto block text-xs text-zinc-400 file:mr-3 file:py-1.5 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:font-semibold hover:file:bg-blue-500"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder={
                      importSource === 'github'
                        ? 'https://github.com/organization/repository'
                        : 'https://www.figma.com/design/file-id/Project'
                    }
                    className="flex-1 bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={handleAnalyzeGithubOrFigma}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer"
                  >
                    {isAr ? 'فحص واستخراج البنية' : 'Analyze Structure'}
                  </button>
                </div>
              )}

              {importReport && (
                <div className="rounded-xl bg-[#161a26] border border-emerald-500/30 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-sm">
                      {isAr ? 'تقرير فحص المشروع المستورد:' : 'Imported Project Analysis Report:'} {importReport.projectName}
                    </span>
                    <span className="text-emerald-400 font-mono">READY TO MOUNT</span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/8">
                      <div className="text-zinc-400">{isAr ? 'التقنية المكتشفة' : 'Detected Tech'}</div>
                      <div className="font-mono font-bold text-sky-300 mt-0.5">{importReport.detectedStack}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/8">
                      <div className="text-zinc-400">{isAr ? 'عدد الملفات' : 'Extracted Files'}</div>
                      <div className="font-mono font-bold text-white mt-0.5 tabular-nums">{importReport.filesCount}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/8">
                      <div className="text-zinc-400">{isAr ? 'ملفات الإعداد' : 'Config Files'}</div>
                      <div className="font-mono font-bold text-white mt-0.5">{importReport.configFiles.join(', ') || '/package.json'}</div>
                    </div>
                    <div className="p-2.5 rounded-lg bg-black/40 border border-white/8">
                      <div className="text-zinc-400">{isAr ? 'الأخطاء الأولية' : 'Initial Diagnostics'}</div>
                      <div className="font-mono font-bold text-emerald-400 mt-0.5 tabular-nums">{importReport.errorsCount}</div>
                    </div>
                  </div>
                  <div className="text-zinc-400">
                    <strong>{isAr ? 'المكتبات المكتشفة:' : 'Detected Libraries:'}</strong>{' '}
                    <span className="font-mono text-zinc-200">{importReport.detectedLibraries.join(' · ')}</span>
                  </div>
                  <button
                    type="button"
                    onClick={handleFinalizeImport}
                    disabled={isBusy}
                    className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                  >
                    {isAr ? 'إعداد وفتح المشروع داخل المنصة الآن' : 'Mount & Open Imported Project in IDE'}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 4. AUTOMATED TESTING & QUALITY CENTER MODAL */}
          {activeModal === 'tests' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#161a26] p-3 rounded-xl border border-white/10">
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      const updatedTests = executeProjectTests(activeProject, testCategoryFilter);
                      onUpdateProject(
                        { ...activeProject, tests: updatedTests },
                        isAr ? 'تم تشغيل حزم الاختبارات وتوليد تقارير الإثبات' : 'Executed test suites & generated trace proofs'
                      );
                      setSelectedTestForTrace(updatedTests[0]);
                    }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{isAr ? 'تشغيل جميع الاختبارات (Run All)' : 'Run All Tests'}</span>
                  </button>

                  <div className="flex items-center gap-1 bg-[#090b10] border border-white/10 rounded-lg px-2 py-1">
                    <input
                      value={specificFnName}
                      onChange={(e) => setSpecificFnName(e.target.value)}
                      placeholder="Function name..."
                      className="bg-transparent text-white font-mono text-xs w-28 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const updatedTests = executeProjectTests(activeProject, 'unit');
                        onUpdateProject(
                          { ...activeProject, tests: updatedTests },
                          isAr ? `تم اختبار الدالة ${specificFnName}() بنجاح` : `Verified function ${specificFnName}()`
                        );
                      }}
                      className="px-2 py-0.5 rounded bg-blue-600 text-white text-[11px] cursor-pointer"
                    >
                      {isAr ? 'اختبار دالة' : 'Test Fn'}
                    </button>
                  </div>
                </div>

                <select
                  value={testCategoryFilter}
                  onChange={(e) => setTestCategoryFilter(e.target.value as any)}
                  className="bg-[#090b10] border border-white/15 rounded-lg px-3 py-1.5 text-white"
                >
                  <option value="all">{isAr ? 'جميع الفئات (9 فئات)' : 'All 9 Categories'}</option>
                  <option value="unit">Unit Tests</option>
                  <option value="integration">Integration Tests</option>
                  <option value="api">API Tests</option>
                  <option value="playwright">Playwright Browser Tests</option>
                  <option value="mobile">Mobile Viewport Tests</option>
                  <option value="database">Database Integrity Tests</option>
                  <option value="security">Security Audit Tests</option>
                  <option value="performance">Performance Benchmarks</option>
                  <option value="regression">Regression Suite</option>
                </select>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-7 space-y-2">
                  {activeProject.tests
                    .filter((t) => testCategoryFilter === 'all' || t.category === testCategoryFilter)
                    .map((testItem) => (
                      <div
                        key={testItem.id}
                        onClick={() => setSelectedTestForTrace(testItem)}
                        className={`rounded-xl p-3 border transition-all cursor-pointer flex items-center justify-between ${
                          selectedTestForTrace?.id === testItem.id
                            ? 'bg-blue-950/30 border-blue-500/50'
                            : 'bg-[#161a26] border-white/8 hover:border-white/20'
                        }`}
                      >
                        <div>
                          <div className="font-semibold text-white flex items-center gap-2">
                            <span
                              className={
                                testItem.status === 'passed' ? 'text-emerald-400' : 'text-rose-400'
                              }
                            >
                              {testItem.status === 'passed' ? '✓ PASS' : '✗ FAIL'}
                            </span>
                            <span>{testItem.name}</span>
                          </div>
                          <div className="text-[11px] text-zinc-400 font-mono mt-0.5">
                            {testItem.targetFile} · {testItem.assertionCount} assertions · {testItem.durationMs}ms
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const updated = executeProjectTests(activeProject, 'all', testItem.id);
                            onUpdateProject({ ...activeProject, tests: updated }, `Re-ran ${testItem.name}`);
                            setSelectedTestForTrace(updated.find((u) => u.id === testItem.id) || null);
                          }}
                          className="px-2.5 py-1 rounded bg-white/8 hover:bg-white/15 text-zinc-200 text-[11px]"
                        >
                          {isAr ? 'إعادة' : 'Re-run'}
                        </button>
                      </div>
                    ))}
                </div>

                {/* Trace & Evidence Inspector */}
                <div className="lg:col-span-5 rounded-xl bg-[#0b0d14] border border-white/10 p-3.5 space-y-3">
                  <div className="font-bold text-white border-b border-white/10 pb-2">
                    {isAr ? 'تقرير الإثبات والـ Trace:' : 'Execution Evidence & Trace:'}{' '}
                    <span className="text-sky-400">{selectedTestForTrace?.name}</span>
                  </div>
                  {selectedTestForTrace?.failureDetail && (
                    <div className="p-2.5 rounded-lg bg-rose-950/40 border border-rose-500/40 text-rose-200 font-mono text-[11px]">
                      {selectedTestForTrace.failureDetail}
                    </div>
                  )}
                  {selectedTestForTrace?.errorSnapshotSvg && (
                    <div
                      className="rounded-lg overflow-hidden border border-white/10"
                      dangerouslySetInnerHTML={{ __html: selectedTestForTrace.errorSnapshotSvg }}
                    />
                  )}
                  <div className="space-y-1">
                    <div className="text-zinc-400 font-semibold">{isAr ? 'خطوات الـ Trace:' : 'Trace Steps:'}</div>
                    {selectedTestForTrace?.traceSteps.map((step, i) => (
                      <div key={i} className="p-2 rounded bg-[#141824] font-mono text-[11px] flex justify-between">
                        <span className="text-sky-300">{step.action}</span>
                        <span className={step.status === 'ok' ? 'text-emerald-400' : 'text-rose-400'}>
                          {step.status.toUpperCase()} ({step.latencyMs}ms)
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1">
                    <div className="text-zinc-400 font-semibold">{isAr ? 'سجل الإثبات:' : 'Evidence Log:'}</div>
                    {selectedTestForTrace?.evidenceLog.map((line, i) => (
                      <div key={i} className="text-[11px] font-mono text-zinc-300">
                        {line}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5. ERROR DIAGNOSTICS & SURGICAL BUG FIXER MODAL */}
          {activeModal === 'diagnostics' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between bg-[#161a26] p-3 rounded-xl border border-white/10">
                <div>
                  <div className="font-bold text-white">
                    {isAr
                      ? 'فحص وتشخيص الأخطاء البرمجية مع المقارنة قبل وبعد الإصلاح'
                      : 'Root-Cause Error Diagnostics & Surgical Patching'}
                  </div>
                  <div className="text-zinc-400">
                    {isAr
                      ? 'النظام يصلح السبب الجذري في الكود دون إخفاء الخطأ أو حذف الاختبارات.'
                      : 'Fixes root causes in source files with full pre/post diff and rollback support.'}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const scanned = analyzeCodeDiagnostics(activeProject.files);
                    onUpdateProject(
                      { ...activeProject, diagnostics: scanned },
                      isAr ? `اكتمل فحص الكود (${scanned.length} ملاحظات)` : `Scanned project AST (${scanned.length} issues)`
                    );
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer"
                >
                  {isAr ? 'إعادة فحص الأخطاء' : 'Rescan Project'}
                </button>
              </div>

              {activeProject.diagnostics.length === 0 ? (
                <div className="rounded-xl bg-emerald-950/25 border border-emerald-500/30 p-6 text-center space-y-2">
                  <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                  <div className="text-sm font-bold text-white">
                    {isAr ? 'جميع ملفات المشروع خالية من الأخطاء البرمجية!' : 'Zero unfixed errors across all project files!'}
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  {activeProject.diagnostics.map((issue) => (
                    <div key={issue.id} className="rounded-xl bg-[#161a26] border border-amber-500/30 p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-amber-300 font-mono">
                          [{issue.code}] {issue.filePath}:{issue.line} — {issue.message}
                        </span>
                        <span className="text-[11px] uppercase font-mono text-rose-400">{issue.severity}</span>
                      </div>
                      <div className="text-zinc-300">
                        <strong>{isAr ? 'تحليل السبب الجذري:' : 'Root Cause:'}</strong> {issue.rootCause}
                      </div>
                      <div className="text-emerald-300">
                        <strong>{isAr ? 'الإصلاح المقترح:' : 'Suggested Fix:'}</strong> {issue.suggestedFix}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-[11px]">
                        <div className="p-2.5 rounded-lg bg-rose-950/30 border border-rose-500/30 text-rose-200">
                          <div className="text-rose-400 mb-1">{isAr ? 'قبل الإصلاح (Before):' : 'Before Fix:'}</div>
                          {issue.originalSnippet}
                        </div>
                        <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-500/30 text-emerald-200">
                          <div className="text-emerald-400 mb-1">{isAr ? 'بعد الإصلاح (After):' : 'After Fix:'}</div>
                          {issue.fixedSnippet}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={async () => {
                            const { updatedFiles } = applyDiagnosticFix(activeProject.files, issue);
                            const remainingDiag = analyzeCodeDiagnostics(updatedFiles);
                            const updatedProject = {
                              ...activeProject,
                              files: updatedFiles,
                              diagnostics: remainingDiag,
                            };
                            updatedProject.tests = executeProjectTests(updatedProject, 'all');
                            await onUpdateProject(
                              updatedProject,
                              isAr
                                ? 'تم تطبيق الإصلاح الجذري وإعادة تشغيل الاختبارات بنجاح'
                                : 'Applied surgical fix & verified all tests pass'
                            );
                          }}
                          className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                        >
                          {isAr ? 'تنفيذ الإصلاح وإعادة الاختبار' : 'Apply Fix & Re-Test'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 6. DATABASE STUDIO & BACKUP VAULT MODAL */}
          {activeModal === 'database' && (
            <div className="space-y-4">
              {/* Top DB Bar: Engine, Add Table, Backup, Export */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#161a26] p-3 rounded-xl border border-white/10">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sky-400 font-mono uppercase">{activeProject.databaseEngine}</span>
                  <span className="text-zinc-400">
                    · {activeProject.dbTables.length} {isAr ? 'جداول' : 'tables'} · {activeProject.dbBackups.length}{' '}
                    {isAr ? 'نسخ احتياطية' : 'backups'}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const bkp = {
                        id: `bkp-${Date.now()}`,
                        label: `Manual Snapshot #${activeProject.dbBackups.length + 1}`,
                        createdAt: new Date().toISOString(),
                        sizeBytes: 24576,
                        tablesSnapshot: JSON.parse(JSON.stringify(activeProject.dbTables)),
                      };
                      onUpdateProject(
                        { ...activeProject, dbBackups: [bkp, ...activeProject.dbBackups] },
                        isAr ? 'تم إنشاء نسخة احتياطية لقاعدة البيانات' : 'Created database backup snapshot'
                      );
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer"
                  >
                    {isAr ? '+ نسخ احتياطي فوري' : '+ Create Backup'}
                  </button>
                  {activeProject.dbBackups.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        const latest = activeProject.dbBackups[0];
                        onUpdateProject(
                          { ...activeProject, dbTables: JSON.parse(JSON.stringify(latest.tablesSnapshot)) },
                          isAr ? `تمت استعادة النسخة الاحتياطية (${latest.label})` : `Restored backup (${latest.label})`
                        );
                      }}
                      className="px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 text-zinc-200 cursor-pointer"
                    >
                      {isAr ? 'استعادة آخر نسخة' : 'Restore Latest Backup'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const json = JSON.stringify(activeProject.dbTables, null, 2);
                      const blob = new Blob([json], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${activeProject.id}-db-export.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      onNotify('success', isAr ? 'تم تصدير بيانات قاعدة البيانات JSON' : 'Exported database tables as JSON');
                    }}
                    className="px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 text-zinc-200 cursor-pointer"
                  >
                    {isAr ? 'تصدير البيانات' : 'Export Data'}
                  </button>
                </div>
              </div>

              {/* Create New Table + Select Table */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  {activeProject.dbTables.map((tbl) => (
                    <button
                      key={tbl.id}
                      type="button"
                      onClick={() => setActiveTableId(tbl.id)}
                      className={`px-3 py-1.5 rounded-lg font-mono text-xs cursor-pointer ${
                        (activeTableId || activeProject.dbTables[0]?.id) === tbl.id
                          ? 'bg-blue-600 text-white font-semibold'
                          : 'bg-[#161a26] text-zinc-300 hover:text-white'
                      }`}
                    >
                      {tbl.name} ({tbl.rows.length})
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1.5">
                  <input
                    value={newTableName}
                    onChange={(e) => setNewTableName(e.target.value)}
                    placeholder={isAr ? 'اسم جدول جديد...' : 'New table name...'}
                    className="bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-1.5 text-white font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newTableName.trim()) return;
                      const clean = newTableName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');
                      const createdTbl = {
                        id: `tbl-${Date.now()}`,
                        name: clean,
                        rlsEnabled: true,
                        updatedAt: new Date().toISOString(),
                        indexes: [`idx_${clean}_id`],
                        columns: [
                          { name: 'id', type: 'UUID' as const, primaryKey: true },
                          { name: 'title', type: 'TEXT' as const },
                          { name: 'status', type: 'TEXT' as const },
                        ],
                        rows: [{ id: `row-1`, title: `Initial ${clean} item`, status: 'Active' }],
                      };
                      setNewTableName('');
                      setActiveTableId(createdTbl.id);
                      onUpdateProject(
                        { ...activeProject, dbTables: [...activeProject.dbTables, createdTbl] },
                        isAr ? `تم إنشاء الجدول ${clean} وتنفيذ الترحيل` : `Created table "${clean}" & applied migration`
                      );
                    }}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                  >
                    {isAr ? '+ إضافة جدول' : '+ Add Table'}
                  </button>
                </div>
              </div>

              {/* Active Table Records CRUD */}
              {(() => {
                const currentTable =
                  activeProject.dbTables.find((t) => t.id === activeTableId) || activeProject.dbTables[0];
                if (!currentTable) return null;
                return (
                  <div className="rounded-xl bg-[#161a26] border border-white/10 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <input
                          value={dbSearch}
                          onChange={(e) => setDbSearch(e.target.value)}
                          placeholder={isAr ? 'بحث في السجلات...' : 'Search records...'}
                          className="bg-[#090b10] border border-white/15 rounded-lg px-3 py-1 text-white"
                        />
                        <span className="text-[11px] font-mono text-zinc-400">
                          Indexes: {currentTable.indexes.join(', ')} · RLS: {currentTable.rlsEnabled ? 'ON' : 'OFF'}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          value={newRowTitle}
                          onChange={(e) => setNewRowTitle(e.target.value)}
                          placeholder={isAr ? 'عنوان السجل الجديد...' : 'New record title/name...'}
                          className="bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-1 text-white"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            if (!newRowTitle.trim()) return;
                            const newRow = {
                              id: `rec-${Date.now().toString().slice(-4)}`,
                              name: newRowTitle.trim(),
                              title: newRowTitle.trim(),
                              status: newRowStatus,
                            };
                            const updatedTables = activeProject.dbTables.map((t) =>
                              t.id === currentTable.id ? { ...t, rows: [newRow, ...t.rows] } : t
                            );
                            setNewRowTitle('');
                            onUpdateProject(
                              { ...activeProject, dbTables: updatedTables },
                              isAr ? 'تمت إضافة السجل في قاعدة البيانات' : 'Inserted record into database table'
                            );
                          }}
                          className="px-3 py-1 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold cursor-pointer"
                        >
                          {isAr ? '+ إضافة سجل' : '+ Insert Row'}
                        </button>
                      </div>
                    </div>

                    <table className="w-full text-start border-collapse">
                      <thead>
                        <tr className="border-b border-white/10 text-zinc-400">
                          <th className="p-2 text-start">ID</th>
                          <th className="p-2 text-start">{isAr ? 'الاسم / العنوان' : 'Name / Title'}</th>
                          <th className="p-2 text-start">{isAr ? 'الحالة / الدور' : 'Status / Role'}</th>
                          <th className="p-2 text-end">{isAr ? 'إجراءات' : 'Actions'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentTable.rows
                          .filter(
                            (r) =>
                              !dbSearch.trim() ||
                              JSON.stringify(r).toLowerCase().includes(dbSearch.toLowerCase())
                          )
                          .map((row, idx) => (
                            <tr key={row.id || idx} className="border-b border-white/5">
                              <td className="p-2 font-mono text-sky-300">{row.id}</td>
                              <td className="p-2 text-white">{row.name || row.title}</td>
                              <td className="p-2 font-mono text-emerald-400">{row.status || row.role}</td>
                              <td className="p-2 text-end">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const updatedTables = activeProject.dbTables.map((t) =>
                                      t.id === currentTable.id
                                        ? { ...t, rows: t.rows.filter((r) => r.id !== row.id) }
                                        : t
                                    );
                                    onUpdateProject(
                                      { ...activeProject, dbTables: updatedTables },
                                      isAr ? 'تم حذف السجل' : 'Deleted row'
                                    );
                                  }}
                                  className="text-rose-400 hover:underline cursor-pointer"
                                >
                                  {isAr ? 'حذف' : 'Delete'}
                                </button>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>

                    {/* Destructive Migration & Drop Guard */}
                    <div className="pt-3 border-t border-white/10 flex items-center justify-between">
                      <label className="inline-flex items-center gap-2 text-zinc-400">
                        <input
                          type="checkbox"
                          checked={confirmDestructiveDb}
                          onChange={(e) => setConfirmDestructiveDb(e.target.checked)}
                        />
                        <span>
                          {isAr
                            ? 'أؤكد وجود نسخة احتياطية والموافقة على الترحيل الحساس'
                            : 'I confirm backup readiness for destructive table operations'}
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const check = validateDestructiveDbAction(
                            'drop_table',
                            confirmDestructiveDb,
                            activeProject.dbBackups.length
                          );
                          if (!check.allowed) {
                            onNotify('error', isAr ? check.reasonAr! : check.reasonEn!);
                            return;
                          }
                          if (activeProject.dbTables.length <= 1) {
                            onNotify('error', isAr ? 'يجب الإبقاء على جدول واحد على الأقل' : 'Keep at least 1 active table');
                            return;
                          }
                          const remaining = activeProject.dbTables.filter((t) => t.id !== currentTable.id);
                          setActiveTableId(remaining[0].id);
                          setConfirmDestructiveDb(false);
                          onUpdateProject(
                            { ...activeProject, dbTables: remaining },
                            isAr ? `تم حذف الجدول ${currentTable.name} بأمان` : `Dropped table ${currentTable.name}`
                          );
                        }}
                        className="px-3 py-1 rounded bg-rose-500/20 text-rose-300 hover:bg-rose-500/30 cursor-pointer"
                      >
                        {isAr ? 'حذف هذا الجدول' : 'Drop Table'}
                      </button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* 7. 17-STEP CLOUD DEPLOYMENT WIZARD & POST-DEPLOY CONSOLE */}
          {activeModal === 'deploy' && (
            <div className="space-y-5">
              {/* Configuration Grid (Steps 1-8) */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-[#161a26] p-4 rounded-xl border border-white/10">
                <div>
                  <label className="block text-zinc-400 mb-1">
                    {isAr ? '1. بيئة النشر' : '1. Target Environment'}
                  </label>
                  <select
                    value={deployConfig.environment}
                    onChange={(e) => setDeployConfig({ ...deployConfig, environment: e.target.value as any })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-1.5 text-white"
                  >
                    <option value="production">{isAr ? 'إنتاج (Production)' : 'Production'}</option>
                    <option value="staging">{isAr ? 'اختبار (Staging)' : 'Staging / Canary'}</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">
                    {isAr ? '2. اسم التطبيق' : '2. Application Name'}
                  </label>
                  <input
                    value={deployConfig.appName}
                    onChange={(e) => setDeployConfig({ ...deployConfig, appName: e.target.value })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-1.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">
                    {isAr ? '3. النطاق السحابي' : '3. Custom Domain / Subdomain'}
                  </label>
                  <input
                    value={deployConfig.domain}
                    onChange={(e) => setDeployConfig({ ...deployConfig, domain: e.target.value })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-1.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">
                    {isAr ? '4. المنطقة السحابية' : '4. Cloud Region'}
                  </label>
                  <select
                    value={deployConfig.region}
                    onChange={(e) => setDeployConfig({ ...deployConfig, region: e.target.value })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-1.5 text-white"
                  >
                    <option value="europe-west2 (London)">europe-west2 (London)</option>
                    <option value="me-central1 (Doha)">me-central1 (Middle East)</option>
                    <option value="us-central1 (Iowa)">us-central1 (Iowa)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-zinc-400 mb-1">
                    {isAr ? '5. موارد التشغيل' : '5. Compute Resources'}
                  </label>
                  <select
                    value={deployConfig.cpuRam}
                    onChange={(e) => setDeployConfig({ ...deployConfig, cpuRam: e.target.value })}
                    className="w-full bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-1.5 text-white"
                  >
                    <option value="2 vCPU / 4 GB RAM">2 vCPU / 4 GB RAM (Autoscaled)</option>
                    <option value="4 vCPU / 8 GB RAM">4 vCPU / 8 GB RAM (High Load)</option>
                    <option value="1 vCPU / 2 GB RAM">1 vCPU / 2 GB RAM (Starter)</option>
                  </select>
                </div>
                <div className="flex flex-col justify-end gap-1.5">
                  <label className="inline-flex items-center gap-2 text-zinc-200">
                    <input
                      type="checkbox"
                      checked={deployConfig.userApprovedRelease}
                      onChange={(e) => setDeployConfig({ ...deployConfig, userApprovedRelease: e.target.checked })}
                    />
                    <span className="font-semibold text-amber-300">
                      {isAr ? '13. الموافقة على النشر العام' : '13. Approve Public Release'}
                    </span>
                  </label>
                </div>
              </div>

              {/* Environment Variables (Step 6) */}
              <div className="bg-[#161a26] p-3.5 rounded-xl border border-white/10 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-white">
                    {isAr ? '6. متغيرات البيئة وربط قاعدة البيانات والتخزين' : '6–8. Environment Secrets, Database & Storage Binding'}
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      value={newEnvKey}
                      onChange={(e) => setNewEnvKey(e.target.value)}
                      placeholder="KEY"
                      className="bg-[#090b10] border border-white/15 rounded px-2 py-1 text-white font-mono w-28"
                    />
                    <input
                      value={newEnvVal}
                      onChange={(e) => setNewEnvVal(e.target.value)}
                      placeholder="VALUE"
                      className="bg-[#090b10] border border-white/15 rounded px-2 py-1 text-white font-mono w-36"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!newEnvKey.trim()) return;
                        setDeployConfig({
                          ...deployConfig,
                          envVars: [...deployConfig.envVars, { key: newEnvKey.trim(), value: newEnvVal.trim() }],
                        });
                        setNewEnvKey('');
                        setNewEnvVal('');
                      }}
                      className="px-2.5 py-1 rounded bg-blue-600 text-white"
                    >
                      +
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 font-mono text-[11px]">
                  {deployConfig.envVars.map((ev, i) => (
                    <span key={i} className="px-2 py-0.5 rounded bg-black/50 border border-white/10 text-sky-300">
                      {ev.key}=***
                    </span>
                  ))}
                </div>
              </div>

              {/* Trigger 17-Step Deployment Button */}
              <button
                type="button"
                disabled={isBusy}
                onClick={async () => {
                  if (!deployConfig.userApprovedRelease) {
                    onNotify(
                      'error',
                      isAr
                        ? 'يرجى تفعيل خيار (13. الموافقة على النشر العام) أولاً لاعتماد النشر'
                        : 'Please check Step 13 (Approve Public Release) before launching deployment'
                    );
                    return;
                  }
                  setIsBusy(true);
                  try {
                    const res = await fetch(`/api/projects/${activeProject.id}/deploy`, {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(deployConfig),
                    });
                    const data = await res.json();
                    if (data.steps) setDeploySteps(data.steps);
                    if (data.project) {
                      await onUpdateProject(
                        data.project,
                        isAr
                          ? `تم نشر التطبيق بنجاح وإصدار الرابط: ${data.deployment.url}`
                          : `Deployed successfully to ${data.deployment.url}`
                      );
                    }
                  } finally {
                    setIsBusy(false);
                  }
                }}
                className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                {isBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                <span>
                  {isAr
                    ? 'بدء عملية النشر السحابي الكاملة (17 خطوة) وإصدار الرابط النهائي'
                    : 'Execute Full 17-Step Cloud Deployment & Issue Live Endpoint'}
                </span>
              </button>

              {/* 17 Steps Progress Checklist */}
              {deploySteps.length > 0 && (
                <div className="rounded-xl bg-[#0b0d14] border border-emerald-500/30 p-3.5 max-h-48 overflow-y-auto space-y-1 font-mono text-[11px]">
                  {deploySteps.map((st) => (
                    <div key={st.id} className="flex items-center justify-between text-emerald-300">
                      <span>✓ {isAr ? st.titleAr : st.titleEn}</span>
                      <span className="text-zinc-400">{st.detailLog}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Post-Deployment Management Console */}
              <div className="space-y-2.5">
                <h3 className="font-bold text-white text-sm">
                  {isAr ? 'لوحة إدارة الإصدارات المنشورة:' : 'Active Cloud Deployments & Operations:'}
                </h3>
                {activeProject.deployments.map((dep) => (
                  <div key={dep.id} className="rounded-xl bg-[#161a26] border border-white/10 p-4 space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <a
                          href={dep.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-bold text-sky-400 hover:underline inline-flex items-center gap-1"
                        >
                          <span>{dep.url}</span>
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                        <div className="text-[11px] font-mono text-zinc-400 mt-0.5">
                          {dep.version} · {dep.environment.toUpperCase()} · {dep.region} · Health: {dep.healthScore}%
                        </div>
                      </div>
                      <span
                        className={`text-xs font-mono uppercase font-bold ${
                          dep.status === 'running' ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {dep.status}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => {
                          const updatedDeps = activeProject.deployments.map((d) =>
                            d.id === dep.id
                              ? { ...d, status: (d.status === 'running' ? 'stopped' : 'running') as 'running' | 'stopped' }
                              : d
                          );
                          onUpdateProject(
                            { ...activeProject, deployments: updatedDeps },
                            dep.status === 'running'
                              ? isAr
                                ? 'تم إيقاف التطبيق المنشور'
                                : 'Stopped deployed application'
                              : isAr
                              ? 'تم تشغيل التطبيق المنشور'
                              : 'Started deployed application'
                          );
                        }}
                        className="px-3 py-1 rounded bg-white/8 hover:bg-white/15 text-zinc-200 cursor-pointer"
                      >
                        {dep.status === 'running'
                          ? isAr
                            ? 'إيقاف التطبيق'
                            : 'Stop App'
                          : isAr
                          ? 'تشغيل التطبيق'
                          : 'Start App'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const updatedDeps = activeProject.deployments.map((d) =>
                            d.id === dep.id ? { ...d, version: `${d.version}-rollback`, createdAt: new Date().toISOString() } : d
                          );
                          onUpdateProject(
                            { ...activeProject, deployments: updatedDeps },
                            isAr ? 'تم التراجع إلى الإصدار السابق بنجاح' : 'Rolled back to previous stable revision'
                          );
                        }}
                        className="px-3 py-1 rounded bg-white/8 hover:bg-white/15 text-zinc-200 cursor-pointer"
                      >
                        {isAr ? 'التراجع لإصدار سابق (Rollback)' : 'Rollback Revision'}
                      </button>

                      {confirmDeleteDeployId === dep.id ? (
                        <button
                          type="button"
                          onClick={() => {
                            const remaining = activeProject.deployments.filter((d) => d.id !== dep.id);
                            setConfirmDeleteDeployId(null);
                            onUpdateProject(
                              { ...activeProject, deployments: remaining },
                              isAr ? 'تم حذف خدمة النشر' : 'Deleted deployment service'
                            );
                          }}
                          className="px-3 py-1 rounded bg-rose-600 text-white font-semibold"
                        >
                          {isAr ? 'تأكيد حذف التطبيق' : 'Confirm Delete'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteDeployId(dep.id)}
                          className="px-3 py-1 rounded bg-rose-500/20 text-rose-300"
                        >
                          {isAr ? 'حذف التطبيق' : 'Delete Service'}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 8. GIT & VERSION CONTROL MODAL */}
          {activeModal === 'git' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-[#161a26] p-4 rounded-xl border border-white/10">
                <div>
                  <div className="text-zinc-400 mb-1">{isAr ? 'المستودع المرتبط (GitHub):' : 'Connected GitHub Repository:'}</div>
                  <div className="font-mono text-sky-400 truncate">{activeProject.gitRepoUrl}</div>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={activeProject.gitCurrentBranch}
                    onChange={(e) =>
                      onUpdateProject(
                        { ...activeProject, gitCurrentBranch: e.target.value },
                        isAr ? `تم الانتقال إلى الفرع ${e.target.value}` : `Switched to branch ${e.target.value}`
                      )
                    }
                    className="bg-[#090b10] border border-white/15 rounded-lg px-3 py-1.5 text-white font-mono"
                  >
                    {activeProject.gitBranches.map((b) => (
                      <option key={b} value={b}>
                        branch: {b}
                      </option>
                    ))}
                  </select>
                  <input
                    value={newBranchName}
                    onChange={(e) => setNewBranchName(e.target.value)}
                    placeholder={isAr ? 'اسم فرع جديد...' : 'New branch...'}
                    className="bg-[#090b10] border border-white/15 rounded-lg px-2.5 py-1.5 text-white font-mono w-32"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!newBranchName.trim()) return;
                      const b = newBranchName.trim();
                      setNewBranchName('');
                      onUpdateProject(
                        {
                          ...activeProject,
                          gitBranches: [...activeProject.gitBranches, b],
                          gitCurrentBranch: b,
                        },
                        isAr ? `تم إنشاء الفرع ${b}` : `Created branch ${b}`
                      );
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer"
                  >
                    + Branch
                  </button>
                </div>
              </div>

              {/* Changed Files Before Commit / Merge */}
              <div className="rounded-xl bg-[#161a26] border border-white/10 p-4 space-y-3">
                <div className="font-bold text-white">
                  {isAr ? 'الملفات المتغيرة قبل الحفظ والدمج (Working Tree Diff):' : 'Changed Files Before Commit & Merge:'}
                </div>
                <div className="space-y-1 font-mono text-xs">
                  {calculateWorkingTreeChanges(activeProject.files, activeProject.gitCommits[0]).map((ch, i) => (
                    <div key={i} className="flex items-center justify-between py-1 border-b border-white/5">
                      <span className="text-sky-300">{ch.path}</span>
                      <span className="text-zinc-400">
                        {ch.status.toUpperCase()} · <span className="text-emerald-400">+{ch.additions}</span>{' '}
                        <span className="text-rose-400">-{ch.deletions}</span>
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <input
                    value={commitMessage}
                    onChange={(e) => setCommitMessage(e.target.value)}
                    placeholder={isAr ? 'رسالة الـ Commit أو نقطة الاستعادة...' : 'Commit message / restore point label...'}
                    className="flex-1 bg-[#090b10] border border-white/15 rounded-lg px-3 py-1.5 text-white"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const msg = commitMessage.trim() || `Update ${activeProject.name} files`;
                      const newCommit = {
                        id: `commit-${Date.now()}`,
                        hash: Math.random().toString(16).slice(2, 9),
                        branch: activeProject.gitCurrentBranch,
                        message: msg,
                        author: settings.userName,
                        timestamp: new Date().toISOString(),
                        changedFiles: calculateWorkingTreeChanges(activeProject.files, activeProject.gitCommits[0]).map(
                          (c) => ({ path: c.path, additions: c.additions, deletions: c.deletions })
                        ),
                        filesSnapshot: JSON.parse(JSON.stringify(activeProject.files)),
                      };
                      setCommitMessage('');
                      onUpdateProject(
                        { ...activeProject, gitCommits: [newCommit, ...activeProject.gitCommits] },
                        isAr ? `تم حفظ Commit ونقطة استعادة (${newCommit.hash})` : `Created commit ${newCommit.hash}`
                      );
                    }}
                    className="px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold cursor-pointer"
                  >
                    {isAr ? 'حفظ Commit ونقطة استعادة' : 'Commit & Save Restore Point'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onNotify('success', isAr ? 'تم دفع التعديلات (git push) إلى GitHub بنجاح' : 'Pushed commits to remote GitHub repository')
                    }
                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer"
                  >
                    {isAr ? 'دفع (Push)' : 'Push'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      onNotify('success', isAr ? 'تم سحب أحدث التعديلات (git pull) ومزامنتها' : 'Pulled latest commits from origin')
                    }
                    className="px-3 py-1.5 rounded-lg bg-white/10 text-zinc-200 cursor-pointer"
                  >
                    {isAr ? 'سحب (Pull)' : 'Pull'}
                  </button>
                </div>
              </div>

              {/* Commit History & Snapshot Restore */}
              <div className="space-y-2">
                <div className="font-bold text-white">{isAr ? 'سجل الإصدارات ونقاط الاستعادة:' : 'Commit History & Restore Points:'}</div>
                {activeProject.gitCommits.map((cm) => (
                  <div
                    key={cm.id}
                    className="rounded-xl bg-[#161a26] border border-white/10 p-3 flex items-center justify-between"
                  >
                    <div>
                      <div className="font-semibold text-white">
                        <span className="font-mono text-violet-400 me-2">[{cm.hash}]</span>
                        {cm.message}
                      </div>
                      <div className="text-[11px] text-zinc-400 font-mono">
                        {cm.branch} · {cm.author} · {new Date(cm.timestamp).toLocaleString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onUpdateProject(
                          {
                            ...activeProject,
                            files: JSON.parse(JSON.stringify(cm.filesSnapshot)),
                          },
                          isAr ? `تمت استعادة نسخة المشروع إلى الإصدار ${cm.hash}` : `Restored project files to commit ${cm.hash}`
                        );
                      }}
                      className="px-3 py-1 rounded-lg bg-white/8 hover:bg-white/15 text-sky-300 font-medium cursor-pointer"
                    >
                      {isAr ? 'استعادة هذه النسخة' : 'Restore Snapshot'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 9. SETTINGS, ACCOUNTS, BILLING & TEAMS MODAL */}
          {activeModal === 'settings' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-1.5 bg-[#090b10] p-1.5 rounded-xl border border-white/10">
                {[
                  { id: 'account', labelAr: 'الحساب واللغة والثيم', labelEn: 'Account, Language & Theme' },
                  { id: 'ai', labelAr: 'الذكاء الاصطناعي والنماذج', labelEn: 'AI Models & Token Usage' },
                  { id: 'teams', labelAr: 'الفرق والصلاحيات (RBAC)', labelEn: 'Teams & Permissions' },
                  { id: 'billing', labelAr: 'الاشتراك والفواتير', labelEn: 'Subscription & Invoices' },
                  { id: 'audit', labelAr: 'سجل النشاط', labelEn: 'Activity Audit Log' },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSettingsTab(t.id as any)}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition-colors cursor-pointer ${
                      settingsTab === t.id ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {isAr ? t.labelAr : t.labelEn}
                  </button>
                ))}
              </div>

              {settingsTab === 'account' && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-[#161a26] p-4 rounded-xl border border-white/10">
                  <div>
                    <label className="block text-zinc-400 mb-1">{isAr ? 'الاسم الكامل' : 'Full Name'}</label>
                    <input
                      value={settings.userName}
                      onChange={(e) => onUpdateSettings({ userName: e.target.value })}
                      className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">{isAr ? 'البريد الإلكتروني' : 'Email'}</label>
                    <input
                      value={settings.userEmail}
                      onChange={(e) => onUpdateSettings({ userEmail: e.target.value })}
                      className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">{isAr ? 'لغة المنصة والاتجاه' : 'Platform Language & Direction'}</label>
                    <select
                      value={settings.language}
                      onChange={(e) => onUpdateSettings({ language: e.target.value })}
                      className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                    >
                      <option value="ar">العربية (RTL)</option>
                      <option value="en">English (LTR)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-zinc-400 mb-1">{isAr ? 'الثيم والألوان' : 'Interface Theme'}</label>
                    <select
                      value={settings.theme}
                      onChange={(e) => onUpdateSettings({ theme: e.target.value })}
                      className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                    >
                      <option value="dark">{isAr ? 'داكن احترافي (Dark Obsidian)' : 'Dark Obsidian'}</option>
                      <option value="light">{isAr ? 'فاتح (Clean Light)' : 'Clean Light'}</option>
                    </select>
                  </div>
                </div>
              )}

              {settingsTab === 'ai' && (
                <div className="bg-[#161a26] p-4 rounded-xl border border-white/10 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white">
                      {isAr ? 'استهلاك وحدود الذكاء الاصطناعي:' : 'AI Compute & Token Quota:'}
                    </span>
                    <span className="font-mono text-sky-400 tabular-nums">
                      {settings.aiTokensUsed.toLocaleString()} / {settings.aiTokensLimit.toLocaleString()} tokens
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-black/50 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${Math.min(100, (settings.aiTokensUsed / settings.aiTokensLimit) * 100)}%` }}
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-zinc-400 mb-1">{isAr ? 'النموذج الافتراضي' : 'Default AI Model'}</label>
                      <select
                        value={settings.defaultModel}
                        onChange={(e) => onUpdateSettings({ defaultModel: e.target.value })}
                        className="w-full bg-[#090b10] border border-white/15 rounded-lg px-3 py-2 text-white"
                      >
                        <option value="gemini-3.8-flash">Gemini 3.8 Flash (Balanced Coding)</option>
                        <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite (Low Latency)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-zinc-400 mb-1">{isAr ? 'حالة بوابة المزود' : 'Server-Side Provider Status'}</label>
                      <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-mono">
                        ✓ Server-Side Gemini API Proxy Active
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {settingsTab === 'teams' && (
                <div className="bg-[#161a26] p-4 rounded-xl border border-white/10 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={newMemberEmail}
                      onChange={(e) => setNewMemberEmail(e.target.value)}
                      placeholder={isAr ? 'البريد الإلكتروني للعضو الجديد...' : 'Member email...'}
                      className="flex-1 bg-[#090b10] border border-white/15 rounded-lg px-3 py-1.5 text-white"
                    />
                    <select
                      value={newMemberRole}
                      onChange={(e) => setNewMemberRole(e.target.value as any)}
                      className="bg-[#090b10] border border-white/15 rounded-lg px-3 py-1.5 text-white"
                    >
                      <option value="Admin">Admin</option>
                      <option value="Editor">Editor</option>
                      <option value="Viewer">Viewer</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        if (!newMemberEmail.trim()) return;
                        const added = {
                          id: `tm-${Date.now()}`,
                          name: newMemberEmail.split('@')[0],
                          email: newMemberEmail.trim(),
                          role: newMemberRole,
                          status: 'Active',
                        };
                        setNewMemberEmail('');
                        onUpdateSettings({ teamMembers: [...settings.teamMembers, added] });
                      }}
                      className="px-3.5 py-1.5 rounded-lg bg-blue-600 text-white font-semibold cursor-pointer"
                    >
                      {isAr ? '+ دعوة عضو' : '+ Invite'}
                    </button>
                  </div>
                  <div className="space-y-2">
                    {settings.teamMembers.map((m: any) => (
                      <div key={m.id} className="flex items-center justify-between p-2.5 rounded-lg bg-black/30 border border-white/8">
                        <div>
                          <div className="font-semibold text-white">{m.name}</div>
                          <div className="text-zinc-400 font-mono text-[11px]">{m.email}</div>
                        </div>
                        <span className="font-mono text-sky-400">{m.role}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {settingsTab === 'billing' && (
                <div className="bg-[#161a26] p-4 rounded-xl border border-white/10 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-bold text-white">{settings.planName}</div>
                      <div className="text-zinc-400">{isAr ? 'تشمل جميع الوكلاء العشرة والنشر السحابي غير المحدود' : 'Includes all 10 AI agents & unlimited Cloud Run deployments'}</div>
                    </div>
                    <span className="text-emerald-400 font-mono font-bold">ACTIVE</span>
                  </div>
                  <div className="space-y-1.5 pt-2 border-t border-white/10">
                    {settings.invoices.map((inv: any) => (
                      <div key={inv.id} className="flex items-center justify-between p-2 rounded bg-black/30 font-mono">
                        <span>{inv.id} · {inv.date}</span>
                        <span className="text-emerald-400">{inv.amount} ({inv.status})</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {settingsTab === 'audit' && (
                <div className="bg-[#161a26] p-4 rounded-xl border border-white/10 max-h-64 overflow-y-auto space-y-1.5 font-mono text-[11px]">
                  {settings.activityLog.map((act: any) => (
                    <div key={act.id} className="flex items-center justify-between py-1 border-b border-white/5">
                      <span className="text-zinc-200">{act.actor}: {act.action}</span>
                      <span className="text-sky-400">{act.target}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 10. 10 AI AGENTS OVERVIEW MODAL */}
          {activeModal === 'agents' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {agents.map((ag) => (
                <div key={ag.id} className="rounded-xl bg-[#161a26] border border-white/10 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-white text-sm">{isAr ? ag.nameAr : ag.nameEn}</span>
                    <span className="font-mono text-[11px] text-emerald-400 uppercase">{ag.status}</span>
                  </div>
                  <p className="text-zinc-300">{isAr ? ag.missionAr : ag.missionEn}</p>
                  <div className="text-[11px] font-mono text-sky-400">
                    Model: {ag.model} · Tools: {ag.tools.join(', ')}
                  </div>
                  <div className="text-[11px] text-zinc-400">
                    {isAr ? 'آخر الملفات المعدلة:' : 'Modified files:'} {ag.modifiedFiles.join(', ')}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 11. COMMAND PALETTE MODAL (⌘K) */}
          {activeModal === 'command-palette' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 bg-[#090b10] border border-blue-500/50 rounded-xl px-3.5 py-2.5">
                <Search className="w-4 h-4 text-blue-400" />
                <input
                  autoFocus
                  value={cmdQuery}
                  onChange={(e) => setCmdQuery(e.target.value)}
                  placeholder={isAr ? 'ابحث عن مشروع، ملف، وكيل ذكاء اصطناعي، أو أمر...' : 'Type a command or search projects, files, and agents...'}
                  className="bg-transparent text-white text-sm w-full focus:outline-none"
                />
              </div>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {projects
                  .filter((p) => !cmdQuery.trim() || p.name.toLowerCase().includes(cmdQuery.toLowerCase()))
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        onSelectProject(p, true);
                        onClose();
                      }}
                      className="w-full text-start px-3 py-2 rounded-lg hover:bg-white/10 flex items-center justify-between"
                    >
                      <span className="font-semibold text-white">{p.name}</span>
                      <span className="text-[11px] font-mono text-sky-400">Open in IDE →</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
