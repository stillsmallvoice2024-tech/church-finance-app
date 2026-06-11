import { memo } from 'react'

export interface DetailItem {
  label:    string
  value:    React.ReactNode
  mono?:    boolean
  breakAll?: boolean
  badge?:   string   // Tailwind bg+text classes; renders value as a badge span
}

export const RowDetailPanel = memo(function RowDetailPanel({
  items,
  colSpan,
  footer,
}: {
  items:   DetailItem[]
  colSpan: number
  /** Optional full-width content rendered below the detail grid (e.g. history timeline). */
  footer?: React.ReactNode
}) {
  const visible = items.filter(({ value }) =>
    value !== null && value !== undefined && value !== '' && value !== false,
  )
  if (!visible.length && !footer) return null
  return (
    <tr className="bg-gray-50/70 border-b border-gray-100">
      <td colSpan={colSpan} className="px-6 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-3">
          {visible.map(({ label, value, mono, breakAll, badge }, i) => (
            <div key={i} className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">
                {label}
              </p>
              {badge ? (
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${badge}`}>
                  {value}
                </span>
              ) : (
                <p
                  className={[
                    'text-xs text-gray-700 select-text',
                    breakAll ? 'break-all whitespace-normal' : 'break-words',
                    mono ? 'font-mono' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {value}
                </p>
              )}
            </div>
          ))}
          {footer}
        </div>
      </td>
    </tr>
  )
})
