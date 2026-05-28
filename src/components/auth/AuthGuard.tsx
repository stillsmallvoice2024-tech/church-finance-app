import { createContext, useContext } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useAuthStore } from '../../store/authStore'
import type { UserRole } from '../../types'

// ── Role context ──────────────────────────────────────────────────────────────
// Provided by AuthGuard so any descendant can read the role without
// going through Zustand (useful for deeply nested components / testing).
export const RoleContext = createContext<UserRole | null>(null)

export function useRoleContext(): UserRole | null {
  return useContext(RoleContext)
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function FullPageSpinner() {
  return (
    <div
      className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background"
      role="status"
      aria-label="Authenticating"
    >
      {/* Church cross logo while loading */}
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white shadow-md">
        <svg viewBox="0 0 32 32" className="h-9 w-9" fill="currentColor" aria-hidden="true">
          <rect x="13" y="2" width="6" height="28" rx="2" />
          <rect x="4" y="9" width="24" height="6" rx="2" />
        </svg>
      </div>
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      <p className="text-sm font-medium text-gray-400">Authenticating…</p>
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

// ── AuthGuard ─────────────────────────────────────────────────────────────────
export function AuthGuard() {
  const { isAuthenticated, loading, profile, role, signOut } = useAuth()
  const profileFetchFailed = useAuthStore((s) => s.profileFetchFailed)

  // Show spinner while the auth listener is resolving the initial session
  if (loading) return <FullPageSpinner />

  // No user → send to login
  if (!isAuthenticated) return <Navigate to="/login" replace />

  // Authenticated but profile never loaded — surface error instead of silently
  // dropping all permissions (which looks identical to viewer access).
  if (!profile && profileFetchFailed) return <ProfileErrorScreen onSignOut={signOut} />

  // Authenticated: provide role via context for descendants that need it
  return (
    <RoleContext.Provider value={role}>
      <Outlet />
    </RoleContext.Provider>
  )
}
