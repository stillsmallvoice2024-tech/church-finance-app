import { createContext, useContext } from 'react'
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../store/authStore'
import { useOrgStore } from '../../store/orgStore'
import type { UserRole } from '../../types'

// ── Role context ──────────────────────────────────────────────────────────────
export const RoleContext = createContext<UserRole | null>(null)

export function useRoleContext(): UserRole | null {
  return useContext(RoleContext)
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function FullPageSpinner({ label = 'Authenticating…' }: { label?: string }) {
  return (
    <div
      className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background"
      role="status"
      aria-label={label}
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white shadow-md">
        <svg viewBox="0 0 64 64" className="h-9 w-9" fill="none" aria-hidden="true">
          <path d="M 43 51 A 22 22 0 1 0 21 51"
                stroke="currentColor" strokeWidth="5.5" strokeLinecap="round"/>
          <path d="M 43 51 C 40 38 34 23 32 12 C 30 23 24 38 21 51 Z"
                fill="currentColor" opacity="0.72"/>
        </svg>
      </div>
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="text-sm font-medium text-gray-400">{label}</p>
    </div>
  )
}

// ── ProfileErrorScreen ────────────────────────────────────────────────────────
function ProfileErrorScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 text-red-500 shadow-md">
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
      </div>
      <div className="text-center">
        <p className="text-base font-semibold text-gray-800">Could not load your profile</p>
        <p className="mt-1 text-sm text-gray-500">
          Your account is authenticated but your profile failed to load.
          Please sign out and sign back in.
        </p>
      </div>
      <button
        onClick={onSignOut}
        className="mt-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary-light"
      >
        Sign out
      </button>
    </div>
  )
}

// ── NoOrgScreen ───────────────────────────────────────────────────────────────
// Shown when the user is authenticated but belongs to no active org.
function NoOrgScreen({ onSignOut, onCreateOrg }: { onSignOut: () => void; onCreateOrg: () => void }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-500 shadow-md">
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      </div>
      <div className="text-center max-w-sm">
        <p className="text-base font-semibold text-gray-800">No organisation access</p>
        <p className="mt-1 text-sm text-gray-500">
          Your account isn't linked to any organisation yet.
          You can create a new organisation or contact your administrator.
        </p>
      </div>
      <div className="flex gap-3 mt-2">
        <button
          onClick={onCreateOrg}
          className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-white hover:bg-primary-light"
        >
          Create Organisation
        </button>
        <button
          onClick={onSignOut}
          className="rounded-lg border border-gray-200 bg-white px-5 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}

// ── AuthGuard ─────────────────────────────────────────────────────────────────
export function AuthGuard() {
  const { isAuthenticated, loading, profile, role, signOut } = useAuth()
  const profileFetchFailed = useAuthStore((s) => s.profileFetchFailed)
  const orgId      = useOrgStore((s) => s.orgId)
  const switching  = useOrgStore((s) => s.switching)
  const location   = useLocation()
  const navigate   = useNavigate()

  // /onboarding is accessible without an org (user may be creating one)
  const isOnboarding = location.pathname === '/onboarding'

  if (loading) return <FullPageSpinner />

  if (switching) return <FullPageSpinner label="Switching organisation…" />

  if (!isAuthenticated) return <Navigate to="/login" replace />

  if (!profile && profileFetchFailed) return <ProfileErrorScreen onSignOut={signOut} />

  // Authenticated + profile loaded but no org membership — allow /onboarding so
  // the user can create their first org there.
  if (profile && !orgId && !isOnboarding) {
    return (
      <NoOrgScreen
        onSignOut={signOut}
        onCreateOrg={() => navigate('/onboarding')}
      />
    )
  }

  return (
    <RoleContext.Provider value={role}>
      <Outlet />
    </RoleContext.Provider>
  )
}
