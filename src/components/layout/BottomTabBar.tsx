import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard, TrendingUp, TrendingDown, Wallet,
  Target, Globe, ArrowLeftRight, BarChart3,
  Settings, Users, MoreHorizontal, X,
} from 'lucide-react'
import { useRole } from '../../hooks/useRole'

const PRIMARY_TABS = [
  { label: 'Home',     path: '/',         icon: LayoutDashboard },
  { label: 'Inflows',  path: '/inflows',  icon: TrendingUp      },
  { label: 'Outflows', path: '/outflows', icon: TrendingDown    },
  { label: 'Accounts', path: '/accounts', icon: Wallet          },
]

const MORE_ITEMS = [
  { label: 'Special Projects',    path: '/special-projects',  icon: Target        },
  { label: 'Foreign Currency',    path: '/foreign-currency',  icon: Globe         },
  { label: 'Intra-Account Flows', path: '/intra-flow',        icon: ArrowLeftRight},
  { label: 'Reports',             path: '/reports',           icon: BarChart3     },
  { label: 'Settings',            path: '/settings',          icon: Settings      },
]

const ADMIN_MORE = [
  { label: 'User Management', path: '/users', icon: Users },
]

export function BottomTabBar() {
  const [moreOpen, setMoreOpen] = useState(false)
  const { isAdmin } = useRole()

  const moreItems = isAdmin() ? [...MORE_ITEMS, ...ADMIN_MORE] : MORE_ITEMS

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

      {/* More drawer (slide up) */}
      {moreOpen && (
        <div className="fixed bottom-16 left-0 right-0 z-50 bg-white rounded-t-2xl shadow-2xl border-t border-gray-100 lg:hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-700">More</span>
            <button
              onClick={() => setMoreOpen(false)}
              className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <nav className="grid grid-cols-3 gap-2 p-4">
            {moreItems.map(({ label, path, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl text-center transition-colors ${
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`
                }
              >
                <Icon className="w-5 h-5" />
                <span className="text-[11px] font-medium leading-tight">{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      )}

      {/* Bottom tab bar */}
      <nav className="bottom-tab-bar fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-gray-200 flex lg:hidden safe-area-inset-bottom">
        {PRIMARY_TABS.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={path}
            to={path}
            end={path === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center gap-1 py-2 text-center transition-colors ${
                isActive ? 'text-primary' : 'text-gray-400 hover:text-gray-600'
              }`
            }
          >
            <Icon className="w-5 h-5" />
            <span className="text-[10px] font-medium">{label}</span>
          </NavLink>
        ))}

        {/* More tab */}
        <button
          onClick={() => setMoreOpen(v => !v)}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 transition-colors ${
            moreOpen ? 'text-primary' : 'text-gray-400 hover:text-gray-600'
          }`}
        >
          <MoreHorizontal className="w-5 h-5" />
          <span className="text-[10px] font-medium">More</span>
        </button>
      </nav>
    </>
  )
}
