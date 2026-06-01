import { useAuthStore } from '../store/authStore'
import { useOrgStore }  from '../store/orgStore'

export function useRole() {
  const user    = useAuthStore((s) => s.user)
  const loading = useAuthStore((s) => s.loading)
  const orgRole = useOrgStore((s)  => s.orgRole)

  // Guard on auth loading — setLoading(false) is deferred until org membership is
  // also resolved, so this single flag covers both profile and org readiness.
  const resolved = !loading && !!user

  if (resolved && orgRole === null) {
    console.warn('[role] resolved=true but orgRole=null — org membership may not have loaded correctly')
  }

  const role = orgRole

  const isOwnerOrAdmin = role === 'owner' || role === 'admin'
  const isFinanceUser  = isOwnerOrAdmin || role === 'accountant'

  return {
    role,
    isOwner:               (): boolean => resolved && role === 'owner',
    isAdmin:               (): boolean => resolved && isOwnerOrAdmin,
    isAccountant:          (): boolean => resolved && role === 'accountant',
    isViewer:              (): boolean => resolved && role === 'viewer',
    isReadOnly:            (): boolean => resolved && role === 'viewer',
    canWrite:              (): boolean => resolved && isFinanceUser,
    canDelete:             (): boolean => resolved && isFinanceUser,
    canEditTransactions:   (): boolean => resolved && isFinanceUser,
    canImportTransactions: (): boolean => resolved && isFinanceUser,
    canManageConfigs:      (): boolean => resolved && isOwnerOrAdmin,
    canManageMembers:      (): boolean => resolved && isOwnerOrAdmin,
    canTransferOwnership:  (): boolean => resolved && role === 'owner',
  }
}
