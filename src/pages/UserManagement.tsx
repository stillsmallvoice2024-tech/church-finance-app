import { UserPlus, Pencil } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { DataTable, type Column } from '../components/ui/DataTable'
import { getInitials, formatDate } from '../utils/formatters'
import { ROLE_LABELS } from '../utils/constants'
import { AdminOnly } from '../components/auth/RoleGates'
import type { UserProfile } from '../types'

const MOCK_USERS: UserProfile[] = [
  { id: '1', email: 'pastor@tsci.org', full_name: 'Pastor Emmanuel Okafor', role: 'admin', created_at: '2024-01-01', updated_at: '2024-01-01' },
  { id: '2', email: 'finance@tsci.org', full_name: 'Deacon Grace Adeyemi', role: 'accountant', created_at: '2024-01-15', updated_at: '2024-01-15' },
  { id: '3', email: 'treasurer@tsci.org', full_name: 'Bro. Daniel Musa', role: 'accountant', created_at: '2024-02-01', updated_at: '2024-02-01' },
  { id: '4', email: 'secretary@tsci.org', full_name: 'Sis. Ruth Nwachukwu', role: 'viewer', created_at: '2024-03-10', updated_at: '2024-03-10' },
]

const ROLE_VARIANT: Record<UserProfile['role'], 'primary' | 'warning' | 'neutral'> = {
  admin: 'primary',
  accountant: 'warning',
  viewer: 'neutral',
}

const columns: Column<UserProfile>[] = [
  {
    key: 'user',
    header: 'User',
    render: (u) => (
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
          {getInitials(u.full_name)}
        </div>
        <div>
          <p className="font-medium text-gray-900 text-sm">{u.full_name}</p>
          <p className="text-xs text-gray-500">{u.email}</p>
        </div>
      </div>
    ),
  },
  {
    key: 'role',
    header: 'Role',
    render: (u) => <Badge label={ROLE_LABELS[u.role]} variant={ROLE_VARIANT[u.role]} />,
  },
  {
    key: 'created_at',
    header: 'Joined',
    render: (u) => <span className="text-gray-500">{formatDate(u.created_at)}</span>,
  },
  {
    key: 'actions',
    header: '',
    render: () => (
      <AdminOnly>
        <button className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-500 hover:text-primary hover:bg-primary-100 rounded-lg transition-colors">
          <Pencil className="w-3.5 h-3.5" />
          Edit Role
        </button>
      </AdminOnly>
    ),
    className: 'text-right',
  },
]

export default function UserManagement() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">User Management</h1>
          <p className="text-sm text-gray-500 mt-1">Manage user accounts and access roles</p>
        </div>
        <AdminOnly>
          <button className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-light transition-colors">
            <UserPlus className="w-4 h-4" />
            Invite User
          </button>
        </AdminOnly>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Total Users', value: MOCK_USERS.length },
          { label: 'Admins', value: MOCK_USERS.filter((u) => u.role === 'admin').length },
          { label: 'Accountants', value: MOCK_USERS.filter((u) => u.role === 'accountant').length },
        ].map(({ label, value }) => (
          <Card key={label}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
            <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
          </Card>
        ))}
      </div>

      <Card padding={false}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-800">All Users</h2>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{MOCK_USERS.length} members</span>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={MOCK_USERS}
          keyExtractor={(u) => u.id}
          emptyMessage="No users found."
        />
      </Card>
    </div>
  )
}
