import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckCircle2, Circle, X, ChevronDown, ChevronUp, Sparkles,
  Building2, Landmark, ArrowDownCircle, ArrowUpCircle,
  Upload, UserPlus, Tag,
} from 'lucide-react'
import { useUserPreferences } from '../../hooks/useUserPreferences'
import { useChecklistData } from '../../hooks/useChecklistData'
import { useRole } from '../../hooks/useRole'
import { useOnboardingStore } from '../../store/onboardingStore'
import { CHECKLIST_ITEMS } from '../../onboarding/checklist/definitions'
import type { LucideIcon } from 'lucide-react'

// ── Icon resolver ─────────────────────────────────────────────────────────────

const ICON_MAP: Record<string, LucideIcon> = {
  Building2,
  Landmark,
  ArrowDownCircle,
  ArrowUpCircle,
  Tag,
  Upload,
  UserPlus,
}

function resolveIcon(name: string): LucideIcon {
  return ICON_MAP[name] ?? Circle
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ChecklistProgress({ done, total }: { done: number; total: number }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums flex-shrink-0">
        {done}/{total}
      </span>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function OnboardingChecklist() {
  const { canWrite } = useRole()
  const { prefs, loading: prefsLoading, updatePrefs } = useUserPreferences()
  const { data, loading: dataLoading }                = useChecklistData()
  const openWizard = useOnboardingStore(s => s.openWizard)

  const [collapsed,     setCollapsed]     = useState(false)
  const [allDoneShown,  setAllDoneShown]  = useState(false)

  // Evaluate each item's completion
  const results = CHECKLIST_ITEMS.map(item => ({
    ...item,
    done: item.completionCheck(data),
    Icon: resolveIcon(item.iconName),
  }))

  const doneCount  = results.filter(r => r.done).length
  const totalCount = results.length
  const allDone    = doneCount === totalCount

  // When all items complete, show celebration then auto-dismiss after 4s
  useEffect(() => {
    if (!allDone || allDoneShown || prefsLoading) return
    setAllDoneShown(true)
    const t = setTimeout(() => {
      updatePrefs({ checklist_dismissed: true })
    }, 4000)
    return () => clearTimeout(t)
  }, [allDone, allDoneShown, prefsLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Don't render for viewers, or while loading, or when dismissed
  if (!canWrite())                    return null
  if (prefsLoading || dataLoading)    return null
  if (prefs.checklist_dismissed && !allDone) return null

  // All-done celebration banner
  if (allDone) {
    return (
      <div className="rounded-2xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-5 py-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center flex-shrink-0">
          <Sparkles className="w-5 h-5 text-green-600 dark:text-green-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-green-800 dark:text-green-300">
            Setup complete!
          </p>
          <p className="text-xs text-green-600 dark:text-green-500 mt-0.5">
            Your organisation is fully configured. This checklist will disappear shortly.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3.5 border-b border-gray-100 dark:border-gray-700">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1.5">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
              Finish setting up your organisation
            </h3>
          </div>
          <ChecklistProgress done={doneCount} total={totalCount} />
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Continue wizard shortcut */}
          <button
            type="button"
            onClick={openWizard}
            className="hidden sm:inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline px-2 py-1 rounded"
          >
            Open wizard
          </button>

          {/* Collapse / expand */}
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            aria-label={collapsed ? 'Expand checklist' : 'Collapse checklist'}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            {collapsed
              ? <ChevronDown className="w-4 h-4" />
              : <ChevronUp className="w-4 h-4" />
            }
          </button>

          {/* Dismiss */}
          <button
            type="button"
            onClick={() => updatePrefs({ checklist_dismissed: true })}
            aria-label="Dismiss checklist"
            title="Dismiss — reopen from Help Centre"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Items */}
      {!collapsed && (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {results.map(item => {
            const { Icon } = item
            return (
              <li
                key={item.id}
                className={`flex items-center gap-3 px-5 py-3 transition-colors ${
                  item.done
                    ? 'opacity-60'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                }`}
              >
                {/* Status icon */}
                <div className="flex-shrink-0">
                  {item.done
                    ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                    : <Circle className="w-5 h-5 text-gray-300 dark:text-gray-600" />
                  }
                </div>

                {/* Item icon */}
                <div className={`flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${
                  item.done
                    ? 'bg-gray-100 dark:bg-gray-700'
                    : 'bg-primary/10'
                }`}>
                  <Icon className={`w-3.5 h-3.5 ${item.done ? 'text-gray-400' : 'text-primary'}`} />
                </div>

                {/* Label + description */}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${
                    item.done
                      ? 'line-through text-gray-400 dark:text-gray-500'
                      : 'text-gray-800 dark:text-gray-200'
                  }`}>
                    {item.label}
                    {!item.required && (
                      <span className="ml-1.5 text-xs font-normal text-gray-400 dark:text-gray-500">
                        (optional)
                      </span>
                    )}
                  </p>
                  {!item.done && item.description && (
                    <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5 truncate">
                      {item.description}
                    </p>
                  )}
                </div>

                {/* Action link */}
                {!item.done && (
                  <Link
                    to={item.action.href}
                    className="flex-shrink-0 text-xs font-medium text-primary hover:underline px-2 py-1"
                  >
                    {item.action.label} →
                  </Link>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
