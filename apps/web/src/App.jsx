import { Toaster as SonnerToaster } from 'sonner'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import { BrowserRouter as Router, Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import Layout from './components/Layout';
import RoleGuard from '@/components/auth/RoleGuard';
import Triage from './pages/Triage';
import VisualTriage from './pages/VisualTriage';
import PatientTracking from './pages/PatientTracking';
import ClinicalLibrariesAdmin from './pages/ClinicalLibrariesAdmin';
import ClinicalAnalytics from './pages/ClinicalAnalytics';
import AiEvaluationDashboard from './pages/AiEvaluationDashboard';
import Login from './pages/Login';
import { syncClinicalLibrariesFromApi } from '@/lib/clinicalLibrariesSync';

function HomeRedirect() {
  const location = useLocation();
  return <Navigate to={`/visual-triage${location.search || ''}`} replace />;
}

function Guarded({ permission, children }) {
  return (
    <RoleGuard permission={permission}>
      {children}
    </RoleGuard>
  );
}

const AuthenticatedApp = () => {
  const { isLoadingAuth, isAuthenticated } = useAuth();

  useEffect(() => {
    if (isAuthenticated) syncClinicalLibrariesFromApi();
  }, [isAuthenticated]);

  if (isLoadingAuth) {
    return (
      <div className="fixed inset-0 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout><Outlet /></Layout>}>
        <Route path="/" element={<HomeRedirect />} />
        <Route path="/visual-triage" element={<Guarded permission="perform_triage"><VisualTriage /></Guarded>} />
        <Route path="/triage" element={<Guarded permission="perform_triage"><Triage /></Guarded>} />
        <Route path="/tracking" element={<Guarded permission="perform_triage"><PatientTracking /></Guarded>} />
        <Route path="/admin/libraries" element={<Guarded permission="manage_clinical_libraries"><ClinicalLibrariesAdmin /></Guarded>} />
        <Route path="/admin/analytics" element={<Guarded permission="view_clinical_analytics"><ClinicalAnalytics /></Guarded>} />
        <Route path="/admin/ai-evaluation" element={<Guarded permission="view_clinical_analytics"><AiEvaluationDashboard /></Guarded>} />
      </Route>
      <Route path="/login" element={<Navigate to="/visual-triage" replace />} />
      <Route path="*" element={<PageNotFound />} />
    </Routes>
  );
};

function App() {
  return (
    <AuthProvider>
      <QueryClientProvider client={queryClientInstance}>
        <Router basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
          <AuthenticatedApp />
        </Router>
        <SonnerToaster position="top-center" richColors closeButton />
      </QueryClientProvider>
    </AuthProvider>
  )
}

export default App
