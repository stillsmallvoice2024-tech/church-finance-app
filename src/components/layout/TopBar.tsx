import { Menu, LogOut, Sun, Moon } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import { useThemeStore } from '../../store/themeStore'
import { getInitials } from '../../utils/formatters'
import { ROLE_LABELS, ROLE_BADGE_CLASSES } from '../../utils/constants'

interface TopBarProps {
  onMenuClick: () => void
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { user, profile, signOut } = useAuth()
  const { role } = useRole()
  const { theme, toggle: toggleTheme } = useThemeStore()

  const displayName = profile?.full_name || user?.email || 'User'
  const initials = getInitials(displayName)
  const roleBadgeClass = role ? ROLE_BADGE_CLASSES[role] : 'bg-gray-100 text-gray-600'
  const roleLabel = role ? ROLE_LABELS[role] : ''

  return (
    <header className="topbar sticky top-0 z-10 flex h-16 items-center justify-between border-b border-gray-100 bg-white px-4 shadow-sm lg:px-6 dark:bg-gray-800 dark:border-gray-700">

      {/* Left: hamburger (mobile only) + app title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="hidden text-base font-semibold text-gray-800 sm:block">
          Church Finance
        </h1>
      </div>

      {/* Right: role badge + user avatar + sign out */}
      <div className="flex items-center gap-3">
        {roleLabel && (
          <span
            className={`hidden items-center rounded-full px-2.5 py-0.5 text-xs font-semibold sm:inline-flex ${roleBadgeClass}`}
          >
            {roleLabel}
          </span>
        )}

        {/* Avatar + name */}
        <div className="flex items-center gap-2">
          <div
            className="flex h-8 w-8 select-none items-center justify-center rounded-full bg-primary text-xs font-bold text-white"
            title={displayName}
          >
            {initials}
          </div>
          <span className="hidden max-w-[160px] truncate text-sm font-medium text-gray-700 md:block">
            {displayName}
          </span>
        </div>

        {/* Dark mode toggle */}
        <button
          onClick={toggleTheme}
          className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark'
            ? <Sun className="h-5 w-5" />
            : <Moon className="h-5 w-5" />}
        </button>

        {/* Sign out */}
        <button
          onClick={signOut}
          className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger-light"
          title="Sign out"
        >
          <LogOut className="h-4 w-4" />
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  )
}
