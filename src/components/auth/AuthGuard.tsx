import { createContext, useContext } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
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

// ── AuthGuard ─────────────────────────────────────────────────────────────────
export function AuthGuard() {
  const { isAuthenticated, loading, role } = useAuth()

  // Show spinner while the auth listener is resolving the initial session
  if (loading) return <FullPageSpinner />

  // No user → send to login
  if (!isAuthenticated) return <Navigate to="/login" replace />

  // Authenticated: provide role via context for descendants that need it
  return (
    <RoleContext.Provider value={role}>
      <Outlet />
    </RoleContext.Provider>
  )
}
