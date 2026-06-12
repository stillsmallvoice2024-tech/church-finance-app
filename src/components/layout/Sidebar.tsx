import { useState, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, TrendingDown, FileUp, Receipt,
  BookOpen, Repeat2, Globe, ShieldCheck,
  Hourglass, RotateCcw, Undo2,
  Layers, LayoutList, Percent, PieChart, HandCoins, PiggyBank,
  BarChart3, FileText, NotebookPen,
  SlidersHorizontal, Settings, Users, ClipboardList,
  ChevronDown, X, HelpCircle,
} from 'lucide-react'
import { BankMovementIcon } from '../ui/CompositeIcons'
import { useRole } from '../../hooks/useRole'
import { useOrgStore } from '../../store/orgStore'
import { useAccountingYearStore } from '../../store/accountingYearStore'
import { ROLE_LABELS } from '../../utils/constants'
import { useOnboardingStore } from '../../store/onboardingStore'
import { useUnreadAnnouncements } from '../onboarding/AnnouncementBanner'

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
  adminOnly?: boolean
  canWriteOnly?: boolean
}

interface NavGroupDef {
  id: string
  label: string
  items: NavItem[]
  defaultOpen: boolean
}

const NAV_GROUPS: NavGroupDef[] = [
  {
    id: 'daily',
    label: 'Daily Finance',
    defaultOpen: true,
    items: [
      { label: 'Dashboard',         path: '/',           icon: LayoutDashboard },
      { label: 'Inflows',           path: '/inflows',    icon: TrendingUp      },
      { label: 'Outflows',          path: '/outflows',   icon: TrendingDown    },
      { label: 'Import',            path: '/import',     icon: FileUp,         canWriteOnly: true },
      { label: 'Category Fund Transfers', path: '/intra-flow', icon: Repeat2 },
      { label: 'Receipts',          path: '/receipts',   icon: Receipt         },
    ],
  },
  {
    id: 'banking',
    label: 'Banking',
    defaultOpen: false,
    items: [
      { label: 'Bank Ledger',          path: '/bank-ledger',      icon: BookOpen       },
      { label: 'Bank Deposits & Transfers', path: '/bank-movement',    icon: BankMovementIcon },
      { label: 'Foreign Currency',     path: '/foreign-currency', icon: Globe          },
    ],
  },
  {
    id: 'review',
    label: 'Review & Processing',
    defaultOpen: false,
    items: [
      { label: 'Upcoming Deductions', path: '/pending-deductions', icon: Hourglass },
      { label: 'Refunds',             path: '/refunds',            icon: RotateCcw },
      { label: 'Reversals',           path: '/reversals',          icon: Undo2     },
      { label: 'Reconciliation',      path: '/reconciliation',     icon: ShieldCheck },
    ],
  },
  {
    id: 'budget',
    label: 'Budget & Allocation',
    defaultOpen: false,
    items: [
      { label: 'Categories',        path: '/categories',             icon: Layers     },
      { label: 'Distribution Rules', path: '/percentage-allocations', icon: Percent    },
      { label: 'Category Accounts', path: '/category-ledger',        icon: LayoutList },
      { label: 'Regular Funds',     path: '/percentage-allocation',  icon: PieChart   },
      { label: 'Designated Gifts',  path: '/specific-givings',       icon: HandCoins  },
      { label: 'Savings Funds',     path: '/savings-portions',       icon: PiggyBank  },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    defaultOpen: false,
    items: [
      { label: 'Reports',          path: '/reports',          icon: BarChart3    },
      { label: 'Financial Report', path: '/financial-report', icon: FileText     },
      { label: 'Custom Reports',   path: '/dynamic-reports',  icon: NotebookPen  },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    defaultOpen: false,
    items: [
      { label: 'Setup',             path: '/setup',       icon: SlidersHorizontal, canWriteOnly: true },
      { label: 'Settings',          path: '/settings',    icon: Settings          },
      { label: 'User Management',   path: '/users',       icon: Users,         adminOnly: true },
      { label: 'Activity History',  path: '/change-log',  icon: ClipboardList, adminOnly: true },
    ],
  },
]

function useGroupOpenState() {
  const [state, setState] = useState<Record<string, boolean>>(() => {
    const result: Record<string, boolean> = {}
    NAV_GROUPS.forEach(g => {
      const stored = localStorage.getItem(`nav-group-${g.id}`)
      result[g.id] = stored !== null ? stored === 'true' : g.defaultOpen
    })
    return result
  })

  const toggle = useCallback((id: string) => {
    setState(prev => {
      const next = { ...prev, [id]: !prev[id] }
      localStorage.setItem(`nav-group-${id}`, String(next[id]))
      return next
    })
  }, [])

  return { openState: state, toggle }
}

function AppIcon() {
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
  const { isAdmin, canWrite } = useRole()
  const showAdmin = isAdmin()
  const showWrite = canWrite()
  const activeYear = useAccountingYearStore(s => s.year)
  const { openState, toggle } = useGroupOpenState()
  const orgName = useOrgStore(s => s.orgName)
  const orgRole = useOrgStore(s => s.orgRole)

  const displayName    = orgName ?? 'Finance'
  const roleLabel      = orgRole ? ROLE_LABELS[orgRole] : null
  const openHelpCenter = useOnboardingStore(s => s.openHelpCenter)
  const unread         = useUnreadAnnouncements()

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
          fixed inset-y-0 left-0 z-30 w-72 flex flex-col bg-nav
          transform transition-transform duration-300 ease-in-out
          ${open ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0
        `}
      >
        {/* Logo / org header */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white shrink-0">
              <AppIcon />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm leading-tight truncate" title={displayName}>
                {displayName}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                <p className="text-accent text-xs font-semibold tracking-widest uppercase">
                  Finance {activeYear}
                </p>
                {roleLabel && (
                  <span className="text-xs text-white/50 font-medium">
                    · {roleLabel}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-3 px-3" aria-label="Main navigation">
          {NAV_GROUPS.map(group => {
            const visibleItems = group.items.filter(item =>
              (!item.adminOnly || showAdmin) &&
              (!item.canWriteOnly || showWrite)
            )

            if (visibleItems.length === 0) return null

            const isOpen = openState[group.id] ?? group.defaultOpen

            return (
              <div key={group.id} className="mb-1">
                <button
                  onClick={() => toggle(group.id)}
                  aria-expanded={isOpen}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-bold text-white/40 uppercase tracking-widest hover:text-white/60 transition-colors rounded-lg group"
                >
                  <span>{group.label}</span>
                  <ChevronDown
                    className={`w-3.5 h-3.5 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                <div
                  className={`overflow-hidden transition-all duration-200 ease-in-out ${
                    isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
                  }`}
                >
                  <div className="space-y-0.5 pb-1">
                    {visibleItems.map(({ label, path, icon: Icon }) => (
                      <NavLink
                        key={path}
                        to={path}
                        end={path === '/'}
                        onClick={onClose}
                        className={({ isActive }) =>
                          `flex items-center gap-3 pl-[10px] pr-3 py-2.5 rounded-lg text-sm font-medium transition-colors border-l-2 ${
                            isActive
                              ? 'bg-white/15 text-white border-accent'
                              : 'text-white/70 hover:bg-white/10 hover:text-white border-transparent'
                          }`
                        }
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-white/10 space-y-2">
          <button
            type="button"
            onClick={openHelpCenter}
            className="w-full flex items-center gap-3 pl-[10px] pr-3 py-2.5 rounded-lg text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors"
          >
            <div className="relative shrink-0">
              <HelpCircle className="w-4 h-4" />
              {unread.length > 0 && (
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-accent border border-nav" />
              )}
            </div>
            <span>Help Center</span>
            {unread.length > 0 && (
              <span className="ml-auto px-1.5 py-0.5 rounded-full bg-accent text-nav text-xs font-bold leading-none">
                {unread.length}
              </span>
            )}
          </button>
          <p className="text-xs text-white/30 text-center pb-1">
            © {new Date().getFullYear()} {displayName}
          </p>
        </div>
      </aside>
    </>
  )
}
