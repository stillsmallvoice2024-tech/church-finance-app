import { useState, useCallback } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, TrendingDown, FileUp, Receipt,
  BookOpen, Landmark, ArrowRightLeft, Repeat2, Globe,
  Hourglass, RotateCcw, Undo2,
  Layers, LayoutList, Percent, PieChart, HandCoins, PiggyBank,
  BarChart3, FileText, NotebookPen,
  SlidersHorizontal, Settings, Users, ClipboardList,
  ChevronDown, X,
} from 'lucide-react'
import { useRole } from '../../hooks/useRole'
import { useAccountingYearStore } from '../../store/accountingYearStore'

interface NavItem {
  label: string
  path: string
  icon: React.ElementType
  adminOnly?: boolean
  canWriteOnly?: boolean  // hidden for viewer role
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
      { label: 'Dashboard', path: '/',        icon: LayoutDashboard },
      { label: 'Inflows',   path: '/inflows',  icon: TrendingUp      },
      { label: 'Outflows',  path: '/outflows', icon: TrendingDown    },
      { label: 'Import',    path: '/import',   icon: FileUp,         canWriteOnly: true },
      { label: 'Intra-Account Flows', path: '/intra-flow', icon: Repeat2 },
      { label: 'Receipts',  path: '/receipts', icon: Receipt         },
    ],
  },
  {
    id: 'banking',
    label: 'Banking',
    defaultOpen: true,
    items: [
      { label: 'Bank Ledger',         path: '/bank-ledger',         icon: BookOpen       },
      { label: 'Bank Deposits',       path: '/bank-deposits',       icon: Landmark       },
      { label: 'Intrabank Transfers', path: '/intrabank-transfers', icon: ArrowRightLeft },
      { label: 'Foreign Currency',    path: '/foreign-currency',    icon: Globe          },
    ],
  },
  {
    id: 'review',
    label: 'Review & Processing',
    defaultOpen: true,
    items: [
      { label: 'Pending Deductions', path: '/pending-deductions', icon: Hourglass },
      { label: 'Refunds',            path: '/refunds',            icon: RotateCcw },
      { label: 'Reversals',          path: '/reversals',          icon: Undo2     },
    ],
  },
  {
    id: 'budget',
    label: 'Budget & Allocation',
    defaultOpen: true,
    items: [
      { label: 'Categories',          path: '/categories',             icon: Layers     },
      { label: 'Allocation Configs',  path: '/percentage-allocations', icon: Percent    },
      { label: 'Category Ledger',     path: '/category-ledger',        icon: LayoutList },
      { label: 'Percentage Allocation', path: '/percentage-allocation', icon: PieChart   },
      { label: 'Specific Givings',    path: '/specific-givings',       icon: HandCoins  },
      { label: 'Savings Portions',    path: '/savings-portions',       icon: PiggyBank  },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    defaultOpen: false,
    items: [
      { label: 'Reports',          path: '/reports',          icon: BarChart3    },
      { label: 'Financial Report', path: '/financial-report', icon: FileText     },
      { label: 'Dynamic Reports',  path: '/dynamic-reports',  icon: NotebookPen  },
    ],
  },
  {
    id: 'admin',
    label: 'Administration',
    defaultOpen: false,
    items: [
      { label: 'Setup',           path: '/setup',       icon: SlidersHorizontal, canWriteOnly: true },
      { label: 'Settings',        path: '/settings',    icon: Settings          },
      { label: 'User Management', path: '/users',       icon: Users,         adminOnly: true },
      { label: 'Change Log',      path: '/change-log',  icon: ClipboardList, adminOnly: true },
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
  const { isAdmin, canWrite } = useRole()
  const showAdmin = isAdmin()
  const showWrite = canWrite()
  const activeYear = useAccountingYearStore(s => s.year)
  const { openState, toggle } = useGroupOpenState()

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
        {/* Logo */}
        <div className="flex items-center justify-between px-5 py-5 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center text-white shrink-0">
              <ChurchCross />
            </div>
            <div className="min-w-0">
              <p className="text-white font-semibold text-sm leading-tight break-words">
                The Standing Church International
              </p>
              <p className="text-accent text-xs font-semibold tracking-widest uppercase mt-0.5">
                Finance {activeYear}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="lg:hidden p-1 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
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
                  className="w-full flex items-center justify-between px-3 py-2 text-[10px] font-bold text-white/40 uppercase tracking-widest hover:text-white/60 transition-colors rounded-lg group"
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
        <div className="px-5 py-4 border-t border-white/10">
          <p className="text-[10px] text-white/30 text-center">
            © {new Date().getFullYear()} TSCI Finance
          </p>
        </div>
      </aside>
    </>
  )
}
