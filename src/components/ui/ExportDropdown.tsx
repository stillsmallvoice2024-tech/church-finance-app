import { useState, useRef, useEffect } from 'react'
import { Download, ChevronDown } from 'lucide-react'
import { ButtonSpinner } from './ButtonSpinner'

interface ExportDropdownProps {
  onExportView: () => void
  onExportAll: () => void | Promise<void>
  disabled?: boolean
}

export function ExportDropdown({ onExportView, onExportAll, disabled }: ExportDropdownProps) {
  const [open,       setOpen]       = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleExportAll = async () => {
    setOpen(false)
    setLoadingAll(true)
    try { await onExportAll() } finally { setLoadingAll(false) }
  }

  return (
    <div ref={ref} className="relative flex">
      <button
        onClick={() => { setOpen(false); onExportView() }}
        disabled={disabled || loadingAll}
        className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-l-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
      >
        {loadingAll ? <ButtonSpinner /> : <Download className="w-4 h-4" />}
        Export CSV
      </button>
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled || loadingAll}
        className="flex items-center px-2 py-2 text-sm text-gray-700 bg-white border border-gray-300 border-l-0 rounded-r-lg hover:bg-gray-50 transition-colors disabled:opacity-40"
        aria-label="Export options"
      >
        <ChevronDown className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg border border-gray-200 shadow-lg z-50 overflow-hidden">
          <button
            onClick={() => { setOpen(false); onExportView() }}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Export Current View
          </button>
          <button
            onClick={handleExportAll}
            className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50"
          >
            Export All
          </button>
        </div>
      )}
    </div>
  )
}
