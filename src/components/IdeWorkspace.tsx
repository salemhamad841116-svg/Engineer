import React, { useState, useRef, useMemo, useEffect } from 'react';
import JSZip from 'jszip';
import {
  RotateCcw,
  Eye,
  RefreshCw,
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
  Bot,
  Terminal,
  Loader2,
  FileText,
  Folder,
  MessageSquarePlus,
  MousePointerClick,
  Paperclip,
  Mic,
  MicOff,
  X,
  Square,
  ChevronDown,
} from 'lucide-react';
import {
  AIAgentProfile,
  ChatAttachmentMeta,
  ChatMessage,
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
  listPreviewEntries,
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
      attachments?: ChatAttachmentMeta[];
      attachmentIds?: string[];
      retryOfClientId?: string;
    }
  ) => Promise<unknown>;
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
  const [selectedModel, setSelectedModel] = useState('');
  const [availableModels, setAvailableModels] = useState<{ id: string; name: string; provider: string; available: boolean; local?: boolean }[]>([]);
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [pendingAttachments, setPendingAttachments] = useState<ChatAttachmentMeta[]>([]);
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [_promptMode] = useState<PromptMode>('auto');
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const speechRecognitionRef = useRef<{ stop: () => void; start: () => void; lang: string; interimResults: boolean; maxAlternatives: number; onstart: () => void; onresult: (e: { results: Array<Array<{ transcript?: string }>> }) => void; onerror: () => void; onend: () => void } | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const modelPickerRef = useRef<HTMLDivElement>(null);

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
  const [isFullscreenPreview, _setIsFullscreenPreview] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const [previewEntry, setPreviewEntry] = useState<string>('');
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [showServerConsole, setShowServerConsole] = useState(false);
  const [mobileActiveView, setMobileActiveView] = useState<'preview' | 'chat'>('preview');
  const [isAppServerRunning, setIsAppServerRunning] = useState<boolean>(false);
  const [isInspectorActive, setIsInspectorActive] = useState<boolean>(false);
  const [projectSnapshots, setProjectSnapshots] = useState<{ files: ProjectFile[]; timestamp: string }[]>([]);
  const lastFilesRef = useRef<ProjectFile[]>(project.files);

  const activeFile = useMemo(
    () => project.files.find((f) => f.id === project.activeFileId) || project.files[0],
    [project.files, project.activeFileId]
  );

  const activeChatThread = useMemo(
    () => project.chatThreads.find((c) => c.id === project.activeChatId) || project.chatThreads[0],
    [project.chatThreads, project.activeChatId]
  );

  const previewEntries = useMemo(() => listPreviewEntries(project), [project]);
  const previewStorageKey = `engineer-preview-storage:${project.id}`;

  const compiledPreviewHtml = useMemo(() => {
    let storageSeed: Record<string, string>;
    try {
      storageSeed = JSON.parse(window.localStorage.getItem(previewStorageKey) || '{}') || {};
    } catch {
      storageSeed = {};
    }
    const entry = previewEntries.some((p) => p.path === previewEntry) ? previewEntry : undefined;
    return compileProjectToPreviewHtml(project, { entry, storageSeed });
    // previewRefreshKey intentionally re-reads the persisted storage snapshot.
  }, [project, previewRefreshKey, previewEntry, previewEntries, previewStorageKey]);

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

  // Capture snapshots for Instant Snapshot Undo
  useEffect(() => {
    if (lastFilesRef.current !== project.files && lastFilesRef.current.length > 0) {
      setProjectSnapshots((prev) => [
        ...prev.slice(-9),
        { files: lastFilesRef.current, timestamp: new Date().toISOString() },
      ]);
    }
    lastFilesRef.current = project.files;
  }, [project.files]);

  // Close model picker on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modelPickerRef.current && !modelPickerRef.current.contains(e.target as Node)) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedModel]);

  // Fetch available real models from server
  useEffect(() => {
    fetch('/api/ai/models')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.models && Array.isArray(data.models)) {
          setAvailableModels(data.models);
          if (data.defaultModelId) {
            setSelectedModel((prev) => {
              const currentAvailable = prev && data.models.some((m: { id: string; available: boolean }) => m.id === prev && m.available);
              return currentAvailable ? prev : data.defaultModelId;
            });
          } else if (!selectedModel) {
            const firstAvailable = data.models.find((m: { available: boolean }) => m.available);
            if (firstAvailable) setSelectedModel(firstAvailable.id);
          }
        }
      })
      .catch(() => { });
  }, []);

  // Activate the live preview once the project has a real, non-empty HTML page.
  useEffect(() => {
    const hasBuiltApp = project.files.some((f) => f.name.endsWith('.html') && f.content.trim().length > 0);
    if (hasBuiltApp && !isGenerating) {
      setIsAppServerRunning(true);
    }
  }, [project.files, isGenerating]);

  // Messages from the sandboxed preview iframe (only accepted from that exact frame).
  useEffect(() => {
    const handleElementSelected = (event: MessageEvent) => {
      const iframe = document.getElementById('live-app-preview-frame') as HTMLIFrameElement | null;
      if (!iframe || event.source !== iframe.contentWindow) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'ENGINEER_PREVIEW_STORAGE' && data.data && typeof data.data === 'object') {
        try {
          const serialized = JSON.stringify(data.data);
          if (serialized.length < 2_000_000) window.localStorage.setItem(previewStorageKey, serialized);
        } catch {
          /* storage quota exceeded: preview keeps working in memory */
        }
        return;
      }
      if (data.type === 'ENGINEER_NAVIGATE' && typeof data.entry === 'string') {
        const target = data.entry.replace(/^\/+/, '');
        if (previewEntries.some((p) => p.path === target)) setPreviewEntry(target);
        return;
      }
      if (data.type === 'ENGINEER_ELEMENT_SELECTED') {
        setIsInspectorActive(false);
        const { text, selector, tag } = data;
        const targetLabel = text ? `"${String(text).slice(0, 40)}"` : String(selector || tag || '').slice(0, 60);
        const promptDraft = isAr
          ? `عدل هذا العنصر (${targetLabel}) واجعله `
          : `Modify this element (${targetLabel}) and make it `;
        setChatInput(promptDraft);
        setTimeout(() => {
          chatTextareaRef.current?.focus();
        }, 50);
        onNotify('info', isAr ? `تم تحديد العنصر: ${targetLabel}` : `Selected element: ${targetLabel}`);
      }
    };
    window.addEventListener('message', handleElementSelected);
    return () => window.removeEventListener('message', handleElementSelected);
  }, [isAr, onNotify, previewStorageKey, previewEntries]);

  const handleToggleInspector = () => {
    const next = !isInspectorActive;
    setIsInspectorActive(next);
    const iframe = document.getElementById('live-app-preview-frame') as HTMLIFrameElement;
    if (iframe?.contentWindow) {
      iframe.contentWindow.postMessage({ type: 'ENGINEER_TOGGLE_INSPECTOR', active: next }, '*');
    }
  };

  const handleUndoSnapshot = () => {
    if (projectSnapshots.length === 0) {
      onNotify('info', isAr ? 'لا توجد لقطات سابقة للتراجع عنها' : 'No previous snapshots available');
      return;
    }
    const previousSnapshot = projectSnapshots[projectSnapshots.length - 1];
    setProjectSnapshots((prev) => prev.slice(0, -1));
    lastFilesRef.current = previousSnapshot.files;
    onUpdateProject(
      { ...project, files: previousSnapshot.files },
      isAr ? 'تم استرجاع النسخة السابقة بنجاح' : 'Restored previous snapshot'
    );
    setPreviewRefreshKey((k) => k + 1);
  };

  const handleExecuteSuggestion = async (promptText: string) => {
    if (isGenerating) return;
    setChatInput('');
    if (chatTextareaRef.current) {
      chatTextareaRef.current.style.height = 'auto';
    }
    setEditingMsgId(null);
    const result = await onExecutePrompt(promptText, {
      model: selectedModel,
      thinkingMode: 'standard',
      mode: 'build',
    });
    if (result && (result as { intent?: string }).intent === 'build') {
      setIsAppServerRunning(true);
      setPreviewRefreshKey((k) => k + 1);
    }
  };

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
  const _handleRuntimeControl = (action: 'run' | 'stop' | 'restart') => {
    const now = new Date().toISOString();
    if (action === 'stop') {
      setRuntimeState('stopped');
      setIsAppServerRunning(false);
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
      setIsAppServerRunning(true);
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

  // --- Attachments & Voice Handlers ---
  const handleAttachmentFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (pendingAttachments.length + files.length > 5) {
      onNotify('error', isAr ? 'الحد الأقصى هو 5 ملفات في الرسالة الواحدة' : 'Maximum 5 files per message');
      return;
    }
    setIsUploadingAttachments(true);
    try {
      const fileDataList: { name: string; type: string; dataBase64: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (file.size > 10 * 1024 * 1024) {
          onNotify('error', isAr ? `الملف ${file.name} يتجاوز 10 ميغابايت` : `File ${file.name} exceeds 10MB`);
          continue;
        }
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        fileDataList.push({ name: file.name, type: file.type || 'application/octet-stream', dataBase64: base64 });
      }
      if (fileDataList.length > 0) {
        const res = await fetch('/api/ai/attachments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ projectId: project.id, files: fileDataList }),
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.attachments)) {
            setPendingAttachments((prev) => [...prev, ...data.attachments]);
            onNotify('success', isAr ? `تم إرفاق ${data.attachments.length} ملف بنجاح` : `Attached ${data.attachments.length} file(s)`);
          }
        } else {
          const errData = await res.json().catch(() => null);
          onNotify('error', errData?.userMessage || (isAr ? 'فشل رفع المرفق' : 'Failed to upload attachment'));
        }
      }
    } catch {
      onNotify('error', isAr ? 'حدث خطأ أثناء قراءة المرفقات' : 'Error reading attachments');
    } finally {
      setIsUploadingAttachments(false);
      if (attachmentInputRef.current) attachmentInputRef.current.value = '';
    }
  };

  const handleRemoveAttachment = (idOrName: string) => {
    setPendingAttachments((prev) => prev.filter((a) => (a.id ? a.id !== idOrName : a.name !== idOrName)));
  };

  const handleToggleVoiceInput = () => {
    if (isRecordingVoice) {
      if (speechRecognitionRef.current) {
        try { speechRecognitionRef.current.stop(); } catch { /* ignore */ }
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        try { mediaRecorderRef.current.stop(); } catch { /* ignore */ }
      }
      setIsRecordingVoice(false);
      return;
    }

    interface BrowserSpeechRecognition {
      stop: () => void;
      start: () => void;
      lang: string;
      interimResults: boolean;
      maxAlternatives: number;
      onstart: () => void;
      onresult: (e: { results: Array<Array<{ transcript?: string }>> }) => void;
      onerror: () => void;
      onend: () => void;
    }
    const win = window as unknown as {
      SpeechRecognition?: new () => BrowserSpeechRecognition;
      webkitSpeechRecognition?: new () => BrowserSpeechRecognition;
    };
    const SpeechRecognitionClass = win.SpeechRecognition || win.webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
      try {
        const recognition = new SpeechRecognitionClass();
        recognition.lang = isAr ? 'ar-SA' : 'en-US';
        recognition.interimResults = false;
        recognition.maxAlternatives = 1;
        recognition.onstart = () => setIsRecordingVoice(true);
        recognition.onresult = (event: { results: Array<Array<{ transcript?: string }>> }) => {
          const transcript = event.results[0]?.[0]?.transcript;
          if (transcript) {
            setChatInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
          }
          setIsRecordingVoice(false);
        };
        recognition.onerror = () => {
          setIsRecordingVoice(false);
          onNotify('error', isAr ? 'تعذر التعرف على الصوت. يمكنك كتابة الرسالة.' : 'Voice recognition error.');
        };
        recognition.onend = () => setIsRecordingVoice(false);
        speechRecognitionRef.current = recognition;
        recognition.start();
        return;
      } catch (err) {
        console.warn('SpeechRecognition failed, falling back to MediaRecorder', err);
      }
    }

    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then((stream) => {
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];
          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
          };
          mediaRecorder.onstop = async () => {
            stream.getTracks().forEach((t) => t.stop());
            setIsRecordingVoice(false);
            const audioBlob = new Blob(audioChunksRef.current, { type: mediaRecorder.mimeType || 'audio/webm' });
            if (audioBlob.size < 100) return;
            const reader = new FileReader();
            reader.onload = async () => {
              const base64 = String(reader.result || '').split(',')[1] || '';
              try {
                const res = await fetch('/api/ai/transcribe', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    audioBase64: base64,
                    mimeType: audioBlob.type,
                    language: isAr ? 'ar' : 'en',
                  }),
                });
                const data = await res.json();
                if (res.ok && data.text) {
                  setChatInput((prev) => (prev ? `${prev} ${data.text}` : data.text));
                  onNotify('success', isAr ? 'تم تحويل الصوت إلى نص' : 'Transcribed voice');
                } else {
                  onNotify('info', data?.userMessage || (isAr ? 'التحويل الصوتي غير متاح حالياً' : 'Voice transcription unavailable'));
                }
              } catch {
                onNotify('error', isAr ? 'تعذر إرسال التسجيل الصوتي' : 'Failed to send audio');
              }
            };
            reader.readAsDataURL(audioBlob);
          };
          mediaRecorder.start();
          setIsRecordingVoice(true);
        })
        .catch(() => {
          onNotify('error', isAr ? 'يرجى السماح بالوصول إلى الميكروفون' : 'Microphone access denied');
        });
    } else {
      onNotify('info', isAr ? 'الميكروفون غير مدعوم في هذا المتصفح' : 'Microphone not supported in this browser');
    }
  };

  const handleRetryMessage = async (failedMsg: ChatMessage) => {
    if (isGenerating) return;
    const promptText = failedMsg.replyTo
      ? activeChatThread?.messages.find((m) => m.id === failedMsg.replyTo)?.content || failedMsg.content
      : failedMsg.content;
    const result = await onExecutePrompt(promptText, {
      model: selectedModel,
      thinkingMode: 'standard',
      mode: 'auto',
      retryOfClientId: failedMsg.clientId,
    });
    if (result && (result as { intent?: string }).intent === 'build') {
      setIsAppServerRunning(true);
      setPreviewRefreshKey((k) => k + 1);
    }
  };

  // --- AI Chat Submit ---
  const handleSendChatMessage = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if ((!chatInput.trim() && pendingAttachments.length === 0) || isGenerating) return;
    const text = chatInput.trim();
    const attachmentsToSend = [...pendingAttachments];
    setChatInput('');
    setPendingAttachments([]);
    if (chatTextareaRef.current) {
      chatTextareaRef.current.style.height = 'auto';
    }
    setEditingMsgId(null);
    const result = await onExecutePrompt(text || (isAr ? 'راجع المرفقات المرفقة' : 'Please check the attachments'), {
      model: selectedModel,
      thinkingMode: 'standard',
      mode: 'auto',
      attachments: attachmentsToSend,
      attachmentIds: attachmentsToSend.map((a) => a.id).filter(Boolean) as string[],
    });
    if (result && (result as { intent?: string }).intent === 'build') {
      setIsAppServerRunning(true);
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
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-[#090D18] text-zinc-100">
      {/* Top Clean Header */}
      <header className="h-12 px-4 glass-toolbar flex items-center justify-between gap-3 shrink-0">
        {/* Project Selector & Name Badge as elegant interactive card */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onOpenModal('open-project')}
            title={isAr ? 'فتح أو تبديل المشروع' : 'Open or switch project'}
            className="btn btn-secondary btn-sm"
          >
            <Folder className="w-3.5 h-3.5 text-blue-400 stroke-[2]" />
            <span className="max-w-[200px] truncate">{project.name}</span>
          </button>
        </div>

        {/* Center: Clean Workspace Indicator */}
        <div className="hidden md:flex items-center gap-2 text-xs text-zinc-400">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse shadow-[0_0_8px_#60a5fa]" />
          <span className="font-medium">{isAr ? 'منصة Engineer · مساحة العمل الذكية' : 'Engineer Platform · Smart Workspace'}</span>
        </div>

        {/* Actions: Developer Mode Toggle (the single Publish CTA lives in the preview toolbar) */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            id="toggle-dev-mode-btn"
            data-testid="toggle-dev-mode-btn"
            onClick={() => setIsEditMode(!isEditMode)}
            title={isAr ? 'الوضع المتقدم / محرر الأكواد والملفات' : 'Developer Mode (Code Editor & Files)'}
            className={`btn btn-sm ${isEditMode ? 'btn-primary' : 'btn-secondary'
              }`}
          >
            <Code2 className="w-3.5 h-3.5 stroke-[2]" />
            <span>{isEditMode ? (isAr ? 'عرض المعاينة' : 'Show Preview') : (isAr ? 'الوضع المتقدم' : 'Developer Mode')}</span>
          </button>
        </div>
      </header>

      {/* Mobile / Tablet Responsive Tab Switcher */}
      <div className="lg:hidden px-3 py-1.5 glass-panel border-b border-white/10 flex items-center justify-center shrink-0">
        <div className="segmented-pill-container w-full max-w-sm justify-center">
          <button
            type="button"
            onClick={() => {
              setMobileActiveView('preview');
              setIsEditMode(false);
            }}
            className={`segmented-pill-btn flex-1 flex items-center justify-center gap-1.5 ${mobileActiveView === 'preview' && !isEditMode ? 'segmented-pill-btn-active' : ''
              }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{isAr ? 'المعاينة' : 'Preview'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileActiveView('chat');
            }}
            className={`segmented-pill-btn flex-1 flex items-center justify-center gap-1.5 ${mobileActiveView === 'chat' ? 'segmented-pill-btn-active' : ''
              }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>{isAr ? 'المحادثة' : 'Chat'}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMobileActiveView('preview');
              setIsEditMode(true);
            }}
            className={`segmented-pill-btn flex-1 flex items-center justify-center gap-1.5 ${isEditMode ? 'segmented-pill-btn-active' : ''
              }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            <span>{isAr ? 'الكود' : 'Code'}</span>
          </button>
        </div>
      </div>

      {/* Main Clean 2-Panel Split Body: Chat on Right + Preview on Left */}
      <div
        className={`flex-1 flex ${isAr ? 'flex-row' : 'flex-row-reverse'} min-h-0 overflow-hidden`}
        dir={isAr ? 'rtl' : 'ltr'}
      >
        {/* CHAT PANE (32% width): Clean Q&A (User + Engineer) */}
        {!isFullscreenPreview && (
          <aside
            dir={isAr ? 'rtl' : 'ltr'}
            className={`w-[390px] min-w-[360px] lg:w-[32%] lg:max-w-[440px] shrink-0 border-e border-[#252529] bg-[#151517] flex flex-col min-h-0 h-full overflow-hidden ${mobileActiveView === 'chat' ? 'flex' : 'hidden lg:flex'
              }`}
          >
            {/* Clean Chat Header (Bolt-inspired minimal aesthetic) */}
            <div className="px-3.5 py-2.5 border-b border-[#252529] bg-[#171719] flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-[#246290]/20 border border-[#246290]/40 flex items-center justify-center">
                  <Sparkles className="w-3.5 h-3.5 text-[#38bdf8]" />
                </div>
                <div>
                  <h2 className="text-xs font-semibold text-[#f4f1f5] leading-none">
                    {isAr ? 'محادثة Engineer' : 'Engineer Chat'}
                  </h2>
                  <p className="text-[10px] text-[#969498] mt-0.5">
                    {isAr ? 'سؤال وجواب · بناء وتعديل فوري' : 'Q&A · Instant Generation'}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setShowChatSearch(!showChatSearch)}
                  title={isAr ? 'بحث في الرسائل' : 'Search Messages'}
                  className={`p-1.5 rounded-lg text-[#96969e] hover:text-[#f4f1f5] hover:bg-[#252529] transition-all ${showChatSearch ? 'text-[#38bdf8] bg-[#252529]' : ''
                    }`}
                >
                  <Search className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={handleNewChatThread}
                  title={isAr ? 'بدء محادثة جديدة' : 'New Chat Thread'}
                  className="p-1.5 rounded-lg text-[#96969e] hover:text-[#f4f1f5] hover:bg-[#252529] transition-all"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => activeChatThread && handleDeleteChatThread(activeChatThread.id)}
                  title={isAr ? 'مسح المحادثة' : 'Clear Chat'}
                  className="p-1.5 rounded-lg text-[#96969e] hover:text-rose-400 hover:bg-[#252529] transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Chat Search Bar */}
            {showChatSearch && (
              <div className="px-3.5 py-1.5 border-b border-[#252529] bg-[#111114] flex items-center gap-2">
                <Search className="w-3 h-3 text-[#96969e] shrink-0" />
                <input
                  value={chatSearchQuery}
                  onChange={(e) => setChatSearchQuery(e.target.value)}
                  placeholder={isAr ? 'بحث في الرسائل...' : 'Search messages...'}
                  className="bg-transparent text-xs text-[#f4f1f5] placeholder-[#9898a0] focus:outline-none w-full"
                />
              </div>
            )}

            {/* Messages Stream - Clean Q&A ONLY (User + Engineer) */}
            <div className="flex-1 min-h-0 overflow-y-auto p-3.5 space-y-3.5 overscroll-contain bg-[#151517]">
              {(activeChatThread?.messages || [])
                .filter((m) => !chatSearchQuery.trim() || m.content.toLowerCase().includes(chatSearchQuery.toLowerCase()))
                .map((msg) => (
                  <div
                    key={msg.id}
                    className={`text-xs leading-relaxed transition-all ${msg.role === 'user'
                      ? 'bg-[#1e1e21] border border-[#2c2c30] text-[#f4f1f5] rounded-xl px-3.5 py-2.5 max-w-[88%] self-end ms-auto shadow-sm group relative'
                      : 'text-[#f4f1f5] px-1 py-1.5 max-w-full group relative'
                      }`}
                  >
                    {/* Header line for each message */}
                    <div className="flex items-center justify-between text-[11px] text-[#969498] mb-1.5 pb-1 border-b border-white/5">
                      <div className="flex items-center gap-1.5">
                        {msg.role === 'user' ? (
                          <span className="font-semibold text-[#93c5fd]">
                            {isAr ? 'أنت' : 'You'}
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 font-semibold text-[#f4f1f5]">
                            <span className="w-2 h-2 rounded-full bg-[#246290] inline-block shadow-[0_0_8px_rgba(36,98,144,0.8)]" />
                            <span>Engineer</span>
                          </div>
                        )}
                        {/* Status badges */}
                        {msg.status === 'SENDING' && (
                          <span className="text-[10px] text-[#969498] flex items-center gap-1">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            {isAr ? 'جاري الإرسال...' : 'Sending...'}
                          </span>
                        )}
                        {msg.status === 'PROCESSING' && (
                          <span className="text-[10px] text-[#38bdf8] flex items-center gap-1 animate-pulse">
                            <Loader2 className="w-2.5 h-2.5 animate-spin" />
                            {isAr ? 'قيد المعالجة...' : 'Processing...'}
                          </span>
                        )}
                        {msg.status === 'STREAMING' && (
                          <span className="text-[10px] text-[#38bdf8] flex items-center gap-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8] animate-ping" />
                            {isAr ? 'يكتب...' : 'Typing...'}
                          </span>
                        )}
                        {msg.status === 'CANCELLED' && (
                          <span className="text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                            {isAr ? 'تم الإيقاف' : 'Cancelled'}
                          </span>
                        )}
                        {msg.status === 'FAILED' && (
                          <span className="text-[10px] text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded border border-rose-500/20">
                            {isAr ? 'تعذر الإكمال' : 'Failed'}
                          </span>
                        )}
                      </div>

                      {/* Actions: visible on hover */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-[#1e1e21] border border-[#36363b] rounded-lg p-0.5 shadow-md">
                        {msg.role === 'user' && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingMsgId(msg.id);
                              setChatInput(msg.content);
                            }}
                            title={isAr ? 'تعديل الرسالة' : 'Edit message'}
                            className="p-1 rounded hover:bg-white/10 text-[#96969e] hover:text-[#f4f1f5] cursor-pointer"
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
                          className="p-1 rounded hover:bg-white/10 text-[#96969e] hover:text-[#f4f1f5] cursor-pointer"
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
                            className="p-1 rounded hover:bg-white/10 text-[#96969e] hover:text-[#f4f1f5] cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3 stroke-[2]" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Attached files preview in message */}
                    {msg.attachments && msg.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {msg.attachments.map((att, idx) => (
                          <div
                            key={idx}
                            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#252529] border border-[#36363b] text-[10px] text-[#f4f1f5]"
                          >
                            <FileText className="w-3 h-3 text-[#96969e]" />
                            <span className="max-w-[120px] truncate">{att.name}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Content */}
                    {msg.role === 'assistant' ? (
                      <div className="space-y-3">
                        <SmartResponseRenderer
                          content={formatUserFacingResponse(msg.content)}
                          isStreaming={isGenerating && msg.id === activeChatThread.messages[activeChatThread.messages.length - 1]?.id}
                          isAr={isAr}
                          onNotify={onNotify}
                        />

                        {/* Error box with explicit retry if failed */}
                        {msg.status === 'FAILED' && (
                          <div className="p-2.5 rounded-lg border border-rose-500/30 bg-rose-950/20 text-rose-300 text-xs flex items-center justify-between gap-2 mt-2">
                            <div className="flex items-center gap-1.5">
                              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-rose-400" />
                              <span>{msg.errorCode || (isAr ? 'حدث خطأ' : 'Error')}</span>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRetryMessage(msg)}
                              className="px-2 py-1 rounded bg-rose-600 hover:bg-rose-500 text-white text-[11px] font-medium flex items-center gap-1 transition-all"
                            >
                              <RotateCcw className="w-3 h-3" />
                              <span>{isAr ? 'إعادة المحاولة' : 'Retry'}</span>
                            </button>
                          </div>
                        )}

                        {/* 4 Interactive Clickable Quick Suggestions */}
                        {(msg.suggestions ||
                          msg.content.includes('أبشر! يسعدني بناء تطبيقك بالكامل') ||
                          msg.content.includes('أي نوع من التطبيقات تود أن أصمم لك اليوم')) && (
                            <div className="pt-2 flex flex-col gap-2 border-t border-white/5">
                              <p className="text-[12px] font-semibold text-[#f4f1f5]">
                                {isAr ? 'اختر أحد المقترحات الجاهزة للبدء فوراً:' : 'Select a suggested application to start immediately:'}
                              </p>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                {[
                                  {
                                    id: 'trading',
                                    title: isAr ? 'منصة تداول وتحليل مالي' : 'Trading Risk Platform',
                                    desc: isAr ? 'حاسبة نسبة المخاطرة والعقود' : 'Risk & Position Sizing Calc',
                                    prompt: 'اصنع لي تطبيق حاسبة نسبة المخاطرة في التداول',
                                    action: 'execute' as const,
                                  },
                                  {
                                    id: 'store',
                                    title: isAr ? 'متجر إلكتروني متكامل' : 'Full E-Commerce Store',
                                    desc: isAr ? 'منتجات رقمية وسداد وسلة' : 'Digital goods, cart & checkout',
                                    prompt: 'اصنع لي متجر إلكتروني متكامل للمنتجات الرقمية مع سلة وسداد',
                                    action: 'execute' as const,
                                  },
                                  {
                                    id: 'crm',
                                    title: isAr ? 'نظام إدارة ومبيعات' : 'Sales & CRM System',
                                    desc: isAr ? 'فواتير وتقارير ولوحة تحكم' : 'Invoices, reports & dashboard',
                                    prompt: 'اصنع لي نظام إدارة مبيعات وفواتير متكامل',
                                    action: 'execute' as const,
                                  },
                                  {
                                    id: 'custom',
                                    title: isAr ? 'تطبيق مخصص بفكرتي' : 'Custom App Idea',
                                    desc: isAr ? 'اكتب مواصفات فكرتك' : 'Type your custom requirements',
                                    prompt: isAr ? 'اصنع لي تطبيق ' : 'Build me an app ',
                                    action: 'input' as const,
                                  },
                                ].map((sug) => (
                                  <button
                                    key={sug.id}
                                    type="button"
                                    onClick={() => {
                                      if (sug.action === 'execute') {
                                        handleExecuteSuggestion(sug.prompt);
                                      } else {
                                        setChatInput(sug.prompt);
                                        setTimeout(() => chatTextareaRef.current?.focus(), 50);
                                      }
                                    }}
                                    className="text-start p-2.5 rounded-xl border border-[#36363b] bg-[#1e1e21] hover:bg-[#252529] hover:border-[#246290] transition-all group cursor-pointer"
                                  >
                                    <div className="text-xs font-bold text-[#f4f1f5] group-hover:text-[#38bdf8] flex items-center justify-between">
                                      <span>{sug.title}</span>
                                      <span className="text-[11px] text-[#246290] group-hover:translate-x-[-2px] transition-transform">←</span>
                                    </div>
                                    <div className="text-[11px] text-[#969498] mt-0.5">{sug.desc}</div>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap leading-relaxed select-text text-[#f4f1f5]">
                        {msg.content}
                      </div>
                    )}
                  </div>
                ))}

              {/* Minimal Generating Status Pill */}
              {isGenerating && (
                <div className="p-2.5 rounded-xl bg-[#1e1e21] border border-[#36363b] flex items-center gap-2.5 text-xs text-[#38bdf8] shadow-sm animate-pulse">
                  <Loader2 className="w-4 h-4 animate-spin text-[#38bdf8] shrink-0" />
                  <span className="flex-1 font-medium">
                    {isAr ? 'Engineer يعمل على طلبك وتحديث المعاينة...' : 'Engineer is executing your request & updating preview...'}
                  </span>
                  <button
                    type="button"
                    onClick={onStopGeneration}
                    className="px-2.5 py-1 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[11px] font-semibold flex items-center gap-1 transition-all"
                  >
                    <Square className="w-3 h-3 fill-current" />
                    <span>{isAr ? 'إيقاف' : 'Stop'}</span>
                  </button>
                </div>
              )}
              {/* Auto-scroll target */}
              <div ref={messagesEndRef} />
            </div>

            {/* Hidden File Input for Attachments */}
            <input
              ref={attachmentInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.doc,.docx,.txt,.md,.json,.js,.ts,.tsx,.jsx,.html,.css,.py,.csv"
              onChange={handleAttachmentFilesSelected}
              className="hidden"
            />

            {/* Redesigned Composer: exactly 4 controls (Send/Stop, Attachments, Model Switcher, Microphone) */}
            <form
              onSubmit={handleSendChatMessage}
              className="p-3 bg-[#151517] border-t border-[#252529] shrink-0 z-10"
            >
              <div className="rounded-xl p-2.5 bg-[#1e1e21] border border-[#36363b] focus-within:border-[#246290] focus-within:ring-1 focus-within:ring-[#1d4066] transition-all space-y-2">
                {/* Pending attachments chips */}
                {pendingAttachments.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pb-2 border-b border-[#2c2c30]">
                    {pendingAttachments.map((att) => (
                      <div
                        key={att.id || att.name}
                        className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#252529] border border-[#36363b] text-[11px] text-[#f4f1f5]"
                      >
                        <FileText className="w-3 h-3 text-[#96969e]" />
                        <span className="max-w-[120px] truncate">{att.name}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveAttachment(att.id || att.name)}
                          className="text-[#96969e] hover:text-red-400 p-0.5"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Auto-expanding Textarea */}
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
                      : (isAr ? 'اكتب رسالتك أو اطلب تعديلاً في التطبيق...' : 'Type a message or describe a change...')
                  }
                  className="w-full bg-transparent text-[#f4f1f5] placeholder-[#9898a0] text-xs leading-relaxed resize-none focus:outline-none min-h-[44px] max-h-[160px] overflow-y-auto"
                />

                {/* Bottom Action Row: Exactly 4 Controls */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#2c2c30]">
                  {/* Left Controls: Attachments + Model Switcher + Microphone */}
                  <div className="flex items-center gap-1.5 relative">
                    {/* Control 1: Attachments */}
                    <button
                      type="button"
                      onClick={() => attachmentInputRef.current?.click()}
                      disabled={isUploadingAttachments}
                      title={isAr ? 'إرفاق ملف أو صورة' : 'Attach file or image'}
                      className="p-1.5 rounded-lg text-[#96969e] hover:text-[#f4f1f5] hover:bg-[#252529] transition-all disabled:opacity-50"
                    >
                      {isUploadingAttachments ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#38bdf8]" />
                      ) : (
                        <Paperclip className="w-4 h-4 stroke-[2]" />
                      )}
                    </button>

                    {/* Control 2: Model Switcher */}
                    <div ref={modelPickerRef} className="relative">
                      <button
                        type="button"
                        onClick={() => setShowModelPicker(!showModelPicker)}
                        title={isAr ? 'اختيار نموذج الذكاء الاصطناعي' : 'Select AI Model'}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[#252529] hover:bg-[#2c2c30] text-[11px] text-[#f4f1f5] border border-[#3a3a3e] transition-all"
                      >
                        <Bot className="w-3.5 h-3.5 text-[#38bdf8]" />
                        <span className="max-w-[110px] truncate font-medium">
                          {availableModels.find((m) => m.id === selectedModel)?.name || selectedModel}
                        </span>
                        <ChevronDown className="w-3 h-3 text-[#96969e]" />
                      </button>

                      {showModelPicker && (
                        <div
                          className="absolute bottom-full mb-1.5 start-0 w-64 rounded-xl bg-[#1e1e21] border border-[#36363b] shadow-2xl p-1.5 z-50 space-y-1 text-xs"
                          dir={isAr ? 'rtl' : 'ltr'}
                        >
                          <div className="px-2 py-1 text-[10px] font-semibold text-[#969498] uppercase tracking-wider border-b border-[#2c2c30]">
                            {isAr ? 'النماذج المتاحة' : 'Available Models'}
                          </div>
                          <div className="max-h-56 overflow-y-auto space-y-0.5">
                            {availableModels.length === 0 ? (
                              <div className="px-2 py-3 text-center text-[#969498] text-[11px]">
                                {isAr ? 'جاري تحميل النماذج...' : 'Loading models...'}
                              </div>
                            ) : (
                              availableModels.map((m) => (
                                <button
                                  key={m.id}
                                  type="button"
                                  disabled={!m.available}
                                  onClick={() => {
                                    setSelectedModel(m.id);
                                    setShowModelPicker(false);
                                    onNotify('info', isAr ? `تم اختيار النموذج: ${m.name}` : `Selected model: ${m.name}`);
                                  }}
                                  className={`w-full text-start px-2 py-1.5 rounded-lg flex items-center justify-between text-xs transition-all ${selectedModel === m.id
                                    ? 'bg-[#183857] text-[#38bdf8] font-semibold'
                                    : m.available
                                      ? 'text-[#f4f1f5] hover:bg-[#252529]'
                                      : 'text-[#706f71] cursor-not-allowed opacity-50'
                                    }`}
                                >
                                  <div className="flex flex-col">
                                    <span className="truncate">{m.name}</span>
                                    <span className="text-[10px] text-[#969498]">{m.provider}</span>
                                  </div>
                                  {!m.available && (
                                    <span className="text-[9px] bg-red-950/40 text-red-400 px-1 py-0.5 rounded border border-red-500/20">
                                      {isAr ? 'غير مثبت' : 'Not installed'}
                                    </span>
                                  )}
                                </button>
                              ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Control 3: Microphone */}
                    <button
                      type="button"
                      onClick={handleToggleVoiceInput}
                      title={
                        isRecordingVoice
                          ? (isAr ? 'إيقاف التسجيل الصوتي' : 'Stop voice recording')
                          : (isAr ? 'تسجيل صوتي' : 'Voice input')
                      }
                      className={`p-1.5 rounded-lg transition-all ${isRecordingVoice
                        ? 'bg-red-500/20 text-red-400 animate-pulse border border-red-500/40'
                        : 'text-[#96969e] hover:text-[#f4f1f5] hover:bg-[#252529]'
                        }`}
                    >
                      {isRecordingVoice ? (
                        <MicOff className="w-4 h-4 stroke-[2]" />
                      ) : (
                        <Mic className="w-4 h-4 stroke-[2]" />
                      )}
                    </button>
                  </div>

                  {/* Control 4: Send (becomes Stop during generation) */}
                  <div className="flex items-center shrink-0">
                    {isGenerating ? (
                      <button
                        type="button"
                        onClick={onStopGeneration}
                        title={isAr ? 'إيقاف التوليد' : 'Stop Generation'}
                        className="p-2 rounded-lg bg-red-600 hover:bg-red-700 text-white flex items-center justify-center transition-all cursor-pointer shadow-sm"
                      >
                        <Square className="w-3.5 h-3.5 fill-current" />
                      </button>
                    ) : (
                      <button
                        type="submit"
                        disabled={!chatInput.trim() && pendingAttachments.length === 0}
                        title={isAr ? 'إرسال الطلب (Enter)' : 'Send Request (Enter)'}
                        className="p-2 rounded-lg bg-[#246290] hover:bg-[#2d78af] disabled:opacity-40 disabled:hover:bg-[#246290] text-white flex items-center justify-center transition-all cursor-pointer disabled:cursor-not-allowed shadow-sm"
                      >
                        <Send className="w-3.5 h-3.5 stroke-[2.4]" />
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
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${centerTab === 'editor' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
                    }`}
                >
                  {isAr ? 'محرر الأكواد (Code Editor)' : 'Code Editor'}
                </button>
                <button
                  type="button"
                  onClick={() => setCenterTab('files')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer ${centerTab === 'files' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
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
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono transition-colors cursor-pointer whitespace-nowrap ${isActive
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
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${showDiffView ? 'bg-violet-600 text-white' : 'hover:bg-white/10 text-zinc-300'
                      }`}
                  >
                    <GitCompare className="w-3 h-3" />
                    <span>{isAr ? 'مقارنة' : 'Diff'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowSymbolsDrawer(!showSymbolsDrawer)}
                    title={isAr ? 'الانتقال إلى تعريف الدوال' : 'Go to Function Definitions'}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded cursor-pointer ${showSymbolsDrawer ? 'bg-blue-600 text-white' : 'hover:bg-white/10 text-zinc-300'
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
                          className={`px-2 py-0.5 rounded flex gap-3 ${d.type === 'added'
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
                      className={`${log.level === 'error'
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
          className={`${isFullscreenPreview ? 'w-full' : isEditMode ? 'hidden' : 'flex-1'
            } min-w-0 bg-[#090D18] flex flex-col min-h-0 ${mobileActiveView === 'preview' ? 'flex' : 'hidden lg:flex'
            }`}
        >
          {!isAppServerRunning ? (
            /* Blank-Until-Live Specification: Deep black #09090B with ZERO buttons, ZERO words, ZERO toolbars */
            <div data-testid="blank-preview-canvas" className="w-full h-full bg-[#09090B]" />
          ) : (
            <div className="w-full h-full flex flex-col min-h-0 animate-fadeIn duration-300">
              {/* Single Slim Toolbar (h-11 px-3 flex items-center justify-between flex-nowrap overflow-hidden) */}
              <div className="h-11 px-3 glass-toolbar flex items-center justify-between flex-nowrap overflow-hidden text-xs shrink-0 z-20">
                {/* Left Side: Status pill + Visual Click-to-Edit Inspector + Instant Snapshot Undo */}
                <div className="flex items-center gap-2 flex-nowrap shrink-0">
                  {/* Status Pill */}
                  {isGenerating ? (
                    <span className="status-pill status-pill-building flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 shrink-0">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span className="hidden sm:inline">{isAr ? 'جاري البناء...' : 'Building...'}</span>
                    </span>
                  ) : (
                    <span className="status-pill status-pill-running flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 shrink-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_#34d399]" />
                      <span>Live</span>
                    </span>
                  )}

                  {/* Visual Click-to-Edit Inspector */}
                  <button
                    type="button"
                    onClick={handleToggleInspector}
                    title={isInspectorActive ? (isAr ? 'إلغاء وضع فحص وتعديل العناصر' : 'Cancel Inspector') : (isAr ? 'فحص وتعديل العنصر مرئياً' : 'Visual Click-to-Edit Inspector')}
                    className={`btn btn-sm shrink-0 flex items-center gap-1.5 ${isInspectorActive
                      ? 'btn-primary shadow-[0_0_12px_rgba(59,130,246,0.5)]'
                      : 'btn-secondary text-slate-200'
                      }`}
                  >
                    <MousePointerClick className="w-3.5 h-3.5 stroke-[2]" />
                    <span className="hidden sm:inline">{isInspectorActive ? (isAr ? 'إلغاء الفحص' : 'Cancel') : (isAr ? 'تعديل العنصر' : 'Inspector')}</span>
                  </button>

                  {/* Instant Snapshot Undo */}
                  <button
                    type="button"
                    onClick={handleUndoSnapshot}
                    disabled={projectSnapshots.length === 0}
                    title={isAr ? 'التراجع اللحظي إلى النسخة السابقة' : 'Instant Snapshot Undo'}
                    className="btn btn-secondary btn-sm shrink-0 flex items-center gap-1.5 disabled:opacity-40"
                  >
                    <RotateCcw className="w-3.5 h-3.5 stroke-[2]" />
                    <span className="hidden sm:inline">{isAr ? 'تراجع' : 'Undo'}</span>
                  </button>
                </div>

                {/* Right Side: Viewports (icon-only) + Refresh + </> Edit Code + Glowing Deploy */}
                <div className="flex items-center gap-2 flex-nowrap shrink-0">
                  {/* Viewport Switcher (Icon-only) */}
                  <div className="segmented-pill-container shrink-0 flex items-center">
                    <button
                      type="button"
                      onClick={() => setPreviewDevice('desktop')}
                      aria-label="Desktop Preview"
                      title={isAr ? 'معاينة سطح المكتب' : 'Desktop Viewport'}
                      className={`segmented-pill-btn !p-1.5 ${previewDevice === 'desktop' ? 'segmented-pill-btn-active' : ''
                        }`}
                    >
                      <Monitor className="w-3.5 h-3.5 stroke-[2]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewDevice('tablet')}
                      aria-label="Tablet Preview"
                      title={isAr ? 'معاينة التابلت' : 'Tablet Viewport (768px)'}
                      className={`segmented-pill-btn !p-1.5 ${previewDevice === 'tablet' ? 'segmented-pill-btn-active' : ''
                        }`}
                    >
                      <Tablet className="w-3.5 h-3.5 stroke-[2]" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewDevice('mobile')}
                      aria-label="Mobile Preview"
                      title={isAr ? 'معاينة الهاتف' : 'Mobile Viewport (390px)'}
                      className={`segmented-pill-btn !p-1.5 ${previewDevice === 'mobile' ? 'segmented-pill-btn-active' : ''
                        }`}
                    >
                      <Smartphone className="w-3.5 h-3.5 stroke-[2]" />
                    </button>
                  </div>

                  {/* Page selector (multi-page apps / agent-generated screens) */}
                  {previewEntries.length > 1 && (
                    <select
                      data-testid="preview-entry-select"
                      value={previewEntry || previewEntries[0].path}
                      onChange={(e) => setPreviewEntry(e.target.value)}
                      title={isAr ? 'الصفحة المعروضة' : 'Displayed page'}
                      className="h-7 max-w-[150px] rounded-md bg-white/5 border border-white/10 text-slate-200 text-xs px-1.5 shrink-0"
                    >
                      {previewEntries.map((p) => (
                        <option key={p.path} value={p.path}>
                          {p.isScreen ? `▦ ${p.label}` : p.label}
                        </option>
                      ))}
                    </select>
                  )}

                  {/* Refresh Button */}
                  <button
                    type="button"
                    onClick={() => setPreviewRefreshKey((k) => k + 1)}
                    title={isAr ? 'تحديث المعاينة' : 'Refresh Preview'}
                    className="btn btn-secondary btn-sm !p-1.5 shrink-0"
                  >
                    <RefreshCw className="w-3.5 h-3.5 stroke-[2]" />
                  </button>

                  {/* High-Contrast Code Edit Button (Preserves id="toggle-edit-mode-btn") */}
                  <button
                    type="button"
                    id="toggle-edit-mode-btn"
                    data-testid="toggle-edit-mode-btn"
                    onClick={() => setIsEditMode(true)}
                    title={isAr ? 'تحرير الكود والملفات' : 'Edit Code & Files'}
                    className="btn btn-secondary btn-sm border-blue-500/40 text-blue-200 hover:border-blue-400 shrink-0 font-semibold flex items-center gap-1.5"
                  >
                    <Code2 className="w-3.5 h-3.5 stroke-[2] text-blue-400" />
                    <span>{isAr ? '</> تحرير' : '</> Edit'}</span>
                  </button>

                  {/* Glowing Deploy CTA Button */}
                  <button
                    type="button"
                    id="preview-deploy-btn"
                    data-testid="preview-deploy-btn"
                    onClick={() => onOpenModal('deploy')}
                    title={isAr ? 'نشر التطبيق' : 'Deploy Application'}
                    className="btn btn-primary btn-sm shrink-0 font-bold shadow-[0_0_15px_rgba(59,130,246,0.5)] flex items-center gap-1.5"
                  >
                    <Rocket className="w-3.5 h-3.5 stroke-[2]" />
                    <span>{isAr ? 'نشر' : 'Deploy'}</span>
                  </button>
                </div>
              </div>

              {/* Live Application Preview Canvas */}
              <div className="flex-1 bg-[#090D18] flex items-center justify-center p-2 sm:p-4 overflow-hidden relative">
                <div
                  className={`h-full transition-all duration-300 rounded-2xl overflow-hidden glass-card shadow-2xl bg-[#090D18] ${previewDevice === 'mobile'
                    ? 'w-[390px] max-w-full'
                    : previewDevice === 'tablet'
                      ? 'w-[768px] max-w-full'
                      : 'w-full'
                    }`}
                >
                  <iframe
                    key={`${previewRefreshKey}:${previewEntry}`}
                    id="live-app-preview-frame"
                    data-testid="live-app-preview-frame"
                    title={`Live Preview — ${project.name}`}
                    srcDoc={compiledPreviewHtml}
                    sandbox="allow-scripts allow-forms allow-modals allow-downloads"
                    className="w-full h-full border-0"
                  />
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
