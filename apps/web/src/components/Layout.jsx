import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, BarChart3, ClipboardCheck, Eye, KeyRound, Library, LogOut, Menu, Monitor, ShieldCheck,
  Signpost, UserCheck, Users, UsersRound, Hourglass,
} from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { api } from '@/api/client';
import Wordmark from '@/components/Wordmark';
import { canAccess, ROLE_LABELS } from '@/lib/security/roles';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Page width per screen: the CTAS rail and the board need room; forms stay narrow. */
function mainWidth(pathname) {
  if (pathname.startsWith('/tracking')) return 'max-w-[1600px]';
  if (pathname.startsWith('/triage') || pathname.startsWith('/visual-triage')) return 'max-w-6xl';
  if (pathname.startsWith('/admin/')) return 'max-w-5xl';
  return 'max-w-3xl';
}

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || '?').toUpperCase() + (parts[1]?.[0] || '').toUpperCase();
}

/** The two screens the triage nurse uses all shift; everything else lives in the menu. */
const TABS = [
  { path: '/visual-triage', label: 'الفرز البصري', short: 'بصري', labelEn: 'Visual triage', Icon: Eye },
  { path: '/triage', label: 'فرز CTAS', short: 'CTAS', labelEn: 'CTAS triage', Icon: Activity },
];

function menuGroups(user) {
  const groups = [
    {
      ar: 'العمل', en: 'Work',
      items: [
        { path: '/tracking', ar: 'لوحة التتبع', en: 'Tracking board', Icon: Users },
        { path: '/tracking/wall', ar: 'شاشة الحائط', en: 'Wall display', Icon: Monitor },
        ...(canAccess(user, 'view_own_feedback') ? [{ path: '/my-triage', ar: 'فرزي', en: 'My triage', Icon: UserCheck, badge: 'feedback' }] : []),
      ],
    },
  ];
  if (canAccess(user, 'view_clinical_analytics')) {
    groups.push({
      ar: 'الجودة', en: 'Quality',
      items: [
        { path: '/admin/triage-review', ar: 'مراجعة الفرز', en: 'Triage review', Icon: ClipboardCheck },
        { path: '/admin/analytics', ar: 'التحليل', en: 'Analytics', Icon: BarChart3 },
        { path: '/admin/ai-evaluation', ar: 'تقييم AI', en: 'AI evaluation', Icon: ShieldCheck },
      ],
    });
  }
  const admin = [
    ...(canAccess(user, 'manage_security') ? [{ path: '/admin/staff', ar: 'الموظفون', en: 'Staff', Icon: UsersRound }] : []),
    ...(canAccess(user, 'manage_clinical_libraries') ? [{ path: '/admin/libraries', ar: 'المكتبات', en: 'Libraries', Icon: Library }] : []),
    ...(canAccess(user, 'manage_routing') ? [{ path: '/admin/routing', ar: 'التوجيه', en: 'Direction', Icon: Signpost }] : []),
  ];
  if (admin.length) groups.push({ ar: 'الإدارة', en: 'Admin', items: admin });
  return groups;
}

export default function Layout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  // Same query (key and source) as the tracking board, so they share one cached copy.
  const { data: board = [] } = useQuery({
    queryKey: ['tracking-board'],
    queryFn: () => api.tracking.board(),
    refetchInterval: 15000,
    enabled: canAccess(user, 'perform_triage'),
  });
  const waiting = board.filter((p) => !p.ctas_level).length;

  // Cases waiting for the nurse's reply on "My triage" (dot on the menu).
  const { data: mine } = useQuery({
    queryKey: ['my-feedback-badge'],
    queryFn: () => api.feedback.mine(),
    refetchInterval: 5 * 60 * 1000,
    enabled: canAccess(user, 'view_own_feedback'),
  });
  const pendingReplies = mine?.pendingResponses || 0;

  const groups = menuGroups(user);
  const isActive = (path) => location.pathname === path || (path !== '/tracking' && location.pathname.startsWith(`${path}/`));
  const inMenu = groups.some((g) => g.items.some((i) => isActive(i.path)));

  return (
    <div dir="rtl" className="min-h-screen bg-paper text-ink flex flex-col">
      <header className="bg-white border-b border-mist">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 h-16 flex items-center gap-2 sm:gap-4">
          <Link to="/" aria-label="TriagePulse, الصفحة الرئيسية" className="shrink-0 rounded-lg hidden sm:block">
            <Wordmark />
          </Link>

          <nav aria-label="الأقسام" className="flex gap-1 bg-paper rounded-xl p-1 min-w-0">
            {TABS.map(({ path, label, short, labelEn, Icon }) => {
              const active = isActive(path);
              return (
                <Link
                  key={path}
                  to={path}
                  aria-current={active ? 'page' : undefined}
                  title={labelEn}
                  className={`flex items-center gap-1.5 sm:gap-2 h-12 px-2.5 sm:px-5 rounded-lg text-[15px] font-semibold whitespace-nowrap transition-colors ${
                    active ? 'bg-ink text-white' : 'text-ink hover:bg-mist'
                  }`}
                >
                  <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="ms-auto flex items-center gap-2 shrink-0">
            {canAccess(user, 'perform_triage') && (
              <Link
                to="/tracking"
                title="لوحة التتبع / Tracking board"
                aria-label={`بانتظار CTAS ${waiting} — لوحة التتبع`}
                aria-current={location.pathname === '/tracking' ? 'page' : undefined}
                className={`h-12 px-2.5 sm:px-3 rounded-xl flex items-center gap-1.5 sm:gap-2 text-[15px] font-semibold ${
                  location.pathname === '/tracking'
                    ? 'bg-ink text-white'
                    : waiting > 0 ? 'border-2 border-ink text-ink' : 'border border-mist text-graphite'
                }`}
              >
                <Hourglass className="w-4 h-4" aria-hidden="true" />
                <span className="hidden md:inline">بانتظار CTAS</span>
                <span className="tabular-nums text-lg leading-none">{waiting}</span>
              </Link>
            )}

            <DropdownMenu dir="rtl">
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="القائمة / Menu"
                  className={`relative h-12 ps-2 sm:ps-3 pe-1.5 sm:pe-2 rounded-xl flex items-center gap-1.5 sm:gap-2 border ${inMenu ? 'border-ink' : 'border-mist'} hover:bg-paper`}
                >
                  <Menu className="w-5 h-5" aria-hidden="true" />
                  <span className="w-8 h-8 rounded-full bg-ink text-white text-xs font-semibold flex items-center justify-center" aria-hidden="true">
                    {initials(user?.full_name)}
                  </span>
                  {pendingReplies > 0 && (
                    <span className="absolute -top-1 -start-1 w-3 h-3 rounded-full bg-[#D3242C] ring-2 ring-white" aria-label="ردود بانتظارك" />
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="w-72 max-h-[80vh] overflow-y-auto p-1.5">
                <DropdownMenuLabel className="flex flex-col gap-0.5 py-2">
                  <span className="text-[15px] font-semibold">{user?.full_name}</span>
                  <span className="text-xs text-graphite font-normal">{ROLE_LABELS[user?.role] || user?.role}</span>
                </DropdownMenuLabel>
                {groups.map((g) => (
                  <div key={g.en}>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-graphite font-semibold py-1">{g.ar} · {g.en}</DropdownMenuLabel>
                    {g.items.map(({ path, ar, en, Icon, badge }) => (
                      <DropdownMenuItem
                        key={path}
                        onSelect={() => navigate(path)}
                        className={`min-h-12 gap-3 rounded-lg text-[15px] cursor-pointer ${isActive(path) ? 'bg-paper font-semibold' : ''}`}
                      >
                        <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                        <span className="flex-1"><bdi>{ar}</bdi> <span className="text-graphite text-xs font-normal">· <bdi>{en}</bdi></span></span>
                        {badge === 'feedback' && pendingReplies > 0 && (
                          <span className="min-w-6 h-6 px-1.5 rounded-full bg-[#D3242C] text-white text-xs font-semibold flex items-center justify-center">{pendingReplies}</span>
                        )}
                      </DropdownMenuItem>
                    ))}
                  </div>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-graphite font-semibold py-1">الحساب · Account</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => navigate('/account/password')} className="min-h-12 gap-3 rounded-lg text-[15px] cursor-pointer">
                  <KeyRound className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span>تغيير كلمة المرور <span className="text-graphite text-xs">· Change password</span></span>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => logout()} className="min-h-12 gap-3 rounded-lg text-[15px] cursor-pointer">
                  <LogOut className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span>تسجيل الخروج <span className="text-graphite text-xs">· Sign out</span></span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <main className={`flex-1 mx-auto w-full px-3 sm:px-6 py-5 ${mainWidth(location.pathname)}`}>
        {children}
      </main>
    </div>
  );
}
