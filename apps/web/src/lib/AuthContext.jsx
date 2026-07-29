import React, { createContext, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from '@/api/client';
import { appHref } from '@/lib/appUrl';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    if (!getToken()) {
      setIsLoadingAuth(false);
      return;
    }
    try {
      const me = await api.auth.me();
      setUser(me);
      setIsAuthenticated(true);
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

  const logout = () => {
    setToken(null);
    setUser(null);
    setIsAuthenticated(false);
    window.location.href = appHref('/login');
  };

  return (
    <AuthContext.Provider value={{
      user,
      isAuthenticated,
      isLoadingAuth,
      isLoadingPublicSettings: false,
      authError: null,
      login,
      logout,
      navigateToLogin: () => { window.location.href = appHref('/login'); },
      checkAuth,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
