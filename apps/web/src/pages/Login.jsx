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

  useEffect(() => {
    fetch(`${API_BASE}/api/health`)
      .then((r) => r.ok ? r.json() : Promise.reject())
      .then(() => setApiOnline(true))
      .catch(() => setApiOnline(false));
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
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            API offline — run <code className="font-mono">npm run dev</code> from the project root (starts API on port 3001).
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
        <p className="text-xs text-slate-400 text-center">
          Demo: nurse@triagepulse.local / triage123
        </p>
      </form>
    </div>
  );
}
