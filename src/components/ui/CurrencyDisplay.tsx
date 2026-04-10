import { formatCurrency } from '../../utils/formatters'
import type { Currency, TransactionType } from '../../types'

interface CurrencyDisplayProps {
  amount: number
  currency?: Currency
  type?: TransactionType
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const SIZE_CLASSES = {
  sm: 'text-sm',
  md: 'text-base',
  lg: 'text-xl font-bold',
}

export function CurrencyDisplay({
  amount,
  currency = 'NGN',
  type,
  className = '',
  size = 'md',
}: CurrencyDisplayProps) {
  const colorClass =
    type === 'inflow'
      ? 'text-success'
      : type === 'outflow'
        ? 'text-danger'
        : 'text-gray-900'

  return (
    <span className={`font-medium tabular-nums ${SIZE_CLASSES[size]} ${colorClass} ${className}`}>
      {type === 'inflow' ? '+' : type === 'outflow' ? '−' : ''}
      {formatCurrency(amount, currency)}
    </span>
  )
}
