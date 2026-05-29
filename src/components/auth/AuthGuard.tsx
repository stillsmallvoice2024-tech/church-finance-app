import { createContext, useContext } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
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
        <svg viewBox="0 0 32 32" className="h-9 w-9" fill="currentColor" aria-hidden="true">
          <rect x="13" y="2" width="6" height="28" rx="2" />
          <rect x="4" y="9" width="24" height="6" rx="2" />
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
function NoOrgScreen({ onSignOut }: { onSignOut: () => void }) {
  return (
    <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background px-4">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 text-amber-500 shadow-md">
        <svg viewBox="0 0 24 24" className="h-8 w-8" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" />
          <path d="M8 21h8M12 17v4" />
        </svg>
      </div>
      <div className="text-center max-w-sm">
        <p className="text-base font-semibold text-gray-800">No organization access</p>
        <p className="mt-1 text-sm text-gray-500">
          Your account isn't linked to any organization yet.
          Contact your administrator to be added to an organization.
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

// ── AuthGuard ─────────────────────────────────────────────────────────────────
export function AuthGuard() {
  const { isAuthenticated, loading, profile, role, signOut } = useAuth()
  const profileFetchFailed = useAuthStore((s) => s.profileFetchFailed)
  const orgId      = useOrgStore((s) => s.orgId)
  const switching  = useOrgStore((s) => s.switching)

  if (loading) return <FullPageSpinner />

  if (switching) return <FullPageSpinner label="Switching organization…" />

  if (!isAuthenticated) return <Navigate to="/login" replace />

  if (!profile && profileFetchFailed) return <ProfileErrorScreen onSignOut={signOut} />

  // Authenticated + profile loaded but no org membership resolved
  if (profile && !orgId) return <NoOrgScreen onSignOut={signOut} />

  return (
    <RoleContext.Provider value={role}>
      <Outlet />
    </RoleContext.Provider>
  )
}
