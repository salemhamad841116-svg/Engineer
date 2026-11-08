import React, { useState, useRef, useEffect } from 'react';
import { X, Lock, Mail, User, CheckCircle2, AlertCircle, Sparkles, KeyRound } from 'lucide-react';
import { Language } from '../types/platform';
import { LegalModal } from './LegalModal';

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
  const [mode, setMode] = useState<'register' | 'login' | 'forgot'>('register');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [legalModalType, setLegalModalType] = useState<'terms' | 'privacy' | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  const handleClose = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onClose();
  };

  if (!isOpen) return null;

  const handleDemoLogin = async () => {
    setStatusMessage(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/demo-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || (isAr ? 'فشل الدخول التجريبي' : 'Demo login failed'));
      }
      setStatusMessage({
        type: 'success',
        text: isAr ? 'تم تسجيل الدخول في الوضع التجريبي بنجاح' : 'Demo guest session activated successfully',
      });
      if (onAuthSuccess && data.user) {
        onAuthSuccess(data.user);
      }
      timerRef.current = setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (isAr ? 'حدث خطأ في الدخول التجريبي' : 'Demo error');
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatusMessage(null);
    setIsLoading(true);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.message || data.error || (isAr ? 'فشل إرسال الرابط' : 'Failed to send reset link'));
      }
      setStatusMessage({
        type: 'success',
        text: isAr
          ? 'إذا كان البريد مسجلاً، فقد تم إرسال رابط مؤقت (صالح لـ 15 دقيقة) لاستعادة كلمة المرور.'
          : 'If the email is registered, a single-use 15-minute reset link has been dispatched.',
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (isAr ? 'حدث خطأ' : 'Error');
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'forgot') {
      return handleForgotPassword(e);
    }

    if (mode === 'register' && !termsAccepted) {
      setStatusMessage({
        type: 'error',
        text: isAr ? 'يجب الموافقة على شروط الاستخدام وسياسة الخصوصية للمتابعة' : 'You must accept the Terms and Privacy Policy to continue',
      });
      return;
    }

    setStatusMessage(null);
    setIsLoading(true);

    const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
    const payload = mode === 'register'
      ? {
          name: name.trim(),
          email: email.trim(),
          password,
          termsAccepted: true,
          termsVersion: '2026.1',
          deviceFingerprint: typeof navigator !== 'undefined' ? `${navigator.userAgent}_${navigator.language}` : 'web_client',
        }
      : { email: email.trim(), password };

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
        ? (isAr ? `تم تسجيل الحساب بنجاح: ${data.user?.name || email}. يرجى التحقق من بريدك الإلكتروني لتأكيده.` : `Account registered: ${data.user?.name || email}. Check your email to verify.`)
        : (isAr ? `تم تسجيل الدخول بنجاح: ${data.user?.name || email}` : `Logged in successfully: ${data.user?.name || email}`);

      setStatusMessage({ type: 'success', text: successText });

      if (onAuthSuccess && data.user) {
        onAuthSuccess(data.user);
      }

      timerRef.current = setTimeout(() => {
        handleClose();
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : (isAr ? 'حدث خطأ في المصادقة' : 'Authentication error');
      setStatusMessage({ type: 'error', text: msg });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
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
            onClick={handleClose}
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
            {mode === 'forgot' && (
              <span className="pb-2 text-sm font-semibold border-b-2 border-amber-500 text-amber-400">
                {isAr ? 'استعادة الحساب' : 'Account Recovery'}
              </span>
            )}
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

            {mode !== 'forgot' && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="block text-xs font-medium text-zinc-400">
                    {isAr ? 'كلمة المرور' : 'Password'}
                  </label>
                  {mode === 'login' && (
                    <button
                      type="button"
                      data-testid="auth-forgot-password-link"
                      onClick={() => {
                        setMode('forgot');
                        setStatusMessage(null);
                      }}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
                    >
                      {isAr ? 'نسيت كلمة المرور؟' : 'Forgot Password?'}
                    </button>
                  )}
                </div>
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
            )}

            {/* Mandatory Terms & Privacy Checkbox */}
            {mode === 'register' && (
              <div className="pt-2 pb-1" data-testid="terms-container">
                <label className="flex items-start gap-2.5 text-xs text-zinc-400 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    data-testid="auth-terms-checkbox"
                    checked={termsAccepted}
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-0.5 rounded border-white/20 bg-white/5 text-blue-600 focus:ring-0 focus:ring-offset-0 cursor-pointer"
                  />
                  <span>
                    {isAr ? 'أوافق على ' : 'I agree to the '}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setLegalModalType('terms');
                      }}
                      className="text-blue-400 hover:underline cursor-pointer"
                    >
                      {isAr ? 'شروط الاستخدام' : 'Terms of Service'}
                    </button>
                    {isAr ? ' و' : ' and '}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setLegalModalType('privacy');
                      }}
                      className="text-blue-400 hover:underline cursor-pointer"
                    >
                      {isAr ? 'سياسة الخصوصية' : 'Privacy Policy'}
                    </button>
                  </span>
                </label>
              </div>
            )}

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
              ) : mode === 'forgot' ? (
                <span className="flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4" />
                  {isAr ? 'إرسال رابط الاستعادة (15 دقيقة)' : 'Send Reset Link (15m)'}
                </span>
              ) : (
                <span>{isAr ? 'تسجيل الدخول' : 'Sign In'}</span>
              )}
            </button>

            {mode === 'forgot' && (
              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setStatusMessage(null);
                  }}
                  className="text-xs text-zinc-400 hover:text-white transition-colors cursor-pointer"
                >
                  {isAr ? 'العودة لتسجيل الدخول' : 'Back to Sign In'}
                </button>
              </div>
            )}
          </form>

          {/* Demo Mode Button ("جرّب بدون تسجيل") */}
          <div className="mt-6 pt-5 border-t border-white/10 text-center">
            <button
              type="button"
              data-testid="auth-demo-button"
              onClick={handleDemoLogin}
              disabled={isLoading}
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-300 hover:text-emerald-200 text-xs sm:text-sm font-semibold transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4 text-emerald-400" />
              <span>{isAr ? 'جرّب المنصة الآن بدون تسجيل (جلسة ضيف)' : 'Try Without Registration (Demo Guest)'}</span>
            </button>
            <p className="mt-2 text-[11px] text-zinc-500">
              {isAr
                ? 'جلسة تجريبية سريعة مع مراجع ثنائية اللغة وحصة تجريبية مخصصة'
                : 'Instant guest session with bilingual references & dedicated demo quota'}
            </p>
          </div>
        </div>
      </div>

      {/* Legal Modal for Terms & Privacy */}
      {legalModalType && (
        <LegalModal
          isOpen={Boolean(legalModalType)}
          type={legalModalType}
          language={language}
          onClose={() => setLegalModalType(null)}
        />
      )}
    </>
  );
};
