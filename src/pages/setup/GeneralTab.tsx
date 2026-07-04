import { useState, useEffect } from 'react'
import { CalendarDays, CheckCircle2, Globe } from 'lucide-react'
import { useAccountingYearStore } from '../../store/accountingYearStore'
import { supabase } from '../../lib/supabase'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'
import { useOrgStore } from '../../store/orgStore'
import { COMMON_TIMEZONES, getOrgTimezone } from '../../utils/timezones'

// ── General tab ──────────────────────────────────────────────────────────────────

function buildYearOptions(): number[] {
  const current = new Date().getFullYear()
  const years: number[] = []
  for (let y = current - 2; y <= current + 2; y++) years.push(y)
  return years
}

const YEAR_OPTIONS = buildYearOptions()

export function GeneralTab() {
  const { year, setYear } = useAccountingYearStore()
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(year)

  const orgId          = useOrgStore(s => s.orgId)
  const storedTimezone = useOrgStore(s => s.timezone)
  const setTimezone    = useOrgStore(s => s.setTimezone)
  const { baseCurrencyCode } = useOrgCurrency()

  const effectiveTz    = getOrgTimezone(storedTimezone, baseCurrencyCode)
  const [pendingTz, setPendingTz] = useState(effectiveTz)
  const [tzSaved,   setTzSaved]   = useState(false)
  const [tzSaving,  setTzSaving]  = useState(false)
  const [tzError,   setTzError]   = useState<string | null>(null)

  // Keep pendingTz in sync if the store changes (e.g. org switch)
  useEffect(() => {
    setPendingTz(getOrgTimezone(storedTimezone, baseCurrencyCode))
  }, [storedTimezone, baseCurrencyCode])

  const handleSave = () => {
    setYear(pending)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleSaveTz = async () => {
    if (!orgId) return
    setTzSaving(true)
    setTzError(null)
    const { error } = await supabase
      .from('organizations')
      .update({ timezone: pendingTz })
      .eq('id', orgId)
    setTzSaving(false)
    if (error) {
      setTzError(error.message)
    } else {
      setTimezone(pendingTz)
      setTzSaved(true)
      setTimeout(() => setTzSaved(false), 2000)
    }
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-gray-800">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold">Accounting Year</h2>
        </div>
        <p className="text-sm text-gray-500">
          Select the financial year you are currently working in. All transaction views and reports will reflect this period.
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          {YEAR_OPTIONS.map(y => (
            <button
              key={y}
              onClick={() => setPending(y)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                pending === y
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-primary hover:text-primary'
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={pending === year}
            className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50 transition-colors"
          >
            Save
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-success font-medium">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
          {pending !== year && !saved && (
            <span className="text-xs text-gray-500">Unsaved change</span>
          )}
        </div>
      </div>

      {/* ── Timezone ─────────────────────────────────────────────────────────── */}
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-gray-800">
          <Globe className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold">Organisation Timezone</h2>
        </div>
        <p className="text-sm text-gray-500">
          Controls how timestamps (e.g. last reconciliation check) are displayed throughout the app.
          Defaults to the timezone of your organisation's base currency.
        </p>

        <div className="pt-1">
          <select
            value={pendingTz}
            onChange={e => setPendingTz(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
          >
            {COMMON_TIMEZONES.map(tz => (
              <option key={tz.value} value={tz.value}>
                {tz.label} (UTC{tz.offset})
              </option>
            ))}
          </select>
        </div>

        {tzError && (
          <p className="text-xs text-danger">{tzError}</p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSaveTz}
            disabled={pendingTz === effectiveTz || tzSaving}
            className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50 transition-colors"
          >
            {tzSaving ? 'Saving…' : 'Save'}
          </button>
          {tzSaved && (
            <span className="flex items-center gap-1.5 text-sm text-success font-medium">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
          {pendingTz !== effectiveTz && !tzSaved && !tzSaving && (
            <span className="text-xs text-gray-500">Unsaved change</span>
          )}
        </div>
      </div>
    </div>
  )
}
