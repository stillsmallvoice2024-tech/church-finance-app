import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  UserPlus, Shield, Users, User,
  ChevronDown, Pencil, XCircle, MailOpen, Eye, EyeOff, KeyRound, Trash2,
} from 'lucide-react'
import { Modal }           from '../components/ui/Modal'
import { DeleteDialog }    from '../components/ui/DeleteDialog'
import { DeleteOrgModal }  from '../components/modals/DeleteOrgModal'
import { exportCSV }    from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { Navigate } from 'react-router-dom'
import { useAuth }      from '../hooks/useAuth'
import { useRole }      from '../hooks/useRole'
import { useToastStore } from '../store/toastStore'
import { usePageTitle }  from '../hooks/usePageTitle'
import { supabase }     from '../lib/supabase'
import { useOrgStore }  from '../store/orgStore'
import type { UserRole } from '../types'

// Org-member row — flattened from org_members + profiles join.
// Role and identity are sourced from org_members (not profiles.role).
interface OrgMember {
  id:         string   // org_members.id — used for UPDATE operations
  user_id:    string   // profiles.id  — used for isSelf comparison
  role:       UserRole
  status:     string
  joined_at:  string
  email:      string
  full_name:  string
  username:   string | null
  created_at: string   // profiles.created_at (registration date)
  updated_at: string
}

// ── Role display config ────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<UserRole, { label: string; pill: string }> = {
  owner:      { label: 'Owner',      pill: 'bg-purple-600 text-white'      },
  admin:      { label: 'Admin',      pill: 'bg-primary text-white'         },
  accountant: { label: 'Accountant', pill: 'bg-amber-100 text-amber-700'   },
  viewer:     { label: 'Viewer',     pill: 'bg-gray-100 text-gray-500'     },
}

function RolePill({ role }: { role: UserRole }) {
  const { label, pill } = ROLE_CONFIG[role]
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${pill}`}>
      {(role === 'owner' || role === 'admin') && <Shield className="w-3 h-3" />}
      {label}
    </span>
  )
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

// ── Invite User Modal ──────────────────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email('Enter a valid email'),
  role:  z.enum(['admin', 'accountant', 'viewer'] as const),
})
type InviteForm = z.infer<typeof inviteSchema>

function InviteUserModal({
  open,
  onClose,
  onSuccess,
  invitedById,
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  invitedById: string
}) {
  const { push: toast } = useToastStore()
  const { register, handleSubmit, formState: { errors }, reset } =
    useForm<InviteForm>({ resolver: zodResolver(inviteSchema), defaultValues: { role: 'accountant' } })
  const [loading,   setLoading]   = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copied,    setCopied]    = useState(false)

  useEffect(() => {
    if (open) { reset({ role: 'accountant' }); setInviteUrl(null); setCopied(false) }
  }, [open, reset])

  const handleCopy = () => {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const onSubmit = async (values: InviteForm) => {
    setLoading(true)
    const { orgId } = useOrgStore.getState()

    // Check for an existing pending invite for this email+org to avoid duplicates.
    let existingQuery = supabase
      .from('invitations')
      .select('token')
      .eq('email', values.email)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
    if (orgId) existingQuery = existingQuery.eq('org_id', orgId)
    const { data: existing } = await existingQuery.maybeSingle()

    if (existing) {
      setLoading(false)
      setInviteUrl(`${window.location.origin}/invite/${existing.token}`)
      onSuccess()
      return
    }

    const token      = crypto.randomUUID()
    const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { error } = await supabase.from('invitations').insert({
      email:      values.email,
      role:       values.role,
      invited_by: invitedById,
      status:     'pending',
      token,
      expires_at: expiresAt,
      ...(orgId ? { org_id: orgId } : {}),
    })
    setLoading(false)
    if (error) {
      toast(error.message, 'error')
    } else {
      setInviteUrl(`${window.location.origin}/invite/${token}`)
      onSuccess()
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite User" size="max-w-md">
      {inviteUrl ? (
        <div className="space-y-4">
          <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-700">
            Invitation created! Share this link with the user. It expires in 7 days.
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Invite Link</label>
            <div className="flex gap-2">
              <input
                type="text"
                readOnly
                value={inviteUrl}
                className="flex-1 px-3 py-2 text-xs border border-gray-300 rounded-lg bg-gray-50 text-gray-600 font-mono outline-none"
              />
              <button
                onClick={handleCopy}
                className="px-3 py-2 text-xs bg-primary text-white rounded-lg hover:bg-primary-light shrink-0"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700 flex gap-2">
            <MailOpen className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              A unique invite link will be generated. Share it with the user so they can
              create their account and set a password.
            </span>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Email Address *</label>
            <input
              type="email"
              placeholder="user@example.com"
              {...register('email')}
              className={`w-full px-3 py-2 text-sm border rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white ${errors.email ? 'border-red-400' : 'border-gray-300 focus:border-primary'}`}
            />
            {errors.email && <p className="text-xs text-red-500">{errors.email.message}</p>}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600">Role</label>
            <select
              {...register('role')}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 bg-white focus:border-primary"
            >
              <option value="admin">Admin — full access except ownership transfer</option>
              <option value="accountant">Accountant — can add and edit records</option>
              <option value="viewer">Viewer — read-only access</option>
            </select>
            <p className="text-xs text-gray-400">Owner role can only be assigned via Transfer Ownership after the user joins.</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
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
              disabled={loading}
              className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
            >
              {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {loading ? 'Generating…' : 'Generate Invite Link'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}

// ── Edit Profile Modal ─────────────────────────────────────────────────────────

const USERNAME_MIGRATION_SQL = `-- Run in Supabase SQL editor:
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text UNIQUE;`

function EditProfileModal({
  open,
  onClose,
  profile: currentProfile,
  userId,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  profile: { full_name: string; username?: string | null }
  userId: string
  onSuccess: (update: { full_name: string; username: string | null }) => void
}) {
  const { push: toast } = useToastStore()
  const [name,     setName]     = useState(currentProfile.full_name)
  const [username, setUsername] = useState(currentProfile.username ?? '')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const isMigrationError = !!error && /column.*does not exist|does not exist/i.test(error)

  useEffect(() => {
    if (open) {
      setName(currentProfile.full_name)
      setUsername(currentProfile.username ?? '')
      setError(null)
    }
  }, [open, currentProfile])

  const handleSave = async () => {
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    const update: Record<string, unknown> = {
      full_name:  name.trim(),
      username:   username.trim().toLowerCase() || null,
      updated_at: new Date().toISOString(),
    }
    const { error: err } = await supabase
      .from('profiles')
      .update(update)
      .eq('id', userId)
    setLoading(false)
    if (err) {
      setError(err.message)
    } else {
      toast('Profile updated', 'success')
      onSuccess({ full_name: name.trim(), username: update.username as string | null })
      onClose()
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Profile" size="max-w-sm">
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Full Name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Your full name"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            autoFocus
          />
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Username</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value.replace(/\s/g, ''))}
            placeholder="e.g. johnsmith (for login)"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          />
          <p className="text-[11px] text-gray-400">
            Optional. Used to log in instead of your email address.
          </p>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">
            <p className="font-medium mb-1">{error}</p>
            {isMigrationError && (
              <>
                <p className="mb-1 text-gray-500">Run this migration in Supabase first:</p>
                <pre className="bg-gray-900 text-green-300 rounded p-2 overflow-x-auto whitespace-pre-wrap text-[10px]">
                  {USERNAME_MIGRATION_SQL}
                </pre>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || !name.trim()}
            className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Change Password Modal ──────────────────────────────────────────────────────

function ChangePasswordModal({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const { push: toast } = useToastStore()
  const [password,  setPassword]  = useState('')
  const [confirm,   setConfirm]   = useState('')
  const [showPw,    setShowPw]    = useState(false)
  const [showConf,  setShowConf]  = useState(false)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)

  useEffect(() => {
    if (open) { setPassword(''); setConfirm(''); setError(null) }
  }, [open])

  const handleSave = async () => {
    setError(null)
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirm) {
      setError('Passwords do not match.')
      return
    }
    setLoading(true)
    const { error: err } = await supabase.auth.updateUser({ password })
    setLoading(false)
    if (err) {
      setError(err.message)
    } else {
      toast('Password updated successfully', 'success')
      onClose()
    }
  }

  const fieldCls = 'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary pr-10'

  return (
    <Modal open={open} onClose={onClose} title="Change Password" size="max-w-sm">
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">New Password</label>
          <div className="relative">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              autoComplete="new-password"
              className={fieldCls}
            />
            <button
              type="button"
              onClick={() => setShowPw(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Confirm New Password</label>
          <div className="relative">
            <input
              type={showConf ? 'text' : 'password'}
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              placeholder="Re-enter new password"
              autoComplete="new-password"
              className={fieldCls}
            />
            <button
              type="button"
              onClick={() => setShowConf(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showConf ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={loading}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || !password || !confirm}
            className="px-5 py-2 text-sm text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60 flex items-center gap-2"
          >
            {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Update Password
          </button>
        </div>
      </div>
    </Modal>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UserManagement() {
  const { user, profile } = useAuth()
  const { isAdmin, isOwner, canTransferOwnership } = useRole()
  const { push: toast }   = useToastStore()
  const { orgId }         = useOrgStore()

  usePageTitle('User Management')

  const [members,          setMembers]          = useState<OrgMember[]>([])
  const [loading,          setLoading]          = useState(true)
  const [inviteOpen,       setInviteOpen]       = useState(false)
  const [editProfileOpen,  setEditProfileOpen]  = useState(false)
  const [changePwOpen,     setChangePwOpen]     = useState(false)
  const [removeId,         setRemoveId]         = useState<string | null>(null)
  const [transferTarget,   setTransferTarget]   = useState<OrgMember | null>(null)
  const [savingId,         setSavingId]         = useState<string | null>(null)
  const [removing,         setRemoving]         = useState(false)
  const [transferring,     setTransferring]     = useState(false)
  const [deleteOrgOpen,    setDeleteOrgOpen]    = useState(false)
  const [currentProfile,   setCurrentProfile]   = useState({
    full_name: profile?.full_name ?? '',
    username:  profile?.username  ?? null as string | null,
  })

  useEffect(() => {
    if (profile) {
      setCurrentProfile({
        full_name: profile.full_name ?? '',
        username:  profile.username ?? null,
      })
    }
  }, [profile?.full_name])

  // Query org_members joined with profiles — role is sourced from org_members.
  const fetchUsers = useCallback(async () => {
    setLoading(true)
    if (!orgId) { setLoading(false); return }

    const { data, error } = await supabase
      .from('org_members')
      .select('id, user_id, role, status, joined_at, user_profile:profiles!org_members_user_id_fkey(id, email, full_name, created_at, updated_at)')
      .eq('org_id', orgId)
      .eq('status', 'active')
      .order('joined_at', { ascending: true })

    if (error) {
      toast(error.message, 'error')
      setLoading(false)
      return
    }

    type ProfileJoin = { id: string; email: string; full_name: string; created_at: string; updated_at: string }
    const flattened: OrgMember[] = (data ?? []).map(m => {
      const p = (m.user_profile as unknown as ProfileJoin) ?? { id: '', email: '', full_name: '', created_at: '', updated_at: '' }
      return {
        id:         m.id,
        user_id:    m.user_id,
        role:       m.role as UserRole,
        status:     m.status,
        joined_at:  m.joined_at,
        email:      p.email ?? '',
        full_name:  p.full_name ?? '',
        username:   null,
        created_at: p.created_at,
        updated_at: p.updated_at,
      }
    })

    setMembers(flattened)
    setLoading(false)
  }, [toast, orgId])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  // Uses update_org_member_role RPC — enforces min-owner constraint and caller permissions.
  const handleRoleChange = async (memberId: string, newRole: UserRole) => {
    setSavingId(memberId)
    const { error } = await supabase.rpc('update_org_member_role', {
      p_member_id: memberId,
      p_new_role:  newRole,
    })
    setSavingId(null)
    if (error) {
      toast(error.message, 'error')
    } else {
      toast('Role updated', 'success')
      setMembers(prev => prev.map(m => m.id === memberId ? { ...m, role: newRole } : m))
    }
  }

  const handleRemove = async () => {
    if (!removeId) return
    setRemoving(true)
    const { error } = await supabase.rpc('remove_org_member', { p_member_id: removeId })
    setRemoving(false)
    if (error) {
      toast(error.message, 'error')
    } else {
      toast('Member removed', 'success')
      setMembers(prev => prev.filter(m => m.id !== removeId))
      setRemoveId(null)
    }
  }

  const handleTransferOwnership = async () => {
    if (!transferTarget || !orgId) return
    setTransferring(true)
    const { error } = await supabase.rpc('transfer_org_ownership', {
      p_org_id:         orgId,
      p_target_user_id: transferTarget.user_id,
    })
    setTransferring(false)
    if (error) {
      toast(error.message, 'error')
    } else {
      toast(`Ownership transferred to ${transferTarget.full_name || transferTarget.email}`, 'success')
      setTransferTarget(null)
      fetchUsers()
    }
  }

  const removeTarget   = members.find(m => m.id === removeId)

  const UM_CSV_HEADERS = ['Email', 'Full Name', 'Role', 'Joined']
  const umCsvRow = (m: OrgMember) => [m.email, m.full_name, m.role, m.created_at ? new Date(m.created_at).toLocaleDateString() : '']
  const UM_CSV_FILE = `users-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(UM_CSV_FILE, UM_CSV_HEADERS, members.map(umCsvRow))
  const handleExportAll  = () => exportCSV(UM_CSV_FILE, UM_CSV_HEADERS, members.map(umCsvRow))

  const totalCount      = members.length
  const ownerCount      = members.filter(m => m.role === 'owner').length
  const adminCount      = members.filter(m => m.role === 'admin').length
  const accountantCount = members.filter(m => m.role === 'accountant').length

  // Defense-in-depth: route guard in App.tsx is primary, this is a fallback
  if (!isAdmin()) return <Navigate to="/" replace />

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Control who can access the finance system</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportDropdown onExportView={handleExportView} onExportAll={handleExportAll} disabled={members.length === 0} />
          <button
            onClick={() => setInviteOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light"
          >
            <UserPlus className="w-4 h-4" /> Invite User
          </button>
        </div>
      </div>

      {/* ── Current user card ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold shrink-0">
              {initials(currentProfile.full_name || profile?.email || 'Me')}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">{currentProfile.full_name || '—'}</span>
                <span className="text-xs text-gray-400">(you)</span>
              </div>
              {currentProfile.username && (
                <div className="text-xs text-gray-400 font-mono">@{currentProfile.username}</div>
              )}
              <div className="text-sm text-gray-500">{user?.email}</div>
              <div className="mt-1">
                <RolePill role={(profile?.role as UserRole) ?? 'viewer'} />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setChangePwOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              <KeyRound className="w-3.5 h-3.5" /> Change Password
            </button>
            <button
              onClick={() => setEditProfileOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit Profile
            </button>
          </div>
        </div>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Members', value: totalCount,      icon: <Users className="w-5 h-5 text-primary" /> },
          { label: 'Owners',        value: ownerCount,      icon: <Shield className="w-5 h-5 text-purple-600" /> },
          { label: 'Admins',        value: adminCount,      icon: <Shield className="w-5 h-5 text-primary" /> },
          { label: 'Accountants',   value: accountantCount, icon: <User  className="w-5 h-5 text-amber-500" /> },
        ].map(({ label, value, icon }) => (
          <div key={label} className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 flex items-center gap-3">
            <div className="p-2 bg-gray-50 rounded-lg">{icon}</div>
            <div>
              <div className="text-xs text-gray-500">{label}</div>
              <div className="text-2xl font-bold text-gray-900">{value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Team members table ────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">All Members</h2>
          <span className="text-xs text-gray-400">{totalCount} member{totalCount !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : !orgId ? (
          <div className="py-16 text-center text-sm text-gray-400">No organisation loaded. Please refresh.</div>
        ) : members.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">No members found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="px-5 py-3 text-left font-medium">Name</th>
                  <th className="px-5 py-3 text-left font-medium">Email</th>
                  <th className="px-5 py-3 text-left font-medium">Role</th>
                  <th className="px-5 py-3 text-left font-medium">Registered</th>
                  <th className="px-5 py-3 text-left font-medium">Joined Org</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {members.map(m => {
                  const isSelf  = m.user_id === user?.id
                  const saving  = savingId === m.id
                  // Owner can change any role; admin can change non-owner roles only
                  const canEditRole = !isSelf && isAdmin() && !(m.role === 'owner' && !isOwner())

                  return (
                    <tr key={m.id} className={`hover:bg-gray-50 ${isSelf ? 'bg-blue-50/30' : ''}`}>
                      {/* Name */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                            {initials(m.full_name || m.email)}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">
                              {m.full_name || '—'}
                              {isSelf && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="px-5 py-3 text-gray-500">{m.email}</td>

                      {/* Role — editable dropdown via RPC */}
                      <td className="px-5 py-3">
                        <div className="relative inline-block">
                          <select
                            value={m.role}
                            disabled={!canEditRole || saving}
                            onChange={e => handleRoleChange(m.id, e.target.value as UserRole)}
                            className={`appearance-none pr-6 pl-2.5 py-1 text-xs rounded-full font-semibold border-0 outline-none cursor-pointer disabled:cursor-default ${ROLE_CONFIG[m.role].pill} ${!canEditRole ? 'opacity-60' : ''}`}
                            title={isSelf ? 'You cannot change your own role' : undefined}
                          >
                            {isOwner() && <option value="owner">Owner</option>}
                            <option value="admin">Admin</option>
                            <option value="accountant">Accountant</option>
                            <option value="viewer">Viewer</option>
                          </select>
                          {canEditRole && (
                            <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" />
                          )}
                          {saving && (
                            <span className="ml-2 inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          )}
                        </div>
                      </td>

                      {/* Registered */}
                      <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {m.created_at ? new Date(m.created_at).toLocaleDateString() : '—'}
                      </td>

                      {/* Joined org */}
                      <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {m.joined_at ? new Date(m.joined_at).toLocaleDateString() : '—'}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canTransferOwnership() && !isSelf && m.role !== 'owner' && (
                            <button
                              onClick={() => setTransferTarget(m)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-purple-600 hover:text-purple-800 hover:bg-purple-50 rounded-lg transition-colors"
                              title="Transfer ownership"
                            >
                              <Shield className="w-3.5 h-3.5" /> Make Owner
                            </button>
                          )}
                          {!isSelf && isAdmin() && (
                            <button
                              onClick={() => setRemoveId(m.id)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                              title="Remove from organisation"
                            >
                              <XCircle className="w-3.5 h-3.5" /> Remove
                            </button>
                          )}
                          {isSelf && <span className="text-xs text-gray-300">—</span>}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Danger Zone (owner only) ──────────────────────────────────────── */}
      {isOwner() && (
        <div className="mt-10 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 p-6">
          <h3 className="text-sm font-semibold text-red-800 dark:text-red-300 mb-1 flex items-center gap-2">
            <Trash2 className="w-4 h-4" />
            Danger Zone
          </h3>
          <p className="text-xs text-red-600 dark:text-red-400 mb-4">
            Irreversible actions. Proceed with extreme caution.
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-lg border border-red-200 dark:border-red-800 bg-white dark:bg-gray-900 p-4">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Delete this organisation</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Locks the organisation immediately. All data is permanently deleted after 30 days unless restored.
              </p>
            </div>
            <button
              onClick={() => setDeleteOrgOpen(true)}
              className="shrink-0 rounded-lg border border-red-300 dark:border-red-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
            >
              Delete Organisation…
            </button>
          </div>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      <InviteUserModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSuccess={fetchUsers}
        invitedById={user?.id ?? ''}
      />

      <EditProfileModal
        open={editProfileOpen}
        onClose={() => setEditProfileOpen(false)}
        profile={currentProfile}
        userId={user?.id ?? ''}
        onSuccess={update => setCurrentProfile(update)}
      />

      <ChangePasswordModal
        open={changePwOpen}
        onClose={() => setChangePwOpen(false)}
      />

      <DeleteDialog
        open={!!removeId}
        onClose={() => setRemoveId(null)}
        onConfirm={handleRemove}
        loading={removing}
        label={removeTarget?.full_name || removeTarget?.email || 'this member'}
      />

      <DeleteDialog
        open={!!transferTarget}
        onClose={() => setTransferTarget(null)}
        onConfirm={handleTransferOwnership}
        loading={transferring}
        label={`Transfer ownership to ${transferTarget?.full_name || transferTarget?.email || 'this member'}? They will become an owner of this organisation.`}
      />

      <DeleteOrgModal
        open={deleteOrgOpen}
        onClose={() => setDeleteOrgOpen(false)}
      />
    </div>
  )
}
