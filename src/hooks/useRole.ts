import { useAuthStore } from '../store/authStore'
import type { UserRole } from '../types'

export function useRole() {
  const role = useAuthStore((state) => state.role)

  return {
    role,
    isAdmin: role === 'admin',
    isFinanceManager: role === 'admin' || role === 'finance_manager',
    can: (requiredRole: UserRole): boolean => {
      if (requiredRole === 'viewer') return true
      if (requiredRole === 'finance_manager') return role === 'admin' || role === 'finance_manager'
      if (requiredRole === 'admin') return role === 'admin'
      return false
    },
  }
}
