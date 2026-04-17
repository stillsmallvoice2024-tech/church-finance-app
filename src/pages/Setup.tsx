import { useState } from 'react'
import { CalendarDays, CheckCircle2 } from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useAccountingYearStore } from '../store/accountingYearStore'

const TABS = ['General', 'Banks', 'Allocation'] as const
type Tab = typeof TABS[number]

function buildYearOptions(): number[] {
  const current = new Date().getFullYear()
  const years: number[] = []
  for (let y = current - 2; y <= current + 2; y++) years.push(y)
  return years
}

const YEAR_OPTIONS = buildYearOptions()

function GeneralTab() {
  const { year, setYear } = useAccountingYearStore()
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(year)

  const handleSave = () => {
    setYear(pending)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
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
            <span className="text-xs text-gray-400">Unsaved change</span>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SetupPage() {
  const [activeTab, setActiveTab] = useState<Tab>('General')

  usePageTitle('Setup')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Setup</h1>
        <p className="text-sm text-gray-500 mt-1">Configure your church finance settings</p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'General'    && <GeneralTab />}
        {activeTab === 'Banks'      && <div className="min-h-[300px] flex items-center justify-center text-sm text-gray-400">Banks settings coming soon.</div>}
        {activeTab === 'Allocation' && <div className="min-h-[300px] flex items-center justify-center text-sm text-gray-400">Allocation settings coming soon.</div>}
      </div>
    </div>
  )
}
