import { useState } from 'react'
import { usePageTitle } from '../hooks/usePageTitle'

const TABS = ['General', 'Banks', 'Allocation'] as const
type Tab = typeof TABS[number]

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
      <div className="min-h-[300px] flex items-center justify-center text-sm text-gray-400">
        {activeTab} settings coming soon.
      </div>
    </div>
  )
}
