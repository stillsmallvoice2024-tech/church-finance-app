import { format } from 'date-fns'

// ── Symbol map ────────────────────────────────────────────────────────────────

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

// ── Locale map — maps each currency code to its natural BCP-47 locale ─────────

export const CURRENCY_LOCALE_MAP: Record<string, string> = {
  NGN: 'en-NG',
  USD: 'en-US',
  GBP: 'en-GB',
  EUR: 'de-DE',
  CNY: 'zh-CN',
  JPY: 'ja-JP',
  AED: 'ar-AE',
  CAD: 'en-CA',
  AUD: 'en-AU',
  CHF: 'de-CH',
  ZAR: 'en-ZA',
  GHS: 'en-GH',
  KES: 'en-KE',
  UGX: 'en-UG',
  TZS: 'sw-TZ',
  XOF: 'fr-SN',
  XAF: 'fr-CM',
  EGP: 'ar-EG',
  INR: 'en-IN',
  BRL: 'pt-BR',
  MXN: 'es-MX',
  SGD: 'en-SG',
  HKD: 'zh-HK',
  NZD: 'en-NZ',
  SEK: 'sv-SE',
  NOK: 'nb-NO',
  DKK: 'da-DK',
}

// ── Public helpers ─────────────────────────────────────────────────────────────

export function getCurrencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code] ?? code
}

/** Returns the BCP-47 locale most appropriate for formatting amounts in the given currency. */
export function getCurrencyLocale(code: string): string {
  return CURRENCY_LOCALE_MAP[code] ?? 'en-US'
}

export function formatCurrency(amount: number, currency: string): string {
  const locale = getCurrencyLocale(currency)
  const symbol = getCurrencySymbol(currency)
  return `${symbol}${amount.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

/** Renders negatives as (SYM 1,234.56), zero as —, positives normally. */
export function formatCurrencyNegative(amount: number, currency: string): string {
  if (amount === 0) return '—'
  const locale = getCurrencyLocale(currency)
  const symbol = getCurrencySymbol(currency)
  const abs = Math.abs(amount).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return amount < 0 ? `(${symbol}${abs})` : `${symbol}${abs}`
}

export function formatCurrencyCompact(amount: number, currency: string): string {
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
