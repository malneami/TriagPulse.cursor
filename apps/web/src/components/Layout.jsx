import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Activity, LogOut, Eye, Users, Library, BarChart3, ShieldCheck } from 'lucide-react';
import PatientStrip from '@/components/PatientStrip';
import Wordmark from '@/components/Wordmark';
import { canAccess } from '@/lib/security/roles';

/** Page width per screen: the CTAS rail and the board need room; forms stay narrow. */
function mainWidth(pathname) {
  if (pathname.startsWith('/tracking')) return 'max-w-[1600px]';
  if (pathname.startsWith('/triage')) return 'max-w-6xl';
  if (pathname.startsWith('/admin/')) return 'max-w-5xl';
  return 'max-w-3xl';
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

export default function Layout({ children }) {
  const location = useLocation();
  const { user, logout } = useAuth();

  const navItems = [
    { path: '/visual-triage', label: 'الفرز البصري', labelEn: 'Visual triage', Icon: Eye },
    { path: '/triage', label: 'فرز CTAS', labelEn: 'CTAS triage', Icon: Activity },
    { path: '/tracking', label: 'لوحة التتبع', labelEn: 'Tracking', Icon: Users },
    ...(canAccess(user, 'manage_clinical_libraries')
      ? [{ path: '/admin/libraries', label: 'المكتبات', labelEn: 'Libraries', Icon: Library }]
      : []),
    ...(canAccess(user, 'view_clinical_analytics')
      ? [
          { path: '/admin/analytics', label: 'التحليل', labelEn: 'Analytics', Icon: BarChart3 },
          { path: '/admin/ai-evaluation', label: 'تقييم AI', labelEn: 'AI evaluation', Icon: ShieldCheck },
        ]
      : []),
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-paper text-ink flex flex-col">
      <header className="bg-white border-b border-mist">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link to="/visual-triage" aria-label="TriagePulse, الصفحة الرئيسية" className="shrink-0 rounded-lg">
            <Wordmark />
          </Link>

          <nav aria-label="الأقسام" className="min-w-0 overflow-x-auto">
            <div className="flex gap-1 bg-paper rounded-xl p-1 min-w-max">
              {navItems.map(({ path, label, labelEn, Icon }) => {
                const active = location.pathname === path || location.pathname.startsWith(`${path}/`);
                return (
                  <Link
                    key={path}
                    to={path}
                    aria-current={active ? 'page' : undefined}
                    title={labelEn}
                    className={`flex items-center gap-2 h-10 px-4 rounded-lg text-[15px] font-medium whitespace-nowrap transition-colors ${
                      active ? 'bg-ink text-white' : 'text-ink hover:bg-mist'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                );
              })}
            </div>
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <span
              className="hidden md:flex w-10 h-10 rounded-full border border-mist items-center justify-center text-sm font-semibold"
              title={user?.full_name}
              aria-hidden="true"
            >
              {initials(user?.full_name)}
            </span>
            <button
              type="button"
              onClick={logout}
              aria-label="تسجيل الخروج / Sign out"
              title="تسجيل الخروج / Sign out"
              className="w-11 h-11 rounded-xl flex items-center justify-center text-graphite hover:bg-paper hover:text-ink"
            >
              <LogOut className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </header>

      <PatientStrip />

      <main className={`flex-1 mx-auto w-full px-4 sm:px-6 py-6 ${mainWidth(location.pathname)}`}>
        {children}
      </main>
    </div>
  );
}
