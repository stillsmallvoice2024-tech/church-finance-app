import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, ArrowDownCircle, ArrowUpCircle, FileSpreadsheet,
  BarChart2, FileText, FilePlus, Settings, Users, DollarSign,
  Landmark, PiggyBank, GitBranch, Layers, Receipt, ArrowLeftRight,
  RefreshCcw, RotateCcw, Building2, PieChart, Search, X,
} from 'lucide-react'
import { useRole } from '../../hooks/useRole'

interface NavEntry {
  label:    string
  sub?:     string
  href:     string
  icon:     React.ElementType
  adminOnly?: boolean
  writeOnly?: boolean
}

const NAV_ENTRIES: NavEntry[] = [
  { label: 'Dashboard',            href: '/',                      icon: LayoutDashboard  },
  { label: 'Inflows',              sub: 'Income & donations',      href: '/inflows',               icon: ArrowDownCircle  },
  { label: 'Outflows',             sub: 'Expenses & payments',     href: '/outflows',              icon: ArrowUpCircle    },
  { label: 'Import',               sub: 'Upload bank statements',  href: '/import',                icon: FileSpreadsheet, writeOnly: true },
  { label: 'Reports',              sub: 'Financial summaries',     href: '/reports',               icon: BarChart2        },
  { label: 'Financial Report',     sub: 'Custom report builder',   href: '/reports?tab=financial',      icon: FileText         },
  { label: 'Dynamic Reports',      sub: 'Live-updating reports',   href: '/reports?tab=custom',       icon: FilePlus         },
  { label: 'Bank Ledger',          sub: 'Transactions by account', href: '/bank-ledger',           icon: Landmark         },
  { label: 'Bank Deposits',        sub: 'Cash deposits',           href: '/bank-deposits',         icon: Building2        },
  { label: 'Category Fund Transfers', sub: 'Inter-category fund movements', href: '/intra-flow',            icon: ArrowLeftRight   },
  { label: 'Intra-Bank Transfers', href: '/intrabank-transfers',   icon: GitBranch                 },
  { label: 'FX / Foreign Currency',sub: 'Currency conversions',   href: '/foreign-currency',      icon: DollarSign       },
  { label: 'Regular Funds',        sub: 'Fund distribution rules', href: '/funds?tab=regular', icon: PieChart         },
  { label: 'Designated Gifts',     sub: 'Earmarked donations',     href: '/funds?tab=designated',      icon: PiggyBank        },
  { label: 'Savings Funds',        sub: 'Reserve funds',          href: '/funds?tab=savings',      icon: PiggyBank        },
  { label: 'Category Ledger',      sub: 'Spending by category',    href: '/funds?tab=accounts',       icon: Layers           },
  { label: 'Categories',           sub: 'Manage categories',       href: '/categories',            icon: Layers           },
  { label: 'Pending Deductions',   sub: 'Approved but unpaid',     href: '/adjustments?tab=upcoming',    icon: BarChart2        },
  { label: 'Refunds',              href: '/adjustments?tab=refunds',               icon: RefreshCcw               },
  { label: 'Reversals',            href: '/adjustments?tab=reversals',             icon: RotateCcw                },
  { label: 'Receipts',             href: '/receipts',              icon: Receipt                  },
  { label: 'Setup',                sub: 'Org configuration',       href: '/settings?tab=setup',                 icon: Settings, writeOnly: true },
  { label: 'Settings',             href: '/settings',              icon: Settings                 },
  { label: 'Users',                sub: 'Manage team members',     href: '/users',                 icon: Users, adminOnly: true },
  { label: 'Change Log',           sub: 'Audit history',           href: '/change-log',            icon: FileText, adminOnly: true },
]

function score(entry: NavEntry, query: string): number {
  const q   = query.toLowerCase()
  const lbl = entry.label.toLowerCase()
  const sub = (entry.sub ?? '').toLowerCase()
  if (lbl === q)                    return 100
  if (lbl.startsWith(q))           return  80
  if (lbl.includes(q))             return  60
  if (sub.includes(q))             return  40
  return 0
}

interface Props {
  open:    boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: Props) {
  const [query,   setQuery]   = useState('')
  const [cursor,  setCursor]  = useState(0)
  const navigate  = useNavigate()
  const inputRef  = useRef<HTMLInputElement>(null)
  const listRef   = useRef<HTMLUListElement>(null)
  const { isAdmin, canWrite } = useRole()

  const visibleEntries = NAV_ENTRIES.filter(e => {
    if (e.adminOnly && !isAdmin())  return false
    if (e.writeOnly && !canWrite()) return false
    return true
  })

  const results = query.trim()
    ? visibleEntries
        .map(e => ({ entry: e, s: score(e, query.trim()) }))
        .filter(x => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .map(x => x.entry)
    : visibleEntries

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  useEffect(() => {
    setCursor(0)
  }, [query])

  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const go = useCallback((href: string) => {
    onClose()
    navigate(href)
  }, [navigate, onClose])

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor(c => Math.min(c + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor(c => Math.max(c - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (results[cursor]) go(results[cursor].href)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] px-4"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation palette"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel */}
      <div className="relative w-full max-w-lg bg-white dark:bg-[#1c1c1e] rounded-2xl shadow-2xl border border-gray-200 dark:border-white/[0.07] overflow-hidden">

        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-100 dark:border-white/[0.07]">
          <Search className="w-4 h-4 text-gray-400 shrink-0" aria-hidden="true" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Go to page…"
            className="flex-1 text-sm bg-transparent outline-none text-gray-900 dark:text-white placeholder-gray-400"
            role="combobox"
            aria-expanded="true"
            aria-controls="cmd-palette-list"
            aria-autocomplete="list"
          />
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results */}
        <ul
          id="cmd-palette-list"
          ref={listRef}
          role="listbox"
          className="max-h-72 overflow-y-auto py-1"
        >
          {results.length === 0 ? (
            <li className="px-4 py-6 text-sm text-center text-gray-400">No pages found</li>
          ) : results.map((entry, i) => {
            const Icon = entry.icon
            return (
              <li
                key={entry.href}
                role="option"
                aria-selected={i === cursor}
                className={`flex items-center gap-3 px-4 py-2.5 cursor-pointer transition-colors ${
                  i === cursor
                    ? 'bg-primary/10 dark:bg-primary/20'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(entry.href)}
              >
                <Icon className={`w-4 h-4 shrink-0 ${i === cursor ? 'text-primary' : 'text-gray-400'}`} aria-hidden="true" />
                <div className="min-w-0">
                  <p className={`text-sm font-medium truncate ${i === cursor ? 'text-primary dark:text-primary' : 'text-gray-800 dark:text-gray-200'}`}>
                    {entry.label}
                  </p>
                  {entry.sub && (
                    <p className="text-xs text-gray-500 dark:text-gray-500 truncate">{entry.sub}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <div className="px-4 py-2 border-t border-gray-100 dark:border-white/[0.07] flex items-center gap-3 text-xs text-gray-500">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">Enter</kbd> go</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
