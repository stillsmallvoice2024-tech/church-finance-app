import { useEffect, useRef, useState } from 'react'
import { Menu, LogOut, Sun, Moon, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useRole } from '../../hooks/useRole'
import { useOrgStore } from '../../store/orgStore'
import { useThemeStore } from '../../store/themeStore'
import { useDbStatus, type DbStatus } from '../../hooks/useDbStatus'
import { OrgSwitcher } from '../ui/OrgSwitcher'
import { getInitials } from '../../utils/formatters'
import { ROLE_BADGE_CLASSES, ROLE_LABELS } from '../../utils/constants'
import { useHealthStore } from '../../store/healthStore'
import type { HealthStatus } from '../../utils/reconciliationAggregator'

function HealthBadge({ status, skipped, stableDays }: { status: HealthStatus | null; skipped: boolean; stableDays: number }) {
  const muted = skipped || !status
  const icon =
    !muted && status === 'critical' ? <ShieldX     className="h-3.5 w-3.5" /> :
    !muted && status === 'warning'  ? <ShieldAlert className="h-3.5 w-3.5" /> :
    <ShieldCheck className="h-3.5 w-3.5" />
  const cls = muted
    ? 'text-gray-400 bg-gray-50 hover:bg-gray-100 border-gray-200'
    : status === 'critical' ? 'text-red-600 bg-red-50 hover:bg-red-100 border-red-200'
    : status === 'warning'  ? 'text-amber-600 bg-amber-50 hover:bg-amber-100 border-amber-200'
    : 'text-green-600 bg-green-50 hover:bg-green-100 border-green-200'
  const label =
    !status  ? '—' :
    skipped  ? 'Paused' :
    status === 'critical' ? 'Critical' :
    status === 'warning'  ? 'Warning'  : 'Healthy'
  const streakNote = !muted && status === 'healthy' && stableDays >= 7
    ? ` · stable for ${stableDays} day${stableDays === 1 ? '' : 's'}`
    : ''
  return (
    <Link
      to="/reconciliation"
      title={muted ? 'System health check paused — click to view' : `System health: ${label}${streakNote} — view Reconciliation Center`}
      className={`hidden sm:inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors ${cls}`}
    >
      {icon}
      <span className="hidden md:inline">{label}</span>
    </Link>
  )
}

function ConnectionDot({ status, latency }: { status: DbStatus; latency: number | null }) {
  const label =
    status === 'online'  ? `Connected${latency !== null ? ` (${latency}ms)` : ''}` :
    status === 'offline' ? 'Offline — check your connection' :
    'Checking connection…'
  return (
    <span title={label} aria-label={label} className="flex items-center gap-1.5">
      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
        status === 'online'  ? 'bg-green-400' :
        status === 'offline' ? 'bg-red-500'   :
        'bg-amber-400 animate-pulse'
      }`} />
      {status === 'offline' && (
        <span className="hidden sm:inline text-xs font-medium text-red-500">Offline</span>
      )}
    </span>
  )
}

interface TopBarProps {
  onMenuClick: () => void
}

export function TopBar({ onMenuClick }: TopBarProps) {
  const { user, profile, signOut } = useAuth()
  const { role } = useRole()
  const orgRole = useOrgStore(s => s.orgRole)
  const { theme, toggle: toggleTheme } = useThemeStore()
  const { status: dbStatus, latency } = useDbStatus()

  const displayName  = profile?.full_name || user?.email || 'User'
  const initials     = getInitials(displayName)
  const healthStatus  = useHealthStore(s => s.status)
  const healthSkipped = useHealthStore(s => s.skipped)
  const cleanSince    = useHealthStore(s => s.cleanSince)
  const stableDays    = cleanSince
    ? Math.floor((Date.now() - new Date(cleanSince).getTime()) / 86_400_000)
    : 0

  // Show the org-scoped role (orgRole) in the badge — more accurate than profile.role
  const badgeRole = orgRole ?? role
  const roleBadgeClass = badgeRole ? ROLE_BADGE_CLASSES[badgeRole] : 'bg-gray-100 text-gray-600'
  const roleLabel = badgeRole ? ROLE_LABELS[badgeRole] : ''

  // Mobile user menu — collapses avatar/theme/sign-out into one 44px target
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!userMenuOpen) return
    const close = (e: MouseEvent | TouchEvent) => {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('touchstart', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('touchstart', close)
    }
  }, [userMenuOpen])

  return (
    <header className="topbar sticky top-0 z-10 flex h-16 items-center justify-between border-b border-black/[0.06] bg-white px-4 lg:px-6 dark:bg-[#101012] dark:border-white/[0.06]">

      {/* Left: hamburger (mobile only) + org switcher */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="touch-target rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <OrgSwitcher />
      </div>

      {/* Right: health badge + role badge + user controls */}
      <div className="flex items-center gap-2 sm:gap-3">
        <HealthBadge status={healthStatus} skipped={healthSkipped} stableDays={stableDays} />
        {roleLabel && (
          <span
            className={`hidden sm:inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${roleBadgeClass}`}
          >
            {roleLabel}
          </span>
        )}

        {/* Connection status */}
        <ConnectionDot status={dbStatus} latency={latency} />

        {/* ── Mobile: single avatar button opens user menu ── */}
        <div className="relative sm:hidden" ref={userMenuRef}>
          <button
            onClick={() => setUserMenuOpen(o => !o)}
            aria-expanded={userMenuOpen}
            aria-haspopup="menu"
            aria-label={`Account menu for ${displayName}`}
            className="touch-target rounded-full"
          >
            <span className="flex h-9 w-9 select-none items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {initials}
            </span>
          </button>
          {userMenuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full mt-1.5 z-50 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-black/[0.07] bg-white shadow-card-md py-1.5 dark:bg-[#1c1c1e] dark:border-white/[0.08]"
            >
              <div className="px-3.5 py-2.5 border-b border-black/[0.06] dark:border-white/[0.07]">
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{displayName}</p>
                {roleLabel && (
                  <span className={`mt-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${roleBadgeClass}`}>
                    {roleLabel}
                  </span>
                )}
              </div>
              <button
                role="menuitem"
                onClick={() => { toggleTheme(); setUserMenuOpen(false) }}
                className="flex w-full items-center gap-2.5 px-3.5 min-h-[44px] text-sm text-gray-700 hover:bg-black/[0.04] dark:text-gray-200 dark:hover:bg-white/[0.06]"
              >
                {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
                {theme === 'dark' ? 'Light mode' : 'Dark mode'}
              </button>
              <button
                role="menuitem"
                onClick={signOut}
                className="flex w-full items-center gap-2.5 px-3.5 min-h-[44px] text-sm font-medium text-danger hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <LogOut className="h-4 w-4" />
                Sign out
              </button>
            </div>
          )}
        </div>

        {/* ── sm+ : inline avatar, theme toggle, sign out ── */}
        <div className="hidden sm:flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 select-none items-center justify-center rounded-full bg-primary text-xs font-bold text-white"
              title={displayName}
            >
              {initials}
            </div>
            <span className="hidden max-w-[160px] truncate text-sm font-medium text-gray-700 md:block dark:text-gray-200">
              {displayName}
            </span>
          </div>

          <button
            onClick={toggleTheme}
            className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-black/[0.05] hover:text-gray-700 dark:text-gray-400 dark:hover:bg-white/[0.07] dark:hover:text-gray-200"
            aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark'
              ? <Sun className="h-5 w-5" />
              : <Moon className="h-5 w-5" />}
          </button>

          <button
            onClick={signOut}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-danger transition-colors hover:bg-danger-light"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </header>
  )
}
