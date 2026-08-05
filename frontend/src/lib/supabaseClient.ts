import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SUPABASE_ENABLED = Boolean(supabaseUrl && supabaseAnonKey);

const noop = async () => ({ data: null, error: null });

const noopObj = {
  auth: {
    getSession: async () => ({ data: { session: null } }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }),
    signUp: noop,
    signInWithPassword: noop,
    signOut: noop,
    getUser: async () => ({ data: { user: null } }),
  },
  from: () => ({
    select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
  }),
  rpc: async () => ({ data: null, error: null }),
};

export const supabase: SupabaseClient = (
  SUPABASE_ENABLED ? createClient(supabaseUrl!, supabaseAnonKey!) : noopObj
) as unknown as SupabaseClient;