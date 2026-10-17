import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, KeyRound, Lock, Pencil, Plus, Search, UserCheck, UserX, Wand2 } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { ROLE_LABELS } from '@/lib/security/roles';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

/**
 * Staff accounts (admin only): add staff, change name or role, reset a password, unlock
 * a locked account, deactivate or reactivate. A new or reset account gets a temporary
 * password that must be changed at first sign-in. Passwords are never shown again.
 */

const ROLES = ['nurse', 'physician', 'admin'];
const ROLE_AR = { nurse: 'ممرض', physician: 'طبيب', admin: 'مسؤول' };

/** 12 characters, letters and digits, no look-alikes (0/O, 1/l/I). */
export function tempPassword() {
  const letters = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = letters + digits;
  const pick = (set) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  const chars = [pick(letters), pick(digits), ...Array.from({ length: 10 }, () => pick(all))];
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

function fmt(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function status(u, now = Date.now()) {
  if (!u.active) return { ar: 'موقوف', en: 'Deactivated', strong: false };
  if (u.lockedUntil && new Date(u.lockedUntil).getTime() > now) return { ar: 'مقفل', en: `Locked until ${fmt(u.lockedUntil)}`, strong: true };
  if (u.mustChangePassword) return { ar: 'كلمة مرور مؤقتة', en: 'Temporary password', strong: false };
  return { ar: 'نشط', en: 'Active', strong: false };
}

function PasswordField({ value, onChange }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium">كلمة مرور مؤقتة · Temporary password</span>
      <div className="flex gap-2">
        <input
          dir="ltr"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 h-12 border border-mist rounded-xl px-3 font-mono text-[15px] bg-white"
        />
        <button type="button" onClick={() => onChange(tempPassword())} className="h-12 px-3 rounded-xl border border-mist flex items-center gap-1 text-sm">
          <Wand2 className="w-4 h-4" aria-hidden="true" /> توليد · Generate
        </button>
        <button
          type="button"
          disabled={!value}
          onClick={() => navigator.clipboard?.writeText(value).then(() => toast.success('نُسخت / Copied'))}
          aria-label="نسخ / Copy"
          className="h-12 w-12 rounded-xl border border-mist flex items-center justify-center disabled:opacity-40"
        >
          <Copy className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
      <span className="text-xs text-graphite">
        ١٠ أحرف على الأقل، حروف وأرقام. سلّمها للموظف شخصياً؛ سيغيّرها عند أول دخول ولن تظهر مرة أخرى.
        <span className="block" dir="ltr">At least 10 characters, letters and numbers. Hand it over in person; they change it at first sign-in. It is not shown again.</span>
      </span>
    </div>
  );
}

function StaffDialog({ open, onOpenChange, editing, onSaved }) {
  const isNew = !editing;
  const [form, setForm] = useState({ email: '', fullName: '', role: 'nurse', password: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const key = open ? (editing?.id || 'new') : null;
  const [loadedKey, setLoadedKey] = useState(null);
  if (key && key !== loadedKey) {
    setLoadedKey(key);
    setForm(editing ? { email: editing.email, fullName: editing.fullName, role: editing.role, password: '' } : { email: '', fullName: '', role: 'nurse', password: tempPassword() });
    setError('');
  }
  if (!open && loadedKey) setLoadedKey(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (isNew) await api.users.create(form);
      else await api.users.update(editing.id, { fullName: form.fullName, role: form.role });
      toast.success(isNew ? `أُضيف ${form.fullName} / Staff added` : 'تم الحفظ / Saved');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not save');
    } finally {
      setSaving(false);
    }
  };
  const input = 'h-12 w-full border border-mist rounded-xl px-3 text-[15px] bg-white';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogTitle className="text-lg">{isNew ? 'إضافة موظف · Add staff' : 'تعديل · Edit staff'}</DialogTitle>
        <DialogDescription className="text-sm text-graphite">
          {isNew ? 'الحساب يبدأ بكلمة مرور مؤقتة. · The account starts with a temporary password.' : <span dir="ltr">{editing?.email}</span>}
        </DialogDescription>
        <label className="flex flex-col gap-1 text-sm font-medium">
          الاسم الكامل · Full name
          <input value={form.fullName} onChange={set('fullName')} className={input} />
        </label>
        {isNew && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            البريد الإلكتروني · E-mail
            <input type="email" dir="ltr" value={form.email} onChange={set('email')} autoComplete="off" className={input} />
          </label>
        )}
        <fieldset className="flex flex-col gap-1">
          <legend className="text-sm font-medium mb-1">الدور · Role</legend>
          <div className="grid grid-cols-3 gap-2">
            {ROLES.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={form.role === r}
                onClick={() => set('role')(r)}
                className={`h-12 rounded-xl text-sm font-medium ${form.role === r ? 'bg-ink text-white' : 'border border-mist'}`}
              >
                {ROLE_LABELS[r]}
              </button>
            ))}
          </div>
        </fieldset>
        {isNew && <PasswordField value={form.password} onChange={set('password')} />}
        {error && <p role="alert" className="m-0 text-sm font-semibold border-2 border-ink rounded-lg px-3 py-2">{error}</p>}
        <button
          type="button"
          disabled={saving || !form.fullName.trim() || (isNew && (!form.email || !form.password))}
          onClick={save}
          className="h-12 rounded-xl bg-ink text-white font-medium disabled:opacity-40"
        >
          {saving ? '…' : isNew ? 'إضافة · Add' : 'حفظ · Save'}
        </button>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ user, onOpenChange, onSaved }) {
  const [password, setPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [forId, setForId] = useState(null);
  if (user && user.id !== forId) { setForId(user.id); setPassword(tempPassword()); setError(''); }
  if (!user && forId) setForId(null);
  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await api.users.resetPassword(user.id, password);
      toast.success('تم تعيين كلمة مرور مؤقتة / Temporary password set');
      onSaved();
      onOpenChange(false);
    } catch (err) {
      setError(err?.message || 'Could not reset');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open={Boolean(user)} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-lg">
        <DialogTitle className="text-lg">إعادة تعيين كلمة المرور · Reset password</DialogTitle>
        <DialogDescription className="text-sm text-graphite">
          {user?.fullName} · <span dir="ltr">{user?.email}</span> — يفك القفل أيضاً · also unlocks the account
        </DialogDescription>
        <PasswordField value={password} onChange={setPassword} />
        {error && <p role="alert" className="m-0 text-sm font-semibold border-2 border-ink rounded-lg px-3 py-2">{error}</p>}
        <button type="button" disabled={saving || !password} onClick={save} className="h-12 rounded-xl bg-ink text-white font-medium disabled:opacity-40">
          {saving ? '…' : 'تعيين · Set temporary password'}
        </button>
      </DialogContent>
    </Dialog>
  );
}

export default function StaffAdmin() {
  const queryClient = useQueryClient();
  const { user: me } = useAuth();
  const { data: staff = [], isLoading, isError } = useQuery({ queryKey: ['staff'], queryFn: () => api.users.list() });
  const [q, setQ] = useState('');
  const [role, setRole] = useState('all');
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState({ open: false, editing: null });
  const [resetFor, setResetFor] = useState(null);
  const [confirmId, setConfirmId] = useState(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['staff'] });

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return staff.filter((u) => (showInactive || u.active)
      && (role === 'all' || u.role === role)
      && (!t || u.fullName.toLowerCase().includes(t) || u.email.toLowerCase().includes(t)));
  }, [staff, q, role, showInactive]);

  const counts = useMemo(() => Object.fromEntries(ROLES.map((r) => [r, staff.filter((u) => u.active && u.role === r).length])), [staff]);

  const act = async (fn, okMsg) => {
    try { await fn(); toast.success(okMsg); refresh(); } catch (err) { toast.error(err?.message || 'Failed'); }
  };
  const toggleActive = (u) => {
    if (u.active && confirmId !== u.id) { setConfirmId(u.id); setTimeout(() => setConfirmId((c) => (c === u.id ? null : c)), 4000); return; }
    setConfirmId(null);
    act(() => api.users.update(u.id, { active: !u.active }), u.active ? `أُوقف ${u.fullName} / Deactivated` : `أُعيد تفعيل ${u.fullName} / Reactivated`);
  };

  return (
    <div dir="rtl" className="space-y-4 pb-10">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col">
          <h1 className="m-0 text-[28px] font-semibold">الموظفون</h1>
          <span className="text-sm text-graphite">Staff accounts — add, change role, reset password, unlock, deactivate.</span>
        </div>
        <button type="button" onClick={() => setDialog({ open: true, editing: null })} className="ms-auto h-12 px-4 rounded-xl bg-ink text-white flex items-center gap-2 font-medium">
          <Plus className="w-5 h-5" aria-hidden="true" /> إضافة موظف · Add staff
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {ROLES.map((r) => (
          <div key={r} className="bg-white border border-mist rounded-2xl px-4 py-3 flex flex-col">
            <span className="text-sm text-graphite">{ROLE_LABELS[r]}</span>
            <span className="text-2xl font-semibold tabular-nums">{counts[r] ?? 0}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <label className="relative flex-1 min-w-[220px]">
          <span className="sr-only">بحث / Search</span>
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-graphite" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم أو البريد… / Search" className="w-full h-12 border border-mist rounded-xl pr-10 pl-3 text-[15px] bg-white" />
        </label>
        <div className="flex gap-1 bg-white border border-mist rounded-xl p-1">
          {['all', ...ROLES].map((r) => (
            <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)} className={`h-10 px-3 rounded-lg text-sm ${role === r ? 'bg-ink text-white' : ''}`}>
              {r === 'all' ? 'الكل · All' : ROLE_AR[r]}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} className="w-4 h-4" />
          إظهار الموقوفين · Show deactivated
        </label>
      </div>

      {isError && <p role="alert" className="border-2 border-ink rounded-xl px-4 py-3">تعذّر التحميل / Could not load.</p>}
      {isLoading && <p className="text-graphite">…</p>}

      <ul className="list-none m-0 p-0 flex flex-col gap-2">
        {list.map((u) => {
          const st = status(u);
          const self = u.id === me?.id;
          const locked = u.lockedUntil && new Date(u.lockedUntil).getTime() > Date.now();
          return (
            <li key={u.id} className={`bg-white border rounded-2xl p-4 flex flex-wrap items-center gap-x-4 gap-y-2 ${u.active ? 'border-mist' : 'border-dashed border-graphite/40 opacity-70'}`}>
              <div className="flex flex-col min-w-[200px] flex-1">
                <span className="font-semibold text-[15px]">{u.fullName}{self && <span className="text-graphite font-normal"> · أنت / you</span>}</span>
                <span dir="ltr" className="text-sm text-graphite text-start">{u.email}</span>
              </div>
              <span className="text-sm border border-mist rounded-lg px-2 py-1">{ROLE_LABELS[u.role] || u.role}</span>
              <span className={`text-sm rounded-lg px-2 py-1 ${st.strong ? 'bg-ink text-white' : 'text-graphite'}`}>{st.ar} · {st.en}</span>
              <span className="text-xs text-graphite">آخر دخول · Last sign-in: <span dir="ltr">{fmt(u.lastLoginAt)}</span></span>
              <div className="flex gap-1.5 ms-auto">
                <button type="button" onClick={() => setDialog({ open: true, editing: u })} aria-label={`تعديل ${u.fullName}`} title="تعديل · Edit" className="h-10 w-10 rounded-lg border border-mist flex items-center justify-center">
                  <Pencil className="w-4 h-4" aria-hidden="true" />
                </button>
                <button type="button" onClick={() => setResetFor(u)} aria-label={`إعادة تعيين كلمة مرور ${u.fullName}`} title="كلمة المرور · Reset password" className="h-10 w-10 rounded-lg border border-mist flex items-center justify-center">
                  <KeyRound className="w-4 h-4" aria-hidden="true" />
                </button>
                {locked && (
                  <button type="button" onClick={() => act(() => api.users.unlock(u.id), 'فُك القفل / Unlocked')} title="فك القفل · Unlock" className="h-10 px-3 rounded-lg bg-ink text-white flex items-center gap-1 text-sm">
                    <Lock className="w-4 h-4" aria-hidden="true" /> فك · Unlock
                  </button>
                )}
                {!self && (
                  <button
                    type="button"
                    onClick={() => toggleActive(u)}
                    className={`h-10 px-3 rounded-lg flex items-center gap-1 text-sm ${confirmId === u.id ? 'bg-ink text-white' : 'border border-mist'}`}
                  >
                    {u.active ? <UserX className="w-4 h-4" aria-hidden="true" /> : <UserCheck className="w-4 h-4" aria-hidden="true" />}
                    {u.active ? (confirmId === u.id ? 'اضغط للتأكيد · Confirm' : 'إيقاف · Deactivate') : 'تفعيل · Reactivate'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
        {!isLoading && list.length === 0 && <li className="text-graphite text-sm py-6 text-center">لا نتائج · No staff match.</li>}
      </ul>

      <StaffDialog open={dialog.open} editing={dialog.editing} onOpenChange={(o) => setDialog((d) => ({ ...d, open: o }))} onSaved={refresh} />
      <ResetDialog user={resetFor} onOpenChange={(o) => { if (!o) setResetFor(null); }} onSaved={refresh} />
    </div>
  );
}
