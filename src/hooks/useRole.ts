import { useAuthStore } from '../store/authStore'

export function useRole() {
  const user    = useAuthStore((state) => state.user)
  const role    = useAuthStore((state) => state.role)
  const loading = useAuthStore((state) => state.loading)

  // Guard on loading to avoid flash: no permissions until profile is hydrated.
  const resolved = !loading && !!user

  if (resolved && role === null) {
    console.warn('[role] resolved=true but role=null — profile may not have loaded correctly')
  }

  return {
    role,
    isAdmin:      (): boolean => resolved && role === 'admin',
    isAccountant: (): boolean => resolved && role === 'accountant',
    canWrite:     (): boolean => resolved && (role === 'admin' || role === 'accountant'),
    canDelete:    (): boolean => resolved && (role === 'admin' || role === 'accountant'),
  }
}
