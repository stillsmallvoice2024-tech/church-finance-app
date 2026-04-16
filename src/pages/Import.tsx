import { useState, useRef } from 'react'
import { Upload, PenLine, FileSpreadsheet } from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { ImportModal } from '../components/modals/ImportModal'

type Tab = 'file' | 'manual'

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'file',   label: 'File Import',  icon: Upload  },
  { id: 'manual', label: 'Manual Entry', icon: PenLine },
]

export default function Import() {
  const [activeTab, setActiveTab]   = useState<Tab>('file')
  const [importOpen, setImportOpen] = useState(false)
  const [dragging,   setDragging]   = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  usePageTitle('Import')

  // Dropping a file directly on the zone auto-opens the modal.
  // The modal re-accepts the file internally via its own input,
  // so we just use the drop event to trigger opening.
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    if (e.dataTransfer.files.length > 0) setImportOpen(true)
  }

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

      {/* ── File Import tab ──────────────────────────────────────────────── */}
      {activeTab === 'file' && (
        <div className="space-y-6">
          {/* Drop zone */}
          <div
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => setImportOpen(true)}
            className={`cursor-pointer border-2 border-dashed rounded-xl p-14 flex flex-col items-center gap-4 transition-colors ${
              dragging
                ? 'border-primary bg-primary/5'
                : 'border-gray-300 bg-gray-50 hover:border-primary hover:bg-primary/5'
            }`}
          >
            <div className={`p-5 rounded-full transition-colors ${dragging ? 'bg-primary/10' : 'bg-white shadow-sm'}`}>
              <FileSpreadsheet className={`w-8 h-8 ${dragging ? 'text-primary' : 'text-gray-400'}`} />
            </div>
            <div className="text-center">
              <p className="text-sm font-semibold text-gray-700">
                Drop your Excel file here, or{' '}
                <span className="text-primary underline underline-offset-2">click to browse</span>
              </p>
              <p className="text-xs text-gray-400 mt-1">Accepts .xlsx and .xls — launches the import wizard</p>
            </div>
          </div>

          {/* Hidden file input (modal handles its own — this is just UI affordance) */}
          <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" />

          {/* Supported formats */}
          <div className="rounded-xl border border-gray-100 bg-white p-5 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Supported Tables</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {[
                'Inflow Transactions',
                'Outflow Transactions',
                'Intra-Account Flows',
                'Ledger Entries',
                'FX Transactions',
              ].map(label => (
                <div key={label} className="flex items-center gap-2 text-xs text-gray-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Manual Entry tab ─────────────────────────────────────────────── */}
      {activeTab === 'manual' && (
        <div className="flex flex-col items-center justify-center py-24 gap-3 text-center text-gray-400 border-2 border-dashed border-gray-200 rounded-xl bg-gray-50">
          <PenLine className="w-10 h-10 text-gray-300" />
          <p className="text-sm font-medium text-gray-500">Manual Entry</p>
          <p className="text-xs">Coming soon — enter transactions with duplicate checking</p>
        </div>
      )}

      {/* Import wizard modal */}
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}
