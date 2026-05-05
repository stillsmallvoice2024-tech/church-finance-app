import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface Currency {
  code:       string
  name:       string
  symbol:     string
  flag:       string | null
  is_active:  boolean
  sort_order: number
}

export const DEFAULT_CURRENCIES: Currency[] = [
  { code: 'NGN', name: 'Nigerian Naira', symbol: '₦', flag: '🇳🇬', is_active: true, sort_order: 0 },
  { code: 'USD', name: 'US Dollar',      symbol: '$', flag: '🇺🇸', is_active: true, sort_order: 1 },
  { code: 'GBP', name: 'British Pound',  symbol: '£', flag: '🇬🇧', is_active: true, sort_order: 2 },
  { code: 'EUR', name: 'Euro',           symbol: '€', flag: '🇪🇺', is_active: true, sort_order: 3 },
  { code: 'CNY', name: 'Chinese Yuan',   symbol: '¥', flag: '🇨🇳', is_active: true, sort_order: 4 },
]

export function useCurrencies() {
  const [currencies, setCurrencies] = useState<Currency[]>(DEFAULT_CURRENCIES)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('currencies')
      .select('*')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('code',       { ascending: true })
    if (err) {
      if (/relation.*does not exist|does not exist/i.test(err.message)) {
        setCurrencies(DEFAULT_CURRENCIES)
      } else {
        setError(err.message)
        setCurrencies(DEFAULT_CURRENCIES)
      }
    } else {
      setCurrencies((data ?? []) as Currency[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { currencies, loading, error, refetch: fetch }
}

export function useAddCurrency() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: { code: string; name: string; symbol: string; flag?: string }) => {
    setLoading(true)
    setError(null)
    const { error: err } = await supabase.from('currencies').insert({
      code:   input.code.toUpperCase().trim(),
      name:   input.name.trim(),
      symbol: input.symbol.trim(),
      flag:   input.flag?.trim() || null,
    })
    setLoading(false)
    if (err) { setError(err.message); throw err }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

export function useDeleteCurrency() {
  const [loading, setLoading] = useState(false)

  const mutate = useCallback(async (code: string) => {
    setLoading(true)
    const { error } = await supabase.from('currencies').delete().eq('code', code)
    setLoading(false)
    if (error) throw error
  }, [])

  return { mutate, loading }
}
