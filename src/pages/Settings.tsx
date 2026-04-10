import { User, Bell, Shield } from 'lucide-react'
import { Card } from '../components/ui/Card'
import { useAuth } from '../hooks/useAuth'
import { useRole } from '../hooks/useRole'
import { ROLE_LABELS } from '../utils/constants'

export default function Settings() {
  const { fullName, email } = useAuth()
  const { role } = useRole()

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">Manage your account and preferences</p>
      </div>

      {/* Profile */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <User className="w-4 h-4 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-800">Profile</h2>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">Full Name</label>
            <input
              type="text"
              defaultValue={fullName}
              placeholder="Enter your full name"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">Email Address</label>
            <input
              type="email"
              value={email}
              readOnly
              className="w-full border border-gray-100 rounded-xl px-4 py-2.5 text-sm text-gray-500 bg-gray-50 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">Email cannot be changed here.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-600 mb-1.5">Role</label>
            <input
              type="text"
              value={role ? ROLE_LABELS[role] : ''}
              readOnly
              className="w-full border border-gray-100 rounded-xl px-4 py-2.5 text-sm text-gray-500 bg-gray-50 cursor-not-allowed"
            />
            <p className="text-xs text-gray-400 mt-1">Roles are assigned by an Admin.</p>
          </div>
          <div className="pt-2">
            <button className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-xl hover:bg-primary-light transition-colors">
              Save Changes
            </button>
          </div>
        </div>
      </Card>

      {/* Notifications */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <Bell className="w-4 h-4 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-800">Notifications</h2>
        </div>
        <div className="space-y-3">
          {[
            { label: 'Email summary reports', desc: 'Receive weekly financial summaries via email' },
            { label: 'Large transaction alerts', desc: 'Get notified for transactions above ₦1,000,000' },
          ].map(({ label, desc }) => (
            <label key={label} className="flex items-start justify-between gap-4 cursor-pointer">
              <div>
                <p className="text-sm font-medium text-gray-700">{label}</p>
                <p className="text-xs text-gray-400">{desc}</p>
              </div>
              <input type="checkbox" defaultChecked className="mt-0.5 accent-primary w-4 h-4" />
            </label>
          ))}
        </div>
      </Card>

      {/* Security */}
      <Card>
        <div className="flex items-center gap-3 mb-5">
          <Shield className="w-4 h-4 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-800">Security</h2>
        </div>
        <button className="px-4 py-2 border border-gray-200 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
          Change Password
        </button>
      </Card>
    </div>
  )
}
