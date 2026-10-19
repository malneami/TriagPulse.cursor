import { clearAllDrafts } from '@/lib/triageDraft';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, setToken, refreshSession, signOutOnServer } from '@/api/client';
import { appHref } from '@/lib/appUrl';

const AuthContext = createContext(null);

/**
 * Idle auto-lock for shared ED workstations (review E6).
 * After IDLE_LOCK_MIN minutes with no keyboard, pointer, touch or scroll
 * activity the session ends; a warning appears one minute before.
 * Override with VITE_IDLE_LOCK_MIN (minutes); 0 disables it.
 */
const IDLE_LOCK_MIN = Number(import.meta.env.VITE_IDLE_LOCK_MIN ?? 15);
const IDLE_WARN_BEFORE_MS = 60 * 1000;
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
export const LOGOUT_REASON_KEY = 'triagepulse_logout_reason';

function rememberLogoutReason(reason) {
  try { sessionStorage.setItem(LOGOUT_REASON_KEY, reason); } catch { /* storage unavailable */ }
}

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  // After a reload the access token is gone (memory only); the session cookie renews it.
  const checkAuth = async () => {
    try {
      const session = await refreshSession();
      if (session?.user) {
        setUser(session.user);
        setIsAuthenticated(true);
      } else {
        setIsAuthenticated(false);
      }
    } catch {
      setToken(null);
      setIsAuthenticated(false);
    } finally {
      setIsLoadingAuth(false);
    }
  };

  const login = async (email, password) => {
    const result = await api.auth.login(email, password);
    setToken(result.access_token);
    setUser(result.user);
    setIsAuthenticated(true);
    return result;
  };

  const logout = useCallback((reason) => {
    if (reason) rememberLogoutReason(reason);
    // A manual sign-out removes triage drafts from this tab; the idle lock keeps them so
    // the same nurse can sign back in and continue (review H6).
    if (reason !== 'idle') clearAllDrafts();
    setUser(null);
    setIsAuthenticated(false);
    // End the session on the server too (H3), then leave; a failed call still signs out here.
    signOutOnServer().finally(() => { window.location.href = appHref('/login'); });
  }, []);

  // ── Idle auto-lock ──────────────────────────────────────────────
  const lastActivityRef = useRef(Date.now());
  const warnedRef = useRef(false);

  useEffect(() => {
    if (!isAuthenticated || !(IDLE_LOCK_MIN > 0)) return undefined;
    const lockAfterMs = IDLE_LOCK_MIN * 60 * 1000;
    lastActivityRef.current = Date.now();
    warnedRef.current = false;

    const markActive = () => {
      lastActivityRef.current = Date.now();
      if (warnedRef.current) {
        warnedRef.current = false;
        toast.dismiss('idle-lock-warning');
      }
    };
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, markActive, { passive: true }));

    const timer = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= lockAfterMs) {
        logout('idle');
      } else if (!warnedRef.current && idleMs >= lockAfterMs - IDLE_WARN_BEFORE_MS) {
        warnedRef.current = true;
        toast.warning('سيتم تسجيل الخروج خلال دقيقة لعدم النشاط — Signing out in 1 minute due to inactivity', {
          id: 'idle-lock-warning',
          duration: IDLE_WARN_BEFORE_MS,
        });
      }
    }, 5000);

    return () => {
      clearInterval(timer);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, markActive));
    };
  }, [isAuthenticated, logout]);

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError: null,
      login,
      logout: () => logout(),
      navigateToLogin: () => { window.location.href = appHref('/login'); },
      checkAuth,
      /** After the user changes a temporary password. */
      passwordChanged: () => setUser((u) => (u ? { ...u, must_change_password: false } : u)),
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
