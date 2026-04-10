import { useRef } from 'react'
import { Upload, FileSpreadsheet, Info } from 'lucide-react'
import { Modal } from '../ui/Modal'

interface Props {
  open: boolean
  onClose: () => void
}

export function ImportModal({ open, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <Modal open={open} onClose={onClose} title="Import from Excel">
      <div className="space-y-5">
        {/* Coming-soon notice */}
        <div className="flex gap-3 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3">
          <Info className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-700">
            Excel import is <strong>coming soon</strong>. You can upload a file below and we'll
            notify you once processing is available.
          </p>
        </div>

        {/* Drop zone */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="w-full border-2 border-dashed border-gray-300 rounded-xl p-8 flex flex-col items-center gap-3 hover:border-primary hover:bg-primary/5 transition-colors group"
        >
          <div className="p-3 bg-gray-100 group-hover:bg-primary/10 rounded-full transition-colors">
            <Upload className="w-6 h-6 text-gray-400 group-hover:text-primary transition-colors" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">Click to select a file</p>
            <p className="text-xs text-gray-400 mt-1">.xlsx or .csv — max 5 MB</p>
          </div>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={() => {/* placeholder */}}
        />

        {/* Expected format hint */}
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            <FileSpreadsheet className="w-4 h-4" />
            Expected columns
          </div>
          <div className="grid grid-cols-3 gap-1">
            {['Date', 'Amount', 'Description', 'Stage Code', 'Transaction Ref', 'Remark'].map(col => (
              <span key={col} className="text-xs bg-white border border-gray-200 rounded px-2 py-1 text-gray-600">
                {col}
              </span>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  )
}
