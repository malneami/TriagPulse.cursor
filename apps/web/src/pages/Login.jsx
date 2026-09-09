import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

const API_BASE = import.meta.env.DEV ? '' : (import.meta.env.VITE_API_URL || '');

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('nurse@triagepulse.local');
  const [password, setPassword] = useState('triage123');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [apiOnline, setApiOnline] = useState(null);

  const DEMO_ACCOUNTS = [
    { role: 'Nurse', email: 'nurse@triagepulse.local', note: 'Bedside triage' },
    { role: 'Physician', email: 'physician@triagepulse.local', note: 'AI Eval + Stats' },
    { role: 'Admin', email: 'admin@triagepulse.local', note: 'AI Eval + Libraries' },
  ];

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
    <div className="min-h-screen flex items-center justify-center bg-slate-50" dir="rtl">
      <form onSubmit={handleSubmit} noValidate className="bg-white p-8 rounded-2xl shadow-lg w-full max-w-md space-y-4">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-black text-slate-900">TriagePulse</h1>
          <p className="text-slate-500 text-sm mt-1">نظام فرز الطوارئ / Emergency Triage</p>
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
          <label className="block text-sm font-bold mb-1">Email</label>
          <input
            type="text"
            inputMode="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full border rounded-xl px-3 py-2"
            required
          />
        </div>
        <div>
          <label className="block text-sm font-bold mb-1">Password</label>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border rounded-xl px-3 py-2"
            required
          />
        </div>
        <button
          type="submit"
          disabled={!canSubmit}
          className="w-full bg-teal-600 text-white py-3 rounded-xl font-black hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '...' : 'تسجيل الدخول / Login'}
        </button>
        <div className="pt-1 space-y-2">
          <p className="text-xs text-slate-500 text-center font-bold">Demo accounts (password: triage123)</p>
          <div className="grid grid-cols-3 gap-2">
            {DEMO_ACCOUNTS.map((a) => (
              <button
                key={a.email}
                type="button"
                onClick={() => { setEmail(a.email); setPassword('triage123'); }}
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
      </form>
    </div>
  );
}
