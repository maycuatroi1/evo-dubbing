"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";

interface AuthContextValue {
  client: SupabaseClient | null;
  session: Session | null;
  ready: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  client: null,
  session: null,
  ready: false,
  signOut: async () => undefined
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [client, setClient] = useState<SupabaseClient | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [configReady, setConfigReady] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/config")
      .then((res) => res.json())
      .then((data: { configured?: boolean; url?: string; key?: string }) => {
        if (cancelled) return;
        if (data.configured && data.url && data.key) {
          setClient(createClient(data.url, data.key));
        }
        setConfigReady(true);
      })
      .catch(() => {
        if (!cancelled) setConfigReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!configReady) return;
    if (!client) {
      setReady(true);
      return;
    }
    let cancelled = false;
    client.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setReady(true);
    });
    const {
      data: { subscription }
    } = client.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });
    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [client, configReady]);

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
    setSession(null);
  }

  return (
    <AuthContext.Provider value={{ client, session, ready, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
