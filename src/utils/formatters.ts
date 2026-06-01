import { format } from 'date-fns'

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦',
  USD: '$',
  GBP: '£',
  EUR: '€',
  CNY: '¥',
  JPY: '¥',
  AED: 'د.إ',
  CAD: 'CA$',
  AUD: 'A$',
  CHF: 'Fr',
  ZAR: 'R',
  GHS: '₵',
  KES: 'KSh',
  UGX: 'USh',
  TZS: 'TSh',
  XOF: 'Fr',
  XAF: 'Fr',
  EGP: '£',
  INR: '₹',
  BRL: 'R$',
  MXN: '$',
  SGD: 'S$',
  HKD: 'HK$',
  NZD: 'NZ$',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
}

export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code
}

export function formatCurrency(amount: number, currency = 'NGN'): string {
  const symbol = getCurrencySymbol(currency)
  return `${symbol}${amount.toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Renders negatives as (SYM 1,234.56), zero as —, positives normally. */
export function formatCurrencyNegative(amount: number, currency = 'NGN'): string {
  if (amount === 0) return '—'
  const symbol = getCurrencySymbol(currency)
  const abs = Math.abs(amount).toLocaleString('en-NG', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return amount < 0 ? `(${symbol}${abs})` : `${symbol}${abs}`
}

export function formatCurrencyCompact(amount: number, currency = 'NGN'): string {
  const symbol = getCurrencySymbol(currency)
  const abs = Math.abs(amount)
  let formatted: string
  if (abs >= 1_000_000) formatted = `${symbol}${(abs / 1_000_000).toFixed(1)}M`
  else if (abs >= 1_000) formatted = `${symbol}${(abs / 1_000).toFixed(0)}K`
  else formatted = `${symbol}${abs.toFixed(0)}`
  return amount < 0 ? `(${formatted})` : formatted
}

export function formatDate(date: string | Date): string {
  return format(new Date(date), 'dd MMM yyyy')
}

export function formatCardDate(date: string | Date): { dayMonth: string; year: string } {
  const d = new Date(date)
  return { dayMonth: format(d, 'dd MMM,'), year: format(d, 'yyyy') }
}

export function formatDateTime(date: string | Date): string {
  return format(new Date(date), 'dd MMM yyyy, HH:mm')
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function formatPercentage(value: number, total: number): string {
  if (total === 0) return '0%'
  return `${((value / total) * 100).toFixed(1)}%`
}
