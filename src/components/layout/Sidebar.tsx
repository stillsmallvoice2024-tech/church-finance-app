import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  TrendingUp,
  TrendingDown,
  Wallet,
  Target,
  Globe,
  ArrowLeftRight,
  BarChart3,
  Settings,
  Users,
  X,
} from 'lucide-react'
import { useRole } from '../../hooks/useRole'

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: LayoutDashboard },
  { label: 'Inflows', path: '/inflows', icon: TrendingUp },
  { label: 'Outflows', path: '/outflows', icon: TrendingDown },
  { label: 'Accounts', path: '/accounts', icon: Wallet },
  { label: 'Special Projects', path: '/special-projects', icon: Target },
  { label: 'Foreign Currency', path: '/foreign-currency', icon: Globe },
  { label: 'Intra-Account Flows', path: '/intra-flow', icon: ArrowLeftRight },
  { label: 'Reports', path: '/reports', icon: BarChart3 },
  { label: 'Settings', path: '/settings', icon: Settings },
]

const ADMIN_NAV_ITEMS: NavItem[] = [
  { label: 'User Management', path: '/users', icon: Users },
]

// Church cross SVG
function ChurchCross() {
  return (
    <svg viewBox="0 0 32 32" className="w-7 h-7" fill="currentColor" aria-hidden="true">
      <rect x="13" y="2" width="6" height="28" rx="2" />
      <rect x="4" y="9" width="24" height="6" rx="2" />
    </svg>
  )
}

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  const { isAdmin } = useRole()
  const showAdmin = isAdmin()

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-20 bg-black/50 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar panel */}
      <aside
        className={`
          sidebar-panel
          fixed inset-y-0 left-0 z-30 w-64 flex flex-col bg-primary
          transform transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        {/* Logo / church header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white shrink-0">
              <ChurchCross />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm leading-tight truncate">
                The Standing Church International
              </p>
              <p className="text-accent text-xs font-semibold tracking-widest uppercase mt-0.5">
                Finance 2024
              </p>
            </div>
          </div>
          {/* Mobile close button */}
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-0.5">
          <p className="px-3 py-2 text-[10px] font-bold text-white/40 uppercase tracking-widest">
            Main Menu
          </p>
          {NAV_ITEMS.map(({ label, path, icon: Icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-white/15 text-white border-l-2 border-accent pl-[10px]'
                    : 'text-white/70 hover:bg-white/10 hover:text-white'
                }`
              }
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="truncate">{label}</span>
            </NavLink>
          ))}

          {showAdmin && (
            <>
              <div className="pt-4 pb-1">
                <p className="px-3 py-2 text-[10px] font-bold text-white/40 uppercase tracking-widest">
                  Administration
                </p>
              </div>
              {ADMIN_NAV_ITEMS.map(({ label, path, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? 'bg-white/15 text-white border-l-2 border-accent pl-[10px]'
                        : 'text-white/70 hover:bg-white/10 hover:text-white'
                    }`
                  }
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </NavLink>
              ))}
            </>
          )}
        </nav>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/10">
          <p className="text-[10px] text-white/30 text-center">
            © {new Date().getFullYear()} TSCI Finance
          </p>
        </div>
      </aside>
    </>
  )
}
