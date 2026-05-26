import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useReportTemplateStore } from '../store/reportTemplateStore'
import type { UserProfile } from '../types'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

const PROFILE_FETCH_TIMEOUT_MS = 10_000

type AuthEvent = AuthChangeEvent | 'FOCUS_REVALIDATE'

// ── fetchProfile ───────────────────────────────────────────────────────────────
// Raw fetch with credentials: 'include' and AbortSignal for precise
// cancellation control. Bypasses the Supabase client builder so the caller
// fully owns the request lifecycle.
async function fetchProfile(
  userId: string,
  accessToken: string,
  signal: AbortSignal,
): Promise<UserProfile | null> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

  const res = await fetch(
    `${baseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=*&limit=1`,
    {
      credentials: 'include',
      signal,
      headers: {
        apikey:        anonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept:        'application/json',
      },
    },
  )

  if (!res.ok) {
    console.warn(`[auth] fetchProfile HTTP ${res.status}`)
    return null
  }

  const rows = (await res.json()) as UserProfile[]
  return rows[0] ?? null
}

// ── useAuthListener ────────────────────────────────────────────────────────────
// Call ONCE at the root of the app (App.tsx).
//
// Structural guarantees:
//   - requestIdRef  monotonically increments per event; only the matching
//     request may write state or clear loading.
//   - controllerRef holds the AbortController for the in-flight fetch;
//     aborted on every new event and on unmount.
//   - AbortError is caught explicitly and never updates state.
//   - setLoading(false) is in a finally block, guarded by requestId + signal.
//   - A 10 s timeout aborts the controller and forces loading false.
//   - A window 'focus' listener re-validates the session after tab blur.
export function useAuthListener(): void {
  const requestIdRef  = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let mounted = true

    async function processAuthEvent(event: AuthEvent, session: Session | null): Promise<void> {
      // ── Cancel previous in-flight request ─────────────────────────────────
      controllerRef.current?.abort()
      const controller      = new AbortController()
      controllerRef.current = controller
      const { signal }      = controller

      // ── Capture request ownership ──────────────────────────────────────────
      const requestId = ++requestIdRef.current
      console.log(`[auth:${requestId}] start  event=${event}  user=${session?.user?.id ?? 'none'}`)

      const isAuthenticatedEvent =
        session?.user != null &&
        (event === 'INITIAL_SESSION' ||
          event === 'SIGNED_IN'      ||
          event === 'TOKEN_REFRESHED'||
          event === 'USER_UPDATED'   ||
          event === 'FOCUS_REVALIDATE')

      if (isAuthenticatedEvent && session?.user) {
        useAuthStore.getState().setUser(session.user)

        // ── Timeout: abort + force loading false if fetch hangs ──────────────
        const timeoutId = setTimeout(() => {
          if (requestIdRef.current === requestId) {
            console.warn(`[auth:${requestId}] timeout after ${PROFILE_FETCH_TIMEOUT_MS}ms — aborting`)
            controller.abort()
            if (mounted) useAuthStore.getState().setLoading(false)
          } else {
            console.log(`[auth:${requestId}] timeout fired on stale request — ignored`)
          }
        }, PROFILE_FETCH_TIMEOUT_MS)

        try {
          if (signal.aborted) {
            console.warn(`[auth:${requestId}] aborted before profile fetch`)
            return
          }

          const profile = await fetchProfile(session.user.id, session.access_token, signal)

          // ── Re-verify ownership after every await ──────────────────────────
          if (signal.aborted) {
            console.warn(`[auth:${requestId}] abort — result discarded`)
            return
          }
          if (requestIdRef.current !== requestId) {
            console.warn(`[auth:${requestId}] stale response ignored  (current=${requestIdRef.current})`)
            return
          }
          if (!mounted) return

          if (profile) {
            useAuthStore.getState().setProfile(profile)
            console.log(`[auth:${requestId}] success — profile loaded`)
          } else {
            console.warn(`[auth:${requestId}] user authenticated but profile returned null`)
          }
        } catch (err) {
          if (err instanceof Error && err.name === 'AbortError') {
            console.warn(`[auth:${requestId}] AbortError — no state update`)
            return
          }
          console.error(`[auth:${requestId}] unexpected error:`, err)
        } finally {
          clearTimeout(timeoutId)
          // ── Only the current, live, non-aborted request clears loading ──────
          if (requestIdRef.current === requestId && mounted && !signal.aborted) {
            console.log(`[auth:${requestId}] setLoading(false)`)
            useAuthStore.getState().setLoading(false)
          } else {
            console.log(
              `[auth:${requestId}] finally — loading not cleared` +
              `  stale=${requestIdRef.current !== requestId}` +
              `  aborted=${signal.aborted}` +
              `  mounted=${mounted}`,
            )
          }
        }
      } else if (event === 'INITIAL_SESSION' || event === 'SIGNED_OUT') {
        if (requestIdRef.current === requestId && mounted && !signal.aborted) {
          console.log(`[auth:${requestId}] clearAuth`)
          useAuthStore.getState().clearAuth()
          if (event === 'SIGNED_OUT') {
            useReportTemplateStore.getState().clearPin()
          }
        }
      }
    }

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      processAuthEvent(event, session)
    })

    // ── Focus revalidation ─────────────────────────────────────────────────────
    // Re-fetches the session when the tab regains focus. Any in-flight request
    // is cancelled by processAuthEvent's abort logic before the new one starts.
    async function handleFocus(): Promise<void> {
      console.log('[auth] window focus — revalidating session')
      const { data: { session } } = await supabase.auth.getSession()
      if (!mounted) return
      processAuthEvent('FOCUS_REVALIDATE', session)
    }

    window.addEventListener('focus', handleFocus)

    return () => {
      mounted = false
      controllerRef.current?.abort()
      subscription.unsubscribe()
      window.removeEventListener('focus', handleFocus)
    }
  }, [])
}

// ── useAuth ────────────────────────────────────────────────────────────────────
export function useAuth() {
  const { user, profile, role, loading } = useAuthStore()

  const signOut = async (): Promise<void> => {
    useAuthStore.getState().clearAuth()
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
