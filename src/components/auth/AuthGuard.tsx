import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { LoadingSkeleton } from '../ui/LoadingSkeleton'

export function AuthGuard() {
  const { isAuthenticated, isLoading } = useAuth()

  if (isLoading) return <LoadingSkeleton />
  if (!isAuthenticated) return <Navigate to="/login" replace />

  return <Outlet />
}
