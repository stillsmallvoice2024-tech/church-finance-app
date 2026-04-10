import { Menu, LogOut } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import { getInitials } from '../../utils/formatters'
import { ROLE_LABELS, ROLE_BADGE_CLASSES } from '../../utils/constants'

interface TopBarProps {
  onMenuClick: () => void
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { fullName, email } = useAuth()
  const { role } = useRole()

  const displayName = fullName || email || 'User'
  const initials = getInitials(displayName)
  const roleBadgeClass = role ? ROLE_BADGE_CLASSES[role] : 'bg-gray-100 text-gray-600'
  const roleLabel = role ? ROLE_LABELS[role] : ''

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between h-16 px-4 lg:px-6 bg-white border-b border-gray-100 shadow-sm">
      {/* Left: hamburger (mobile) + app title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>
        <h1 className="text-base font-semibold text-gray-800 hidden sm:block">
          Church Finance
        </h1>
      </div>

      {/* Right: user info + logout */}
      <div className="flex items-center gap-3">
        {/* Role badge */}
        {roleLabel && (
          <span
            className={`hidden sm:inline-flex items-center px-2.5 py-0.5 text-xs font-semibold rounded-full ${roleBadgeClass}`}
          >
            {roleLabel}
          </span>
        )}

        {/* Avatar + name */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-white text-xs font-bold select-none">
            {initials}
          </div>
          <span className="hidden md:block text-sm font-medium text-gray-700 max-w-[160px] truncate">
            {displayName}
          </span>
        </div>

        {/* Logout */}
        <button
          onClick={handleSignOut}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-danger hover:bg-danger-light rounded-lg transition-colors font-medium"
          title="Sign out"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  )
}
