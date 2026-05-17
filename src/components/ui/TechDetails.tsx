import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface Props {
  children: ReactNode
}

/** Collapsed-by-default disclosure for SQL / stack traces / infra details. */
export function TechDetails({ children }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors"
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        Technical details
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-gray-200 bg-gray-900 overflow-hidden">
          <pre className="px-3 py-3 text-[11px] text-green-300 font-mono overflow-x-auto whitespace-pre leading-relaxed">
            {children}
          </pre>
        </div>
      )}
    </div>
  )
}
