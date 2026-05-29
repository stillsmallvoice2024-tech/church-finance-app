import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useOrgStore } from '../store/orgStore'
import { useAllocationStore } from '../store/allocationStore'
import { useAccountCodesStore } from '../store/accountCodesStore'
import { useReportTemplateStore } from '../store/reportTemplateStore'
import type { UserProfile, UserRole } from '../types'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

const PROFILE_FETCH_TIMEOUT_MS = 10_000

type AuthEvent = AuthChangeEvent | 'FOCUS_REVALIDATE'

// ── fetchOrgMembership ─────────────────────────────────────────────────────────
// Fetches the user's first active org membership via raw REST (same CORS rationale
// as fetchProfile — no credentials:include).
async function fetchOrgMembership(
  userId:      string,
  accessToken: string,
  signal:      AbortSignal,
): Promise<{ org_id: string; org_name: string; role: UserRole } | null> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

  // organizations.slug=eq.primary ensures we always resolve the canonical org,
  // not a test/secondary org the user may also be a member of.
  const res = await fetch(
    `${baseUrl}/rest/v1/org_members?user_id=eq.${encodeURIComponent(userId)}&status=eq.active&select=org_id,role,organizations(name)&organizations.slug=eq.primary&limit=1`,
    {
      signal,
      headers: {
        apikey:        anonKey,
        Authorization: `Bearer ${accessToken}`,
        Accept:        'application/json',
      },
    },
  )

  if (!res.ok) {
    console.warn(`[auth] fetchOrgMembership HTTP ${res.status}`)
    return null
  }

  const rows = await res.json() as Array<{
    org_id:        string
    role:          UserRole
    organizations: { name: string } | null
  }>

  if (!rows[0]) return null
  const row = rows[0]
  return {
    org_id:   row.org_id,
    org_name: row.organizations?.name ?? 'My Church',
    role:     row.role,
  }
}

// ── fetchProfile ───────────────────────────────────────────────────────────────
// Raw fetch with AbortSignal for precise cancellation control.
// No `credentials: 'include'` — Supabase REST uses Bearer tokens, not cookies.
// Using credentials:include with Supabase's default CORS (Allow-Origin: *) causes
// browsers to block the response, leaving profile null and role unresolved.
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

// ── fetchProfileWithRetry ──────────────────────────────────────────────────────
// Retries up to MAX_ATTEMPTS times with exponential backoff on null returns.
// AbortError propagates immediately (caller owns cancellation).
const RETRY_DELAYS_MS = [0, 500, 1000]

async function fetchProfileWithRetry(
  userId: string,
  accessToken: string,
  signal: AbortSignal,
): Promise<UserProfile | null> {
  for (let attempt = 0; attempt < RETRY_DELAYS_MS.length; attempt++) {
    if (signal.aborted) return null

    if (attempt > 0) {
      await new Promise<void>(r => setTimeout(r, RETRY_DELAYS_MS[attempt]))
      if (signal.aborted) return null
      console.log(`[auth] fetchProfile retry attempt ${attempt + 1}`)
    }

    // fetchProfile throws AbortError if aborted — propagate immediately
    const profile = await fetchProfile(userId, accessToken, signal)
    if (profile) return profile
  }
  return null
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

          const profile = await fetchProfileWithRetry(session.user.id, session.access_token, signal)

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
            console.log(`[auth:${requestId}] profile loaded  role=${profile.role}`)

            // Load org membership — setLoading(false) is deferred until this resolves
            // so that useRole.resolved is not true until both profile and org are ready.
            try {
              const membership = await fetchOrgMembership(session.user.id, session.access_token, signal)
              if (signal.aborted || requestIdRef.current !== requestId || !mounted) return
              if (membership) {
                useOrgStore.getState().setOrg(membership)
                console.log(`[auth:${requestId}] org loaded  org=${membership.org_id}  orgRole=${membership.role}`)
              } else {
                console.warn(`[auth:${requestId}] no active org membership found`)
                useOrgStore.getState().clearOrg()
              }
            } catch (orgErr) {
              if (orgErr instanceof Error && orgErr.name === 'AbortError') return
              console.error(`[auth:${requestId}] org membership fetch failed:`, orgErr)
              if (requestIdRef.current === requestId && mounted && !signal.aborted) {
                useOrgStore.getState().clearOrg()
              }
            }
          } else {
            console.warn(`[auth:${requestId}] profile fetch failed after retries — user authenticated but role unresolved`)
            useAuthStore.getState().setProfileFetchFailed(true)
            useOrgStore.getState().clearOrg()
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
          useOrgStore.getState().clearOrg()
          useAllocationStore.getState().reset()
          useAccountCodesStore.getState().reset()
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
    useOrgStore.getState().clearOrg()
    useAllocationStore.getState().reset()
    useAccountCodesStore.getState().reset()
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
