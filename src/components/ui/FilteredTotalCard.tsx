import { formatCurrencyCompact } from '../../utils/formatters'

interface FilteredTotalCardProps {
  label: string
  amount: number
  offsetAmount?: number
  mode: 'inflow' | 'outflow' | 'neutral'
  currencyCode: string
  loading?: boolean
}

export function FilteredTotalCard({
  label,
  amount,
  offsetAmount = 0,
  mode,
  currencyCode,
  loading = false,
}: FilteredTotalCardProps) {
  const valueCls =
    mode === 'inflow'  ? 'text-success' :
    mode === 'outflow' ? 'text-danger'  :
    'text-gray-900'

  const hasOffset    = offsetAmount > 0
  const effectiveAmt = amount - offsetAmount
  const displayAmt   = hasOffset ? effectiveAmt : amount

  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4 min-w-0">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1.5">{label}</p>
      {loading ? (
        <div className="h-8 bg-gray-200 rounded animate-pulse w-2/3" />
      ) : (
        <p className={`text-2xl font-bold tabular-nums ${valueCls}`}>
          {formatCurrencyCompact(displayAmt, currencyCode)}
        </p>
      )}
      {!loading && hasOffset && mode === 'inflow' && (
        <p className="mt-1 text-xs text-gray-400">
          Total {formatCurrencyCompact(amount, currencyCode)} incl. {formatCurrencyCompact(offsetAmount, currencyCode)} offset
        </p>
      )}
      {!loading && hasOffset && mode === 'outflow' && (
        <p className="mt-1 text-xs text-gray-400">
          Total {formatCurrencyCompact(amount, currencyCode)} less {formatCurrencyCompact(offsetAmount, currencyCode)} offset
        </p>
      )}
    </div>
  )
}
