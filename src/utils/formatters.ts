import { format } from 'date-fns'
import type { Currency } from '../types'

export const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦',
  USD: '$',
  GBP: '£',
  EUR: '€',
  CNY: '¥',
}

const CURRENCY_LOCALES: Record<string, string> = {
  NGN: 'en-NG',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'de-DE',
  CNY: 'zh-CN',
}

export function getCurrencyLocale(code: string): string {
  return CURRENCY_LOCALES[code] ?? 'en-NG'
}

export function formatCurrency(amount: number, currency: Currency = 'NGN'): string {
  const symbol = CURRENCY_SYMBOLS[currency]
  return `${symbol}${amount.toLocaleString(getCurrencyLocale(currency), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Format a monetary amount for any currency code (including non-standard ones). */
export function formatAmount(amount: number, currencyCode: string, dp = 2): string {
  const symbol = CURRENCY_SYMBOLS[currencyCode] ?? currencyCode
  return `${symbol}${amount.toLocaleString(getCurrencyLocale(currencyCode), {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  })}`
}

export function formatCurrencyCompact(amount: number, currency: Currency = 'NGN'): string {
  const symbol = CURRENCY_SYMBOLS[currency]
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
