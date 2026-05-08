import { useAuthStore } from '../store/authStore'

// All methods are functions so callers get a stable, predictable API
// that can be extended (e.g., with permission scopes) without breaking call sites.
export function useRole() {
  const user = useAuthStore((state) => state.user)
  const role = useAuthStore((state) => state.role)

  // Any authenticated user gets full access. AuthGuard ensures only
  // signed-in users can reach protected routes, so !!user is the right gate.
  // role is still read from the store (used for display badges etc.) but must
  // not gate write/delete — profile fetch can fail while user is valid.
  const authenticated = !!user

  return {
    role,
    isAdmin:      (): boolean => authenticated,
    isAccountant: (): boolean => role === 'accountant',
    canWrite:     (): boolean => authenticated,
    canDelete:    (): boolean => authenticated,
  }
}
