"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { supabase, SUPABASE_ENABLED } from "@/lib/supabaseClient";

export interface Profile {
  id: string;
  role: "member" | "ceo";
  status: "pending" | "approved" | "rejected";
  full_name?: string | null;
  email?: string | null;
  last_seen_at?: string | null;
}

interface AuthContextValue {
  session: { user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null } | null;
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> } | null;
  profile: Profile | null;
  loading: boolean;
  isCeo: boolean;
  isApproved: boolean;
  isPending: boolean;
  isRejected: boolean;
  signUp: (args: { email: string; password: string; fullName: string }) => Promise<{ data: unknown; error: Error | null }>;
  signIn: (args: { email: string; password: string }) => Promise<{ data: unknown; error: Error | null }>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<Profile | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthContextValue["session"]>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    if (!userId) {
      setProfile(null);
      return null;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();
    if (error || !data) {
      setProfile(null);
      return null;
    }
    setProfile(data as Profile);
    return data as Profile;
  }, []);

  useEffect(() => {
    if (!SUPABASE_ENABLED) {
      setLoading(false);
      return;
    }
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session as AuthContextValue["session"]);
      if (data.session?.user) await loadProfile(data.session.user.id);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;
      setSession(newSession as AuthContextValue["session"]);
      if (newSession?.user) await loadProfile(newSession.user.id);
      else setProfile(null);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, [loadProfile]);

  useEffect(() => {
    if (!SUPABASE_ENABLED || !session?.user || profile?.status !== "approved") {
      return undefined;
    }
    const ping = () => {
      supabase.rpc("heartbeat").then(() => {}, () => {});
    };
    ping();
    heartbeatRef.current = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    return () => {
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
    };
  }, [session?.user, profile?.status]);

  const signUp = async ({ email, password, fullName }: { email: string; password: string; fullName: string }) => {
    if (!SUPABASE_ENABLED) return { data: null, error: new Error("Supabase not configured") };
    return supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } });
  };

  const signIn = async ({ email, password }: { email: string; password: string }) => {
    if (!SUPABASE_ENABLED) return { data: null, error: new Error("Supabase not configured") };
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.data?.session?.user) await loadProfile(result.data.session.user.id);
    return result as { data: unknown; error: Error | null };
  };

  const signOut = async () => {
    if (SUPABASE_ENABLED) await supabase.auth.signOut();
    setProfile(null);
  };

  const refreshProfile = () =>
    session?.user ? loadProfile(session.user.id) : Promise.resolve(null);

  const isCeo = profile?.role === "ceo" && profile?.status === "approved";
  const isApproved = profile?.status === "approved";
  const isPending = profile?.status === "pending";
  const isRejected = profile?.status === "rejected";

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        isCeo,
        isApproved,
        isPending,
        isRejected,
        signUp,
        signIn,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}