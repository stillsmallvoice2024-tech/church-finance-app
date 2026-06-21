import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useOrgStore, type OrgMembership } from '../store/orgStore'
import { useAllocationStore } from '../store/allocationStore'
import { useAccountCodesStore } from '../store/accountCodesStore'
import { useReportTemplateStore } from '../store/reportTemplateStore'
import { useReconciliationStore } from '../store/reconciliationStore'
import { useHealthStore } from '../store/healthStore'
import { useFinanceStore } from '../store/financeStore'
import { useTransactionSyncStore } from '../store/transactionSyncStore'
import type { OrgStatus, UserProfile, UserRole } from '../types'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

const PROFILE_FETCH_TIMEOUT_MS = 10_000

type AuthEvent = AuthChangeEvent | 'FOCUS_REVALIDATE'

// ── fetchAllOrgMemberships ─────────────────────────────────────────────────────
// Fetches all active org memberships for the user.
// Attempt 1: full columns including deletion state (requires 20260602000001).
// Attempt 2: without deletion columns (requires 20260530000000).
// Attempt 3: minimal fallback for very old DBs.
async function fetchAllOrgMemberships(
  userId:      string,
  accessToken: string,
  signal:      AbortSignal,
): Promise<OrgMembership[]> {
  const baseUrl = import.meta.env.VITE_SUPABASE_URL as string
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

  const headers = {
    apikey:        anonKey,
    Authorization: `Bearer ${accessToken}`,
    Accept:        'application/json',
  }
  const base = `${baseUrl}/rest/v1/org_members?user_id=eq.${encodeURIComponent(userId)}&status=eq.active`

  // Attempt 1: full columns including deletion-lifecycle fields
  const res1 = await fetch(
    `${base}&select=org_id,role,organizations(name,onboarding_complete,default_currency,timezone,status,deleted_at,purge_at,metadata)`,
    { signal, headers },
  )

  if (res1.ok) {
    const rows = await res1.json() as Array<{
      org_id:        string
      role:          UserRole
      organizations: {
        name:                string
        onboarding_complete: boolean | null
        default_currency:    string | null
        timezone:            string | null
        status:              OrgStatus | null
        deleted_at:          string | null
        purge_at:            string | null
        metadata:            Record<string, unknown> | null
      } | null
    }>
    return rows.map(row => ({
      org_id:              row.org_id,
      org_name:            row.organizations?.name ?? 'My Organization',
      role:                row.role,
      onboarding_complete: row.organizations?.onboarding_complete ?? null,
      default_currency:    row.organizations?.default_currency ?? null,
      timezone:            row.organizations?.timezone ?? null,
      org_status:          row.organizations?.status ?? 'active',
      org_deleted_at:      row.organizations?.deleted_at ?? null,
      org_purge_at:        row.organizations?.purge_at ?? null,
      org_type:            (row.organizations?.metadata?.org_type as string | null) ?? null,
    }))
  }

  // Attempt 2: without deletion columns (pre-20260602000001 DBs)
  if (res1.status === 400) {
    const res2 = await fetch(
      `${base}&select=org_id,role,organizations(name,onboarding_complete,default_currency)`,
      { signal, headers },
    )
    if (res2.ok) {
      const rows = await res2.json() as Array<{
        org_id:        string
        role:          UserRole
        organizations: { name: string; onboarding_complete: boolean | null; default_currency: string | null } | null
      }>
      return rows.map(row => ({
        org_id:              row.org_id,
        org_name:            row.organizations?.name ?? 'My Organization',
        role:                row.role,
        onboarding_complete: row.organizations?.onboarding_complete ?? null,
        default_currency:    row.organizations?.default_currency ?? null,
        timezone:            null,
        org_status:          'active' as OrgStatus,
        org_deleted_at:      null,
        org_purge_at:        null,
      }))
    }

    // Attempt 3: minimal fallback for very old DBs
    if (res2.status === 400) {
      const res3 = await fetch(
        `${base}&select=org_id,role,organizations(name)`,
        { signal, headers },
      )
      if (!res3.ok) {
        console.warn(`[auth] fetchAllOrgMemberships minimal fallback HTTP ${res3.status}`)
        return []
      }
      const rows = await res3.json() as Array<{
        org_id:        string
        role:          UserRole
        organizations: { name: string } | null
      }>
      return rows.map(row => ({
        org_id:              row.org_id,
        org_name:            row.organizations?.name ?? 'My Organization',
        role:                row.role,
        onboarding_complete: null,
        default_currency:    null,
        timezone:            null,
        org_status:          'active' as OrgStatus,
        org_deleted_at:      null,
        org_purge_at:        null,
      }))
    }

    console.warn(`[auth] fetchAllOrgMemberships attempt 2 HTTP ${res2.status}`)
    return []
  }

  console.warn(`[auth] fetchAllOrgMemberships HTTP ${res1.status}`)
  return []
}

// ── selectActiveOrg ────────────────────────────────────────────────────────────
// Picks the active org from a list of memberships.
// Prefers the org persisted in localStorage for this user; falls back to first.
function selectActiveOrg(
  memberships: OrgMembership[],
  userId: string,
): OrgMembership | null {
  if (memberships.length === 0) return null
  const persisted = useOrgStore.getState().getPersistedOrgId(userId)
  if (persisted) {
    const match = memberships.find(m => m.org_id === persisted)
    if (match) return match
  }
  return memberships[0]
}

// ── fetchProfile ───────────────────────────────────────────────────────────────
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

    const profile = await fetchProfile(userId, accessToken, signal)
    if (profile) return profile
  }
  return null
}

// ── useAuthListener ────────────────────────────────────────────────────────────
export function useAuthListener(): void {
  const requestIdRef  = useRef(0)
  const controllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    let mounted = true

    async function processAuthEvent(event: AuthEvent, session: Session | null): Promise<void> {
      controllerRef.current?.abort()
      const controller      = new AbortController()
      controllerRef.current = controller
      const { signal }      = controller

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
        if (event === 'SIGNED_IN') {
          // Single atomic commit so no render exists where isAuthenticated=true
          // but loading=false before profile+org are ready (avoids blank dashboard)
          useAuthStore.setState({ user: session.user, loading: true })
        } else {
          useAuthStore.getState().setUser(session.user)
        }

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

            try {
              const memberships = await fetchAllOrgMemberships(session.user.id, session.access_token, signal)
              if (signal.aborted || requestIdRef.current !== requestId || !mounted) return

              if (memberships.length > 0) {
                const active = selectActiveOrg(memberships, session.user.id)
                useOrgStore.getState().setMemberships(memberships)
                if (active) {
                  useOrgStore.getState().setOrg(active)
                  console.log(`[auth:${requestId}] org loaded  org=${active.org_id}  orgRole=${active.role}  total=${memberships.length}`)
                }
              } else {
                console.warn(`[auth:${requestId}] no active org memberships found`)
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
          useReconciliationStore.getState().clearResults()
          useHealthStore.getState().clearHealth()
          useFinanceStore.getState().reset()
          useTransactionSyncStore.getState().reset()
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
    useReconciliationStore.getState().clearResults()
    useHealthStore.getState().clearHealth()
    useFinanceStore.getState().reset()
    useTransactionSyncStore.getState().reset()
    useReportTemplateStore.getState().clearPin()
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

// ── useOrgSwitch ───────────────────────────────────────────────────────────────
// Switches the active org: resets all org-scoped caches, persists the choice,
// and activates the new membership. Call from UI — do NOT use inside a store.
export function useOrgSwitch() {
  const user = useAuthStore(s => s.user)

  const switchOrg = (membership: OrgMembership): void => {
    const { setOrg, setSwitching, persistActive } = useOrgStore.getState()
    setSwitching(true)
    // Reset all org-scoped caches so stale data from the previous org is cleared
    useAllocationStore.getState().reset()
    useAccountCodesStore.getState().reset()
    useReconciliationStore.getState().clearResults()
    useHealthStore.getState().clearHealth()
    useFinanceStore.getState().reset()
    useTransactionSyncStore.getState().reset()
    useReportTemplateStore.getState().clearPin()
    // Persist selection so page reloads restore the same org
    if (user?.id) persistActive(user.id, membership.org_id)
    setOrg(membership)
    setSwitching(false)
  }

  return { switchOrg }
}
