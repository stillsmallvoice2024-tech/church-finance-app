import { useState } from 'react'
import { LogIn, Loader2, AlertCircle } from 'lucide-react'
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

export function JoinOrgModal({ open, onClose }: Props) {
  const navigate = useNavigate()
  const user     = useAuthStore(s => s.user)

  const [code,    setCode]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const handleClose = () => {
    setCode('')
    setError(null)
    onClose()
  }

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const trimmed = code.trim().toUpperCase()
    if (!trimmed) { setError('Please enter a join code.'); return }

    setLoading(true)
    const { data, error: rpcErr } = await supabase.rpc('use_join_code', { p_code: trimmed })
    setLoading(false)

    if (rpcErr) {
      setError(
        rpcErr.message.includes('already a member')
          ? 'You are already a member of this organisation.'
          : rpcErr.message.includes('Invalid or expired')
          ? 'This code is invalid or has already been used.'
          : rpcErr.message.includes('no longer active')
          ? 'This organisation is no longer active.'
          : rpcErr.message,
      )
      return
    }

    const result = data as { org_id: string; org_name: string; role: string }
    const membership: OrgMembership = {
      org_id:   result.org_id,
      org_name: result.org_name,
      role:     result.role as UserRole,
    }

    const store = useOrgStore.getState()
    store.setMemberships([...store.memberships, membership])
    store.setOrg(membership)
    if (user?.id) store.persistActive(user.id, result.org_id)

    // Refresh session so useAuth re-fetches org memberships
    await supabase.auth.refreshSession()

    handleClose()
    navigate('/', { replace: false })
  }

  return (
    <Modal open={open} onClose={handleClose} title="Join an Organisation" size="max-w-sm">
      <form onSubmit={handleJoin} className="space-y-4" noValidate>
        <div className="flex items-center gap-3 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5">
          <LogIn className="w-4 h-4 text-blue-500 shrink-0" />
          <p className="text-xs text-blue-700">
            Enter the join code shared by your organisation's administrator.
          </p>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Join Code *</label>
          <input
            type="text"
            value={code}
            onChange={e => setCode(e.target.value.replace(/\s/g, '').toUpperCase())}
            placeholder="e.g. AB12CD34"
            autoFocus
            autoComplete="off"
            maxLength={8}
            className="w-full px-3 py-2.5 text-sm font-mono tracking-widest border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors uppercase"
          />
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-1">
          <button
            type="button"
            onClick={handleClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !code.trim()}
            className="flex items-center gap-2 px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Joining…' : 'Join Organisation'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
