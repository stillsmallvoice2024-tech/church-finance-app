import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import type { UserProfile } from '../types'

// ── Internal helper ────────────────────────────────────────────────────────────
// Called outside React render; uses getState() to avoid stale closures
async function fetchAndSetProfile(userId: string): Promise<void> {
  const { setProfile } = useAuthStore.getState()
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()

  if (!error && data) {
    setProfile(data as UserProfile)
  }
}

// ── useAuthListener ─────────────────────────────────────────────────────────
// Call ONCE at the root of the app (App.tsx).
// Sets up the Supabase auth subscription and hydrates the store.
export function useAuthListener(): void {
  useEffect(() => {
    let mounted = true

    // 1. Hydrate from existing session (page reload / tab focus)
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!mounted) return

      if (session?.user) {
        useAuthStore.getState().setUser(session.user)
        await fetchAndSetProfile(session.user.id)
      }

      useAuthStore.getState().setLoading(false)
    }

    init()

    // 2. Subscribe to future changes (login, logout, token refresh)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return

      if (
        session?.user &&
        (event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED')
      ) {
        useAuthStore.getState().setUser(session.user)
        await fetchAndSetProfile(session.user.id)
        useAuthStore.getState().setLoading(false)
      } else if (event === 'SIGNED_OUT') {
        useAuthStore.getState().clearAuth()
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, []) // intentionally empty — runs once on mount
}

// ── useAuth ─────────────────────────────────────────────────────────────────
// Read-only hook — safe to call in any component.
// Returns auth state from the store plus a signOut helper.
export function useAuth() {
  const { user, profile, role, loading } = useAuthStore()

  const signOut = async (): Promise<void> => {
    // Supabase fires SIGNED_OUT which clears the store via the listener
    await supabase.auth.signOut()
  }

  return {
    user,
    profile,
    role,
    loading,
    signOut,
    isAuthenticated: !!user,
  }
}
