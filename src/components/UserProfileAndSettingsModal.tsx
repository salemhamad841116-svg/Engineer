// src/components/UserProfileAndSettingsModal.tsx
// Phase 10: Complete User Profile, Account Statistics, Security, Synchronized Settings & Data Portability
import React, { useState, useEffect, useRef } from 'react';
import {
  User,
  HardDrive,
  BookOpen,
  Search,
  Star,
  Key,
  Shield,
  Laptop,
  Smartphone,
  Sliders,
  Download,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  X,
  Loader2,
  Camera,
} from 'lucide-react';
import {
  UserProfileContract,
  UserSettingsContract,
  ActiveSessionContract,
  BookItemContract,
  ResearchSessionContract,
  UserFeedbackExportItemContract,
} from '../contracts/index';

interface TabDefinition {
  id: 'profile' | 'activity' | 'security' | 'settings' | 'danger';
  icon: typeof User;
  labelAr: string;
  labelEn: string;
  danger?: boolean;
}

const TAB_DEFINITIONS: TabDefinition[] = [
  { id: 'profile', icon: User, labelAr: 'الملف والإحصاءات', labelEn: 'Profile & Stats' },
  { id: 'activity', icon: BookOpen, labelAr: 'نشاطي ومكتبي', labelEn: 'My Activity' },
  { id: 'security', icon: Shield, labelAr: 'الأمان والجلسات', labelEn: 'Security & Sessions' },
  { id: 'settings', icon: Sliders, labelAr: 'إعدادات التطبيق', labelEn: 'App Preferences' },
  { id: 'danger', icon: AlertTriangle, labelAr: 'منطقة الخطر', labelEn: 'Danger Zone', danger: true },
];

interface UserProfileAndSettingsModalProps {
  isOpen: boolean;
  initialTab?: 'profile' | 'activity' | 'security' | 'settings' | 'danger';
  language: 'ar' | 'en';
  onClose: () => void;
  onLogout: () => void;
  onNotify: (type: 'success' | 'error' | 'info', message: string) => void;
  onProfileUpdated?: (updated: { name?: string; email?: string }) => void;
}

export const UserProfileAndSettingsModal: React.FC<UserProfileAndSettingsModalProps> = ({
  isOpen,
  initialTab = 'profile',
  language,
  onClose,
  onLogout,
  onNotify,
  onProfileUpdated,
}) => {
  const isAr = language === 'ar';
  const [activeTab, setActiveTab] = useState<'profile' | 'activity' | 'security' | 'settings' | 'danger'>(initialTab);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setActiveTab(initialTab);
    }
  }, [isOpen, initialTab]);

  // Profile state
  const [profile, setProfile] = useState<UserProfileContract | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Settings state
  const [settings, setSettings] = useState<UserSettingsContract>({
    userId: '',
    language: 'ar',
    theme: 'dark',
    defaultResearchTier: 'deep',
    showPageNumbers: true,
    answerLength: 'detailed',
    showQualityBadges: true,
    retainSearchHistory: true,
  });

  // Sessions state
  const [sessions, setSessions] = useState<ActiveSessionContract[]>([]);

  // Activity state
  const [books, setBooks] = useState<BookItemContract[]>([]);
  const [searches, setSearches] = useState<ResearchSessionContract[]>([]);
  const [feedbacks, setFeedbacks] = useState<UserFeedbackExportItemContract[]>([]);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Delete account state
  const [deletePassword, setDeletePassword] = useState('');
  const [deletePhrase, setDeletePhrase] = useState('');
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  useEffect(() => {
    if (isOpen) {
      fetchInitialData();
    }
  }, [isOpen]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const [profileRes, settingsRes, sessionsRes, activityRes] = await Promise.all([
        fetch('/api/user/profile', { headers: { 'x-requested-with': 'XMLHttpRequest' } }),
        fetch('/api/user/settings', { headers: { 'x-requested-with': 'XMLHttpRequest' } }),
        fetch('/api/user/sessions', { headers: { 'x-requested-with': 'XMLHttpRequest' } }),
        fetch('/api/user/activity', { headers: { 'x-requested-with': 'XMLHttpRequest' } }),
      ]);

      if (profileRes.ok) {
        const pData = await profileRes.json();
        setProfile(pData.profile);
        setNameInput(pData.profile.name || '');
        setAvatarPreview(pData.profile.avatarUrl || null);
      }

      if (settingsRes.ok) {
        const sData = await settingsRes.json();
        setSettings(sData.settings);
      }

      if (sessionsRes.ok) {
        const sesData = await sessionsRes.json();
        setSessions(sesData.sessions || []);
      }

      if (activityRes.ok) {
        const actData = await activityRes.json();
        setBooks(actData.books || []);
        setSearches(actData.searches || []);
        setFeedbacks(actData.feedbacks || []);
      }
    } catch (_err) {
      onNotify('error', isAr ? 'تعذر تحميل بيانات الحساب' : 'Failed to load user profile data');
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      onNotify('error', isAr ? 'حجم الصورة يجب ألا يتجاوز 2 ميجابايت' : 'Avatar image must not exceed 2MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result as string;
      setAvatarPreview(result);
    };
    reader.readAsDataURL(file);
  };

  const handleSaveProfile = async () => {
    if (!nameInput.trim()) {
      onNotify('error', isAr ? 'الاسم مطلوب' : 'Name is required');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        body: JSON.stringify({ name: nameInput.trim(), avatarUrl: avatarPreview }),
      });
      const data = await res.json();
      if (res.ok) {
        setProfile(data.profile);
        onProfileUpdated?.({ name: data.profile.name, email: data.profile.email });
        onNotify('success', isAr ? 'تم تحديث الملف الشخصي بنجاح' : 'Profile updated successfully');
      } else {
        onNotify('error', data.message || (isAr ? 'فشل حفظ الملف الشخصي' : 'Failed to update profile'));
      }
    } catch (_err) {
      onNotify('error', isAr ? 'خطأ في الاتصال بالخادم' : 'Server connection error');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveSettings = async (patch: Partial<UserSettingsContract>) => {
    const updated = { ...settings, ...patch };
    setSettings(updated);
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        const data = await res.json();
        setSettings(data.settings);
        onNotify('success', isAr ? 'تم حفظ ومزامنة الإعدادات سحابياً' : 'Settings synchronized to server');
      }
    } catch (_err) {
      onNotify('error', isAr ? 'تعذر مزامنة الإعدادات' : 'Failed to sync settings');
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await fetch(`/api/user/sessions/${sessionId}/revoke`, {
        method: 'POST',
        headers: { 'x-requested-with': 'XMLHttpRequest' },
      });
      if (res.ok) {
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        onNotify('success', isAr ? 'تم إنهاء الجلسة بنجاح' : 'Session revoked successfully');
      }
    } catch (_err) {
      onNotify('error', isAr ? 'فشل إنهاء الجلسة' : 'Failed to revoke session');
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword) {
      onNotify('error', isAr ? 'يرجى إدخال كلمة المرور الحالية والجديدة' : 'Please provide current and new password');
      return;
    }
    if (newPassword !== confirmPassword) {
      onNotify('error', isAr ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/user/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        onNotify('success', isAr ? 'تم تغيير كلمة المرور وإبطال الجلسات الأخرى' : 'Password changed & other sessions revoked');
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        fetchInitialData();
      } else {
        onNotify('error', data.message || (isAr ? 'فشل تغيير كلمة المرور' : 'Failed to change password'));
      }
    } catch (_err) {
      onNotify('error', isAr ? 'خطأ في الاتصال' : 'Connection error');
    } finally {
      setSaving(false);
    }
  };

  const handleExportData = () => {
    window.open('/api/user/export-data', '_blank');
    onNotify('info', isAr ? 'بدء تنزيل حزمة بياناتك بصيغة JSON' : 'Starting data export download');
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      onNotify('error', isAr ? 'كلمة المرور مطلوبة لتأكيد الحذف' : 'Password is required to confirm deletion');
      return;
    }
    const requiredPhrase = isAr ? 'احذف حسابي نهائياً' : 'DELETE MY ACCOUNT';
    if (deletePhrase.trim() !== 'احذف حسابي نهائياً' && deletePhrase.trim() !== 'DELETE MY ACCOUNT') {
      onNotify('error', isAr ? `يرجى كتابة العبارة التأكيدية بدقة: "${requiredPhrase}"` : `Please type "${requiredPhrase}" to confirm`);
      return;
    }

    setDeleteLoading(true);
    try {
      const res = await fetch('/api/user/delete-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-requested-with': 'XMLHttpRequest' },
        body: JSON.stringify({ password: deletePassword, confirmationPhrase: deletePhrase.trim() }),
      });
      const data = await res.json();
      if (res.ok) {
        onNotify('success', isAr ? 'تم حذف الحساب وكافة البيانات المرتبطة به نهائياً' : 'Account and data permanently deleted');
        onClose();
        onLogout();
      } else {
        onNotify('error', data.message || (isAr ? 'فشل حذف الحساب' : 'Failed to delete account'));
      }
    } catch (_err) {
      onNotify('error', isAr ? 'خطأ أثناء تنفيذ الحذف' : 'Error deleting account');
    } finally {
      setDeleteLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      data-testid="user-profile-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200"
    >
      <div
        className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#0d1017] border border-white/10 rounded-2xl shadow-2xl overflow-hidden text-zinc-200"
        dir={isAr ? 'rtl' : 'ltr'}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#121622]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 font-bold">
              {profile?.avatarUrl ? (
                <img src={profile.avatarUrl} alt="Avatar" className="w-full h-full object-cover rounded-xl" />
              ) : (
                <User className="w-5 h-5" />
              )}
            </div>
            <div>
              <h2 className="text-lg font-bold text-white leading-tight">
                {isAr ? 'الملف الشخصي وإعدادات الحساب' : 'User Profile & Settings'}
              </h2>
              <p className="text-xs text-zinc-400 font-mono">{profile?.email || 'user@cloudstudio.dev'}</p>
            </div>
          </div>
          <button
            type="button"
            data-testid="user-profile-close-btn"
            onClick={onClose}
            className="p-2 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1.5 px-6 pt-3 border-b border-white/10 bg-[#0f131d] overflow-x-auto">
          {TAB_DEFINITIONS.map((t) => {
            const Icon = t.icon;
            const isSelected = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                data-testid={`tab-btn-${t.id}`}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-t-xl text-sm font-semibold transition-all border-b-2 ${
                  isSelected
                    ? t.danger
                      ? 'border-red-500 text-red-400 bg-red-950/20'
                      : 'border-blue-500 text-blue-400 bg-blue-950/20'
                    : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{isAr ? t.labelAr : t.labelEn}</span>
              </button>
            );
          })}
        </div>

        {/* Content Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 gap-3 text-zinc-400">
              <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
              <p className="text-sm font-medium">{isAr ? 'جاري تحميل بياناتك بأمان...' : 'Loading account data securely...'}</p>
            </div>
          ) : (
            <>
              {/* TAB 1: PROFILE & STATS */}
              {activeTab === 'profile' && (
                <div className="space-y-6">
                  {/* Personal Info Card */}
                  <div className="bg-[#141824] border border-white/10 rounded-2xl p-6">
                    <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                      <User className="w-4 h-4 text-blue-400" />
                      {isAr ? 'المعلومات الشخصية' : 'Personal Information'}
                    </h3>
                    <div className="flex flex-col sm:flex-row gap-6 items-center">
                      <div className="relative group shrink-0">
                        <div className="w-24 h-24 rounded-2xl bg-zinc-800 border-2 border-white/20 overflow-hidden flex items-center justify-center text-3xl font-bold text-zinc-300">
                          {avatarPreview ? (
                            <img src={avatarPreview} alt="Avatar" className="w-full h-full object-cover" />
                          ) : (
                            nameInput.slice(0, 1).toUpperCase() || 'U'
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 flex flex-col items-center justify-center rounded-2xl transition-opacity text-xs text-white gap-1 cursor-pointer"
                        >
                          <Camera className="w-5 h-5 text-blue-400" />
                          <span>{isAr ? 'تغيير' : 'Change'}</span>
                        </button>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={handleAvatarChange}
                          className="hidden"
                        />
                      </div>

                      <div className="flex-1 w-full space-y-4">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-zinc-400 mb-1">
                              {isAr ? 'الاسم المعروض' : 'Display Name'}
                            </label>
                            <input
                              type="text"
                              data-testid="profile-name-input"
                              value={nameInput}
                              onChange={(e) => setNameInput(e.target.value)}
                              className="w-full bg-[#0a0d14] border border-white/15 rounded-xl px-3.5 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-zinc-400 mb-1">
                              {isAr ? 'البريد الإلكتروني (غير قابل للتعديل)' : 'Email (Read-only)'}
                            </label>
                            <input
                              type="text"
                              value={profile?.email || ''}
                              disabled
                              className="w-full bg-[#0a0d14]/50 border border-white/10 rounded-xl px-3.5 py-2 text-zinc-400 text-sm font-mono cursor-not-allowed"
                            />
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <button
                            type="button"
                            data-testid="profile-save-btn"
                            onClick={handleSaveProfile}
                            disabled={saving}
                            className="flex items-center gap-2 px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
                          >
                            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            <span>{isAr ? 'حفظ التغييرات' : 'Save Changes'}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Storage Quota Card */}
                  <div className="bg-[#141824] border border-white/10 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <HardDrive className="w-5 h-5 text-sky-400" />
                        <div>
                          <h4 className="text-sm font-bold text-white">
                            {isAr ? 'سعة التخزين السحابي' : 'Cloud Storage Allocation'}
                          </h4>
                          <p className="text-xs text-zinc-400">
                            {isAr
                              ? 'سعة حسابك لحفظ وتحليل الكتب والمستندات والرسومات'
                              : 'Allocated storage for uploaded books, chunks, and extracted diagrams'}
                          </p>
                        </div>
                      </div>
                      <span data-testid="profile-storage-text" className="text-sm font-mono font-bold text-sky-400 tabular-nums">
                        {((profile?.storageUsedBytes || 0) / (1024 * 1024)).toFixed(1)} MB /{' '}
                        {((profile?.storageQuotaBytes || 104857600) / (1024 * 1024)).toFixed(0)} MB
                      </span>
                    </div>

                    <div className="w-full h-3 rounded-full bg-black/50 p-0.5 overflow-hidden border border-white/10">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          (profile?.storageUsedPercentage || 0) > 90
                            ? 'bg-red-500'
                            : (profile?.storageUsedPercentage || 0) > 75
                            ? 'bg-amber-500'
                            : 'bg-emerald-500'
                        }`}
                        style={{ width: `${Math.max(2, profile?.storageUsedPercentage || 0)}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-xs text-zinc-400">
                      <span>{isAr ? 'المساحة المستخدمة:' : 'Used storage:'} {profile?.storageUsedPercentage || 0}%</span>
                      <span>{isAr ? 'الحد الأقصى الافتراضي: 100 ميجابايت' : 'Default allocation: 100 MB'}</span>
                    </div>
                  </div>

                  {/* Account Metrics Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div data-testid="profile-stat-books" className="bg-[#141824] border border-white/10 rounded-2xl p-4 text-center">
                      <BookOpen className="w-5 h-5 text-blue-400 mx-auto mb-1.5" />
                      <div className="text-2xl font-bold text-white font-mono">{profile?.booksCount || 0}</div>
                      <div className="text-xs text-zinc-400">{isAr ? 'الكتب المفهرسة' : 'Indexed Books'}</div>
                    </div>
                    <div data-testid="profile-stat-searches" className="bg-[#141824] border border-white/10 rounded-2xl p-4 text-center">
                      <Search className="w-5 h-5 text-purple-400 mx-auto mb-1.5" />
                      <div className="text-2xl font-bold text-white font-mono">{profile?.searchesCount || 0}</div>
                      <div className="text-xs text-zinc-400">{isAr ? 'أبحاث تم إجراؤها' : 'Research Queries'}</div>
                    </div>
                    <div data-testid="profile-stat-feedbacks" className="bg-[#141824] border border-white/10 rounded-2xl p-4 text-center">
                      <Star className="w-5 h-5 text-amber-400 mx-auto mb-1.5" />
                      <div className="text-2xl font-bold text-white font-mono">{profile?.feedbacksCount || 0}</div>
                      <div className="text-xs text-zinc-400">{isAr ? 'تقييمات الجودة' : 'Quality Ratings'}</div>
                    </div>
                    <div className="bg-[#141824] border border-white/10 rounded-2xl p-4 text-center">
                      <Shield className="w-5 h-5 text-emerald-400 mx-auto mb-1.5" />
                      <div className="text-xs font-semibold text-emerald-400 uppercase mt-1">
                        {profile?.role === 'admin' ? (isAr ? 'مدير نظام' : 'Administrator') : (isAr ? 'مشرف معتمد' : 'Verified')}
                      </div>
                      <div className="text-xs text-zinc-400 mt-2">
                        {isAr ? 'انضم:' : 'Joined:'} {profile?.createdAt ? new Date(profile.createdAt).toLocaleDateString() : '2026'}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: MY ACTIVITY */}
              {activeTab === 'activity' && (
                <div className="space-y-6">
                  {/* Books Section */}
                  <div className="bg-[#141824] border border-white/10 rounded-2xl p-6">
                    <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-blue-400" />
                      {isAr ? 'كتبي المرفوعة والمفهرسة' : 'My Uploaded Books'}
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-mono">
                        {books.length}
                      </span>
                    </h3>
                    {books.length === 0 ? (
                      <p className="text-sm text-zinc-400 py-4 text-center">
                        {isAr ? 'لم تقم برفع أي كتب خاصة بعد.' : 'No books uploaded yet.'}
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        {books.map((b) => (
                          <div
                            key={b.id}
                            className="flex items-center justify-between p-3 rounded-xl bg-[#0a0d14] border border-white/5 hover:border-white/15 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <BookOpen className="w-4 h-4 text-sky-400 shrink-0" />
                              <div className="truncate">
                                <div className="text-sm font-semibold text-white truncate">{b.title}</div>
                                <div className="text-xs text-zinc-400">
                                  {b.totalPages ? `${b.totalPages} ${isAr ? 'صفحة' : 'pages'}` : ''} •{' '}
                                  {b.language || 'Arabic'}
                                </div>
                              </div>
                            </div>
                            <span className="text-xs font-medium px-2 py-1 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                              {isAr ? 'مفهرس' : 'Indexed'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Searches Section */}
                  <div className="bg-[#141824] border border-white/10 rounded-2xl p-6">
                    <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                      <Search className="w-4 h-4 text-purple-400" />
                      {isAr ? 'آخر عمليات البحث المعرفي' : 'Recent Research Sessions'}
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 font-mono">
                        {searches.length}
                      </span>
                    </h3>
                    {searches.length === 0 ? (
                      <p className="text-sm text-zinc-400 py-4 text-center">
                        {isAr ? 'لا توجد عمليات بحث سابقة مسجلة.' : 'No past research queries recorded.'}
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        {searches.map((s) => (
                          <div
                            key={s.id}
                            className="flex items-center justify-between p-3 rounded-xl bg-[#0a0d14] border border-white/5 hover:border-white/15 transition-colors"
                          >
                            <div className="truncate min-w-0">
                              <div className="text-sm font-semibold text-white truncate">{s.query || s.title}</div>
                              <div className="text-xs text-zinc-400">
                                {s.researchLevel} • {s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}
                              </div>
                            </div>
                            <span className="text-xs font-mono px-2 py-1 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20 shrink-0">
                              {s.currentStage || 'completed'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Feedback Section */}
                  <div className="bg-[#141824] border border-white/10 rounded-2xl p-6">
                    <h3 className="text-base font-bold text-white mb-4 flex items-center gap-2">
                      <Star className="w-4 h-4 text-amber-400" />
                      {isAr ? 'تقييماتي السابقة لجودة الإجابات' : 'My Quality Feedback'}
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono">
                        {feedbacks.length}
                      </span>
                    </h3>
                    {feedbacks.length === 0 ? (
                      <p className="text-sm text-zinc-400 py-4 text-center">
                        {isAr ? 'لم تقم بإرسال أي تقييمات بعد.' : 'No quality feedback submitted yet.'}
                      </p>
                    ) : (
                      <div className="space-y-2 max-h-56 overflow-y-auto">
                        {feedbacks.map((f) => (
                          <div
                            key={f.id}
                            className="flex items-center justify-between p-3 rounded-xl bg-[#0a0d14] border border-white/5 hover:border-white/15 transition-colors"
                          >
                            <div className="truncate min-w-0">
                              <div className="text-sm font-semibold text-white truncate">
                                {f.comment || (isAr ? 'تقييم بدون تعليق' : 'Feedback rating')}
                              </div>
                              <div className="text-xs text-zinc-400">
                                {f.createdAt ? new Date(f.createdAt).toLocaleString() : ''}
                              </div>
                            </div>
                            <div className="flex items-center gap-1 text-amber-400 text-xs font-mono px-2 py-1 rounded bg-amber-500/10 border border-amber-500/20 shrink-0">
                              <Star className="w-3.5 h-3.5 fill-amber-400" />
                              <span>{f.rating} / 5</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3: SECURITY & SESSIONS */}
              {activeTab === 'security' && (
                <div className="space-y-6">
                  {/* Change Password Card */}
                  <div className="bg-[#141824] border border-white/10 rounded-2xl p-6 space-y-4">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Key className="w-4 h-4 text-amber-400" />
                      {isAr ? 'تغيير كلمة المرور' : 'Change Password'}
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {isAr
                        ? 'ملاحظة أمنية: تغيير كلمة المرور سيؤدي تلقائياً إلى إنهاء وتسجيل الخروج من كافة الأجهزة الأخرى المفتوحة للحفاظ على أمان حسابك.'
                        : 'Security Note: Changing your password will automatically terminate sessions on all other active devices while keeping your current session.'}
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">
                          {isAr ? 'كلمة المرور الحالية' : 'Current Password'}
                        </label>
                        <input
                          type="password"
                          data-testid="security-current-password"
                          value={currentPassword}
                          onChange={(e) => setCurrentPassword(e.target.value)}
                          className="w-full bg-[#0a0d14] border border-white/15 rounded-xl px-3.5 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">
                          {isAr ? 'كلمة المرور الجديدة' : 'New Password'}
                        </label>
                        <input
                          type="password"
                          data-testid="security-new-password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full bg-[#0a0d14] border border-white/15 rounded-xl px-3.5 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">
                          {isAr ? 'تأكيد كلمة المرور' : 'Confirm Password'}
                        </label>
                        <input
                          type="password"
                          data-testid="security-confirm-password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full bg-[#0a0d14] border border-white/15 rounded-xl px-3.5 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end">
                      <button
                        type="button"
                        data-testid="security-change-password-btn"
                        onClick={handleChangePassword}
                        disabled={saving}
                        className="px-5 py-2 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isAr ? 'تأكيد تغيير كلمة المرور' : 'Update Password'}
                      </button>
                    </div>
                  </div>

                  {/* Active Sessions Card */}
                  <div className="bg-[#141824] border border-white/10 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Laptop className="w-4 h-4 text-emerald-400" />
                        {isAr ? 'الجلسات والأجهزة النشطة' : 'Active Connected Sessions'}
                      </h3>
                      <span className="text-xs text-zinc-400 font-mono">{sessions.length} {isAr ? 'جلسة' : 'sessions'}</span>
                    </div>

                    <div className="space-y-3">
                      {sessions.map((ses) => (
                        <div
                          key={ses.id}
                          className="flex items-center justify-between p-3.5 rounded-xl bg-[#0a0d14] border border-white/5"
                        >
                          <div className="flex items-center gap-3">
                            {ses.client === 'mobile' ? (
                              <Smartphone className="w-5 h-5 text-sky-400 shrink-0" />
                            ) : (
                              <Laptop className="w-5 h-5 text-blue-400 shrink-0" />
                            )}
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-white">
                                  {ses.client === 'mobile' ? 'Mobile App' : 'Web Browser'}
                                </span>
                                {ses.isCurrent && (
                                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                                    {isAr ? 'جلستك الحالية' : 'Current Session'}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-zinc-400 flex items-center gap-2 mt-0.5">
                                <span>IP: {ses.ip || '127.0.0.1'}</span>
                                <span>•</span>
                                <span>
                                  {isAr ? 'آخر نشاط:' : 'Last active:'}{' '}
                                  {ses.lastActivityAt ? new Date(ses.lastActivityAt).toLocaleTimeString() : ''}
                                </span>
                              </div>
                            </div>
                          </div>

                          {!ses.isCurrent && (
                            <button
                              type="button"
                              onClick={() => handleRevokeSession(ses.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 hover:text-white hover:bg-red-600/20 border border-red-500/20 transition-colors"
                            >
                              {isAr ? 'إنهاء الجلسة' : 'Revoke'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {/* Transparency Notice */}
                    <div className="p-3 rounded-xl bg-blue-950/20 border border-blue-500/20 text-xs text-blue-300 flex items-center gap-2">
                      <Shield className="w-4 h-4 text-blue-400 shrink-0" />
                      <span>
                        {isAr
                          ? `آخر تسجيل دخول مسجل لحسابك: ${profile?.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : 'الآن'} عبر الـ IP (${profile?.lastLoginIp || '127.0.0.1'})`
                          : `Last recorded login: ${profile?.lastLoginAt ? new Date(profile.lastLoginAt).toLocaleString() : 'Now'} from IP (${profile?.lastLoginIp || '127.0.0.1'})`}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 4: APP PREFERENCES & DATA PORTABILITY */}
              {activeTab === 'settings' && (
                <div className="space-y-6">
                  {/* Preferences Form */}
                  <div className="bg-[#141824] border border-white/10 rounded-2xl p-6 space-y-4">
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      <Sliders className="w-4 h-4 text-blue-400" />
                      {isAr ? 'تفضيلات المنصة والبحث المعرفي' : 'Platform & Research Preferences'}
                    </h3>
                    <p className="text-xs text-zinc-400">
                      {isAr
                        ? 'تُحفظ هذه الإعدادات مباشرة في السحابة وتتزامن تلقائياً عبر كافة أجهزتك ومتصفحاتك.'
                        : 'These preferences are saved directly to the database and sync across all your devices.'}
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">
                          {isAr ? 'اللغة الافتراضية' : 'Default Language'}
                        </label>
                        <select
                          value={settings.language}
                          onChange={(e) => handleSaveSettings({ language: e.target.value as 'ar' | 'en' })}
                          className="w-full bg-[#0a0d14] border border-white/15 rounded-xl px-3.5 py-2 text-white text-sm"
                        >
                          <option value="ar">العربية (Arabic - RTL)</option>
                          <option value="en">English (LTR)</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">
                          {isAr ? 'المظهر والسمة' : 'Theme Mode'}
                        </label>
                        <select
                          value={settings.theme}
                          onChange={(e) => handleSaveSettings({ theme: e.target.value as 'dark' | 'light' | 'system' })}
                          className="w-full bg-[#0a0d14] border border-white/15 rounded-xl px-3.5 py-2 text-white text-sm"
                        >
                          <option value="dark">{isAr ? 'داكن احترافي (Dark)' : 'Dark'}</option>
                          <option value="light">{isAr ? 'فاتح هادئ (Light)' : 'Light'}</option>
                          <option value="system">{isAr ? 'حسب النظام (System)' : 'System'}</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">
                          {isAr ? 'مسار البحث الافتراضي' : 'Default Research Tier'}
                        </label>
                        <select
                          data-testid="settings-tier-select"
                          value={settings.defaultResearchTier}
                          onChange={(e) =>
                            handleSaveSettings({ defaultResearchTier: e.target.value as 'quick' | 'deep' | 'expert' })
                          }
                          className="w-full bg-[#0a0d14] border border-white/15 rounded-xl px-3.5 py-2 text-white text-sm"
                        >
                          <option value="quick">{isAr ? 'سريع (Quick - جولة واحدة)' : 'Quick (1 loop)'}</option>
                          <option value="deep">{isAr ? 'عميق (Deep - 3 جولات افتراضية)' : 'Deep (3 loops)'}</option>
                          <option value="expert">{isAr ? 'خبير (Expert - 6 جولات موسعة)' : 'Expert (6 loops)'}</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">
                          {isAr ? 'أسلوب الإجابة' : 'Answer Style'}
                        </label>
                        <select
                          data-testid="settings-answer-length-select"
                          value={settings.answerLength}
                          onChange={(e) => handleSaveSettings({ answerLength: e.target.value as 'concise' | 'detailed' })}
                          className="w-full bg-[#0a0d14] border border-white/15 rounded-xl px-3.5 py-2 text-white text-sm"
                        >
                          <option value="detailed">{isAr ? 'مفصل مع شواهد كاملة' : 'Detailed with rich context'}</option>
                          <option value="concise">{isAr ? 'موجز ومباشر' : 'Concise & direct'}</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-3 pt-3 border-t border-white/10">
                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid="settings-page-numbers-toggle"
                          checked={settings.showPageNumbers}
                          onChange={(e) => handleSaveSettings({ showPageNumbers: e.target.checked })}
                          className="w-4 h-4 rounded border-white/20 text-blue-600 focus:ring-0 bg-[#0a0d14]"
                        />
                        <span className="text-sm text-zinc-300">
                          {isAr ? 'إظهار أرقام الصفحات بدقة مع كل اقتباس' : 'Always display page numbers in citations'}
                        </span>
                      </label>

                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid="settings-quality-badges-toggle"
                          checked={settings.showQualityBadges}
                          onChange={(e) => handleSaveSettings({ showQualityBadges: e.target.checked })}
                          className="w-4 h-4 rounded border-white/20 text-blue-600 focus:ring-0 bg-[#0a0d14]"
                        />
                        <span className="text-sm text-zinc-300">
                          {isAr ? 'إظهار شارة الثقة وبوابة الجودة (8/8) في النتائج' : 'Show quality gate trust badges (8/8)'}
                        </span>
                      </label>

                      <label className="flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          data-testid="settings-retain-history-toggle"
                          checked={settings.retainSearchHistory}
                          onChange={(e) => handleSaveSettings({ retainSearchHistory: e.target.checked })}
                          className="w-4 h-4 rounded border-white/20 text-blue-600 focus:ring-0 bg-[#0a0d14]"
                        />
                        <span className="text-sm text-zinc-300">
                          {isAr ? 'الاحتفاظ بسجل عمليات البحث لتسهيل الرجوع لها' : 'Retain search history in user memory'}
                        </span>
                      </label>
                    </div>
                  </div>

                  {/* Data Portability (Export) Card */}
                  <div className="bg-[#141824] border border-white/10 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div>
                      <h4 className="text-sm font-bold text-white flex items-center gap-2">
                        <Download className="w-4 h-4 text-emerald-400" />
                        {isAr ? 'تصدير بيانات الحساب بالكامل (GDPR Portability)' : 'Export Full Account Data'}
                      </h4>
                      <p className="text-xs text-zinc-400 mt-1">
                        {isAr
                          ? 'حمّل ملف JSON شاملاً لكافة بياناتك: ملفك الشخصي، تفضيلاتك، كتبك، أبحاثك السابقة، وتقييماتك.'
                          : 'Download a complete JSON archive of your personal profile, settings, books, sessions, and feedbacks.'}
                      </p>
                    </div>
                    <button
                      type="button"
                      data-testid="settings-export-json-btn"
                      onClick={handleExportData}
                      className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs transition-colors flex items-center gap-2 shrink-0 cursor-pointer"
                    >
                      <Download className="w-4 h-4" />
                      <span>{isAr ? 'تنزيل ملف البيانات' : 'Download JSON'}</span>
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 5: DANGER ZONE - CASCADE ACCOUNT DELETION */}
              {activeTab === 'danger' && (
                <div className="space-y-6">
                  <div className="bg-red-950/20 border-2 border-red-500/30 rounded-2xl p-6 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-red-500/20 border border-red-500/30 flex items-center justify-center text-red-400 shrink-0">
                        <AlertTriangle className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-base font-bold text-red-300">
                          {isAr ? 'منطقة الخطر: حذف الحساب نهائياً' : 'Danger Zone: Permanent Account Deletion'}
                        </h3>
                        <p className="text-xs text-red-400/80">
                          {isAr
                            ? 'هذا الإجراء نهائي وغير قابل للتراجع. سيتم مسح حسابك وكافة كتبك ومقاطعك وأبحاثك وجلساتك نهائياً من قاعدة البيانات.'
                            : 'This action is irreversible. All your books, chunks, search sessions, feedback, and settings will be permanently destroyed.'}
                        </p>
                      </div>
                    </div>

                    <div className="space-y-3 pt-2">
                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">
                          {isAr ? '1. أدخل كلمة مرور حسابك للتأكيد' : '1. Enter your password to confirm'}
                        </label>
                        <input
                          type="password"
                          data-testid="danger-delete-password"
                          value={deletePassword}
                          onChange={(e) => setDeletePassword(e.target.value)}
                          placeholder="••••••••••••"
                          className="w-full bg-[#0a0d14] border border-red-500/30 rounded-xl px-3.5 py-2 text-white text-sm focus:outline-none focus:border-red-500"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-zinc-400 mb-1">
                          {isAr
                            ? '2. اكتب العبارة التالية نصاً: احذف حسابي نهائياً'
                            : '2. Type the following exact phrase: DELETE MY ACCOUNT'}
                        </label>
                        <input
                          type="text"
                          data-testid="danger-delete-phrase"
                          value={deletePhrase}
                          onChange={(e) => setDeletePhrase(e.target.value)}
                          placeholder={isAr ? 'احذف حسابي نهائياً' : 'DELETE MY ACCOUNT'}
                          className="w-full bg-[#0a0d14] border border-red-500/30 rounded-xl px-3.5 py-2 text-white text-sm font-mono focus:outline-none focus:border-red-500"
                        />
                      </div>
                    </div>

                    <div className="pt-3 border-t border-red-500/20 flex justify-end">
                      <button
                        type="button"
                        data-testid="danger-delete-account-btn"
                        onClick={handleDeleteAccount}
                        disabled={deleteLoading}
                        className="px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-sm transition-colors flex items-center gap-2 cursor-pointer disabled:opacity-50"
                      >
                        {deleteLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        <span>{isAr ? 'حذف حسابي وكافة بياناتي فوراً' : 'Permanently Delete Account'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};
