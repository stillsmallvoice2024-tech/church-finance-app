import { useAuthStore } from '../store/authStore'

export function useAuth() {
  const { user, session, role, fullName, isLoading } = useAuthStore()
  return {
    user,
    session,
    role,
    fullName,
    isLoading,
    isAuthenticated: !!user,
    email: user?.email ?? '',
  }
}
