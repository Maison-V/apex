import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
export const SUPABASE_ENABLED = Boolean(supabaseUrl && supabaseAnonKey)

const noop = () => ({ data: null, error: null })
const noopObj = { auth: { getSession: () => Promise.resolve({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe: noop } } }), signUp: noop, signInWithPassword: noop, signOut: noop } }

export const supabase = SUPABASE_ENABLED ? createClient(supabaseUrl, supabaseAnonKey) : noopObj