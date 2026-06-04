import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useOrgStore } from '../store/orgStore'

export interface FXConversion {
  id:                   string
  date:                 string
  fx_currency:          string
  fx_amount:            number
  exchange_rate:        number
  naira_amount:         number
  fx_withdrawal_id:     string | null
  naira_inflow_id:      string | null
  notes:                string | null
  allocation_config_id: string | null
  is_partial:           boolean
  created_by:           string | null
  created_at:           string
}

export function useFXConversions(currency?: string) {
  const orgId = useOrgStore((s) => s.orgId)

  const [conversions, setConversions] = useState<FXConversion[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    setError(null)
    let q = supabase
      .from('fx_conversions')
      .select('*')
      .eq('org_id', orgId)
      .order('date',       { ascending: false })
      .order('created_at', { ascending: false })
    if (currency) q = q.eq('fx_currency', currency.toUpperCase())
    const { data, error: err } = await q
    if (err) setError(err.message)
    else     setConversions((data ?? []) as FXConversion[])
    setLoading(false)
  }, [orgId, currency])

  useEffect(() => { fetch() }, [fetch])

  return { conversions, loading, error, refetch: fetch }
}

// ── Mutation ──────────────────────────────────────────────────────────────────

export interface AddFXConversionInput {
  date:                 string
  fx_currency:          string
  fx_amount:            number
  exchange_rate:        number
  naira_amount:         number
  bank_name:            string   // required — NULL makes inflow invisible to BankLedger
  notes?:               string
  allocation_config_id?: string
  stage_code_1?:        string
  stage_code_2?:        string
  is_partial?:          boolean
}

export function useAddFXConversion() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: AddFXConversionInput): Promise<void> => {
    const { user } = useAuthStore.getState()
    const { orgId, defaultCurrency } = useOrgStore.getState()
    const baseCurrency = defaultCurrency ?? 'NGN'
    if (!user?.id) throw new Error('You must be signed in.')
    if (!orgId) throw new Error('No active organisation.')
    if (!input.bank_name?.trim()) throw new Error('bank_name is required for FX conversion inflows.')
    setLoading(true); setError(null)

    try {
      // 1. Record FX withdrawal (reduces fx_transactions running balance)
      //    We compute the new running balance from the most recent row for this currency.
      const { data: lastRows } = await supabase
        .from('fx_transactions')
        .select('running_balance')
        .eq('org_id',   orgId)
        .eq('currency', input.fx_currency)
        .order('date',       { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)

      const prevBalance = Number(lastRows?.[0]?.running_balance ?? 0)
      const newBalance  = prevBalance - input.fx_amount

      const { data: fxRow, error: fxErr } = await supabase
        .from('fx_transactions')
        .insert({
          date:            input.date,
          currency:        input.fx_currency,
          withdrawal:      input.fx_amount,
          deposit:         0,
          running_balance: newBalance,
          narration:       input.notes ?? `Converted to ${baseCurrency} @ ${input.exchange_rate}`,
          created_by:      user.id,
          org_id:          orgId,
        })
        .select('id')
        .single()
      if (fxErr) throw fxErr

      // 2. Record NGN inflow (the converted naira)
      //    bank_name must be set — NULL makes the row invisible to BankLedger
      const { data: inflowRow, error: inflowErr } = await supabase
        .from('inflow_transactions')
        .insert({
          date:                 input.date,
          amount:               input.naira_amount,
          description:          input.notes ?? `FX Conversion: ${input.fx_currency} → ${baseCurrency}`,
          bank_name:            input.bank_name ?? null,
          stage_code_1:         input.stage_code_1 ?? null,
          stage_code_2:         input.stage_code_2 ?? 'Percentage Allocation',
          allocation_config_id: input.allocation_config_id ?? null,
          fx_currency:          input.fx_currency,
          fx_amount:            input.fx_amount,
          fx_rate:              input.exchange_rate,
          transaction_type:     'fx_conversion',
          created_by:           user.id,
          org_id:               orgId,
        })
        .select('id')
        .single()
      if (inflowErr) throw inflowErr

      // 3. Record the conversion link record
      const { error: convErr } = await supabase.from('fx_conversions').insert({
        date:                 input.date,
        fx_currency:          input.fx_currency,
        fx_amount:            input.fx_amount,
        exchange_rate:        input.exchange_rate,
        naira_amount:         input.naira_amount,
        fx_withdrawal_id:     fxRow?.id  ?? null,
        naira_inflow_id:      inflowRow?.id ?? null,
        notes:                input.notes ?? null,
        allocation_config_id: input.allocation_config_id ?? null,
        is_partial:           input.is_partial ?? (input.fx_amount < prevBalance),
        created_by:           user.id,
        org_id:               orgId,
      })
      if (convErr) throw convErr

    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err))
      setError(msg)
      throw new Error(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}
