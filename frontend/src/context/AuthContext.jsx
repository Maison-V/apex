import { createContext, useContext, useEffect, useState } from 'react'
import { supabase, SUPABASE_ENABLED } from '../lib/supabaseClient'
import { Navigate } from 'react-router-dom'

const AuthContext = createContext(undefined)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!SUPABASE_ENABLED) {
      setLoading(false)
      return
    }
    let mounted = true
    supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return
      setSession(data.session)
      setLoading(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })
    return () => {
      mounted = false
      listener?.subscription?.unsubscribe()
    }
  }, [])

  const signUp = async ({ email, password, fullName }) => {
    if (!SUPABASE_ENABLED) return { data: null, error: new Error('Supabase not configured') }
    return supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
  }

  const signIn = async ({ email, password }) => {
    if (!SUPABASE_ENABLED) return { data: null, error: new Error('Supabase not configured') }
    return supabase.auth.signInWithPassword({ email, password })
  }

  const signOut = async () => {
    if (SUPABASE_ENABLED) await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}