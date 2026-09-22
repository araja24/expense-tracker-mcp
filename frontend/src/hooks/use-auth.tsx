import * as React from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile } from '@/lib/types'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = React.createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = React.useState<Session | null>(null)
  const [profile, setProfile] = React.useState<Profile | null>(null)
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    let active = true

    /*
     * getSession() reads localStorage and does not contact the server, so a
     * session left behind by a deleted user — or one invalidated on another
     * device — still looks valid and renders the app as that account.
     * getUser() actually verifies it, so the stale copy is cleared on boot
     * rather than surviving until the first failing query.
     */
    async function restore() {
      const { data: cached } = await supabase.auth.getSession()

      if (!cached.session) {
        if (active) setLoading(false)
        return
      }

      const { error } = await supabase.auth.getUser()
      if (!active) return

      if (error) {
        await supabase.auth.signOut({ scope: 'local' })
        if (!active) return
        setSession(null)
        setProfile(null)
      } else {
        setSession(cached.session)
      }
      setLoading(false)
    }

    void restore()

    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoading(false)
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const refreshProfile = React.useCallback(async () => {
    if (!session?.user) {
      setProfile(null)
      return
    }
    const { data } = await supabase
      .from('profiles')
      .select('user_id, display_name, currency, month_start_day')
      .maybeSingle()
    setProfile((data as Profile | null) ?? null)
  }, [session?.user])

  React.useEffect(() => {
    void refreshProfile()
  }, [refreshProfile])

  const signOut = React.useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
  }, [])

  const value = React.useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      refreshProfile,
      signOut,
    }),
    [session, profile, loading, refreshProfile, signOut],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = React.useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside an <AuthProvider />')
  return context
}

/** Currency is a profile setting; everything that renders money needs it. */
export function useCurrency() {
  return useAuth().profile?.currency ?? 'USD'
}
