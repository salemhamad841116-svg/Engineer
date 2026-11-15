import React, { useState, useRef, useMemo, useEffect } from 'react';
import JSZip from 'jszip';
import {
  Play,
  RotateCcw,
  Eye,
  RefreshCw,
  ExternalLink,
  Maximize2,
  Minimize2,
  Smartphone,
  Tablet,
  Monitor,
  Bug,
  FlaskConical,
  Database,
  GitBranch,
  Rocket,
  FolderPlus,
  FilePlus,
  Trash2,
  Edit3,
  Copy,
  ClipboardPaste,
  Search,
  Wand2,
  Sparkles,
  Save,
  Undo2,
  Redo2,
  GitCompare,
  Code2,
  AlertTriangle,
  Upload,
  Download,
  FileArchive,
  CheckSquare,
  Send,
  StopCircle,
  Bot,
  Terminal,
  Loader2,
  FileText,
  Folder,
  MessageSquarePlus,
} from 'lucide-react';
import {
  AIAgentProfile,
  ExecutionPipelineStage,
  Language,
  Project,
  ProjectFile,
} from '../types/platform';
import {
  formatCodeContent,
  findInFile,
  searchAcrossProject,
  replaceInFileContent,
  detectFunctionDefinitions,
  computeLineDiff,
  compileProjectToPreviewHtml,
  inferLanguageFromFilename,
} from '../utils/platformEngine';
import { PromptMode } from '../utils/intentRouter';
import { formatUserFacingResponse } from '../utils/responseFormatter';
import { SmartResponseRenderer } from './SmartResponseRenderer';

interface IdeWorkspaceProps {
  language: Language;
  project: Project;
  agents: AIAgentProfile[];
  isGenerating: boolean;
  pipelineStages: ExecutionPipelineStage[];
  onUpdateProject: (updated: Project, toastMsg?: string) => Promise<void>;
  onExecutePrompt: (
    prompt: string,
    options: {
      model: string;
      thinkingMode: 'standard' | 'deep' | 'plan';
      agentId?: string;
      mode?: PromptMode;
    }
  ) => Promise<{ intent?: string } | void>;
  onStopGeneration: () => void;
  onOpenModal: (modal: string, payload?: unknown) => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
}

export const IdeWorkspace: React.FC<IdeWorkspaceProps> = ({
  language,
  project,
  agents: _agents,
  isGenerating,
  pipelineStages: _pipelineStages,
  onUpdateProject,
  onExecutePrompt,
  onStopGeneration,
  onOpenModal,
  onNotify,
}) => {
  const isAr = language === 'ar';

  // Chat State
  const [chatInput, setChatInput] = useState('');
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [showChatSearch, setShowChatSearch] = useState(false);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [selectedModel] = useState('gemini-3.8-flash');
  const [promptMode, setPromptMode] = useState<PromptMode>('auto');

  // Center Pane state: Code Editor vs Cloud File Manager
  const [centerTab, setCenterTab] = useState<'editor' | 'files'>('editor');
  const [undoStack, setUndoStack] = useState<Record<string, string[]>>({});
  const [redoStack, setRedoStack] = useState<Record<string, string[]>>({});
  const [clipboardText, setClipboardText] = useState('');
  const [showSearchBar, setShowSearchBar] = useState(false);
  const [searchScope, setSearchScope] = useState<'file' | 'project'>('file');
  const [searchText, setSearchText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [showDiffView, setShowDiffView] = useState(false);
  const [showSymbolsDrawer, setShowSymbolsDrawer] = useState(false);
  const [aiReviewReport, setAiReviewReport] = useState<string | null>(null);
  const [isReviewingCode, setIsReviewingCode] = useState(false);
  const [newFileModal, setNewFileModal] = useState<{ open: boolean; type: 'file' | 'folder'; name: string }>({
    open: false,
    type: 'file',
    name: '',
  });
  const [renameFileId, setRenameFileId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // File Manager state
  const [fileManagerSearch, setFileManagerSearch] = useState('');
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>([]);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const fileUploadInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const chatTextareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Right Pane state: Preview & Runtime
  const [runtimeState, setRuntimeState] = useState<'running' | 'stopped' | 'restarting'>('running');
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [isFullscreenPreview, setIsFullscreenPreview] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [showServerConsole, setShowServerConsole] = useState(false);

  const activeFile = useMemo(
    () => project.files.find((f) => f.id === project.activeFileId) || project.files[0],
    [project.files, project.activeFileId]
  );

  const activeChatThread = useMemo(
    () => project.chatThreads.find((c) => c.id === project.activeChatId) || project.chatThreads[0],
    [project.chatThreads, project.activeChatId]
  );

  const compiledPreviewHtml = useMemo(
    () => compileProjectToPreviewHtml(project),
    [project, previewRefreshKey]
  );

  const functionDefs = useMemo(
    () => (activeFile ? detectFunctionDefinitions(activeFile.content) : []),
    [activeFile]
  );

  const fileSearchMatches = useMemo(() => {
    if (!searchText.trim()) return [];
    if (searchScope === 'file' && activeFile) {
      return findInFile(activeFile.content, searchText).map((m) => ({
        fileId: activeFile.id,
        filePath: activeFile.path,
        line: m.line,
        preview: m.preview,
      }));
    }
    return searchAcrossProject(project.files, searchText);
  }, [searchText, searchScope, activeFile, project.files]);

  const unfixedErrorsCount = project.diagnostics.filter((d) => !d.fixed).length;

  // Auto-scroll chat messages smoothly to bottom when new messages arrive or when generating
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeChatThread?.messages.length, isGenerating]);

  // Dynamic textarea height adjustment so text never gets stuck or hidden at bottom
  useEffect(() => {
    if (chatTextareaRef.current) {
      chatTextareaRef.current.style.height = 'auto';
      chatTextareaRef.current.style.height = `${Math.min(chatTextareaRef.current.scrollHeight, 180)}px`;
    }
  }, [chatInput]);

  // --- Editor Handlers ---
  const updateActiveFileContent = (newContent: string, markDirty = true) => {
    if (!activeFile) return;
    setUndoStack((prev) => ({
      ...prev,
      [activeFile.id]: [...(prev[activeFile.id] || []).slice(-19), activeFile.content],
    }));
    setRedoStack((prev) => ({ ...prev, [activeFile.id]: [] }));

    const updatedFiles = project.files.map((f) =>
      f.id === activeFile.id
        ? {
            ...f,
            previousContent: f.previousContent ?? f.content,
            content: newContent,
            size: new Blob([newContent]).size,
            updatedAt: new Date().toISOString(),
            isDirty: markDirty,
          }
        : f
    );
    onUpdateProject({ ...project, files: updatedFiles });
  };

  const handleUndo = () => {
    if (!activeFile) return;
    const history = undoStack[activeFile.id] || [];
    if (history.length === 0) {
      onNotify('info', isAr ? 'لا توجد تعديلات سابقة للتراجع عنها' : 'Nothing to undo in active buffer');
      return;
    }
    const previous = history[history.length - 1];
    setUndoStack((prev) => ({ ...prev, [activeFile.id]: history.slice(0, -1) }));
    setRedoStack((prev) => ({ ...prev, [activeFile.id]: [...(prev[activeFile.id] || []), activeFile.content] }));

    const updatedFiles = project.files.map((f) =>
      f.id === activeFile.id ? { ...f, content: previous, updatedAt: new Date().toISOString() } : f
    );
    onUpdateProject({ ...project, files: updatedFiles }, isAr ? 'تم التراجع عن آخر تعديل' : 'Undid last edit');
  };

  const handleRedo = () => {
    if (!activeFile) return;
    const future = redoStack[activeFile.id] || [];
    if (future.length === 0) {
      onNotify('info', isAr ? 'لا توجد تعديلات لإعادتها' : 'Nothing to redo');
      return;
    }
    const nextContent = future[future.length - 1];
    setRedoStack((prev) => ({ ...prev, [activeFile.id]: future.slice(0, -1) }));
    setUndoStack((prev) => ({ ...prev, [activeFile.id]: [...(prev[activeFile.id] || []), activeFile.content] }));

    const updatedFiles = project.files.map((f) =>
      f.id === activeFile.id ? { ...f, content: nextContent, updatedAt: new Date().toISOString() } : f
    );
    onUpdateProject({ ...project, files: updatedFiles }, isAr ? 'تمت إعادة التعديل' : 'Redid edit');
  };

  const handleFormatActiveFile = () => {
    if (!activeFile) return;
    const formatted = formatCodeContent(activeFile.content, activeFile.language);
    updateActiveFileContent(formatted, false);
    onNotify('success', isAr ? `تم تنسيق الكود في ${activeFile.name}` : `Formatted ${activeFile.name}`);
  };

  const handleAutoCompleteSnippet = () => {
    if (!activeFile) return;
    const snippet =
      activeFile.language === 'sql'
        ? `\n-- Auto-completed index\nCREATE INDEX IF NOT EXISTS idx_auto_created_at ON project_records(created_at);\n`
        : `\n// Auto-completed helper hook\nexport function useCloudHealthProbe() {\n  return { status: 'healthy', timestamp: new Date().toISOString() };\n}\n`;
    updateActiveFileContent(activeFile.content + snippet, true);
    onNotify('success', isAr ? 'تم إكمال الكود الذكي تلقائياً' : 'Inserted context-aware code completion');
  };

  const handleSaveFile = async (saveAll = false) => {
    const updatedFiles = project.files.map((f) =>
      saveAll || f.id === activeFile?.id ? { ...f, isDirty: false, updatedAt: new Date().toISOString() } : f
    );
    await onUpdateProject(
      { ...project, files: updatedFiles },
      saveAll
        ? isAr
          ? 'تم حفظ جميع ملفات المشروع وتحديث المعاينة الحية'
          : 'Saved all project files & synchronized live preview'
        : isAr
        ? `تم حفظ الملف ${activeFile?.name}`
        : `Saved ${activeFile?.name}`
    );
    setPreviewRefreshKey((k) => k + 1);
  };

  const handleExecuteReplace = (replaceAll: boolean) => {
    if (!activeFile || !searchText) return;
    const { newContent, replacementsCount } = replaceInFileContent(
      activeFile.content,
      searchText,
      replaceText,
      replaceAll
    );
    if (replacementsCount === 0) {
      onNotify('info', isAr ? 'لم يتم العثور على النص المطلوب استبداله' : 'No matching occurrences found');
      return;
    }
    updateActiveFileContent(newContent, true);
    onNotify(
      'success',
      isAr ? `تم استبدال ${replacementsCount} تطابق بنجاح` : `Replaced ${replacementsCount} occurrence(s)`
    );
  };

  const handleAiCodeReview = async () => {
    if (!activeFile || isReviewingCode) return;
    setIsReviewingCode(true);
    try {
      const res = await fetch('/api/ai/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: activeFile.path,
          content: activeFile.content,
          language,
        }),
      });
      const data = await res.json();
      setAiReviewReport(data.reviewText);
      onNotify('success', isAr ? 'اكتملت مراجعة الكود بالذكاء الاصطناعي' : 'AI Code Review completed');
    } catch {
      onNotify('error', isAr ? 'تعذر إتمام مراجعة الكود' : 'Failed to run AI code review');
    } finally {
      setIsReviewingCode(false);
    }
  };

  const handleCreateFileOrFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    const rawName = newFileModal.name.trim();
    if (!rawName) return;
    const cleanPath = rawName.startsWith('/') ? rawName : `/src/${rawName}`;
    if (project.files.some((f) => f.path === cleanPath)) {
      onNotify('error', isAr ? 'هذا الملف موجود بالفعل' : 'A file with this path already exists');
      return;
    }
    const parts = cleanPath.split('/').filter(Boolean);
    const fileName = newFileModal.type === 'folder' ? 'index.ts' : parts[parts.length - 1];
    const folderPath =
      newFileModal.type === 'folder'
        ? cleanPath
        : parts.length > 1
        ? '/' + parts.slice(0, -1).join('/')
        : '/src';
    const fullPath = newFileModal.type === 'folder' ? `${cleanPath}/index.ts` : cleanPath;

    const initialContent = `// ${fullPath} — Created in ${project.name}\nexport const moduleReady = true;\n`;
    const created: ProjectFile = {
      id: `file-${Date.now()}`,
      path: fullPath,
      name: fileName,
      folder: folderPath,
      content: initialContent,
      language: inferLanguageFromFilename(fileName),
      size: initialContent.length,
      updatedAt: new Date().toISOString(),
    };

    const updatedFiles = [...project.files, created];
    await onUpdateProject(
      {
        ...project,
        files: updatedFiles,
        openFileIds: [...project.openFileIds, created.id],
        activeFileId: created.id,
      },
      isAr ? `تم إنشاء ${fullPath} بنجاح` : `Created ${fullPath}`
    );
    setNewFileModal({ open: false, type: 'file', name: '' });
  };

  const handleDeleteFile = async (fileId: string) => {
    if (project.files.length <= 1) {
      onNotify('error', isAr ? 'لا يمكن حذف الملف الوحيد المتبقي في المشروع' : 'Cannot delete the last remaining project file');
      return;
    }
    const target = project.files.find((f) => f.id === fileId);
    const remaining = project.files.filter((f) => f.id !== fileId);
    const nextActive = project.activeFileId === fileId ? remaining[0].id : project.activeFileId;
    await onUpdateProject(
      {
        ...project,
        files: remaining,
        openFileIds: project.openFileIds.filter((id) => id !== fileId),
        activeFileId: nextActive,
      },
      isAr ? `تم حذف الملف ${target?.name}` : `Deleted ${target?.name}`
    );
  };

  const handleRenameFile = async (fileId: string) => {
    if (!renameValue.trim()) {
      setRenameFileId(null);
      return;
    }
    const updatedFiles = project.files.map((f) => {
      if (f.id !== fileId) return f;
      const newName = renameValue.trim();
      const newPath = f.folder === '/' ? `/${newName}` : `${f.folder}/${newName}`;
      return {
        ...f,
        name: newName,
        path: newPath,
        language: inferLanguageFromFilename(newName),
        updatedAt: new Date().toISOString(),
      };
    });
    setRenameFileId(null);
    await onUpdateProject({ ...project, files: updatedFiles }, isAr ? 'تمت إعادة تسمية الملف' : 'Renamed file');
  };

  // --- Cloud File Manager Upload & ZIP Export ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedList = Array.from(e.target.files || []);
    if (!uploadedList.length) return;

    const incomingBytes = uploadedList.reduce((acc, f) => acc + f.size, 0);
    if (project.storageUsedBytes + incomingBytes > project.storageQuotaBytes) {
      onNotify('error', isAr ? 'مساحة التخزين السحابية غير كافية لهذا الملف' : 'Upload exceeds project cloud storage quota');
      return;
    }

    setUploadProgress(15);
    await new Promise((r) => setTimeout(r, 120));
    setUploadProgress(65);

    const newFiles: ProjectFile[] = [];
    for (const rawFile of uploadedList) {
      const textContent = await rawFile.text().catch(() => `// Binary attachment: ${rawFile.name} (${rawFile.size} bytes)`);
      newFiles.push({
        id: `up-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        path: `/uploads/${rawFile.name}`,
        name: rawFile.name,
        folder: '/uploads',
        content: textContent,
        language: inferLanguageFromFilename(rawFile.name),
        size: rawFile.size || textContent.length,
        updatedAt: new Date().toISOString(),
        isAttachment: !/\.(ts|tsx|js|jsx|css|html|json|sql|md)$/i.test(rawFile.name),
        mimeType: rawFile.type || 'application/octet-stream',
      });
    }

    setUploadProgress(100);
    await onUpdateProject(
      {
        ...project,
        files: [...project.files, ...newFiles],
        activeFileId: newFiles[0].id,
      },
      isAr ? `تم رفع ${newFiles.length} ملف بنجاح إلى التخزين السحابي` : `Uploaded ${newFiles.length} file(s) to cloud storage`
    );
    setTimeout(() => setUploadProgress(null), 500);
  };

  const handleDownloadFullProjectZip = async () => {
    try {
      const zip = new JSZip();
      for (const file of project.files) {
        const cleanRelative = file.path.startsWith('/') ? file.path.slice(1) : file.path;
        zip.file(cleanRelative, file.content);
      }
      const blob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.toLowerCase().replace(/\s+/g, '-')}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      onNotify('success', isAr ? 'تم تنزيل المشروع بالكامل بصيغة ZIP' : 'Downloaded full project ZIP archive');
    } catch {
      onNotify('error', isAr ? 'فشل إنشاء ملف ZIP' : 'Failed to generate ZIP archive');
    }
  };

  const handleDownloadSingleFile = (file: ProjectFile) => {
    const blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
    onNotify('success', isAr ? `تم تنزيل ${file.name}` : `Downloaded ${file.name}`);
  };

  // --- Runtime & Preview Controls ---
  const handleRuntimeControl = (action: 'run' | 'stop' | 'restart') => {
    const now = new Date().toISOString();
    if (action === 'stop') {
      setRuntimeState('stopped');
      onUpdateProject(
        {
          ...project,
          status: 'ready',
          serverLogs: [
            { time: now, level: 'warn', message: `Process SIGTERM: Stopped ${project.techStack} dev server` },
            ...project.serverLogs,
          ],
        },
        isAr ? 'تم إيقاف خادم التشغيل' : 'Runtime stopped'
      );
      return;
    }

    setRuntimeState('restarting');
    setTimeout(() => {
      setRuntimeState('running');
      setPreviewRefreshKey((k) => k + 1);
      onUpdateProject(
        {
          ...project,
          status: 'running',
          serverLogs: [
            {
              time: new Date().toISOString(),
              level: 'success',
              message: `[${project.techStack}] Server listening on port 3000 · Database (${project.databaseEngine}) connected`,
            },
            ...project.serverLogs,
          ],
        },
        action === 'restart'
          ? isAr
            ? 'تمت إعادة تشغيل التطبيق وتحديث المعاينة'
            : 'Application restarted cleanly'
          : isAr
          ? `تم تشغيل المشروع ببيئة ${project.techStack}`
          : `Started ${project.techStack} runtime`
      );
    }, 180);
  };

  // --- AI Chat Submit ---
  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!chatInput.trim() || isGenerating) return;
    const text = chatInput.trim();
    setChatInput('');
    if (chatTextareaRef.current) {
      chatTextareaRef.current.style.height = 'auto';
    }
    setEditingMsgId(null);
    const result = await onExecutePrompt(text, {
      model: selectedModel,
      thinkingMode: 'standard',
      mode: promptMode,
    });
    if (result && (result as { intent?: string }).intent === 'build') {
      setPreviewRefreshKey((k) => k + 1);
    }
  };

  const handleNewChatThread = () => {
    const now = new Date().toISOString();
    const newThread = {
      id: `chat-${Date.now()}`,
      title: isAr ? `محادثة #${project.chatThreads.length + 1}` : `Chat #${project.chatThreads.length + 1}`,
      updatedAt: now,
      messages: [
        {
          id: `msg-${Date.now()}`,
          role: 'assistant' as const,
          content: isAr
            ? 'مرحباً بك! أنا Engineer، كيف يمكنني مساعدتك في تطوير أو تعديل تطبيقك اليوم؟'
            : 'Welcome! I am Engineer. How can I help you build or update your application today?',
          timestamp: now,
          model: selectedModel,
          thinkingMode: 'standard' as const,
        },
      ],
    };
    onUpdateProject(
      {
        ...project,
        chatThreads: [newThread, ...project.chatThreads],
        activeChatId: newThread.id,
      },
      isAr ? 'تم بدء محادثة جديدة' : 'Created new chat thread'
    );
  };

  const handleDeleteChatThread = (threadId: string) => {
    if (project.chatThreads.length <= 1) {
      onNotify('info', isAr ? 'يجب الإبقاء على محادثة واحدة على الأقل' : 'At least one chat thread must remain active');
      return;
    }
    const remaining = project.chatThreads.filter((c) => c.id !== threadId);
    onUpdateProject(
      {
        ...project,
        chatThreads: remaining,
        activeChatId: remaining[0].id,
      },
      isAr ? 'تم حذف المحادثة' : 'Deleted chat thread'
    );
  };

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#0a0c12] text-zinc-100">
      {/* Top Clean Header */}
      <header className="h-12 px-4 bg-[#0e111a] border-b border-white/8 flex items-center justify-between gap-3 shrink-0">
        {/* Project Selector & Name Badge as elegant interactive card */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onOpenModal('open-project')}
            title={isAr ? 'فتح أو تبديل المشروع' : 'Open or switch project'}
            className="inline-flex items-center gap-2 bg-white/[0.05] border border-white/10 rounded-xl px-3.5 py-1.5 text-slate-100 font-medium text-xs hover:bg-white/[0.09] hover:border-white/20 transition-all cursor-pointer shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
          >
            <Folder className="w-3.5 h-3.5 text-blue-400 stroke-[2]" />
            <span className="max-w-[200px] truncate">{project.name}</span>
          </button>
        </div>

        {/* Center: Clean Workspace Indicator */}
        <div className="hidden md:flex items-center gap-2 text-xs text-zinc-400">
          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
          <span>{isAr ? 'منصة Engineer · مساحة العمل الذكية' : 'Engineer Platform · Smart Workspace'}</span>
        </div>

        {/* Actions: Developer Mode Toggle & Deploy CTA (Admin portal isolated to admin domain) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            id="toggle-edit-mode-btn"
            data-testid="toggle-edit-mode-btn"
            onClick={() => setIsEditMode(!isEditMode)}
            title={isAr ? 'الوضع المتقدم / محرر الأكواد والملفات' : 'Developer Mode (Code Editor & Files)'}
            className={`h-9 px-3.5 rounded-xl border inline-flex items-center gap-2 text-xs font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] ${
              isEditMode
                ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/30'
                : 'bg-slate-800/75 hover:bg-slate-700/85 text-slate-100 border-white/15 hover:border-blue-400/50'
            }`}
          >
            <Code2 className="w-3.5 h-3.5 stroke-[2]" />
            <span>{isEditMode ? (isAr ? 'عرض المعاينة' : 'Show Preview') : (isAr ? 'الوضع المتقدم' : 'Developer Mode')}</span>
          </button>

          <button
            type="button"
            onClick={() => onOpenModal('deploy')}
            title={isAr ? 'نشر التطبيق' : 'Deploy Application'}
            className="h-9 px-4 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:to-violet-500 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3),0_0_20px_-4px_rgba(79,70,229,0.6)] text-white font-semibold text-sm inline-flex items-center gap-2 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
          >
            <Rocket className="w-3.5 h-3.5 stroke-[2]" />
            <span>{isAr ? 'نشر' : 'Deploy'}</span>
          </button>
        </div>
      </header>

      {/* Main Clean 2-Panel Split Body: Chat on Right (in RTL) + Preview on Left (in RTL) */}
      <div className="flex-1 flex flex-row min-h-0 overflow-hidden" dir={isAr ? 'rtl' : 'ltr'}>
        {/* CHAT PANE (32% width): Clean Q&A (User + Engineer) */}
        {!isFullscreenPreview && (
          <aside
            dir={isAr ? 'rtl' : 'ltr'}
            className="w-[32%] min-w-[340px] max-w-[440px] shrink-0 border-e border-white/8 bg-[#0c0e15] flex flex-col min-h-0 h-full overflow-hidden"
          >
            {/* Clean Chat Header */}
            <div className="px-3.5 py-2.5 border-b border-white/8 bg-[#10131c] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-xs font-semibold text-white leading-none">
                    {isAr ? 'محادثة Engineer' : 'Engineer Chat'}
                  </h2>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    {isAr ? 'سؤال وجواب · بناء فوري' : 'Q&A · Instant Generation'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowChatSearch(!showChatSearch)}
                  title={isAr ? 'بحث في الرسائل' : 'Search Messages'}
                  className={`btn btn-ghost btn-sm p-1.5 ${showChatSearch ? 'text-blue-400' : 'text-zinc-400'}`}
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNewChatThread}
                  title={isAr ? 'بدء محادثة جديدة' : 'New Chat Thread'}
                  className="btn btn-ghost btn-sm p-1.5"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => activeChatThread && handleDeleteChatThread(activeChatThread.id)}
                  title={isAr ? 'مسح المحادثة' : 'Clear Chat'}
                  className="btn btn-ghost btn-sm p-1.5 text-zinc-400 hover:text-rose-400"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Chat Search Bar */}
            {showChatSearch && (
              <div className="px-3.5 py-1.5 border-b border-white/8 bg-[#0b0e17] flex items-center gap-2">
                <Search className="w-3 h-3 text-zinc-500 shrink-0" />
                <input
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder={isAr ? 'بحث في الرسائل...' : 'Search messages...'}
                  className="bg-transparent text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none w-full"
                />
              </div>
            )}

            {/* Messages Stream - Clean Q&A ONLY (User + Engineer) */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3 overscroll-contain">
              {(activeChatThread?.messages || [])
                .filter((m) => !chatSearchQuery.trim() || m.content.toLowerCase().includes(chatSearchQuery.toLowerCase()))
                .map((msg) => (
                  <div
                    key={msg.id}
                    className={`text-xs leading-relaxed transition-all ${
                      msg.role === 'user'
                        ? 'bg-blue-600/20 border border-blue-500/30 text-white rounded-2xl rounded-tl-sm px-4 py-2.5 max-w-[85%] self-end ms-auto shadow-sm group relative'
                        : 'bg-slate-900/80 border border-white/10 text-slate-200 rounded-2xl rounded-tr-sm px-4 py-3 max-w-[95%] shadow-sm group relative'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5 pb-1 border-b border-white/5">
                      <div className="flex items-center gap-1.5">
                        {msg.role === 'user' ? (
                          <span className="font-semibold text-blue-300">
                            {isAr ? 'أنت' : 'You'}
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 font-semibold text-white">
                            <span className="w-2 h-2 rounded-full bg-blue-500 inline-block shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                            <span>Engineer</span>
                          </div>
                        )}
                      </div>
                      {/* Decluttered Actions: visible smoothly on hover only */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-slate-900/90 border border-white/10 rounded-lg p-0.5 shadow-md">
                        {msg.role === 'user' && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMsgId(msg.id);
                              setChatInput(msg.content);
                            }}
                            title={isAr ? 'تعديل الرسالة' : 'Edit message'}
                            className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3 stroke-[2]" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(msg.content);
                            onNotify('success', isAr ? 'تم نسخ الرد' : 'Copied response');
                          }}
                          title={isAr ? 'نسخ النص' : 'Copy text'}
                          className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
                        >
                          <Copy className="w-3 h-3 stroke-[2]" />
                        </button>
                        {msg.role === 'assistant' && (
                          <button
                            type="button"
                            onClick={() =>
                              onExecutePrompt(isAr ? 'أعد المحاولة وحسّن الكود الناتج' : 'Retry and refine the generated code', {
                                model: selectedModel,
                                thinkingMode: 'standard',
                              })
                            }
                            title={isAr ? 'إعادة التوليد' : 'Retry generation'}
                            className="p-1 rounded hover:bg-white/10 text-zinc-400 hover:text-white cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3 stroke-[2]" />
                          </button>
                        )}
                      </div>
                    </div>
                    {msg.role === 'assistant' ? (
                      <SmartResponseRenderer
                        content={formatUserFacingResponse(msg.content)}
                        isStreaming={isGenerating && msg.id === activeChatThread.messages[activeChatThread.messages.length - 1]?.id}
                        isAr={isAr}
                        onNotify={onNotify}
                      />
                    ) : (
                      <div className="whitespace-pre-wrap leading-relaxed select-text">
                        {msg.content}
                      </div>
                    )}
                  </div>
                ))}

              {/* Minimal, Elegant Generating Status Pill (Replaces the 9-stage bulky box) */}
              {isGenerating && (
                <div className="flex items-center gap-2.5 p-3 rounded-xl bg-blue-950/25 border border-blue-500/25 text-xs text-blue-300 shadow-sm animate-pulse">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400 shrink-0" />
                  <span className="flex-1 font-medium">
                    {promptMode === 'chat'
                      ? (isAr ? 'Engineer يكتب الرد...' : 'Engineer is responding...')
                      : (isAr ? 'جاري بناء التعديلات وتحديث المعاينة...' : 'Generating code & updating preview...')}
                  </span>
                  <button
                    type="button"
                    onClick={onStopGeneration}
                    className="btn btn-danger btn-sm text-[11px]"
                  >
                    <StopCircle className="w-3 h-3 stroke-[2]" />
                    <span>{isAr ? 'إيقاف' : 'Stop'}</span>
                  </button>
                </div>
              )}
              {/* Auto-scroll target */}
              <div ref={messagesEndRef} />
            </div>

            {/* Unified Floating Prompt Composer */}
            <form onSubmit={handleSendChatMessage} className="p-3 bg-[#0c0e15] border-t border-white/5 shrink-0 z-10">
              <div className="rounded-2xl bg-slate-900/90 backdrop-blur-xl border border-white/15 focus-within:border-blue-500/70 focus-within:shadow-[0_0_30px_-5px_rgba(59,130,246,0.3)] p-3 transition-all space-y-2">
                {/* Auto-expanding Textarea on Top (Clear, Spacious, and Responsive) */}
                <textarea
                  ref={chatTextareaRef}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendChatMessage();
                    }
                  }}
                  rows={2}
                  placeholder={
                    editingMsgId
                      ? (isAr ? 'عدّل رسالتك ثم اضغط إرسال...' : 'Edit your message and press Send...')
                      : promptMode === 'chat'
                      ? (isAr ? 'اسأل سؤالاً تقنياً أو اطلب شرحاً...' : 'Ask a technical question or discuss...')
                      : promptMode === 'build'
                      ? (isAr ? 'صف ما تريد بناءه أو تعديله في المشروع...' : 'Describe what to build or modify in the project...')
                      : (isAr ? 'اسأل سؤالاً أو اطلب بناء وتعديل المشروع...' : 'Ask a question or request to build/modify...')
                  }
                  className="w-full bg-transparent text-slate-100 placeholder-slate-500 text-xs leading-relaxed resize-none focus:outline-none min-h-[50px] max-h-[180px] overflow-y-auto"
                />

                {/* Bottom Action Row: Mode Pill Selector (Auto/Chat/Build) beside newly styled Send CTA */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-white/5">
                  {/* Segmented Pill Mode Selector: Auto / Chat / Build moved to bottom toolbar */}
                  <div className="bg-slate-950/90 p-0.5 rounded-xl border border-white/10 inline-flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => setPromptMode('auto')}
                      title={isAr ? 'توجيه ذكي تلقائي' : 'Smart auto-routing'}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer ${
                        promptMode === 'auto'
                          ? 'bg-blue-600 text-white shadow-sm font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {isAr ? 'تلقائي' : 'Auto'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromptMode('chat')}
                      title={isAr ? 'محادثة وشرح فقط' : 'Chat & Q&A only'}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer ${
                        promptMode === 'chat'
                          ? 'bg-blue-600 text-white shadow-sm font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {isAr ? 'محادثة' : 'Chat'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPromptMode('build')}
                      title={isAr ? 'بناء وتعديل الكود' : 'Build & edit code'}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer ${
                        promptMode === 'build'
                          ? 'bg-blue-600 text-white shadow-sm font-semibold'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {isAr ? 'بناء' : 'Build'}
                    </button>
                  </div>

                  {/* Send or Stop Action Button (Modern High-Contrast Luminous Aesthetic) */}
                  <div className="flex items-center gap-2 shrink-0">
                    {isGenerating ? (
                      <button
                        type="button"
                        onClick={onStopGeneration}
                        className="h-8 px-3 rounded-xl bg-rose-600/90 hover:bg-rose-500 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.3),0_0_15px_-3px_rgba(225,29,72,0.6)] text-white font-semibold text-xs inline-flex items-center gap-1.5 transition-all duration-200 cursor-pointer"
                        title={isAr ? 'إيقاف التوليد' : 'Stop Generation'}
                      >
                        <StopCircle className="w-3.5 h-3.5 stroke-[2.2]" />
                        <span>{isAr ? 'إيقاف' : 'Stop'}</span>
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!chatInput.trim()}
                        className="h-8.5 px-4 rounded-xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.35),0_0_20px_-3px_rgba(79,70,229,0.7)] text-white font-semibold text-xs inline-flex items-center gap-2 transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] disabled:opacity-30 disabled:hover:scale-100 disabled:shadow-none cursor-pointer group"
                        title={isAr ? 'إرسال الطلب (Enter)' : 'Send Request (Enter)'}
                      >
                        <span>{isAr ? 'إرسال' : 'Send'}</span>
                        <div className="w-4 h-4 rounded-md bg-white/20 flex items-center justify-center transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 rtl:group-hover:-translate-x-0.5">
                          <Send className="w-2.5 h-2.5 text-white stroke-[2.4]" />
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </form>
          </aside>
        )}

        {/* Slim Modern Split Divider between Chat and Center/Preview */}
        {!isFullscreenPreview && (
          <div
            className="w-[1px] bg-white/10 hover:w-1 hover:bg-blue-500 transition-all cursor-col-resize shrink-0 z-10"
            title={isAr ? 'سحب لتعديل العرض' : 'Drag to resize'}
          />
        )}

        {/* CENTER PANE: Professional Code Editor & Cloud File Manager (Shown on-demand via Edit Mode) */}
        {!isFullscreenPreview && isEditMode && (
          <section
            dir={isAr ? 'rtl' : 'ltr'}
            className="flex-1 min-w-0 border-e border-white/10 bg-[#0b0d14] flex flex-col min-h-0"
          >
            {/* Switch Tabs: Code Editor vs Cloud File Manager */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10 bg-[#10131c]">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCenterTab('editor')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    centerTab === 'editor' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {isAr ? 'محرر الأكواد (Code Editor)' : 'Code Editor'}
                </button>
                <button
                  type="button"
                  onClick={() => setCenterTab('files')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${
                    centerTab === 'files' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {isAr ? `مدير الملفات والتخزين (${project.files.length})` : `File Manager (${project.files.length})`}
                </button>
              </div>

              {/* Action Controls: Return to Preview Button + Developer Tools + New File/Folder/Export */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  id="toggle-edit-mode-btn-back"
                  data-testid="toggle-edit-mode-btn-back"
                  onClick={() => setIsEditMode(false)}
                  title={isAr ? 'العودة لمعاينة التطبيق' : 'Back to Preview'}
                  className="btn btn-primary btn-sm"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{isAr ? 'العودة للمعاينة' : 'Back to Preview'}</span>
                </button>

                <span className="h-4 w-px bg-white/10 mx-1" />

                {/* Developer Tools in Edit Mode */}
                <button
                  type="button"
                  onClick={() => onOpenModal('diagnostics')}
                  title={isAr ? 'مركز تشخيص وإصلاح الأخطاء' : 'Error Diagnostics'}
                  className={`btn btn-sm ${unfixedErrorsCount > 0 ? 'btn-danger' : 'btn-secondary'}`}
                >
                  <Bug className="w-3.5 h-3.5 text-amber-400" />
                  <span className="hidden sm:inline">{isAr ? 'إصلاح الأخطاء' : 'Diagnostics'}</span>
                  <span>({unfixedErrorsCount})</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenModal('tests')}
                  title={isAr ? 'مركز الاختبارات والجودة' : 'Automated Tests'}
                  className="btn btn-secondary btn-sm"
                >
                  <FlaskConical className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="hidden sm:inline">{isAr ? 'الاختبارات' : 'Tests'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenModal('database')}
                  title={isAr ? 'إدارة قاعدة البيانات والنسخ الاحتياطي' : 'Database Studio'}
                  className="btn btn-secondary btn-sm"
                >
                  <Database className="w-3.5 h-3.5 text-sky-400" />
                  <span className="hidden sm:inline">{isAr ? 'قاعدة البيانات' : 'Database'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => onOpenModal('git')}
                  title={isAr ? 'إدارة الإصدارات و Git' : 'Git Version Control'}
                  className="btn btn-secondary btn-sm"
                >
                  <GitBranch className="w-3.5 h-3.5 text-purple-400" />
                  <span className="hidden sm:inline">{project.gitCurrentBranch}</span>
                </button>
              </div>

              {/* Quick Create File / Folder / Export ZIP */}
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setNewFileModal({ open: true, type: 'file', name: '' })}
                  title={isAr ? 'إنشاء ملف جديد' : 'New File'}
                  className="p-1.5 rounded-md hover:bg-white/10 text-zinc-300 hover:text-white cursor-pointer"
                >
                  <FilePlus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setNewFileModal({ open: true, type: 'folder', name: '' })}
                  title={isAr ? 'إنشاء مجلد جديد' : 'New Folder'}
                  className="p-1.5 rounded-md hover:bg-white/10 text-zinc-300 hover:text-white cursor-pointer"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleDownloadFullProjectZip}
                  title={isAr ? 'تنزيل المشروع بالكامل ZIP' : 'Download Full Project ZIP'}
                  className="p-1.5 rounded-md hover:bg-white/10 text-sky-400 hover:text-sky-300 cursor-pointer"
                >
                  <FileArchive className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Inline New File / Folder Dialog */}
            {newFileModal.open && (
              <form
                onSubmit={handleCreateFileOrFolder}
                className="px-3 py-2 bg-blue-950/40 border-b border-blue-500/30 flex items-center gap-2 text-xs"
              >
                <span className="font-semibold text-blue-300">
                  {newFileModal.type === 'file'
                    ? isAr
                      ? 'اسم الملف الجديد:'
                      : 'New file path:'
                    : isAr
                    ? 'اسم المجلد الجديد:'
                    : 'New folder path:'}
                </span>
                <input
                  autoFocus
                  value={newFileModal.name}
                  onChange={(e) => setNewFileModal({ ...newFileModal, name: e.target.value })}
                  placeholder={newFileModal.type === 'file' ? 'components/Header.tsx' : 'services/auth'}
                  className="flex-1 bg-[#090b10] border border-white/15 rounded px-2 py-1 text-xs text-white"
                />
                <button type="submit" className="px-2.5 py-1 rounded bg-blue-600 text-white font-semibold">
                  {isAr ? 'إنشاء' : 'Create'}
                </button>
                <button
                  type="button"
                  onClick={() => setNewFileModal({ open: false, type: 'file', name: '' })}
                  className="px-2 py-1 text-zinc-400 hover:text-white"
                >
                  {isAr ? 'إلغاء' : 'Cancel'}
                </button>
              </form>
            )}

            {centerTab === 'editor' ? (
              <div className="flex-1 flex flex-col min-h-0">
                {/* Open File Tabs */}
                <div className="flex items-center gap-1 px-2 py-1.5 bg-[#0e1118] border-b border-white/8 overflow-x-auto shrink-0">
                  {project.files.map((f) => {
                    const isActive = f.id === activeFile?.id;
                    return (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => onUpdateProject({ ...project, activeFileId: f.id })}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${
                          isActive
                            ? 'bg-blue-600/20 text-blue-300 border border-blue-500/40'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                        }`}
                      >
                        <FileText className="w-3 h-3" />
                        <span>{f.name}</span>
                        {f.isDirty && <span className="text-amber-400 font-bold">*</span>}
                      </button>
                    );
                  })}
                </div>

                {/* Rich Code Editor Action Toolbar (All 22 Editor Functions) */}
                <div className="px-2.5 py-1.5 bg-[#121621] border-b border-white/8 flex flex-wrap items-center gap-1 text-xs">
                  <button
                    type="button"
                    onClick={() => handleSaveFile(false)}
                    title={isAr ? 'حفظ الملف الحالي' : 'Save Active File'}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 font-medium cursor-pointer"
                  >
                    <Save className="w-3 h-3" />
                    <span>{isAr ? 'حفظ' : 'Save'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSaveFile(true)}
                    title={isAr ? 'حفظ جميع الملفات' : 'Save All Files'}
                    className="px-2 py-1 rounded hover:bg-white/10 text-zinc-300 cursor-pointer"
                  >
                    {isAr ? 'حفظ الكل' : 'Save All'}
                  </button>
                  <button
                    type="button"
                    onClick={handleUndo}
                    title={isAr ? 'تراجع (Undo)' : 'Undo'}
                    className="p-1 rounded hover:bg-white/10 text-zinc-300 cursor-pointer"
                  >
                    <Undo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleRedo}
                    title={isAr ? 'إعادة (Redo)' : 'Redo'}
                    className="p-1 rounded hover:bg-white/10 text-zinc-300 cursor-pointer"
                  >
                    <Redo2 className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeFile) return;
                      setClipboardText(activeFile.content);
                      navigator.clipboard?.writeText(activeFile.content);
                      onNotify('success', isAr ? 'تم نسخ الكود' : 'Copied code');
                    }}
                    title={isAr ? 'نسخ الكود' : 'Copy'}
                    className="p-1 rounded hover:bg-white/10 text-zinc-300 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeFile || !clipboardText) return;
                      updateActiveFileContent(activeFile.content + '\n' + clipboardText, true);
                      onNotify('success', isAr ? 'تم لصق الكود' : 'Pasted code from clipboard');
                    }}
                    title={isAr ? 'لصق الكود' : 'Paste'}
                    className="p-1 rounded hover:bg-white/10 text-zinc-300 cursor-pointer"
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      textareaRef.current?.focus();
                      textareaRef.current?.select();
                      onNotify('info', isAr ? 'تم تحديد جميع النصوص' : 'Selected all text');
                    }}
                    title={isAr ? 'تحديد الكل' : 'Select All'}
                    className="p-1 rounded hover:bg-white/10 text-zinc-300 cursor-pointer"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSearchBar(!showSearchBar)}
                    title={isAr ? 'بحث واستبدال في الملف أو المشروع' : 'Find & Replace in File / Project'}
                    className={`p-1 rounded cursor-pointer ${showSearchBar ? 'bg-blue-600 text-white' : 'hover:bg-white/10 text-zinc-300'}`}
                  >
                    <Search className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={handleFormatActiveFile}
                    title={isAr ? 'تنسيق الكود' : 'Format Code'}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 text-zinc-300 cursor-pointer"
                  >
                    <Wand2 className="w-3 h-3 text-sky-400" />
                    <span>{isAr ? 'تنسيق' : 'Format'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAutoCompleteSnippet}
                    title={isAr ? 'إكمال الكود تلقائياً' : 'AI Autocomplete'}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 text-zinc-300 cursor-pointer"
                  >
                    <Sparkles className="w-3 h-3 text-amber-400" />
                    <span>{isAr ? 'إكمال' : 'Complete'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleAiCodeReview}
                    disabled={isReviewingCode}
                    title={isAr ? 'مراجعة الكود باستخدام الذكاء الاصطناعي' : 'AI Code Review'}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-white/10 text-emerald-300 cursor-pointer"
                  >
                    {isReviewingCode ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
                    <span>{isAr ? 'مراجعة AI' : 'AI Review'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowDiffView(!showDiffView)}
                    title={isAr ? 'مقارنة الإصدارات (Diff)' : 'Compare Versions Diff'}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${
                      showDiffView ? 'bg-violet-600 text-white' : 'hover:bg-white/10 text-zinc-300'
                    }`}
                  >
                    <GitCompare className="w-3 h-3" />
                    <span>{isAr ? 'مقارنة' : 'Diff'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSymbolsDrawer(!showSymbolsDrawer)}
                    title={isAr ? 'الانتقال إلى تعريف الدوال' : 'Go to Function Definitions'}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${
                      showSymbolsDrawer ? 'bg-blue-600 text-white' : 'hover:bg-white/10 text-zinc-300'
                    }`}
                  >
                    <Code2 className="w-3 h-3" />
                    <span>{isAr ? 'الدوال' : 'Symbols'} ({functionDefs.length})</span>
                  </button>
                </div>

                {/* Search & Replace Panel */}
                {showSearchBar && (
                  <div className="p-2.5 bg-[#141926] border-b border-white/10 space-y-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      <select
                        value={searchScope}
                        onChange={(e) => setSearchScope(e.target.value as 'file' | 'project')}
                        className="bg-[#090b10] border border-white/15 rounded px-2 py-1 text-xs text-zinc-200"
                      >
                        <option value="file">{isAr ? 'داخل الملف' : 'In File'}</option>
                        <option value="project">{isAr ? 'في المشروع بالكامل' : 'Entire Project'}</option>
                      </select>
                      <input
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        placeholder={isAr ? 'ابحث عن نص أو دالة...' : 'Find token...'}
                        className="flex-1 bg-[#090b10] border border-white/15 rounded px-2 py-1 text-xs text-white"
                      />
                      <input
                        value={replaceText}
                        onChange={(e) => setReplaceText(e.target.value)}
                        placeholder={isAr ? 'استبدال بـ...' : 'Replace with...'}
                        className="flex-1 bg-[#090b10] border border-white/15 rounded px-2 py-1 text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={() => handleExecuteReplace(true)}
                        className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-medium cursor-pointer"
                      >
                        {isAr ? 'استبدال الكل' : 'Replace All'}
                      </button>
                    </div>
                    {searchText && (
                      <div className="max-h-24 overflow-y-auto space-y-1 text-[11px] font-mono">
                        {fileSearchMatches.map((m, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => onUpdateProject({ ...project, activeFileId: m.fileId })}
                            className="w-full text-start px-2 py-0.5 rounded hover:bg-white/10 flex items-center justify-between text-zinc-300"
                          >
                            <span className="text-sky-400">{m.filePath}:{m.line}</span>
                            <span className="truncate max-w-[240px]">{m.preview}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Go-to-Definition Symbols Bar */}
                {showSymbolsDrawer && (
                  <div className="px-3 py-2 bg-[#141926] border-b border-white/10 flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="text-zinc-400 font-medium">{isAr ? 'تعريفات الدوال:' : 'Definitions:'}</span>
                    {functionDefs.map((fn) => (
                      <button
                        key={`${fn.name}-${fn.line}`}
                        type="button"
                        onClick={() => {
                          textareaRef.current?.focus();
                          onNotify('info', isAr ? `تم الانتقال إلى الدالة ${fn.name} (سطر ${fn.line})` : `Jumped to ${fn.name} at line ${fn.line}`);
                        }}
                        className="px-2 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-300 font-mono text-[11px] cursor-pointer"
                      >
                        {fn.name}() :L{fn.line}
                      </button>
                    ))}
                  </div>
                )}

                {/* AI Code Review Banner */}
                {aiReviewReport && (
                  <div className="p-2.5 bg-emerald-950/30 border-b border-emerald-500/30 text-xs text-emerald-200 flex items-start justify-between gap-2">
                    <div className="whitespace-pre-wrap">{aiReviewReport}</div>
                    <button
                      type="button"
                      onClick={() => setAiReviewReport(null)}
                      className="text-zinc-400 hover:text-white px-1.5"
                    >
                      ×
                    </button>
                  </div>
                )}

                {/* Code Editor Area or Diff View */}
                <div className="flex-1 relative min-h-0 overflow-hidden flex flex-col">
                  {showDiffView && activeFile ? (
                    <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-0.5 bg-[#090b10]">
                      <div className="text-[11px] text-zinc-400 mb-2">
                        {isAr ? 'مقارنة النسخة الحالية مع النسخة السابقة:' : 'Line-by-line comparison against previous snapshot:'}
                      </div>
                      {computeLineDiff(activeFile.previousContent || activeFile.content, activeFile.content).map((d, i) => (
                        <div
                          key={i}
                          className={`px-2 py-0.5 rounded flex gap-3 ${
                            d.type === 'added'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : d.type === 'removed'
                              ? 'bg-rose-500/15 text-rose-300 line-through'
                              : 'text-zinc-400'
                          }`}
                        >
                          <span className="w-8 text-zinc-600 select-none text-end">{d.lineNo}</span>
                          <span>{d.type === 'added' ? '+' : d.type === 'removed' ? '-' : ' '}</span>
                          <span className="whitespace-pre-wrap">{d.text}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <textarea
                      ref={textareaRef}
                      aria-label={activeFile ? `Code editor for ${activeFile.path}` : 'Code Editor'}
                      value={activeFile?.content || ''}
                      onChange={(e) => updateActiveFileContent(e.target.value, true)}
                      spellCheck={false}
                      dir="ltr"
                      className="flex-1 w-full bg-[#080a0f] text-zinc-100 font-mono text-xs leading-relaxed p-4 resize-none focus:outline-none"
                    />
                  )}

                  {/* Editor Footer Status & Diagnostics Bar */}
                  <div className="h-7 px-3 bg-[#10131c] border-t border-white/10 flex items-center justify-between text-[11px] font-mono text-zinc-400 shrink-0">
                    <div className="flex items-center gap-3">
                      <span>{activeFile?.path}</span>
                      <span>{activeFile?.language.toUpperCase()}</span>
                      <span className="tabular-nums">{activeFile?.size || 0} B</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onOpenModal('diagnostics')}
                      className="inline-flex items-center gap-1 text-amber-300 hover:underline cursor-pointer"
                    >
                      <AlertTriangle className="w-3 h-3" />
                      <span>
                        {unfixedErrorsCount} {isAr ? 'أخطاء/تحذيرات قابلة للإصلاح' : 'diagnostics'}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              /* Cloud File & Storage Manager View */
              <div className="flex-1 flex flex-col min-h-0 p-3 space-y-3 overflow-y-auto">
                {/* Storage Quota & Upload Actions */}
                <div className="rounded-xl bg-[#141824] border border-white/10 p-3 space-y-2.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-white">
                      {isAr ? 'مساحة التخزين السحابي للمشروع' : 'Project Cloud Storage Quota'}
                    </span>
                    <span className="font-mono text-sky-300 tabular-nums">
                      {(project.storageUsedBytes / 1024).toFixed(1)} KB / {(project.storageQuotaBytes / (1024 * 1024)).toFixed(0)} MB
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black/50 overflow-hidden">
                    <div
                      className="h-full bg-blue-500 transition-all"
                      style={{ width: `${Math.min(100, Math.max(4, (project.storageUsedBytes / project.storageQuotaBytes) * 100))}%` }}
                    />
                  </div>
                  {uploadProgress !== null && (
                    <div className="text-xs text-emerald-300 font-mono">
                      {isAr ? `جارٍ رفع وفحص الملفات... ${uploadProgress}%` : `Uploading & verifying chunks... ${uploadProgress}%`}
                    </div>
                  )}
                  <input
                    ref={fileUploadInputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleFileUpload}
                  />
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => fileUploadInputRef.current?.click()}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      <span>{isAr ? 'رفع ملفات / مرفقات' : 'Upload Files'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadFullProjectZip}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/8 hover:bg-white/15 text-zinc-200 text-xs font-medium cursor-pointer"
                    >
                      <FileArchive className="w-3.5 h-3.5 text-sky-400" />
                      <span>{isAr ? 'تنزيل المشروع ZIP' : 'Export Project ZIP'}</span>
                    </button>
                    {selectedFileIds.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const remaining = project.files.filter((f) => !selectedFileIds.includes(f.id));
                          if (remaining.length === 0) {
                            onNotify('error', isAr ? 'لا يمكن حذف جميع ملفات المشروع' : 'Cannot delete all project files');
                            return;
                          }
                          setSelectedFileIds([]);
                          onUpdateProject(
                            { ...project, files: remaining, activeFileId: remaining[0].id },
                            isAr ? 'تم حذف الملفات المحددة' : 'Deleted selected files'
                          );
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 text-xs cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        <span>{isAr ? `حذف المحدد (${selectedFileIds.length})` : `Delete Selected (${selectedFileIds.length})`}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Search files */}
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#111520] border border-white/10">
                  <Search className="w-3.5 h-3.5 text-zinc-400" />
                  <input
                    value={fileManagerSearch}
                    onChange={(e) => setFileManagerSearch(e.target.value)}
                    placeholder={isAr ? 'البحث في الملفات والمجلدات والمرفقات...' : 'Search project files, folders, and attachments...'}
                    className="bg-transparent text-xs text-white focus:outline-none w-full"
                  />
                </div>

                {/* Files Table */}
                <div className="rounded-xl border border-white/10 overflow-hidden bg-[#10131c]">
                  <table className="w-full text-xs text-start border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 bg-white/[0.03] text-zinc-400">
                        <th className="p-2.5 text-start w-8">
                          <input
                            type="checkbox"
                            aria-label="Select all files"
                            checked={selectedFileIds.length === project.files.length && project.files.length > 0}
                            onChange={(e) =>
                              setSelectedFileIds(e.target.checked ? project.files.map((f) => f.id) : [])
                            }
                          />
                        </th>
                        <th className="p-2.5 text-start">{isAr ? 'المسار / الملف' : 'Path / File'}</th>
                        <th className="p-2.5 text-start">{isAr ? 'الحجم' : 'Size'}</th>
                        <th className="p-2.5 text-end">{isAr ? 'العمليات' : 'Actions'}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {project.files
                        .filter((f) => !fileManagerSearch.trim() || f.path.toLowerCase().includes(fileManagerSearch.toLowerCase()))
                        .map((file) => (
                          <tr key={file.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                            <td className="p-2.5">
                              <input
                                type="checkbox"
                                aria-label={`Select ${file.name}`}
                                checked={selectedFileIds.includes(file.id)}
                                onChange={(e) =>
                                  setSelectedFileIds((prev) =>
                                    e.target.checked ? [...prev, file.id] : prev.filter((id) => id !== file.id)
                                  )
                                }
                              />
                            </td>
                            <td className="p-2.5 font-mono">
                              {renameFileId === file.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    className="bg-black border border-blue-500 rounded px-1.5 py-0.5 text-xs text-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleRenameFile(file.id)}
                                    className="px-2 py-0.5 rounded bg-blue-600 text-white"
                                  >
                                    ✓
                                  </button>
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onUpdateProject({ ...project, activeFileId: file.id });
                                    setCenterTab('editor');
                                  }}
                                  className="text-sky-300 hover:underline text-start"
                                >
                                  {file.path}
                                </button>
                              )}
                            </td>
                            <td className="p-2.5 font-mono text-zinc-400 tabular-nums">{file.size} B</td>
                            <td className="p-2.5 text-end">
                              <div className="inline-flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setRenameFileId(file.id);
                                    setRenameValue(file.name);
                                  }}
                                  title={isAr ? 'إعادة تسمية' : 'Rename'}
                                  className="p-1 rounded hover:bg-white/10 text-zinc-300"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDownloadSingleFile(file)}
                                  title={isAr ? 'تنزيل الملف' : 'Download File'}
                                  className="p-1 rounded hover:bg-white/10 text-zinc-300"
                                >
                                  <Download className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteFile(file.id)}
                                  title={isAr ? 'حذف الملف' : 'Delete File'}
                                  className="p-1 rounded hover:bg-rose-500/20 text-zinc-400 hover:text-rose-400"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Bottom Server Logs & Runtime Console (Available only in Edit Mode) */}
            <div className="border-t border-white/10 bg-[#0d1018]">
              <div className="px-3 py-1.5 flex items-center justify-between text-xs border-b border-white/5">
                <button
                  type="button"
                  onClick={() => setShowServerConsole(!showServerConsole)}
                  className="inline-flex items-center gap-1.5 font-mono text-[11px] text-zinc-300 hover:text-white cursor-pointer"
                >
                  <Terminal className="w-3.5 h-3.5 text-sky-400" />
                  <span>{isAr ? 'سجلات الخادم والتشغيل (Server Logs)' : 'Server & Runtime Console'}</span>
                </button>
                <span className="text-[11px] font-mono text-emerald-400">
                  {runtimeState.toUpperCase()} · {project.techStack}
                </span>
              </div>
              {showServerConsole && (
                <div className="h-28 overflow-y-auto p-2.5 font-mono text-[11px] space-y-1 bg-[#080a0f]">
                  {project.serverLogs.map((log, i) => (
                    <div
                      key={i}
                      className={`${
                        log.level === 'error'
                          ? 'text-rose-400'
                          : log.level === 'warn'
                          ? 'text-amber-300'
                          : log.level === 'success'
                          ? 'text-emerald-400'
                          : 'text-zinc-400'
                      }`}
                    >
                      <span className="text-zinc-600 me-2">[{new Date(log.time).toLocaleTimeString()}]</span>
                      <span>{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {/* RIGHT/LEFT PANE: Live Interactive Preview (Active by default, clean 68% viewport) */}
        <section
          dir={isAr ? 'rtl' : 'ltr'}
          className={`${
            isFullscreenPreview ? 'w-full' : isEditMode ? 'hidden' : 'flex-1'
          } min-w-0 bg-[#07090e] flex flex-col min-h-0`}
        >
          {/* Streamlined Modern Preview Toolbar */}
          <div className="px-3.5 py-2 bg-[#0f121b] border-b border-white/8 flex items-center justify-between gap-3 text-xs shrink-0">
            {/* Controls: Status Badge + Run/Restart + Refresh + Open in New Tab */}
            <div className="flex items-center gap-2">
              {/* Preview Status Pill: Glowing emerald live capsule with pulsing dot */}
              {isGenerating ? (
                <span className="status-pill status-pill-building">
                  <Loader2 className="w-3 h-3 animate-spin stroke-[2]" />
                  <span>{isAr ? 'جاري البناء...' : 'Building...'}</span>
                </span>
              ) : runtimeState === 'running' ? (
                <span className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 rounded-full px-3 py-1 text-xs font-semibold flex items-center gap-1.5 shadow-[0_0_12px_-2px_rgba(16,185,129,0.3)]">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_6px_#34d399]" />
                  <span>{isAr ? 'يعمل' : 'Live'}</span>
                </span>
              ) : (
                <span className="bg-rose-500/15 border border-rose-500/30 text-rose-300 rounded-full px-3 py-1 text-xs font-semibold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-rose-400" />
                  <span>{isAr ? 'متوقف' : 'Stopped'}</span>
                </span>
              )}

              {/* Run / Restart Button */}
              <button
                type="button"
                onClick={() => handleRuntimeControl(runtimeState === 'running' ? 'restart' : 'run')}
                disabled={runtimeState === 'restarting'}
                title={runtimeState === 'running' ? (isAr ? 'إعادة تشغيل التطبيق' : 'Restart Application') : (isAr ? 'تشغيل التطبيق' : 'Run Application')}
                className="h-8 px-3 rounded-xl bg-slate-800/75 hover:bg-slate-700/85 text-slate-100 border border-white/15 hover:border-blue-400/50 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] inline-flex items-center gap-2 text-xs font-medium transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                {runtimeState === 'running' ? <RotateCcw className="w-3.5 h-3.5 stroke-[2]" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span>{runtimeState === 'running' ? (isAr ? 'إعادة تشغيل' : 'Restart') : (isAr ? 'تشغيل' : 'Run')}</span>
              </button>

              {/* Refresh Button */}
              <button
                type="button"
                onClick={() => setPreviewRefreshKey((k) => k + 1)}
                title={isAr ? 'تحديث المعاينة' : 'Refresh Preview'}
                className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-slate-200 flex items-center justify-center transition-all cursor-pointer shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
              >
                <RefreshCw className="w-4 h-4 stroke-[2]" />
              </button>

              {/* Open in New Tab Button */}
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([compiledPreviewHtml], { type: 'text/html' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.target = '_blank';
                  a.rel = 'noopener noreferrer';
                  a.click();
                  onNotify('success', isAr ? 'تم فتح رابط المعاينة المستقلة' : 'Opened live preview in standalone tab');
                }}
                title={isAr ? 'فتح في نافذة جديدة' : 'Open in New Tab'}
                className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-slate-200 flex items-center justify-center transition-all cursor-pointer shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
              >
                <ExternalLink className="w-4 h-4 stroke-[2]" />
              </button>
            </div>

            {/* Viewports Switcher + Fullscreen + On-Demand Edit Button */}
            <div className="flex items-center gap-2">
              {/* Responsive Viewport Switcher as Segmented Pill */}
              <div className="bg-slate-950/90 p-1 rounded-xl border border-white/10 inline-flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setPreviewDevice('desktop')}
                  aria-label="Desktop Preview"
                  title={isAr ? 'معاينة سطح المكتب' : 'Desktop Viewport'}
                  className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${previewDevice === 'desktop' ? 'bg-blue-600 text-white shadow-sm font-medium' : 'text-slate-400 hover:text-slate-100'}`}
                >
                  <Monitor className="w-3.5 h-3.5 stroke-[2]" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewDevice('tablet')}
                  aria-label="Tablet Preview"
                  title={isAr ? 'معاينة التابلت' : 'Tablet Viewport (768px)'}
                  className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${previewDevice === 'tablet' ? 'bg-blue-600 text-white shadow-sm font-medium' : 'text-slate-400 hover:text-slate-100'}`}
                >
                  <Tablet className="w-3.5 h-3.5 stroke-[2]" />
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewDevice('mobile')}
                  aria-label="Mobile Preview"
                  title={isAr ? 'معاينة الهاتف' : 'Mobile Viewport (390px)'}
                  className={`px-2.5 py-1 rounded-lg transition-all cursor-pointer ${previewDevice === 'mobile' ? 'bg-blue-600 text-white shadow-sm font-medium' : 'text-slate-400 hover:text-slate-100'}`}
                >
                  <Smartphone className="w-3.5 h-3.5 stroke-[2]" />
                </button>
              </div>

              {/* Fullscreen Toggle */}
              <button
                type="button"
                onClick={() => setIsFullscreenPreview(!isFullscreenPreview)}
                title={isAr ? 'ملء الشاشة' : 'Toggle Fullscreen'}
                className="w-8 h-8 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] border border-white/10 text-slate-200 flex items-center justify-center transition-all cursor-pointer shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)]"
              >
                {isFullscreenPreview ? <Minimize2 className="w-4 h-4 stroke-[2]" /> : <Maximize2 className="w-4 h-4 stroke-[2]" />}
              </button>

              {/* On-Demand Edit Button (Preserves id="toggle-edit-mode-btn") with prominent indigo style */}
              <button
                type="button"
                id="toggle-edit-mode-btn"
                data-testid="toggle-edit-mode-btn"
                onClick={() => setIsEditMode(true)}
                title={isAr ? 'تحرير الكود والملفات' : 'Edit Code & Files'}
                className="h-8 px-3 rounded-xl bg-indigo-500/20 border border-indigo-400/40 text-indigo-200 hover:bg-indigo-500/30 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.1)] inline-flex items-center gap-2 text-xs font-semibold transition-all duration-200 hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
              >
                <Code2 className="w-3.5 h-3.5 stroke-[2] text-indigo-300" />
                <span className="hidden sm:inline">{isAr ? 'تحرير' : 'Edit Code'}</span>
              </button>
            </div>
          </div>

          {/* Live Sandbox Viewport */}
          <div className="flex-1 bg-[#06070b] flex items-center justify-center p-2 overflow-hidden">
            {runtimeState === 'stopped' ? (
              <div className="text-center space-y-3 p-6">
                <p className="text-xs text-zinc-400">
                  {isAr ? 'تم إيقاف خادم التشغيل حالياً.' : 'Application runtime server is currently stopped.'}
                </p>
                <button
                  type="button"
                  onClick={() => handleRuntimeControl('run')}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>{isAr ? 'إعادة تشغيل التطبيق الآن' : 'Start Application Runtime'}</span>
                </button>
              </div>
            ) : (
              <div
                className={`h-full transition-all duration-200 rounded-xl overflow-hidden border border-white/12 shadow-2xl bg-[#090d16] ${
                  previewDevice === 'mobile'
                    ? 'w-[375px]'
                    : previewDevice === 'tablet'
                    ? 'w-[720px]'
                    : 'w-full'
                }`}
              >
                <iframe
                  key={previewRefreshKey}
                  title={`Live Preview — ${project.name}`}
                  srcDoc={compiledPreviewHtml}
                  sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-downloads"
                  className="w-full h-full border-0"
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
