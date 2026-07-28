import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { supabase, SUPABASE_ENABLED } from '../lib/supabaseClient'

const AuthContext = createContext(undefined)

const HEARTBEAT_INTERVAL_MS = 60 * 1000

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const heartbeatRef = useRef(null)

  const loadProfile = useCallback(async (userId) => {
    if (!userId) {
      setProfile(null)
      return null
    }
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single()
    if (error) {
      setProfile(null)
      return null
    }
    setProfile(data)
    return data
  }, [])

  useEffect(() => {
    if (!SUPABASE_ENABLED) {
      setLoading(false)
      return
    }
    let mounted = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session?.user) await loadProfile(data.session.user.id)
      setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return
      setSession(newSession)
      if (newSession?.user) await loadProfile(newSession.user.id)
      else setProfile(null)
    })

    return () => {
      mounted = false
      listener?.subscription?.unsubscribe()
    }
  }, [loadProfile])

  // Heartbeat: lets the CEO dashboard show who's online right now.
  // Only pings while a signed-in, approved member has the app open.
  useEffect(() => {
    if (!SUPABASE_ENABLED || !session?.user || profile?.status !== 'approved') {
      return undefined
    }
    const ping = () => {
      supabase.rpc('heartbeat').catch(() => {})
    }
    ping()
    heartbeatRef.current = setInterval(ping, HEARTBEAT_INTERVAL_MS)
    return () => clearInterval(heartbeatRef.current)
  }, [session?.user, profile?.status])

  const signUp = async ({ email, password, fullName }) => {
    if (!SUPABASE_ENABLED) return { data: null, error: new Error('Supabase not configured') }
    return supabase.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
  }

  const signIn = async ({ email, password }) => {
    if (!SUPABASE_ENABLED) return { data: null, error: new Error('Supabase not configured') }
    const result = await supabase.auth.signInWithPassword({ email, password })
    if (result.data?.session?.user) await loadProfile(result.data.session.user.id)
    return result
  }

  const signOut = async () => {
    if (SUPABASE_ENABLED) await supabase.auth.signOut()
    setProfile(null)
  }

  const refreshProfile = () => (session?.user ? loadProfile(session.user.id) : Promise.resolve(null))

  const isCeo = profile?.role === 'ceo' && profile?.status === 'approved'
  const isApproved = profile?.status === 'approved'
  const isPending = profile?.status === 'pending'
  const isRejected = profile?.status === 'rejected'

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
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (ctx === undefined) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}
