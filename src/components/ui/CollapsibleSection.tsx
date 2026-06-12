import { useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

interface CollapsibleSectionProps {
  label: string
  defaultOpen?: boolean
  children: ReactNode
}

export function CollapsibleSection({ label, defaultOpen = false, children }: CollapsibleSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <div className="border border-gray-100 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-gray-500 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        {label}
        <ChevronDown
          aria-hidden="true"
          className={`w-4 h-4 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      <div id={contentId}>
        {open && (
          <div className="p-4 space-y-4">
            {children}
          </div>
        )}
      </div>
    </div>
  )
}
