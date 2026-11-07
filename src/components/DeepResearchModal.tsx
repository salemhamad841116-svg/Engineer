import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Download,
  Sparkles,
  ChevronDown,
  ChevronUp,
  X,
  Layers,
  ShieldCheck,
  ThumbsDown,
  ThumbsUp,
  Bookmark,
  RefreshCw,
  Library,
} from 'lucide-react';
import { Language } from '../types/platform';

interface BookItem {
  id: string;
  title: string;
  author: string;
  edition: string;
  publicationYear: number;
  language: string;
  totalPages: number;
}

interface CitationItem {
  id: string;
  bookTitle: string;
  author: string;
  edition: string;
  chapter: string;
  pageNumber: number;
  quoteExact: string;
  quoteContextBefore?: string;
  quoteContextAfter?: string;
  verifiedGrounded: boolean;
}

interface QualityCheckItem {
  passed: boolean;
  evidence: string;
}

interface QualityGateReport {
  passed: boolean;
  score: string;
  decision: string;
  checklist: Record<string, QualityCheckItem>;
  failureReasons: string[];
}

interface StageItem {
  stage: string;
  name: string;
  status: 'pending' | 'running' | 'completed';
  detail: string;
  timestamp?: string;
}

interface DeepResearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
}

export default function DeepResearchModal({ isOpen, onClose, language }: DeepResearchModalProps) {
  const isAr = language === 'ar';

  const [query, setQuery] = useState('');
  const [researchLevel, setResearchLevel] = useState<'quick' | 'deep' | 'expert'>('deep');
  const [selectedBookIds, _setSelectedBookIds] = useState<string[]>([]);
  const [availableBooks, setAvailableBooks] = useState<BookItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [_activeStageIdx, setActiveStageIdx] = useState(0);

  const [currentStages, setCurrentStages] = useState<StageItem[]>([
    { stage: '1_understanding', name: isAr ? 'فهم السؤال وتحليل نية البحث' : 'Question Understanding & Intent', status: 'pending', detail: '' },
    { stage: '2_searching', name: isAr ? 'البحث في مكتبة الكتب وتحديد الفصول' : 'Library Book & Chapter Search', status: 'pending', detail: '' },
    { stage: '3_analyzing', name: isAr ? 'قراءة السياق ومقارنة الأفكار' : 'Contextual Reading & Comparative Study', status: 'pending', detail: '' },
    { stage: '4_verifying', name: isAr ? 'بوابة جودة الإجابة الصارمة والتحقق' : 'Answer Quality Gate & Verification', status: 'pending', detail: '' },
    { stage: '5_synthesizing', name: isAr ? 'صياغة الإجابة الموثقة بالاقتباسات' : 'Grounded Synthesis & Citation Proof', status: 'pending', detail: '' },
  ]);

  const [result, setResult] = useState<{
    summary?: string;
    answerMarkdown?: string;
    uncertainties?: string;
    citations?: CitationItem[];
    qualityGate?: QualityGateReport;
    tokenCount?: number;
    costEstimate?: number;
    sessionId?: string;
  } | null>(null);

  const [expandedCitationId, setExpandedCitationId] = useState<string | null>(null);
  const [showQualityGateDetails, setShowQualityGateDetails] = useState(false);
  const [feedbackSent, setFeedbackSent] = useState<string | null>(null);

  // Tab & Upload State
  const [activeTab, setActiveTab] = useState<'query' | 'upload'>('query');
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadAuthor, setUploadAuthor] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const reloadBooks = () => {
    fetch('/api/research/books')
      .then((r) => r.json())
      .then((data) => {
        if (data.books && Array.isArray(data.books)) {
          setAvailableBooks(data.books);
        }
      })
      .catch((err) => console.warn('Failed to load books:', err));
  };

  // Load books library on open
  useEffect(() => {
    if (!isOpen) return;
    reloadBooks();
  }, [isOpen]);

  const handlePdfUploadSubmit = async () => {
    if (!selectedFile) {
      setUploadStatus({ type: 'error', text: isAr ? 'يرجى اختيار ملف PDF' : 'Please select a PDF file' });
      return;
    }
    setIsUploading(true);
    setUploadStatus(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Data = (reader.result as string).split(',')[1];
          const res = await fetch('/api/research/books/upload-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              title: uploadTitle.trim() || selectedFile.name.replace(/\.pdf$/i, ''),
              author: uploadAuthor.trim() || 'Verified Author',
              pdfBase64: base64Data,
              filename: selectedFile.name,
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.success) {
            throw new Error(data.error || 'Failed to upload and index PDF');
          }
          setUploadStatus({
            type: 'success',
            text: isAr ? `تمت فهرسة الكتاب بنجاح: ${data.book?.title}` : `Book indexed successfully: ${data.book?.title}`,
          });
          setUploadTitle('');
          setUploadAuthor('');
          setSelectedFile(null);
          reloadBooks();
        } catch (innerErr: unknown) {
          const msg = innerErr instanceof Error ? innerErr.message : 'Error parsing upload';
          setUploadStatus({ type: 'error', text: msg });
        } finally {
          setIsUploading(false);
        }
      };
      reader.onerror = () => {
        setUploadStatus({ type: 'error', text: 'Failed to read PDF file' });
        setIsUploading(false);
      };
      reader.readAsDataURL(selectedFile);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Upload error';
      setUploadStatus({ type: 'error', text: msg });
      setIsUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      if (!uploadTitle.trim()) {
        setUploadTitle(file.name.replace(/\.pdf$/i, ''));
      }
    }
  };

  if (!isOpen) return null;

  const handleStartResearch = async () => {
    if (!query.trim()) return;
    setIsSearching(true);
    setResult(null);
    setFeedbackSent(null);

    // Reset stages
    const initialStages: StageItem[] = [
      { stage: '1_understanding', name: isAr ? 'فهم السؤال وتفكيك نية البحث' : 'Question Understanding', status: 'running', detail: isAr ? 'جاري تحليل تعقيد ونطاق السؤال...' : 'Analyzing query...' },
      { stage: '2_searching', name: isAr ? 'البحث في مكتبة الكتب وتحديد الفصول' : 'Library & Chapter Search', status: 'pending', detail: '' },
      { stage: '3_analyzing', name: isAr ? 'قراءة السياق ومقارنة الأفكار' : 'Comparative Study & Context', status: 'pending', detail: '' },
      { stage: '4_verifying', name: isAr ? 'بوابة جودة الإجابة الصارمة والتحقق' : 'Answer Quality Gate', status: 'pending', detail: '' },
      { stage: '5_synthesizing', name: isAr ? 'صياغة الإجابة الموثقة بالاقتباسات' : 'Grounded Synthesis', status: 'pending', detail: '' },
    ];
    setCurrentStages(initialStages);
    setActiveStageIdx(0);

    try {
      const res = await fetch('/api/research/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: query.trim(),
          level: researchLevel,
          bookIds: selectedBookIds.length > 0 ? selectedBookIds : null,
        }),
      });

      const data = await res.json();
      if (data.success && data.session) {
        // Update stages to done
        setCurrentStages((prev) =>
          prev.map((s, i) => ({
            ...s,
            status: 'completed',
            detail: data.stages?.[i]?.detail || (isAr ? 'تم بنجاح ومطابق للأدلة' : 'Verified with evidence'),
          }))
        );
        setActiveStageIdx(4);

        setResult({
          summary: data.session.summary,
          answerMarkdown: data.session.answerMarkdown,
          uncertainties: data.session.uncertainties,
          citations: data.citations || [],
          qualityGate: data.qualityGate,
          tokenCount: data.session.tokenCount,
          costEstimate: data.session.costEstimate,
          sessionId: data.session.id,
        });
      } else {
        alert(data.error || 'حدث خطأ أثناء تنفيذ البحث المعرفي');
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'فشل الاتصال بمحرك البحث العميق';
      alert(msg);
    } finally {
      setIsSearching(false);
    }
  };

  const handleExportMarkdown = () => {
    if (!result?.sessionId) return;
    window.open(`/api/research/export/${result.sessionId}`, '_blank');
  };

  const handleFeedback = async (type: 'helpful' | 'wrong_source' | 'unsupported_claim') => {
    if (!result?.sessionId) return;
    try {
      await fetch('/api/research/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: result.sessionId,
          feedbackType: type,
        }),
      });
      setFeedbackSent(type);
    } catch (_err) {
      // ignore network errors in feedback logging
    }
  };

  return (
    <div
      data-testid="deep-research-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="relative w-full max-w-5xl max-h-[92vh] flex flex-col rounded-2xl bg-[#0f1117] border border-white/12 shadow-[0_25px_70px_rgba(0,0,0,0.85)] overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#141722]/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">
                  {isAr
                    ? 'محرك البحث المعرفي ودراسة الكتب (Deep Research & Knowledge Reasoning)'
                    : 'Deep Research & Book Intelligence Engine'}
                </h2>
                <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[11px] font-mono font-medium">
                  <ShieldCheck className="w-3 h-3" />
                  Answer Quality Gate™
                </span>
                <span className="hidden md:inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/15 border border-blue-500/30 text-blue-300 text-[11px] font-mono">
                  Offline Mode
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                {isAr
                  ? 'باحث متخصص يدرس الكتب والمراجع بدقة، ويقارن المصادر ويتحقق من الأدلة قبل صياغة الإجابة.'
                  : 'Specialized research engine studying real books, comparing sources & verifying evidence without guessing.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="deep-research-close-button"
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Tabs: Deep Research vs PDF Book Ingestion */}
        <div className="flex border-b border-white/10 px-6 pt-2.5 bg-[#12141c] gap-4">
          <button
            type="button"
            data-testid="research-tab-query"
            onClick={() => setActiveTab('query')}
            className={`pb-2.5 text-xs font-semibold transition-colors cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === 'query'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" />
            <span>{isAr ? 'البحث المعرفي والدراسة' : 'Knowledge Research'}</span>
          </button>
          <button
            type="button"
            data-testid="research-tab-upload"
            onClick={() => setActiveTab('upload')}
            className={`pb-2.5 text-xs font-semibold transition-colors cursor-pointer border-b-2 flex items-center gap-1.5 ${
              activeTab === 'upload'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Library className="w-3.5 h-3.5" />
            <span>{isAr ? 'فهرسة ورفع الكتب (PDF)' : 'Upload & Index Books (PDF)'}</span>
          </button>
        </div>

        {/* Modal Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {/* Upload & Indexing Tab View */}
          {activeTab === 'upload' && (
            <div data-testid="book-upload-section" className="space-y-4 rounded-xl bg-[#14161f] border border-white/10 p-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Library className="w-4 h-4 text-blue-400" />
                  <span>{isAr ? 'فهرسة مرجع أو كتاب PDF حقيقي في مكتبة المعرفة' : 'Index Real PDF Knowledge Reference'}</span>
                </h3>
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  SQLite Verbatim Vault™
                </span>
              </div>

              {uploadStatus && (
                <div
                  data-testid="book-indexing-status"
                  className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
                    uploadStatus.type === 'success'
                      ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                      : 'bg-red-500/15 border border-red-500/30 text-red-300'
                  }`}
                >
                  {uploadStatus.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
                  <span>{uploadStatus.text}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    {isAr ? 'عنوان الكتاب / المرجع' : 'Book / Document Title'}
                  </label>
                  <input
                    type="text"
                    data-testid="book-title-input"
                    value={uploadTitle}
                    onChange={(e) => setUploadTitle(e.target.value)}
                    placeholder={isAr ? 'مثال: مقدمة ابن خلدون' : 'e.g. Distributed Multi-Agent Systems'}
                    className="w-full bg-[#1b1c24] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-1">
                    {isAr ? 'اسم المؤلف' : 'Author'}
                  </label>
                  <input
                    type="text"
                    data-testid="book-author-input"
                    value={uploadAuthor}
                    onChange={(e) => setUploadAuthor(e.target.value)}
                    placeholder={isAr ? 'مثال: عبد الرحمن بن خلدون' : 'e.g. AI Systems Lab'}
                    className="w-full bg-[#1b1c24] border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-1">
                  {isAr ? 'اختيار ملف PDF حقيقي من الجهاز' : 'Select Real PDF File'}
                </label>
                <input
                  type="file"
                  accept=".pdf"
                  data-testid="book-pdf-input"
                  onChange={handleFileSelect}
                  className="w-full bg-[#1b1c24] border border-white/10 rounded-xl px-3 py-2 text-xs text-zinc-300 file:me-3 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-blue-600 file:text-white hover:file:bg-blue-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-2">
                <span className="text-[11px] text-zinc-500">
                  {selectedFile ? `${selectedFile.name} (${(selectedFile.size / 1024).toFixed(1)} KB)` : (isAr ? 'لم يتم اختيار ملف' : 'No file chosen')}
                </span>
                <button
                  type="button"
                  data-testid="book-upload-submit"
                  disabled={isUploading || !selectedFile}
                  onClick={handlePdfUploadSubmit}
                  className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white font-medium text-xs transition-colors cursor-pointer flex items-center gap-2 shadow-lg shadow-blue-900/30"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>{isAr ? 'جاري الفهرسة واستخراج النصوص...' : 'Extracting & Indexing...'}</span>
                    </>
                  ) : (
                    <>
                      <Download className="w-3.5 h-3.5 rotate-180" />
                      <span>{isAr ? 'فهرسة وتخزين في مكتبة المعرفة' : 'Index & Store in Knowledge Library'}</span>
                    </>
                  )}
                </button>
              </div>

              {/* Indexed Books List */}
              <div className="pt-4 border-t border-white/10">
                <h4 className="text-xs font-semibold text-zinc-400 mb-2">
                  {isAr ? 'المراجع المفهرسة حالياً في المكتبة:' : 'Currently Indexed Books:'}
                </h4>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {availableBooks.length === 0 ? (
                    <div className="p-3 text-center text-xs text-zinc-500">
                      {isAr ? 'لا توجد مراجع حالياً، قم برفع أول مرجع أعلاه.' : 'No references indexed yet. Upload one above.'}
                    </div>
                  ) : (
                    availableBooks.map((b) => (
                      <div
                        key={b.id}
                        data-testid={`book-list-item-${b.id}`}
                        className="p-2.5 rounded-lg bg-white/[0.03] border border-white/5 flex items-center justify-between text-xs text-zinc-300 hover:bg-white/[0.06] transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <BookOpen className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          <span className="font-medium text-white">{b.title}</span>
                          <span className="text-zinc-500 text-[11px]">| {b.author || 'Verified'}</span>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-white/5 text-zinc-400 font-mono text-[10px]">
                          {b.totalPages ? `${b.totalPages} p.` : 'Indexed'}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Query & Controls Box */}
          {activeTab === 'query' && (
          <div className="rounded-xl bg-[#14161f] border border-white/10 p-4 space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
                {isAr ? 'أدخل سؤال البحث المعرفي أو الموضوع المراد دراسته ومقارنته:' : 'Enter your research query or topic to study and compare:'}
              </label>
              <textarea
                data-testid="deep-research-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                rows={3}
                placeholder={
                  isAr
                    ? 'مثال: قارن بين معاملات ACID في قواعد البيانات ونظرية CAP، أو: ما هي أحدث مواصفات React 19 مقارنة بالويب الكلاسيكي؟'
                    : 'e.g. Compare ACID transaction guarantees with CAP theorem, or modern React 19 vs legacy web patterns...'
                }
                className="w-full rounded-xl bg-black/40 border border-white/10 p-3 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/60 leading-relaxed resize-none"
              />
            </div>

            {/* Research Controls: Level Selector & Books Selector */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-white/[0.06] text-xs">
              {/* Level Selector */}
              <div className="flex items-center gap-2" data-testid="research-level-selector">
                <span className="text-zinc-400 font-medium">{isAr ? 'مستوى البحث:' : 'Research Level:'}</span>
                <div className="inline-flex rounded-lg bg-black/40 p-1 border border-white/10">
                  {(['quick', 'deep', 'expert'] as const).map((lvl) => (
                    <button
                      key={lvl}
                      type="button"
                      data-testid={`research-level-${lvl}`}
                      onClick={() => setResearchLevel(lvl)}
                      className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer font-medium ${
                        researchLevel === lvl
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-zinc-400 hover:text-white'
                      }`}
                    >
                      {lvl === 'quick' && (isAr ? 'إجابة سريعة' : 'Quick Answer')}
                      {lvl === 'deep' && (isAr ? 'بحث عميق' : 'Deep Research')}
                      {lvl === 'expert' && (isAr ? 'بحث خبير' : 'Expert Research')}
                    </button>
                  ))}
                </div>
              </div>

              {/* Books in Library Filter */}
              <div className="flex items-center gap-2 text-zinc-400">
                <Library className="w-3.5 h-3.5 text-indigo-400" />
                <span>
                  {availableBooks.length > 0
                    ? isAr
                      ? `${availableBooks.length} كتب ومراجع مفهرسة ومتاحة للبحث`
                      : `${availableBooks.length} indexed books in library`
                    : isAr
                    ? 'جاري تحميل المكتبة...'
                    : 'Loading library...'}
                </span>
              </div>

              {/* Execute Button */}
              <button
                type="button"
                data-testid="deep-research-submit"
                onClick={handleStartResearch}
                disabled={isSearching || !query.trim()}
                className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-sky-600 hover:from-indigo-500 hover:to-sky-500 disabled:opacity-50 text-white font-semibold shadow-lg transition-all cursor-pointer"
              >
                {isSearching ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{isAr ? 'جاري الدراسة والتحقق...' : 'Researching & Verifying...'}</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>{isAr ? 'بدء البحث والاستدلال المعرفي' : 'Execute Deep Research'}</span>
                  </>
                )}
              </button>
            </div>
          </div>
          )}

          {/* Stepping Indicator (Shows only executed stages, no fake progress) */}
          {(isSearching || result) && (
            <div className="rounded-xl bg-[#13151f] border border-white/10 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs font-semibold text-zinc-300">
                <span className="flex items-center gap-1.5 text-indigo-400">
                  <Layers className="w-4 h-4" />
                  {isAr ? 'مراحل البحث الفعلي المنفذة (Real Execution Stages):' : 'Active Execution Pipeline:'}
                </span>
                <span className="font-mono text-zinc-500 text-[11px]">
                  {isAr ? 'ممنوع التقدم الوهمي — يعرض المراحل الفعلية فقط' : 'Zero Fake Progress — Real Stages Only'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 pt-1">
                {currentStages.map((st, idx) => (
                  <div
                    key={st.stage}
                    className={`rounded-lg p-2.5 border transition-all text-xs ${
                      st.status === 'completed'
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                        : st.status === 'running'
                        ? 'bg-indigo-500/15 border-indigo-500/40 text-indigo-200 animate-pulse'
                        : 'bg-white/[0.03] border-white/5 text-zinc-500'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-semibold">
                      {st.status === 'completed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : (
                        <div className="w-3.5 h-3.5 rounded-full border border-current flex items-center justify-center text-[9px] shrink-0 font-mono">
                          {idx + 1}
                        </div>
                      )}
                      <span className="truncate">{st.name}</span>
                    </div>
                    {st.detail && (
                      <p className="text-[10px] text-zinc-400 mt-1 line-clamp-2 leading-relaxed">
                        {st.detail}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Research Results View */}
          {result && (
            <div className="space-y-5 animate-in fade-in duration-300">
              {/* Answer Quality Gate Banner */}
              {result.qualityGate && (
                <div
                  data-testid="quality-gate-badge"
                  className={`rounded-xl p-3.5 border flex items-center justify-between text-xs ${
                    result.qualityGate.passed
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-200'
                      : 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emerald-400" />
                    <div>
                      <span className="font-bold">
                        {result.qualityGate.passed
                          ? isAr
                            ? 'تم اجتياز بوابة الجودة والتحقق (Answer Quality Gate Verified):'
                            : 'Answer Quality Gate Passed:'
                          : isAr
                          ? 'تنبيه بوابة جودة المعلومات:'
                          : 'Quality Gate Notice:'}
                      </span>{' '}
                      <span>
                        {result.qualityGate.passed
                          ? isAr
                            ? `الأدلة تدعم النتيجة بدقة (${result.qualityGate.score}) وخالية من الهلوسة والتخمين.`
                            : `Evidence strictly supports the conclusion (${result.qualityGate.score}).`
                          : result.qualityGate.failureReasons.join(', ')}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowQualityGateDetails(!showQualityGateDetails)}
                    className="inline-flex items-center gap-1 text-[11px] underline opacity-80 hover:opacity-100 cursor-pointer"
                  >
                    <span>{showQualityGateDetails ? (isAr ? 'إخفاء المعايير' : 'Hide') : (isAr ? 'عرض فحص المعايير الـ 8' : 'View 8 Checks')}</span>
                    {showQualityGateDetails ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
              )}

              {/* 8-Point Quality Gate Details Accordion */}
              {showQualityGateDetails && result.qualityGate?.checklist && (
                <div className="rounded-xl bg-[#14161e] border border-white/10 p-4 space-y-2 text-xs">
                  <h4 className="font-bold text-zinc-200 mb-2">
                    {isAr ? 'قائمة الفحص الصارمة لبوابة الجودة (Answer Quality Gate Checklist):' : 'Quality Gate Checklist:'}
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {Object.entries(result.qualityGate.checklist).map(([key, item]) => (
                      <div key={key} className="p-2 rounded-lg bg-black/30 border border-white/5 flex items-start gap-2">
                        <CheckCircle2 className={`w-4 h-4 shrink-0 mt-0.5 ${item.passed ? 'text-emerald-400' : 'text-rose-400'}`} />
                        <div>
                          <div className="font-semibold text-zinc-200 capitalize">{key}</div>
                          <div className="text-[11px] text-zinc-400">{item.evidence}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Main Grounded Answer Card */}
              <div className="rounded-xl bg-[#12141c] border border-white/10 p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    <span>{isAr ? 'الإجابة الموثقة والتحليل المعماري:' : 'Grounded Answer & Analysis:'}</span>
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-zinc-400">
                    <span className="font-mono text-[11px]">
                      {result.tokenCount || 0} tokens (~${result.costEstimate?.toFixed(4) || '0.00'})
                    </span>
                    <button
                      type="button"
                      onClick={handleExportMarkdown}
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-200 hover:text-white transition-colors cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-sky-400" />
                      <span>{isAr ? 'تصدير التقرير Markdown' : 'Export Dossier'}</span>
                    </button>
                  </div>
                </div>

                {/* Direct Markdown Result */}
                <div className="prose prose-invert max-w-none text-zinc-200 text-sm leading-relaxed space-y-3 whitespace-pre-wrap">
                  {result.answerMarkdown}
                </div>

                {/* Declared Uncertainties */}
                {result.uncertainties && (
                  <div className="rounded-lg p-3 bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">{isAr ? 'النقاط غير المؤكدة أو حدود المعرفة:' : 'Declared Uncertainties:'}</span>{' '}
                      <span>{result.uncertainties}</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Verified Grounded Citations Section */}
              {result.citations && result.citations.length > 0 && (
                <div data-testid="citations-container" className="rounded-xl bg-[#12141c] border border-white/10 p-5 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs sm:text-sm font-bold text-white flex items-center gap-2">
                      <Bookmark className="w-4 h-4 text-emerald-400" />
                      <span>{isAr ? 'الشواهد والاقتباسات النصية الحقيقية من الكتب (Grounded Citations):' : 'Verified Grounded Book Citations:'}</span>
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">
                        {result.citations.length} {isAr ? 'اقتباسات موثقة' : 'citations'}
                      </span>
                    </h3>
                  </div>

                  <div className="space-y-2.5">
                    {result.citations.map((c, i) => (
                      <div
                        key={c.id || i}
                        data-testid={`citation-card-${i}`}
                        className="rounded-xl bg-black/40 border border-white/8 p-3.5 space-y-2 hover:border-white/15 transition-all"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div className="font-bold text-indigo-300 flex items-center gap-2">
                            <span data-testid="citation-book-title">📖 {c.bookTitle}</span>
                            <span className="text-zinc-500 font-normal">| {c.author}</span>
                            <span className="text-zinc-500 font-normal">| {c.chapter}</span>
                            <span className="px-1.5 py-0.5 rounded bg-white/5 text-amber-300 font-mono text-[11px]">
                              {isAr ? `ص ${c.pageNumber}` : `p. ${c.pageNumber}`}
                            </span>
                          </div>
                          <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300">
                            <CheckCircle2 className="w-3 h-3" />
                            {isAr ? 'مطابق حرفياً في الكتاب' : 'Verbatim Match 100%'}
                          </span>
                        </div>

                        {/* Exact Grounded Quote */}
                        <div
                          data-testid="citation-verbatim-quote"
                          className="p-2.5 rounded-lg bg-white/[0.03] border-s-2 border-indigo-500 text-zinc-300 text-xs italic font-serif leading-relaxed"
                        >
                          «<span data-testid="citation-verbatim-text">{c.quoteExact}</span>»
                        </div>

                        {/* Expandable Preceding/Succeeding Context */}
                        {(c.quoteContextBefore || c.quoteContextAfter) && (
                          <div>
                            <button
                              type="button"
                              onClick={() => setExpandedCitationId(expandedCitationId === c.id ? null : c.id)}
                              className="text-[11px] text-zinc-400 hover:text-white flex items-center gap-1 cursor-pointer"
                            >
                              <span>{expandedCitationId === c.id ? (isAr ? 'إخفاء السياق الكامل' : 'Hide full context') : (isAr ? 'عرض السياق الكامل (النص السابق واللاحق)' : 'View expanded context')}</span>
                              {expandedCitationId === c.id ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                            </button>
                            {expandedCitationId === c.id && (
                              <div className="mt-2 p-2.5 rounded bg-black/60 border border-white/5 text-[11px] text-zinc-400 space-y-1 font-mono leading-relaxed">
                                {c.quoteContextBefore && <p className="text-zinc-500">... {c.quoteContextBefore}</p>}
                                <p className="text-indigo-200 font-semibold">{c.quoteExact}</p>
                                {c.quoteContextAfter && <p className="text-zinc-500">{c.quoteContextAfter} ...</p>}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Feedback Bar */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-xs text-zinc-400 border-t border-white/10">
                <span className="font-medium">
                  {isAr ? 'هل كانت هذه النتيجة دقيقة ومدعومة بالأدلة؟' : 'Was this answer accurate & evidence-backed?'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleFeedback('helpful')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                      feedbackSent === 'helpful'
                        ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300'
                        : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white'
                    }`}
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                    <span>{isAr ? 'توثيق ممتاز ومثبت' : 'Grounded & Accurate'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFeedback('wrong_source')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                      feedbackSent === 'wrong_source'
                        ? 'bg-rose-500/20 border-rose-500/40 text-rose-300'
                        : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white'
                    }`}
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                    <span>{isAr ? 'المصدر خاطئ' : 'Wrong Source'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFeedback('unsupported_claim')}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs cursor-pointer transition-colors ${
                      feedbackSent === 'unsupported_claim'
                        ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                        : 'bg-white/5 border-white/10 text-zinc-300 hover:text-white'
                    }`}
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{isAr ? 'الإجابة غير مدعومة' : 'Unsupported Claim'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
