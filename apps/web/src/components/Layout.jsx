import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { Activity, LogOut, Eye, Users } from 'lucide-react';
import PatientStrip from '@/components/PatientStrip';

export default function Layout({ children }) {
  const location = useLocation();
  const { user, logout } = useAuth();

  const navItems = [
    { path: '/visual-triage', label: 'الفرز البصري', labelEn: 'Visual', Icon: Eye },
    { path: '/triage', label: 'CTAS', labelEn: 'CTAS', Icon: Activity },
    { path: '/tracking', label: 'التتبع', labelEn: 'Track', Icon: Users },
  ];

  return (
    <div dir="rtl" className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white text-slate-800 shadow-md border-b-4 border-red-600">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-14 w-14 rounded-xl bg-red-600 flex items-center justify-center text-white font-black text-xl">TP</div>
            <div className="border-r border-slate-200 pr-3 mr-1">
              <div className="font-bold text-sm leading-tight text-slate-800">نظام الفرز الطارئ</div>
              <div className="text-slate-400 text-xs">Emergency Triage System</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-slate-500 text-sm hidden sm:block">{user?.full_name}</span>
            <button
              onClick={logout}
              className="text-slate-400 hover:text-red-600 transition-colors"
              title="تسجيل الخروج"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <PatientStrip />

      <nav className="bg-red-600 border-b border-red-700">
        <div className="max-w-3xl mx-auto px-4 flex gap-1">
          {navItems.map(({ path, label, labelEn, Icon }) => {
            const active = location.pathname === path;
            return (
              <Link
                key={path}
                to={path}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors border-b-2 ${
                  active
                    ? 'border-white text-white'
                    : 'border-transparent text-red-200 hover:text-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
                <span className="text-xs opacity-60">{labelEn}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      <main className="flex-1 max-w-3xl mx-auto w-full px-4 py-6">
        {children}
      </main>
    </div>
  );
}
