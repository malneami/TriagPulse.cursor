import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';

/**
 * Change your own password. Forced (no way around it) after an admin creates the account
 * or resets the password; also open to everyone from the key icon in the header.
 */
export default function ChangePassword({ forced = false }) {
  const navigate = useNavigate();
  const { user, passwordChanged, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const longEnough = next.length >= 10;
  const mixed = /[A-Za-z]/.test(next) && /\d/.test(next);
  const same = next && next === again;
  const ready = current && longEnough && mixed && same && !saving;

  const submit = async (e) => {
    e.preventDefault();
    if (!ready) return;
    setSaving(true);
    setError('');
    try {
      await api.auth.changePassword(current, next);
      passwordChanged();
      toast.success('تم تغيير كلمة المرور / Password changed');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err?.message || 'Could not change the password');
    } finally {
      setSaving(false);
    }
  };

  const input = 'h-12 w-full border border-mist rounded-xl px-3 text-[15px] bg-white';
  const Rule = ({ ok, ar, en }) => (
    <li className={`text-sm ${ok ? 'text-ink' : 'text-graphite'}`}>{ok ? '✓' : '○'} {ar} · {en}</li>
  );

  return (
    <div dir="rtl" className={forced ? 'min-h-screen bg-paper flex items-center justify-center p-4' : 'max-w-md mx-auto'}>
      <form onSubmit={submit} className="bg-white border border-mist rounded-2xl p-6 w-full max-w-md flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <KeyRound className="w-5 h-5" aria-hidden="true" />
          <h1 className="m-0 text-xl font-semibold">تغيير كلمة المرور · Change password</h1>
        </div>
        {forced && (
          <p className="m-0 text-[15px] border-2 border-ink rounded-xl px-3 py-2">
            هذه كلمة مرور مؤقتة. اختر كلمة مرور جديدة للمتابعة.
            <span className="block text-sm text-graphite">This is a temporary password. Choose a new one to continue.</span>
          </p>
        )}
        <p className="m-0 text-sm text-graphite" dir="ltr">{user?.email}</p>
        <label className="flex flex-col gap-1 text-sm font-medium">
          كلمة المرور الحالية · Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={input} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          كلمة المرور الجديدة · New password
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={input} dir="ltr" />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          أعد كتابتها · Repeat it
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} className={input} dir="ltr" />
        </label>
        <ul className="list-none m-0 p-0 flex flex-col gap-1">
          <Rule ok={longEnough} ar="١٠ أحرف على الأقل" en="at least 10 characters" />
          <Rule ok={mixed} ar="حروف وأرقام" en="letters and numbers" />
          <Rule ok={same} ar="متطابقتان" en="both the same" />
        </ul>
        {error && <p role="alert" className="m-0 text-sm font-semibold border-2 border-ink rounded-lg px-3 py-2">{error}</p>}
        <button type="submit" disabled={!ready} className="h-12 rounded-xl bg-ink text-white font-medium disabled:opacity-40">
          {saving ? '…' : 'حفظ · Save'}
        </button>
        {forced && (
          <button type="button" onClick={() => logout()} className="h-10 text-sm text-graphite underline">
            تسجيل الخروج · Sign out
          </button>
        )}
      </form>
    </div>
  );
}
