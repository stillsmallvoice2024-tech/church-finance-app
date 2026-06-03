import { formatCurrency } from '../../utils/formatters'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'

type AmountMode = 'inflow' | 'outflow' | 'balance' | 'neutral'

export function amountColorCls(value: number, mode: AmountMode): string {
  if (value === 0) return 'text-gray-300'
  switch (mode) {
    case 'inflow':  return 'text-success'
    case 'outflow': return 'text-danger'
    case 'balance': return value >= 0 ? 'text-gray-900 dark:text-gray-100' : 'text-danger'
    case 'neutral': return value <  0  ? 'text-danger' : 'text-gray-800 dark:text-gray-200'
  }
}

interface AmountCellProps {
  value: number
  mode?: AmountMode
  currency?: string
  showZero?: boolean
  bold?: boolean
  className?: string
}

/** Drop-in <td> for right-aligned, font-mono, color-coded monetary values. */
export function AmountCell({
  value,
  mode = 'neutral',
  currency,
  showZero = false,
  bold = true,
  className = '',
}: AmountCellProps) {
  const { baseCurrencyCode } = useOrgCurrency()
  const currencyCode = currency ?? baseCurrencyCode
  const isEmpty = value === 0 && !showZero
  return (
    <td
      className={`px-4 py-3 text-sm text-right font-mono whitespace-nowrap ${
        bold ? 'font-semibold' : 'font-medium'
      } ${isEmpty ? 'text-gray-300' : amountColorCls(value, mode)} ${className}`}
    >
      {isEmpty ? '—' : formatCurrency(value, currencyCode)}
    </td>
  )
}
