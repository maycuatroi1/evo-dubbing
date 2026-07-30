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

export function AuthProvider({
  url,
  publishableKey,
  children
}: {
  url: string;
  publishableKey: string;
  children: React.ReactNode;
}) {
  const [client] = useState<SupabaseClient | null>(() =>
    url && publishableKey ? createClient(url, publishableKey) : null
  );
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
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
  }, [client]);

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
