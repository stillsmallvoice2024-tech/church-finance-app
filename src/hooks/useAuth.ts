import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import type { UserProfile } from '../types'

// ── Internal helper ────────────────────────────────────────────────────────────
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

// ── useAuthListener ────────────────────────────────────────────────────────────
// Call ONCE at the root of the app (App.tsx).
// Relies solely on onAuthStateChange — including INITIAL_SESSION — so there is
// no race condition with a parallel getSession() call.
export function useAuthListener(): void {
  useEffect(() => {
    let mounted = true

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return

      if (
        session?.user &&
        (event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED')
      ) {
        // Authenticated — hydrate the store
        useAuthStore.getState().setUser(session.user)
        await fetchAndSetProfile(session.user.id)
        if (mounted) useAuthStore.getState().setLoading(false)
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
        // No session on first load, or explicit sign-out
        if (mounted) useAuthStore.getState().clearAuth()
      }
    })

    return () => {
      mounted = false
      subscription.unsubscribe()
    }
  }, []) // intentionally empty — runs once on mount
}

// ── useAuth ────────────────────────────────────────────────────────────────────
export function useAuth() {
  const { user, profile, role, loading } = useAuthStore()

  const signOut = async (): Promise<void> => {
    // Clear the store immediately so AuthGuard redirects to /login right away,
    // regardless of whether the Supabase network call succeeds.
    useAuthStore.getState().clearAuth()
    // Best-effort server-side session invalidation — errors are intentionally ignored.
    await supabase.auth.signOut().catch(() => {})
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
