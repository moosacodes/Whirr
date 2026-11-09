import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import type { AuthSessionView } from '../../../../packages/contracts/src/types.ts';
import { api } from './api.ts';
import { Loading } from '../components/ui.tsx';

interface AuthContextValue {
  session: AuthSessionView | null;
  loading: boolean;
  refresh: () => Promise<AuthSessionView | null>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSessionView | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await api<AuthSessionView>('/api/auth/session');
      setSession(next);
      return next;
    } catch {
      setSession(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await api('/api/auth/operator/logout', { method: 'POST' });
    await refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ session, loading, refresh, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider');
  return value;
}

export function RequireOperator({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Checking operator session…" />;
  if (!session?.operator) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/operator/login?next=${next}`} replace />;
  }
  return <>{children}</>;
}
