import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  UserPlus, Shield, Users, User,
  ChevronDown, Pencil, XCircle, MailOpen, Eye, EyeOff, KeyRound,
} from 'lucide-react'
import { Modal }        from '../components/ui/Modal'
import { DeleteDialog } from '../components/ui/DeleteDialog'
import { exportCSV }    from '../utils/csvExport'
import { ExportDropdown } from '../components/ui/ExportDropdown'
import { useAuth }      from '../hooks/useAuth'
import { useToastStore } from '../store/toastStore'
import { usePageTitle }  from '../hooks/usePageTitle'
import { supabase }     from '../lib/supabase'
import type { UserProfile, UserRole } from '../types'

// ── Role display config ────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<UserRole, { label: string; pill: string }> = {
  admin:      { label: 'Admin',      pill: 'bg-primary text-white'         },
  accountant: { label: 'Accountant', pill: 'bg-amber-100 text-amber-700'   },
  viewer:     { label: 'Viewer',     pill: 'bg-gray-100 text-gray-500'     },
}

function RolePill({ role }: { role: UserRole }) {
  const { label, pill } = ROLE_CONFIG[role]
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${pill}`}>
      {role === 'admin' && <Shield className="w-3 h-3" />}
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
  role:  z.enum(['accountant', 'viewer'] as const),
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
    // Generate a UUID token for the invite link
    const token      = crypto.randomUUID()
    const expiresAt  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days

    const { error } = await supabase.from('invitations').insert({
      email:      values.email,
      role:       values.role,
      invited_by: invitedById,
      status:     'pending',
      token,
      expires_at: expiresAt,
    })
    setLoading(false)
    if (error) {
      toast(error.message, 'error')
    } else {
      const url = `${window.location.origin}/invite/${token}`
      setInviteUrl(url)
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
              <option value="accountant">Accountant — can add and edit records</option>
              <option value="viewer">Viewer — read-only access</option>
            </select>
            <p className="text-xs text-gray-400">Admin role can only be assigned directly in the database.</p>
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
  const { push: toast }   = useToastStore()

  usePageTitle('User Management')

  const [users,            setUsers]            = useState<UserProfile[]>([])
  const [loading,          setLoading]          = useState(true)
  const [inviteOpen,       setInviteOpen]       = useState(false)
  const [editProfileOpen,  setEditProfileOpen]  = useState(false)
  const [changePwOpen,     setChangePwOpen]     = useState(false)
  const [revokeId,         setRevokeId]         = useState<string | null>(null)
  const [savingId,         setSavingId]         = useState<string | null>(null)
  const [revoking,         setRevoking]         = useState(false)
  const [currentProfile,   setCurrentProfile]   = useState({
    full_name: profile?.full_name ?? '',
    username:  profile?.username  ?? null as string | null,
  })

  // Sync currentProfile when auth profile loads
  useEffect(() => {
    if (profile) {
      setCurrentProfile({
        full_name: profile.full_name ?? '',
        username:  (profile as UserProfile & { username?: string | null }).username ?? null,
      })
    }
  }, [profile?.full_name])

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true })
    if (error) toast(error.message, 'error')
    else setUsers((data ?? []) as UserProfile[])
    setLoading(false)
  }, [toast])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const handleRoleChange = async (userId: string, newRole: UserRole) => {
    setSavingId(userId)
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole, updated_at: new Date().toISOString() })
      .eq('id', userId)
    setSavingId(null)
    if (error) {
      toast(error.message, 'error')
    } else {
      toast('Role updated', 'success')
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u))
    }
  }

  const handleRevoke = async () => {
    if (!revokeId) return
    setRevoking(true)
    const { error } = await supabase
      .from('profiles')
      .update({ role: 'viewer', updated_at: new Date().toISOString() })
      .eq('id', revokeId)
    setRevoking(false)
    if (error) {
      toast(error.message, 'error')
    } else {
      toast('Access restricted to view-only', 'success')
      setUsers(prev => prev.map(u => u.id === revokeId ? { ...u, role: 'viewer' } : u))
      setRevokeId(null)
    }
  }

  const revokeTarget = users.find(u => u.id === revokeId)

  const UM_CSV_HEADERS = ['Email', 'Full Name', 'Role', 'Joined']
  const umCsvRow = (u: UserProfile) => [u.email ?? '', u.full_name ?? '', u.role, u.created_at ? new Date(u.created_at).toLocaleDateString() : '']
  const UM_CSV_FILE = `users-${new Date().toISOString().slice(0, 10)}.csv`
  const handleExportView = () => exportCSV(UM_CSV_FILE, UM_CSV_HEADERS, users.map(umCsvRow))
  const handleExportAll  = () => exportCSV(UM_CSV_FILE, UM_CSV_HEADERS, users.map(umCsvRow))

  const totalCount      = users.length
  const adminCount      = users.filter(u => u.role === 'admin').length
  const accountantCount = users.filter(u => u.role === 'accountant').length

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-0.5">Control who can access the finance system</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportDropdown onExportView={handleExportView} onExportAll={handleExportAll} disabled={users.length === 0} />
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
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Members', value: totalCount,      icon: <Users className="w-5 h-5 text-primary" /> },
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
          <span className="text-xs text-gray-400">{totalCount} users</span>
        </div>

        {loading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-14 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">No users found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="px-5 py-3 text-left font-medium">Name</th>
                  <th className="px-5 py-3 text-left font-medium">Email</th>
                  <th className="px-5 py-3 text-left font-medium">Role</th>
                  <th className="px-5 py-3 text-left font-medium">Joined</th>
                  <th className="px-5 py-3 text-left font-medium">Last Updated</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map(u => {
                  const isSelf    = u.id === user?.id
                  const saving    = savingId === u.id
                  const isViewer  = u.role === 'viewer'

                  return (
                    <tr key={u.id} className={`hover:bg-gray-50 ${isSelf ? 'bg-blue-50/30' : ''}`}>
                      {/* Name */}
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                            {initials(u.full_name || u.email)}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">
                              {u.full_name || '—'}
                              {isSelf && <span className="ml-1.5 text-xs text-gray-400">(you)</span>}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Email */}
                      <td className="px-5 py-3 text-gray-500">{u.email}</td>

                      {/* Role — editable dropdown */}
                      <td className="px-5 py-3">
                        <div className="relative inline-block">
                          <select
                            value={u.role}
                            disabled={isSelf || saving}
                            onChange={e => handleRoleChange(u.id, e.target.value as UserRole)}
                            className={`appearance-none pr-6 pl-2.5 py-1 text-xs rounded-full font-semibold border-0 outline-none cursor-pointer disabled:cursor-default ${ROLE_CONFIG[u.role].pill} ${isSelf ? 'opacity-60' : ''}`}
                            title={isSelf ? "You cannot change your own role" : undefined}
                          >
                            <option value="admin">Admin</option>
                            <option value="accountant">Accountant</option>
                            <option value="viewer">Viewer</option>
                          </select>
                          {!isSelf && (
                            <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" />
                          )}
                          {saving && (
                            <span className="ml-2 inline-block w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                          )}
                        </div>
                      </td>

                      {/* Joined */}
                      <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>

                      {/* Last updated */}
                      <td className="px-5 py-3 text-gray-400 text-xs whitespace-nowrap">
                        {new Date(u.updated_at).toLocaleDateString()}
                      </td>

                      {/* Actions */}
                      <td className="px-5 py-3 text-right">
                        {!isSelf && !isViewer && (
                          <button
                            onClick={() => setRevokeId(u.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                            title="Restrict to viewer"
                          >
                            <XCircle className="w-3.5 h-3.5" /> Revoke Access
                          </button>
                        )}
                        {(isSelf || isViewer) && (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
        open={!!revokeId}
        onClose={() => setRevokeId(null)}
        onConfirm={handleRevoke}
        loading={revoking}
        label={revokeTarget?.full_name || revokeTarget?.email || 'this user'}
      />
    </div>
  )
}
