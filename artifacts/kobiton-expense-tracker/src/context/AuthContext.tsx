import React, { createContext, useContext, useEffect, useState } from 'react';
import { authService, type Session } from '../services/authService';

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  isBiometricEnabled: boolean;
  setBiometricEnabled: (v: boolean) => Promise<void>;
  refreshBiometric: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBiometricEnabled, setIsBiometricEnabledState] = useState(false);

  useEffect(() => {
    async function init() {
      const s = await authService.getSession();
      const bio = await authService.isBiometricEnabled();
      setSession(s);
      setIsBiometricEnabledState(bio);
      setIsLoading(false);
    }
    init();
  }, []);

  async function login(email: string, password: string): Promise<boolean> {
    const s = await authService.login(email, password);
    if (s) {
      setSession(s);
      return true;
    }
    return false;
  }

  async function logout(): Promise<void> {
    await authService.logout();
    setSession(null);
    setIsBiometricEnabledState(false);
  }

  async function setBiometricEnabled(v: boolean): Promise<void> {
    await authService.setBiometricEnabled(v);
    setIsBiometricEnabledState(v);
  }

  async function refreshBiometric(): Promise<void> {
    const bio = await authService.isBiometricEnabled();
    setIsBiometricEnabledState(bio);
  }

  return (
    <AuthContext.Provider
      value={{ session, isLoading, login, logout, isBiometricEnabled, setBiometricEnabled, refreshBiometric }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
