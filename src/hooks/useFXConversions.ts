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
      // Single atomic RPC — all three inserts (fx_transactions, inflow_transactions,
      // fx_conversions) execute in one Postgres transaction. Any failure rolls back all.
      const { error: rpcErr } = await supabase.rpc('perform_fx_conversion', {
        p_org_id:               orgId,
        p_user_id:              user.id,
        p_date:                 input.date,
        p_fx_currency:          input.fx_currency,
        p_fx_amount:            input.fx_amount,
        p_exchange_rate:        input.exchange_rate,
        p_naira_amount:         input.naira_amount,
        p_bank_name:            input.bank_name,
        p_base_currency:        baseCurrency,
        p_notes:                input.notes ?? null,
        p_allocation_config_id: input.allocation_config_id ?? null,
        p_stage_code_1:         input.stage_code_1 ?? null,
        p_stage_code_2:         input.stage_code_2 ?? 'Percentage Allocation',
      })
      if (rpcErr) throw rpcErr

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

export interface UpdateFXConversionInput {
  id:                    string
  exchange_rate:         number
  naira_amount:          number
  notes:                 string | null
  allocation_config_id:  string | null
  stage_code_1:          string | null
  stage_code_2:          string | null
  bank_name:             string | null
}

export function useUpdateFXConversion() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input: UpdateFXConversionInput): Promise<void> => {
    const { user } = useAuthStore.getState()
    const { orgId } = useOrgStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    if (!orgId) throw new Error('No active organisation.')
    setLoading(true); setError(null)
    try {
      const { data: oldData } = await supabase
        .from('fx_conversions').select('*').eq('id', input.id).single()
      const { data: result, error: rpcErr } = await supabase.rpc('update_fx_conversion', {
        p_conversion_id:        input.id,
        p_org_id:               orgId,
        p_user_id:              user.id,
        p_exchange_rate:        input.exchange_rate,
        p_naira_amount:         input.naira_amount,
        p_notes:                input.notes ?? null,
        p_allocation_config_id: input.allocation_config_id ?? null,
        p_stage_code_1:         input.stage_code_1 ?? null,
        p_stage_code_2:         input.stage_code_2 ?? null,
        p_bank_name:            input.bank_name ?? null,
      })
      if (rpcErr) throw rpcErr
      // Audit trail (fire-and-forget)
      const orgId2 = orgId
      supabase.from('audit_log').insert({
        user_id: user.id, action: 'UPDATE', table_name: 'fx_conversions',
        record_id: input.id, old_data: (oldData ?? null) as Record<string,unknown> | null,
        new_data: input as unknown as Record<string,unknown>, org_id: orgId2,
      }).then(({ error: e }) => { if (e) console.warn('[audit_log] fx_conversion update:', e.message) })
      void result
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err)
      setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}

export function useRevertFXConversion() {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (conversionId: string): Promise<void> => {
    const { user } = useAuthStore.getState()
    const { orgId } = useOrgStore.getState()
    if (!user?.id) throw new Error('You must be signed in.')
    if (!orgId) throw new Error('No active organisation.')
    setLoading(true); setError(null)
    try {
      const { data: oldData } = await supabase
        .from('fx_conversions').select('*').eq('id', conversionId).single()
      const { data: result, error: rpcErr } = await supabase.rpc('revert_fx_conversion', {
        p_conversion_id: conversionId,
        p_org_id:        orgId,
        p_user_id:       user.id,
      })
      if (rpcErr) throw rpcErr
      supabase.from('audit_log').insert({
        user_id: user.id, action: 'DELETE', table_name: 'fx_conversions',
        record_id: conversionId,
        old_data: (oldData ?? null) as Record<string,unknown> | null,
        new_data: { reverted_by: user.id, ...result as object },
        org_id: orgId,
      }).then(({ error: e }) => { if (e) console.warn('[audit_log] fx_conversion revert:', e.message) })
    } catch (err) {
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message ?? String(err)
      setError(msg); throw new Error(msg)
    } finally { setLoading(false) }
  }, [])

  return { mutate, loading, error, reset: useCallback(() => setError(null), []) }
}
