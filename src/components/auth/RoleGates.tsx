import type { ReactNode } from 'react'
import { useRole } from '../../hooks/useRole'

interface GateProps {
  children: ReactNode
  /** Rendered when the gate condition is NOT met. Defaults to nothing. */
  fallback?: ReactNode
}

/**
 * Renders children only when the authenticated user has the 'admin' role.
 */
export function AdminOnly({ children, fallback = null }: GateProps) {
  const { isAdmin } = useRole()
  return isAdmin() ? <>{children}</> : <>{fallback}</>
}

/**
 * Renders children when the user is an admin or accountant (i.e. can write data).
 */
export function CanWrite({ children, fallback = null }: GateProps) {
  const { canWrite } = useRole()
  return canWrite() ? <>{children}</> : <>{fallback}</>
}
