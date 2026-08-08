import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'

export interface Currency {
  id?:        string
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
  const orgId = useOrgStore((s) => s.orgId)
  const [currencies, setCurrencies] = useState<Currency[]>(DEFAULT_CURRENCIES)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setCurrencies(DEFAULT_CURRENCIES); setLoading(false); return }
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('currencies')
      .select('*')
      .eq('org_id', orgId)
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
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { currencies, loading, error, refetch: fetch }
}

export function useAddCurrency() {
  const orgId = useOrgStore((s) => s.orgId)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: { code: string; name: string; symbol: string; flag?: string }) => {
    if (!orgId) { const e = new Error('No active organisation'); setError(e.message); throw e }
    setLoading(true)
    setError(null)
    const { error: err } = await supabase.from('currencies').insert({
      org_id: orgId,
      code:   input.code.toUpperCase().trim(),
      name:   input.name.trim(),
      symbol: input.symbol.trim(),
      flag:   input.flag?.trim() || null,
    })
    setLoading(false)
    if (err) { setError(err.message); throw err }
  }, [orgId])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

export function useDeleteCurrency() {
  const orgId = useOrgStore((s) => s.orgId)
  const [loading, setLoading] = useState(false)

  // Scoped by org_id as well as code: RLS already blocks other tenants, but the
  // filter keeps the delete from depending on that as its only guard.
  const mutate = useCallback(async (code: string) => {
    if (!orgId) throw new Error('No active organisation')
    setLoading(true)
    const { error, count } = await supabase
      .from('currencies')
      .delete({ count: 'exact' })
      .eq('org_id', orgId)
      .eq('code', code)
    setLoading(false)
    if (error) throw error
    if (count === 0) throw new Error(`${code} could not be removed — you may not have permission.`)
  }, [orgId])

  return { mutate, loading }
}
