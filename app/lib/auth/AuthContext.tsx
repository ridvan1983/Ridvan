import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '~/lib/supabase/client';

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  /** Returns Supabase session when email confirmation is off; otherwise session may be null until verify. */
  signUp: (email: string, password: string) => Promise<{ user: User | null; session: Session | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const authEventReceived = useRef(false);

  useEffect(() => {
    const initializeAuth = async () => {
      const { data, error } = await supabase.auth.getSession();

      if (error) {
        throw new Error(`[RIDVAN-E003] Failed to initialize auth session: ${error.message}`);
      }

      setSession(data.session ?? null);
      setUser(data.session?.user ?? null);
    };

    initializeAuth().catch((error) => {
      console.error(error);
      setSession(null);
      setUser(null);
    });

    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      authEventReceived.current = true;
      setSession(nextSession ?? null);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    const loadingTimeout = window.setTimeout(() => {
      if (!authEventReceived.current) {
        setLoading(false);
      }
    }, 1500);

    return () => {
      clearTimeout(loadingTimeout);
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      session,
      loading,
      signIn: async (email: string, password: string) => {
        const { error } = await supabase.auth.signInWithPassword({ email, password });

        if (error) {
          throw new Error(`[RIDVAN-E004] ${error.message}`);
        }
      },
      signUp: async (email: string, password: string) => {
        const { data, error } = await supabase.auth.signUp({ email, password });

        if (error) {
          throw new Error(`[RIDVAN-E005] ${error.message}`);
        }

        return {
          user: data.user ?? null,
          session: data.session ?? null,
        };
      },
      signOut: async () => {
        const { error } = await supabase.auth.signOut();

        if (error) {
          throw new Error(`[RIDVAN-E006] ${error.message}`);
        }
      },
    }),
    [loading, session, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('[RIDVAN-E007] useAuth must be used within an AuthProvider');
  }

  return context;
}
