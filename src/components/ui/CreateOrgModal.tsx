import { useState } from 'react'
import { Building2, Loader2 } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuthStore } from '../../store/authStore'
import { useOrgStore, type OrgMembership } from '../../store/orgStore'
import { Modal } from './Modal'
import type { UserRole } from '../../types'

interface Props {
  open:    boolean
  onClose: () => void
}

export function CreateOrgModal({ open, onClose }: Props) {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)
  const [name,    setName]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!name.trim()) return

    setLoading(true)
    const { data, error: rpcErr } = await supabase.rpc('create_organization', { p_name: name.trim() })
    setLoading(false)

    if (rpcErr) {
      setError(rpcErr.message)
      return
    }

    const newOrgId = data as string
    const membership: OrgMembership = {
      org_id:              newOrgId,
      org_name:            name.trim(),
      role:                'owner' as UserRole,
      onboarding_complete: false,
    }

    const store = useOrgStore.getState()
    store.setMemberships([...store.memberships, membership])
    store.setOrg(membership)
    if (user?.id) store.persistActive(user.id, newOrgId)

    onClose()
    navigate('/onboarding?new=true', { replace: false })
  }

  return (
    <Modal open={open} onClose={onClose} title="Create Organisation" size="max-w-sm">
      <form onSubmit={handleCreate} className="space-y-4" noValidate>
        <div className="flex items-center gap-3 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5">
          <Building2 className="w-4 h-4 text-blue-500 shrink-0" />
          <p className="text-xs text-blue-700">
            You will automatically become the owner of the new organisation.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Organisation Name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g. Grace Community Church"
            autoFocus
            className="w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors"
          />
        </div>

        {error && (
          <p className="text-xs text-red-600 rounded-lg bg-red-50 border border-red-200 px-3 py-2">{error}</p>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="flex items-center gap-2 px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
