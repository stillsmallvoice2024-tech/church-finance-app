import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, TrendingDown, FileUp,
  BookOpen, Landmark, ArrowRightLeft, Repeat2, Globe,
  Hourglass, RotateCcw, Undo2, Receipt,
  Layers, LayoutList, Percent, PieChart, HandCoins, PiggyBank,
  BarChart3, FileText,
  SlidersHorizontal, Settings, Users, ClipboardList,
  MoreHorizontal, X,
} from 'lucide-react'
import { useRole } from '../../hooks/useRole'

const PRIMARY_TABS = [
  { label: 'Home',     path: '/',         icon: LayoutDashboard, end: true },
  { label: 'Inflows',  path: '/inflows',  icon: TrendingUp      },
  { label: 'Outflows', path: '/outflows', icon: TrendingDown    },
  { label: 'Import',   path: '/import',   icon: FileUp          },
]

interface DrawerItem {
  label: string
  path: string
  icon: React.ElementType
  adminOnly?: boolean
}

interface DrawerSection {
  label: string
  items: DrawerItem[]
}

const DRAWER_SECTIONS: DrawerSection[] = [
  {
    label: 'Banking',
    items: [
      { label: 'Bank Ledger',         path: '/bank-ledger',         icon: BookOpen       },
      { label: 'Bank Deposits',       path: '/bank-deposits',       icon: Landmark       },
      { label: 'Intrabank Transfers', path: '/intrabank-transfers', icon: ArrowRightLeft },
      { label: 'Intra-Account',       path: '/intra-flow',          icon: Repeat2        },
      { label: 'FX Currency',         path: '/foreign-currency',    icon: Globe          },
      { label: 'Receipts',            path: '/receipts',            icon: Receipt        },
    ],
  },
  {
    label: 'Review',
    items: [
      { label: 'Pending',    path: '/pending-deductions', icon: Hourglass },
      { label: 'Refunds',    path: '/refunds',            icon: RotateCcw },
      { label: 'Reversals',  path: '/reversals',          icon: Undo2     },
    ],
  },
  {
    label: 'Budget & Allocation',
    items: [
      { label: 'Categories',    path: '/categories',             icon: Layers     },
      { label: 'Alloc. Configs', path: '/percentage-allocations', icon: Percent   },
      { label: 'Cat. Ledger',   path: '/category-ledger',        icon: LayoutList },
      { label: '% Allocation',  path: '/percentage-allocation',  icon: PieChart   },
      { label: 'Specific Give', path: '/specific-givings',       icon: HandCoins  },
      { label: 'Savings',       path: '/savings-portions',       icon: PiggyBank  },
    ],
  },
  {
    label: 'Reports',
    items: [
      { label: 'Reports',     path: '/reports',          icon: BarChart3 },
      { label: 'Fin. Report', path: '/financial-report', icon: FileText  },
    ],
  },
  {
    label: 'Administration',
    items: [
      { label: 'Setup',       path: '/setup',      icon: SlidersHorizontal },
      { label: 'Settings',    path: '/settings',   icon: Settings          },
      { label: 'Users',       path: '/users',      icon: Users,         adminOnly: true },
      { label: 'Change Log',  path: '/change-log', icon: ClipboardList, adminOnly: true },
    ],
  },
]

export function BottomTabBar() {
  const [moreOpen, setMoreOpen] = useState(false)
  const { isAdmin } = useRole()
  const admin = isAdmin()

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
        <div className="fixed bottom-16 left-0 right-0 z-50 bg-white dark:bg-gray-800 rounded-t-2xl shadow-2xl border-t border-gray-100 dark:border-gray-700 max-h-[75vh] flex flex-col lg:hidden">
          {/* Drawer header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700 shrink-0">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">More</span>
            <button
              onClick={() => setMoreOpen(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
              aria-label="Close menu"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Scrollable grouped content */}
          <nav className="overflow-y-auto px-4 py-3 space-y-4" aria-label="More navigation">
            {DRAWER_SECTIONS.map(section => {
              const visibleItems = admin
                ? section.items
                : section.items.filter(i => !i.adminOnly)
              if (visibleItems.length === 0) return null

              return (
                <div key={section.label}>
                  <p className="text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-2 px-1">
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
                              ? 'bg-primary/8 text-primary border-primary dark:bg-primary/15'
                              : 'text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 border-transparent'
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

      {/* Bottom tab bar */}
      <nav
        className="bottom-tab-bar fixed bottom-0 left-0 right-0 z-40 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 flex lg:hidden safe-area-inset-bottom"
        aria-label="Primary navigation"
      >
        {PRIMARY_TABS.map(({ label, path, icon: Icon, end }) => (
          <NavLink
            key={path}
            to={path}
            end={end}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] text-center transition-colors ${
                isActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="w-5 h-5" />
                <span className={`text-[10px] font-medium ${isActive ? 'font-semibold' : ''}`}>
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
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 min-h-[56px] transition-colors ${
            moreOpen ? 'text-primary' : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  )
}
