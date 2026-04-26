import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IncomeTypeRule {
  id:             string
  income_type_id: string
  rule_type:      'keyword' | 'stage_code'
  rule_value:     string
}

export interface IncomeType {
  id:                  string
  name:                string
  description:         string | null
  color:               string
  special_config_id:   string | null
  special_config_name: string | null  // joined from allocation_configs
  rules:               IncomeTypeRule[]
  created_at:          string
}

// ── useIncomeTypes ─────────────────────────────────────────────────────────────

export function useIncomeTypes() {
  const [incomeTypes, setIncomeTypes] = useState<IncomeType[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('income_types')
      .select(`
        id, name, description, color, special_config_id, created_at,
        allocation_configs ( name ),
        income_type_rules ( id, income_type_id, rule_type, rule_value )
      `)
      .order('name')
    if (err) {
      setError(err.message)
    } else {
      const mapped = (data ?? []).map((r: Record<string, unknown>) => {
        const cfg = r.allocation_configs as { name: string } | null
        return {
          id:                  r.id,
          name:                r.name,
          description:         r.description ?? null,
          color:               r.color,
          special_config_id:   r.special_config_id ?? null,
          special_config_name: cfg?.name ?? null,
          rules:               (r.income_type_rules as IncomeTypeRule[]) ?? [],
          created_at:          r.created_at,
        } as IncomeType
      })
      setIncomeTypes(mapped)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { incomeTypes, loading, error, refetch: fetch }
}

// ── useSpecialConfigOptions ────────────────────────────────────────────────────
// Lightweight fetch of special configs for the dropdown in AddIncomeTypeModal.

export interface SpecialConfigOption {
  id:   string
  name: string
}

export function useSpecialConfigOptions() {
  const [options,  setOptions]  = useState<SpecialConfigOption[]>([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    supabase
      .from('allocation_configs')
      .select('id, name')
      .eq('is_special', true)
      .order('name')
      .then(({ data }) => {
        setOptions((data ?? []) as SpecialConfigOption[])
        setLoading(false)
      })
  }, [])

  return { options, loading }
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export interface IncomeTypeInput {
  name:             string
  description?:     string
  color:            string
  special_config_id?: string | null
  rules:            { rule_type: 'keyword' | 'stage_code'; rule_value: string }[]
}

export async function saveIncomeType(input: IncomeTypeInput, existingId?: string): Promise<string> {
  let id = existingId ?? ''

  if (existingId) {
    const { error } = await supabase
      .from('income_types')
      .update({
        name:             input.name,
        description:      input.description || null,
        color:            input.color,
        special_config_id: input.special_config_id || null,
      })
      .eq('id', existingId)
    if (error) throw new Error(error.message)
    // Delete old rules then re-insert
    await supabase.from('income_type_rules').delete().eq('income_type_id', existingId)
  } else {
    const { data, error } = await supabase
      .from('income_types')
      .insert({
        name:             input.name,
        description:      input.description || null,
        color:            input.color,
        special_config_id: input.special_config_id || null,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    id = (data as { id: string }).id
  }

  if (input.rules.length > 0) {
    const { error } = await supabase.from('income_type_rules').insert(
      input.rules
        .filter(r => r.rule_value.trim())
        .map(r => ({ income_type_id: id, rule_type: r.rule_type, rule_value: r.rule_value.trim() }))
    )
    if (error) throw new Error(error.message)
  }

  return id
}

export async function deleteIncomeType(id: string): Promise<void> {
  const { error } = await supabase.from('income_types').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
