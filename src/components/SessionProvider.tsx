'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';
import { isEmailVerifiedForApp } from '@/lib/auth-email-verified';

export type InitialSession = {
  userId: string;
  email: string | null;
  usernameFromMetadata: string | null;
  dbUsername: string | null;
} | null;

function displayFromParts(dbUsername: string | null, user: User | null): string {
  if (dbUsername) return dbUsername;
  const meta = user?.user_metadata?.username as string | undefined;
  if (meta) return meta;
  if (user?.email) return user.email.split('@')[0] ?? '';
  return '';
}

type AuthContextValue = {
  user: User | null;
  displayName: string;
  isAuthenticated: boolean;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth는 SessionProvider 안에서만 사용할 수 있습니다.');
  }
  return ctx;
}

type Props = {
  initialSession: InitialSession;
  children: React.ReactNode;
};

export function SessionProvider({ initialSession, children }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [dbUsername, setDbUsername] = useState<string | null>(
    initialSession?.dbUsername ?? null
  );
  const [hydrated, setHydrated] = useState(false);

  const applyProfile = useCallback(async (accessToken: string) => {
    try {
      await fetch('/api/auth/sync-profile', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      /* 다음 요청에서 재시도 */
    }
    const res = await fetch('/api/auth/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.ok) {
      const body = (await res.json()) as { username?: string | null };
      setDbUsername(body.username ?? null);
    }
  }, []);

  useEffect(() => {
    const supabase = createClient();

    const bootstrap = async () => {
      const { data: { user: u } } = await supabase.auth.getUser();
      if (u && !isEmailVerifiedForApp(u)) {
        await supabase.auth.signOut();
        setUser(null);
        setDbUsername(null);
        setHydrated(true);
        return;
      }
      setUser(u ?? null);
      if (!u) {
        setDbUsername(null);
        setHydrated(true);
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await applyProfile(session.access_token);
      }
      setHydrated(true);
    };

    void bootstrap();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      const next = session?.user ?? null;
      if (next && !isEmailVerifiedForApp(next)) {
        await supabase.auth.signOut();
        setUser(null);
        setDbUsername(null);
        return;
      }
      setUser(next);
      if (!session?.access_token) {
        setDbUsername(null);
        return;
      }
      if (
        event === 'SIGNED_IN' ||
        event === 'INITIAL_SESSION' ||
        event === 'TOKEN_REFRESHED'
      ) {
        await applyProfile(session.access_token);
      }
    });

    return () => subscription.unsubscribe();
  }, [applyProfile]);

  const displayName = useMemo(() => {
    if (!hydrated && initialSession) {
      return (
        initialSession.dbUsername ||
        initialSession.usernameFromMetadata ||
        initialSession.email?.split('@')[0] ||
        ''
      );
    }
    return displayFromParts(dbUsername, user);
  }, [hydrated, initialSession, dbUsername, user]);

  const isAuthenticated = hydrated ? Boolean(user) : Boolean(initialSession);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      displayName,
      isAuthenticated,
    }),
    [user, displayName, isAuthenticated]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
