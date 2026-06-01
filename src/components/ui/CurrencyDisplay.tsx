import { formatCurrency } from '../../utils/formatters'
import { useOrgStore } from '../../store/orgStore'
import type { TransactionType } from '../../types'

interface CurrencyDisplayProps {
  amount: number
  currency?: string
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
  currency,
  type,
  className = '',
  size = 'md',
}: CurrencyDisplayProps) {
  const defaultCurrency = useOrgStore((s) => s.defaultCurrency) ?? 'NGN'
  const colorClass =
    type === 'inflow'
      ? 'text-success'
      : type === 'outflow'
        ? 'text-danger'
        : 'text-gray-900'

  return (
    <span className={`font-medium tabular-nums ${SIZE_CLASSES[size]} ${colorClass} ${className}`}>
      {type === 'inflow' ? '+' : type === 'outflow' ? '−' : ''}
      {formatCurrency(amount, currency ?? defaultCurrency)}
    </span>
  )
}
