import { useAuthStore } from '../store/authStore'

// All methods are functions so callers get a stable, predictable API
// that can be extended (e.g., with permission scopes) without breaking call sites.
export function useRole() {
  const role = useAuthStore((state) => state.role)

  return {
    role,
    isAdmin: (): boolean => !!role,
    isAccountant: (): boolean => role === 'accountant',
    canWrite: (): boolean => !!role,
    canDelete: (): boolean => !!role,
  }
}
