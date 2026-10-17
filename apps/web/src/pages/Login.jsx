import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, LOGOUT_REASON_KEY } from '@/lib/AuthContext';
import { toast } from 'sonner';
import Wordmark from '@/components/Wordmark';

const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

// Demo accounts exist only in local development databases (seed refuses
// NODE_ENV=production). Never show or pre-fill them in a production build.
const SHOW_DEMO = import.meta.env.DEV;
const DEMO_PASSWORD = 'triage123';
const DEMO_ACCOUNTS = SHOW_DEMO
  ? [
      { role: 'Nurse', email: 'nurse@triagepulse.local', note: 'Bedside triage' },
      { role: 'Physician', email: 'physician@triagepulse.local', note: 'AI Eval + Stats' },
      { role: 'Admin', email: 'admin@triagepulse.local', note: 'AI Eval + Libraries' },
    ]
  : [];

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [apiOnline, setApiOnline] = useState(null);

  // Explain an automatic sign-out (idle lock) once, then forget it.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(LOGOUT_REASON_KEY) === 'idle') {
        toast.info('تم تسجيل الخروج تلقائياً لعدم النشاط — You were signed out after a period of inactivity');
      }
      sessionStorage.removeItem(LOGOUT_REASON_KEY);
    } catch { /* storage unavailable */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const check = () => {
      attempts += 1;
      fetch(`${API_BASE}/api/health`)
        .then(async (r) => {
          const body = await r.json().catch(() => null);
          if (!r.ok) throw new Error(`health ${r.status}`);
          return body;
        })
        .then(() => {
          if (!cancelled) setApiOnline(true);
        })
        .catch(() => {
          if (cancelled) return;
          setApiOnline(false);
          if (attempts < 8) setTimeout(check, Math.min(2000 * attempts, 8000));
        });
    };
    check();
    return () => { cancelled = true; };
  }, []);

  if (isAuthenticated) {
    navigate('/visual-triage');
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email.trim(), password);
      toast.success('تم تسجيل الدخول / Logged in');
      navigate('/visual-triage');
    } catch (err) {
      const msg = err.message || 'Login failed';
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const canSubmit = !loading && email.trim() && password && apiOnline !== false;

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper px-4 py-10" dir="rtl">
      <form onSubmit={handleSubmit} noValidate className="bg-white border border-mist p-8 rounded-[18px] w-full max-w-md space-y-5">
        <div className="text-center mb-2 space-y-2">
          <h1 className="m-0"><Wordmark size="lg" /></h1>
          <p className="text-graphite text-base">نظام فرز الطوارئ بمعيار CTAS <span className="block text-sm">Emergency triage</span></p>
        </div>

        {apiOnline === false && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 space-y-2">
            <p>
              API offline — run <code className="font-mono">npm run dev</code> from the project root (starts API on port 3001).
            </p>
            <button
              type="button"
              onClick={() => {
                setApiOnline(null);
                fetch(`${API_BASE}/api/health`)
                  .then((r) => { if (!r.ok) throw new Error(); setApiOnline(true); })
                  .catch(() => setApiOnline(false));
              }}
              className="text-[11px] font-bold underline"
            >
              Retry connection
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div>
          <label htmlFor="login-email" className="block text-sm font-medium mb-1.5">البريد الإلكتروني / Email</label>
          <input
            id="login-email"
            type="text"
            inputMode="email"
            dir="ltr"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full h-[52px] border border-mist rounded-xl px-4 text-[17px] bg-white"
            required
          />
        </div>
        <div>
          <label htmlFor="login-password" className="block text-sm font-medium mb-1.5">كلمة المرور / Password</label>
          <input
            id="login-password"
            type="password"
            dir="ltr"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full h-[52px] border border-mist rounded-xl px-4 text-[17px] bg-white"
            required
          />
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full h-14 bg-ink text-white rounded-xl text-[17px] font-semibold hover:bg-ink-deep disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'جارٍ الدخول… / Signing in…' : 'تسجيل الدخول / Sign in'}
        </button>
        <p className="text-center text-sm text-graphite">
          يُغلق التطبيق تلقائياً بعد ١٥ دقيقة من عدم النشاط
          <span className="block text-xs">Signs out after 15 minutes without activity</span>
        </p>
        {SHOW_DEMO && (
        <div className="pt-1 space-y-2">
          <p className="text-xs text-slate-500 text-center font-bold">Local demo accounts (development only)</p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => { setEmail(a.email); setPassword(DEMO_PASSWORD); }}
                className={`rounded-xl border px-2 py-2 text-[11px] text-center transition-colors ${
                  email === a.email
                    ? 'border-teal-500 bg-teal-50 text-teal-900'
                    : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-teal-300'
                }`}
              >
                <span className="block font-black">{a.role}</span>
                <span className="block text-slate-400 mt-0.5 leading-tight">{a.note}</span>
              </button>
            ))}
          </div>
          <p className="text-[10px] text-slate-400 text-center">
            AI Evaluation nav appears for Physician / Admin only
          </p>
        </div>
        )}
      </form>
    </div>
  );
}
