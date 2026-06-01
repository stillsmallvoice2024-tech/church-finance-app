import { useMemo } from 'react'
import { useOrgStore } from '../store/orgStore'
import { useCurrencies, DEFAULT_CURRENCIES, type Currency as CurrencyMeta } from './useCurrencies'
import { getCurrencySymbol, getCurrencyLocale, formatCurrency, formatCurrencyCompact } from '../utils/formatters'

export interface OrgCurrency {
  /** Code of the organisation's base currency, e.g. "NGN" */
  baseCurrencyCode: string
  /** Display symbol for the base currency, e.g. "₦" */
  baseCurrencySymbol: string
  /** Full name of the base currency */
  baseCurrencyName: string
  /** Flag emoji, if available */
  baseCurrencyFlag: string | null
  /** BCP-47 locale derived from the base currency, e.g. "en-NG" */
  formatLocale: string
  /** All active currencies that are NOT the base currency */
  foreignCurrencies: CurrencyMeta[]
  /** All active currencies (base + foreign) */
  allCurrencies: CurrencyMeta[]
  /** Format an amount using the org base currency (or supplied currency code) */
  formatAmount: (amount: number, currency?: string) => string
  /** Compact (K/M) format using the org base currency (or supplied currency code) */
  formatAmountCompact: (amount: number, currency?: string) => string
  /** Return the symbol for any currency code, falling back to the code itself */
  getCurrencySymbol: (code: string) => string
}

export function useOrgCurrency(): OrgCurrency {
  const storedCode = useOrgStore((s) => s.defaultCurrency)
  const { currencies } = useCurrencies()

  return useMemo(() => {
    const baseCurrencyCode = storedCode ?? 'NGN'
    const pool = currencies.length > 0 ? currencies : DEFAULT_CURRENCIES

    const baseMeta: CurrencyMeta =
      pool.find((c) => c.code === baseCurrencyCode) ??
      DEFAULT_CURRENCIES.find((c) => c.code === baseCurrencyCode) ?? {
        code: baseCurrencyCode,
        name: baseCurrencyCode,
        symbol: getCurrencySymbol(baseCurrencyCode),
        flag: null,
        is_active: true,
        sort_order: 0,
      }

    const sym = (code: string) => {
      const found = pool.find((c) => c.code === code)
      return found?.symbol ?? getCurrencySymbol(code)
    }

    return {
      baseCurrencyCode,
      baseCurrencySymbol:  baseMeta.symbol,
      baseCurrencyName:    baseMeta.name,
      baseCurrencyFlag:    baseMeta.flag ?? null,
      formatLocale:        getCurrencyLocale(baseCurrencyCode),
      foreignCurrencies:   pool.filter((c) => c.code !== baseCurrencyCode),
      allCurrencies:       pool,
      formatAmount:        (amount, currency) => formatCurrency(amount, currency ?? baseCurrencyCode),
      formatAmountCompact: (amount, currency) => formatCurrencyCompact(amount, currency ?? baseCurrencyCode),
      getCurrencySymbol:   sym,
    }
  }, [storedCode, currencies])
}
