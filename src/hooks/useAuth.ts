import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import type { UserProfile } from '../types'

const PROFILE_FETCH_TIMEOUT_MS = 10_000

// ── Internal helper ────────────────────────────────────────────────────────────
// Accepts an AbortSignal so the caller can cancel this fetch when a newer
// auth event arrives (prevents stale-closure race conditions).
async function fetchAndSetProfile(userId: string, signal: AbortSignal): Promise<void> {
  const { setProfile } = useAuthStore.getState()
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .abortSignal(signal)
      .single()

    if (signal.aborted) return

    if (error) {
      console.warn('[auth] fetchAndSetProfile error:', error.message)
      return
    }
    if (data) setProfile(data as UserProfile)
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      console.warn('[auth] profile fetch aborted (background tab or superseded event)')
      return
    }
    console.error('[auth] fetchAndSetProfile unexpected error:', err)
  }
}

// ── useAuthListener ────────────────────────────────────────────────────────────
// Call ONCE at the root of the app (App.tsx).
// Relies solely on onAuthStateChange — including INITIAL_SESSION — so there is
// no race condition with a parallel getSession() call.
//
// Race-condition safety: each auth event cancels the previous in-flight profile
// fetch via AbortController. Only the signal belonging to the current event is
// allowed to commit state or clear loading.
//
// Permanent-loading prevention: a hard timeout forces setLoading(false) if the
// profile fetch hangs for longer than PROFILE_FETCH_TIMEOUT_MS.
export function useAuthListener(): void {
  useEffect(() => {
    let mounted = true
    let currentController: AbortController | null = null

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (!mounted) return

      console.log(`[auth] event=${event} user=${session?.user?.id ?? 'none'}`)

      // Cancel any in-flight profile fetch from a previous auth event
      currentController?.abort()
      currentController = new AbortController()
      const { signal } = currentController

      if (
        session?.user &&
        (event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN' ||
          event === 'TOKEN_REFRESHED' ||
          event === 'USER_UPDATED')
      ) {
        useAuthStore.getState().setUser(session.user)

        // Hard timeout: if the profile fetch hangs, unblock the UI regardless
        const timeoutId = setTimeout(() => {
          if (mounted && !signal.aborted) {
            console.warn(`[auth] profile fetch timed out after ${PROFILE_FETCH_TIMEOUT_MS}ms — forcing setLoading(false)`)
            useAuthStore.getState().setLoading(false)
          }
        }, PROFILE_FETCH_TIMEOUT_MS)

        try {
          await fetchAndSetProfile(session.user.id, signal)
        } finally {
          clearTimeout(timeoutId)
          // Only the current (non-superseded, non-unmounted) event clears loading
          if (mounted && !signal.aborted) {
            console.log(`[auth] setLoading(false) — event=${event}`)
            useAuthStore.getState().setLoading(false)
          }
        }
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
        console.log('[auth] clearAuth()')
        useAuthStore.getState().clearAuth()
      }
    })

    return () => {
      mounted = false
      currentController?.abort()
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
