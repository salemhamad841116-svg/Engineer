import React, { useState } from 'react';
import { X, Lock, Mail, User, CheckCircle2, AlertCircle } from 'lucide-react';
import { Language } from '../types/platform';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: Language;
  onAuthSuccess?: (user: { id: string; email: string; name: string }) => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  language,
  onAuthSuccess,
}) => {
  const isAr = language === 'ar';
  const [mode, setMode] = useState<'register' | 'login'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);
    setIsLoading(true);

    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = mode === 'register' ? { name: name.trim(), email: email.trim(), password } : { email: email.trim(), password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || (isAr ? 'فشلت العملية' : 'Operation failed'));
      }

      const successText = mode === 'register'
        ? (isAr ? `تم تسجيل الحساب بنجاح: ${data.user?.name || email}` : `Account registered successfully: ${data.user?.name || email}`)
        : (isAr ? `تم تسجيل الدخول بنجاح: ${data.user?.name || email}` : `Logged in successfully: ${data.user?.name || email}`);

      setStatusMessage({ type: 'success', text: successText });

      if (onAuthSuccess && data.user) {
        onAuthSuccess(data.user);
      }

      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err: any) {
      setStatusMessage({ type: 'error', text: err.message || (isAr ? 'حدث خطأ في المصادقة' : 'Authentication error') });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      data-testid="auth-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      dir={isAr ? 'rtl' : 'ltr'}
    >
      <div className="relative w-full max-w-md rounded-2xl bg-[#14151b] border border-white/10 shadow-2xl p-6 text-zinc-100">
        {/* Close Button */}
        <button
          type="button"
          data-testid="auth-close-button"
          onClick={onClose}
          className="absolute top-4 end-4 p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header Tabs */}
        <div className="flex border-b border-white/10 mb-6 pb-2 gap-4">
          <button
            type="button"
            data-testid="auth-tab-register"
            onClick={() => {
              setMode('register');
              setStatusMessage(null);
            }}
            className={`pb-2 text-sm font-semibold transition-colors cursor-pointer border-b-2 ${
              mode === 'register'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {isAr ? 'تسجيل مستخدم جديد' : 'Register New User'}
          </button>
          <button
            type="button"
            data-testid="auth-tab-login"
            onClick={() => {
              setMode('login');
              setStatusMessage(null);
            }}
            className={`pb-2 text-sm font-semibold transition-colors cursor-pointer border-b-2 ${
              mode === 'login'
                ? 'border-blue-500 text-blue-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {isAr ? 'تسجيل الدخول' : 'Sign In'}
          </button>
        </div>

        {/* Status Message */}
        {statusMessage && (
          <div
            data-testid="auth-status-message"
            className={`mb-4 p-3 rounded-lg flex items-center gap-2 text-xs font-medium ${
              statusMessage.type === 'success'
                ? 'bg-emerald-500/15 border border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/15 border border-red-500/30 text-red-300'
            }`}
          >
            {statusMessage.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{statusMessage.text}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                {isAr ? 'الاسم الكامل' : 'Full Name'}
              </label>
              <div className="relative">
                <User className="absolute start-3 top-2.5 w-4 h-4 text-zinc-500" />
                <input
                  type="text"
                  data-testid="auth-name-input"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={isAr ? 'مثال: باحث الذكاء الاصطناعي' : 'e.g. AI Researcher'}
                  className="w-full bg-[#1b1c24] border border-white/10 rounded-xl px-9 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              {isAr ? 'البريد الإلكتروني' : 'Email Address'}
            </label>
            <div className="relative">
              <Mail className="absolute start-3 top-2.5 w-4 h-4 text-zinc-500" />
              <input
                type="email"
                data-testid="auth-email-input"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="researcher@example.com"
                className="w-full bg-[#1b1c24] border border-white/10 rounded-xl px-9 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-zinc-400 mb-1.5">
              {isAr ? 'كلمة المرور' : 'Password'}
            </label>
            <div className="relative">
              <Lock className="absolute start-3 top-2.5 w-4 h-4 text-zinc-500" />
              <input
                type="password"
                data-testid="auth-password-input"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#1b1c24] border border-white/10 rounded-xl px-9 py-2 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <button
            type="submit"
            data-testid="auth-submit-button"
            disabled={isLoading}
            className="w-full mt-2 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-medium text-sm transition-colors cursor-pointer shadow-lg shadow-blue-900/30 flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <span>{isAr ? 'جاري المعالجة...' : 'Processing...'}</span>
            ) : mode === 'register' ? (
              <span>{isAr ? 'إنشاء حساب جديد' : 'Create Account'}</span>
            ) : (
              <span>{isAr ? 'تسجيل الدخول' : 'Sign In'}</span>
            )}
          </button>
        </form>
      </div>
    </div>
  );
};
