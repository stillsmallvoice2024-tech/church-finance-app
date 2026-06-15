import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, TrendingDown, FileUp,
  BookOpen, Repeat2, Globe,
  Hourglass, RotateCcw, Undo2, Receipt,
  Layers, LayoutList, Percent, PieChart, HandCoins, PiggyBank,
  BarChart3, FileText, NotebookPen,
  SlidersHorizontal, Settings, Users, ClipboardList,
  MoreHorizontal, X,
} from 'lucide-react'
import { BankMovementIcon } from '../ui/CompositeIcons'
import { useRole } from '../../hooks/useRole'

interface PrimaryTab {
  label: string
  path: string
  icon: React.ElementType
  end?: boolean
}

const BASE_PRIMARY_TABS: PrimaryTab[] = [
  { label: 'Home',     path: '/',          icon: LayoutDashboard, end: true },
  { label: 'Inflows',  path: '/inflows',   icon: TrendingUp                 },
  { label: 'Outflows', path: '/outflows',  icon: TrendingDown               },
  { label: 'Ledger',   path: '/bank-ledger', icon: BookOpen                 },
]

interface DrawerItem {
  label: string
  path: string
  icon: React.ElementType
  adminOnly?: boolean
  canWriteOnly?: boolean
}

interface DrawerSection {
  label: string
  items: DrawerItem[]
}

const DRAWER_SECTIONS: DrawerSection[] = [
  {
    label: 'Daily Finance',
    items: [
      { label: 'Import',            path: '/import',           icon: FileUp,         canWriteOnly: true },
      { label: 'Category Fund Transfers', path: '/intra-flow',      icon: Repeat2        },
      { label: 'Receipts',          path: '/receipts',         icon: Receipt        },
    ],
  },
  {
    label: 'Banking',
    items: [
      { label: 'Bank Deposits & Transfers', path: '/bank-movement',    icon: BankMovementIcon },
      { label: 'Foreign Currency',     path: '/foreign-currency', icon: Globe          },
    ],
  },
  {
    label: 'Review & Processing',
    items: [
      { label: 'Upcoming Deductions', path: '/pending-deductions', icon: Hourglass },
      { label: 'Refunds',             path: '/refunds',            icon: RotateCcw },
      { label: 'Reversals',           path: '/reversals',          icon: Undo2     },
      { label: 'Reconciliation',      path: '/reconciliation',     icon: ClipboardList },
    ],
  },
  {
    label: 'Budget & Allocation',
    items: [
      { label: 'Categories',         path: '/categories',             icon: Layers     },
      { label: 'Distribution Rules', path: '/percentage-allocations', icon: Percent    },
      { label: 'Category Accounts',  path: '/category-ledger',        icon: LayoutList },
      { label: 'Regular Funds',      path: '/percentage-allocation',  icon: PieChart   },
      { label: 'Designated Gifts',   path: '/specific-givings',       icon: HandCoins  },
      { label: 'Savings Funds',      path: '/savings-portions',       icon: PiggyBank  },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Reports',          path: '/reports',          icon: BarChart3 },
      { label: 'Financial Report', path: '/financial-report', icon: FileText  },
      { label: 'Custom Reports',   path: '/dynamic-reports',  icon: NotebookPen },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Setup',            path: '/setup',       icon: SlidersHorizontal, canWriteOnly: true },
      { label: 'Settings',         path: '/settings',    icon: Settings          },
      { label: 'Users',            path: '/users',       icon: Users,         adminOnly: true },
      { label: 'Activity History', path: '/change-log',  icon: ClipboardList, adminOnly: true },
    ],
  },
]

export function BottomTabBar() {
  const [moreOpen, setMoreOpen] = useState(false)
  const { isAdmin, canWrite } = useRole()
  const admin = isAdmin()
  const write = canWrite()
  const primaryTabs = BASE_PRIMARY_TABS

  return (
    <>
      {/* More drawer overlay */}
      {moreOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMoreOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* More drawer */}
      {moreOpen && (
        <div className="fixed bottom-[var(--tab-bar-height)] left-0 right-0 z-50 bg-white dark:bg-[#1c1c1e] rounded-t-2xl shadow-2xl border-t border-black/[0.07] dark:border-white/[0.08] max-h-[calc(100dvh-var(--tab-bar-height)-1rem)] flex flex-col lg:hidden">
          {/* Drawer header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-black/[0.06] dark:border-white/[0.07] shrink-0">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">More</span>
            <button
              onClick={() => setMoreOpen(false)}
              className="touch-target p-1.5 rounded-lg text-gray-400 hover:bg-black/[0.05] dark:hover:bg-white/[0.07]"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable grouped content */}
          <nav className="overflow-y-auto px-4 py-3 space-y-4" aria-label="More navigation">
            {DRAWER_SECTIONS.map(section => {
              const visibleItems = section.items.filter(i =>
                (!i.adminOnly || admin) &&
                (!i.canWriteOnly || write)
              )
              if (visibleItems.length === 0) return null

              return (
                <div key={section.label}>
                  <p className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-[0.12em] mb-2 px-1">
                    {section.label}
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    {visibleItems.map(({ label, path, icon: Icon }) => (
                      <NavLink
                        key={path}
                        to={path}
                        onClick={() => setMoreOpen(false)}
                        className={({ isActive }) =>
                          `flex items-center gap-2.5 px-3 py-3 rounded-xl text-sm font-medium transition-colors border-l-2 min-h-[48px] ${
                            isActive
                              ? 'bg-primary/[0.08] text-primary border-primary dark:bg-primary/20'
                              : 'text-gray-600 dark:text-gray-300 hover:bg-black/[0.04] dark:hover:bg-white/[0.06] border-transparent'
                          }`
                        }
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="leading-tight">{label}</span>
                      </NavLink>
                    ))}
                  </div>
                </div>
              )
            })}
          </nav>
        </div>
      )}

      {/* Bottom tab bar — h-12 content + safe-area inset; matches --tab-bar-height in index.css */}
      <nav
        className="bottom-tab-bar fixed bottom-0 left-0 right-0 z-40 h-[var(--tab-bar-height)] pb-[var(--safe-bottom)] bg-white dark:bg-[#101012] border-t border-black/[0.07] dark:border-white/[0.06] flex lg:hidden"
        aria-label="Primary navigation"
      >
        {primaryTabs.map(({ label, path, icon: Icon, end }) => (
          <NavLink
            key={path}
            to={path}
            end={end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-0.5 h-full text-center transition-colors ${
                isActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="w-5 h-5" />
                <span className={`text-xs leading-tight font-medium ${isActive ? 'font-semibold' : ''}`}>
                  {label}
                </span>
              </>
            )}
          </NavLink>
        ))}

        {/* More tab */}
        <button
          onClick={() => setMoreOpen(v => !v)}
          aria-expanded={moreOpen}
          aria-label="More navigation options"
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 h-full transition-colors ${
            moreOpen ? 'text-primary' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-xs leading-tight font-medium">More</span>
        </button>
      </nav>
    </>
  )
}
