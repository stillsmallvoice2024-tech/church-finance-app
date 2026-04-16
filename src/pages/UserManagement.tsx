import { useState, useEffect, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  UserPlus, Shield, Users, User,
  ChevronDown, Pencil, XCircle, MailOpen,
} from 'lucide-react'
import { Modal }        from '../components/ui/Modal'
import { DeleteDialog } from '../components/ui/DeleteDialog'
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
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) reset({ role: 'accountant' })
  }, [open, reset])

  const onSubmit = async (values: InviteForm) => {
    setLoading(true)
    const { error } = await supabase.from('invitations').insert({
      email:      values.email,
      role:       values.role,
      invited_by: invitedById,
      status:     'pending',
    })
    setLoading(false)
    if (error) {
      toast(error.message, 'error')
    } else {
      toast(`Invite recorded for ${values.email}`, 'success')
      onSuccess()
      onClose()
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Invite User" size="max-w-md">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <div className="rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700 flex gap-2">
          <MailOpen className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            The invited user will receive access once an admin approves their sign-up.
            Share the app URL with them to complete registration.
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
            {loading ? 'Saving…' : 'Send Invite'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

// ── Edit Name Modal ────────────────────────────────────────────────────────────

function EditNameModal({
  open,
  onClose,
  currentName,
  userId,
  onSuccess,
}: {
  open: boolean
  onClose: () => void
  currentName: string
  userId: string
  onSuccess: (name: string) => void
}) {
  const { push: toast } = useToastStore()
  const [name, setName]     = useState(currentName)
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (open) setName(currentName) }, [open, currentName])

  const handleSave = async () => {
    if (!name.trim()) return
    setLoading(true)
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: name.trim(), updated_at: new Date().toISOString() })
      .eq('id', userId)
    setLoading(false)
    if (error) {
      toast(error.message, 'error')
    } else {
      toast('Name updated', 'success')
      onSuccess(name.trim())
      onClose()
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit Display Name" size="max-w-sm">
      <div className="space-y-4">
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-600">Full Name</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="Your full name"
            className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            autoFocus
          />
        </div>
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

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function UserManagement() {
  const { user, profile } = useAuth()
  const { push: toast }   = useToastStore()

  usePageTitle('User Management')

  const [users,          setUsers]          = useState<UserProfile[]>([])
  const [loading,        setLoading]        = useState(true)
  const [inviteOpen,     setInviteOpen]     = useState(false)
  const [editNameOpen,   setEditNameOpen]   = useState(false)
  const [revokeId,       setRevokeId]       = useState<string | null>(null)
  const [savingId,       setSavingId]       = useState<string | null>(null)
  const [revoking,       setRevoking]       = useState(false)
  const [currentName,    setCurrentName]    = useState(profile?.full_name ?? '')

  // Sync currentName when profile loads
  useEffect(() => {
    if (profile?.full_name) setCurrentName(profile.full_name)
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
        <button
          onClick={() => setInviteOpen(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light"
        >
          <UserPlus className="w-4 h-4" /> Invite User
        </button>
      </div>

      {/* ── Current user card ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary flex items-center justify-center text-white text-sm font-bold shrink-0">
              {initials(currentName || profile?.email || 'Me')}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-gray-900">{currentName || '—'}</span>
                <span className="text-xs text-gray-400">(you)</span>
              </div>
              <div className="text-sm text-gray-500">{user?.email}</div>
              <div className="mt-1">
                <RolePill role={(profile?.role as UserRole) ?? 'viewer'} />
              </div>
            </div>
          </div>
          <button
            onClick={() => setEditNameOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit Profile
          </button>
        </div>
      </div>

      {/* ── Stats ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">
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

      <EditNameModal
        open={editNameOpen}
        onClose={() => setEditNameOpen(false)}
        currentName={currentName}
        userId={user?.id ?? ''}
        onSuccess={name => setCurrentName(name)}
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
