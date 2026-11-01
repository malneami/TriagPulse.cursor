import { useEffect, useState } from 'react';
import { BRANCHES, JOB_TITLES } from '@triagepulse/clinical';
import { api } from '@/api/client';

/**
 * Public staff sign-up (join link). Name, e-mail, job title and branch only — no password.
 * Needs the pilot code from the TriagePulse admin. The admin approves and hands over a
 * temporary password in person.
 */
export default function Join() {
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({ code: '', fullName: '', email: '', jobTitle: '', jobTitleOther: '', branch: '', branchOther: '' });
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.join.status().then((s) => setOpen(!!s?.open)).catch(() => setOpen(false));
  }, []);

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError(''); };
  const ready = form.code.trim() && form.fullName.trim().length >= 3 && /\S+@\S+\.\S+/.test(form.email)
    && form.jobTitle && (form.jobTitle !== 'other' || form.jobTitleOther.trim())
    && form.branch && (form.branch !== 'other' || form.branchOther.trim());

  const submit = async (e) => {
    e.preventDefault();
    if (!ready || sending) return;
    setSending(true);
    setError('');
    try {
      await api.join.submit({
        code: form.code.trim(),
        fullName: form.fullName.trim(),
        email: form.email.trim(),
        jobTitle: form.jobTitle,
        jobTitleOther: form.jobTitle === 'other' ? form.jobTitleOther.trim() : undefined,
        branch: form.branch,
        branchOther: form.branch === 'other' ? form.branchOther.trim() : undefined,
      });
      setDone(true);
    } catch (err) {
      setError(err?.message || 'Could not send');
    } finally {
      setSending(false);
    }
  };

  const input = 'h-12 w-full border border-mist rounded-xl px-3 text-[16px] bg-white';
  return (
    <div dir="rtl" className="min-h-[100dvh] bg-paper flex items-start sm:items-center justify-center px-4 py-8">
      <div className="w-full max-w-md bg-white border border-mist rounded-2xl p-5 flex flex-col gap-4">
        <div>
          <h1 className="m-0 text-2xl font-semibold">TriagePulse</h1>
          <p className="m-0 text-[15px] text-graphite">طلب حساب للتجربة · Request a pilot account</p>
        </div>

        {open === null && <p className="m-0 text-graphite">…</p>}

        {open === false && (
          <p role="status" className="m-0 border-2 border-ink rounded-xl px-4 py-3 font-semibold">
            التسجيل مغلق حالياً. تواصل مع مسؤول TriagePulse.
            <span className="block font-normal" dir="ltr">Sign-up is closed. Contact the TriagePulse admin.</span>
          </p>
        )}

        {open && done && (
          <div role="status" className="flex flex-col gap-2">
            <p className="m-0 text-lg font-semibold">✓ تم إرسال طلبك · Request sent</p>
            <p className="m-0 text-[15px]">
              سيراجع المسؤول طلبك ويسلّمك كلمة مرور مؤقتة شخصياً. لا تشارك كلمة المرور مع أحد.
              <span className="block text-graphite" dir="ltr">The admin will review it and give you a temporary password in person. Never share your password.</span>
            </p>
          </div>
        )}

        {open && !done && (
          <form onSubmit={submit} className="flex flex-col gap-3" noValidate>
            <label className="flex flex-col gap-1 text-sm font-medium">
              رمز التجربة · Pilot code
              <input value={form.code} onChange={set('code')} dir="ltr" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={20} className={`${input} font-mono tracking-widest uppercase`} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              الاسم الكامل · Full name
              <input value={form.fullName} onChange={set('fullName')} autoComplete="name" maxLength={120} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              البريد الإلكتروني · E-mail
              <input type="email" value={form.email} onChange={set('email')} dir="ltr" autoComplete="email" inputMode="email" maxLength={120} className={input} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              المسمى الوظيفي · Job title
              <select value={form.jobTitle} onChange={set('jobTitle')} className={input}>
                <option value="">اختر · Choose</option>
                {JOB_TITLES.map((j) => <option key={j.id} value={j.id}>{j.ar} · {j.en}</option>)}
              </select>
            </label>
            {form.jobTitle === 'other' && (
              <label className="flex flex-col gap-1 text-sm font-medium">
                اكتب المسمى · Write your job title
                <input value={form.jobTitleOther} onChange={set('jobTitleOther')} maxLength={60} className={input} />
              </label>
            )}
            <label className="flex flex-col gap-1 text-sm font-medium">
              الفرع · HMG branch
              <select value={form.branch} onChange={set('branch')} className={input}>
                <option value="">اختر · Choose</option>
                {BRANCHES.map((b) => <option key={b.id} value={b.id}>{b.ar} · {b.en}</option>)}
              </select>
            </label>
            {form.branch === 'other' && (
              <label className="flex flex-col gap-1 text-sm font-medium">
                اكتب الفرع · Write your branch
                <input value={form.branchOther} onChange={set('branchOther')} maxLength={60} className={input} />
              </label>
            )}
            {error && <p role="alert" className="m-0 text-sm font-semibold border-2 border-ink rounded-lg px-3 py-2">{error}</p>}
            <button type="submit" disabled={!ready || sending} className="h-12 rounded-xl bg-ink text-white font-semibold disabled:opacity-40">
              {sending ? '…' : 'إرسال الطلب · Send request'}
            </button>
            <p className="m-0 text-xs text-graphite">
              لا نطلب كلمة مرور هنا. تُستخدم بياناتك لإنشاء حسابك فقط.
              <span className="block" dir="ltr">No password is asked here. Your details are used only to create your account.</span>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
