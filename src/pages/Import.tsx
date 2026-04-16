import { useState } from 'react'
import { Upload, PenLine } from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'

type Tab = 'file' | 'manual'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'file',   label: 'File Import',   icon: Upload  },
  { id: 'manual', label: 'Manual Entry',  icon: PenLine },
]

export default function Import() {
  const [activeTab, setActiveTab] = useState<Tab>('file')
  usePageTitle('Import')

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Import Transactions</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload a bank statement or enter transactions manually
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
              activeTab === id
                ? 'border-primary text-primary'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <Icon className="w-4 h-4" />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === 'file' && (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
          <Upload className="w-10 h-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">File Import</p>
          <p className="text-xs">Coming soon — bank statement upload &amp; duplicate detection</p>
        </div>
      )}

      {activeTab === 'manual' && (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
          <PenLine className="w-10 h-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">Manual Entry</p>
          <p className="text-xs">Coming soon — enter transactions with duplicate checking</p>
        </div>
      )}
    </div>
  )
}
