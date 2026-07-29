import { useAuth } from '@/lib/AuthContext';
import { canAccess, getUserRole, ROLE_LABELS } from '@/lib/security/roles';

export default function RoleGuard({ permission, children, fallback = null }) {
  const { user } = useAuth();
  const role = getUserRole(user);

  if (!permission || canAccess(user, permission)) return children;

  return fallback || (
    <div dir="rtl" className="max-w-2xl mx-auto mt-10 bg-red-50 border border-red-200 rounded-2xl px-5 py-5 text-sm text-red-700">
      <p className="font-black text-base">غير مصرح — Access denied</p>
      <p className="mt-1">Your current role is <span className="font-bold">{ROLE_LABELS[role] || role}</span>.</p>
      <p className="mt-1 text-red-600">This page requires permission: <span className="font-mono">{permission}</span>.</p>
      <p className="mt-3 text-xs text-red-500">Ask an admin to update your clinical role in Base44 user settings if this access is required.</p>
    </div>
  );
}
