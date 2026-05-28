import type { ReactNode } from 'react'
import { useRole } from '../../hooks/useRole'

interface GateProps {
  children: ReactNode
  /** Rendered when the gate condition is NOT met. Defaults to nothing. */
  fallback?: ReactNode
}

/** Renders children only when the authenticated user has the 'admin' role. */
export function AdminOnly({ children, fallback = null }: GateProps) {
  const { isAdmin } = useRole()
  return isAdmin() ? <>{children}</> : <>{fallback}</>
}

/** Renders children when the user is an admin or accountant (can write data). */
export function CanWrite({ children, fallback = null }: GateProps) {
  const { canWrite } = useRole()
  return canWrite() ? <>{children}</> : <>{fallback}</>
}

/** Renders children when the user can import transactions (admin or accountant). */
export function CanImport({ children, fallback = null }: GateProps) {
  const { canImportTransactions } = useRole()
  return canImportTransactions() ? <>{children}</> : <>{fallback}</>
}

/** Renders children when the user can manage configs (admin only). */
export function CanManageConfigs({ children, fallback = null }: GateProps) {
  const { canManageConfigs } = useRole()
  return canManageConfigs() ? <>{children}</> : <>{fallback}</>
}
