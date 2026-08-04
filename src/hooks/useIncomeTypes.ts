import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface IncomeTypeRule {
  id:             string
  income_type_id: string
  rule_type:      'keyword' | 'stage_code' | 'bank'
  rule_value:     string
}

export interface IncomeType {
  id:                       string
  name:                     string
  description:              string | null
  color:                    string
  is_system:                boolean
  special_config_id:        string | null
  special_config_name:      string | null  // joined from allocation_configs
  special_config_group_id:  string | null
  special_config_group_name: string | null
  rules:                    IncomeTypeRule[]
  created_at:               string
}

// ── useIncomeTypes ─────────────────────────────────────────────────────────────

export function useIncomeTypes() {
  const orgId = useOrgStore((s) => s.orgId)

  const [incomeTypes, setIncomeTypes] = useState<IncomeType[]>([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState<string | null>(null)

  const fetch = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('income_types')
      .select(`
        id, name, description, color, is_system, special_config_id, special_config_group_id, created_at,
        allocation_configs ( name ),
        special_config_groups ( name ),
        income_type_rules ( id, income_type_id, rule_type, rule_value )
      `)
      .eq('org_id', orgId)
      .order('name')
    if (err) {
      setError(err.message)
    } else {
      const mapped = (data ?? []).map((r: Record<string, unknown>) => {
        const cfg = r.allocation_configs as { name: string } | null
        const grp = r.special_config_groups as { name: string } | null
        return {
          id:                       r.id,
          name:                     r.name,
          description:              r.description ?? null,
          color:                    r.color,
          is_system:                (r.is_system as boolean) ?? false,
          special_config_id:        r.special_config_id ?? null,
          special_config_name:      cfg?.name ?? null,
          special_config_group_id:  r.special_config_group_id ?? null,
          special_config_group_name: grp?.name ?? null,
          rules:                    (r.income_type_rules as IncomeTypeRule[]) ?? [],
          created_at:               r.created_at,
        } as IncomeType
      })
      setIncomeTypes(mapped)
    }
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetch() }, [fetch])

  return { incomeTypes, loading, error, refetch: fetch }
}

// ── useIncomeTypeOptions ───────────────────────────────────────────────────────
// Lightweight fetch used by CreateSpecialConfigModal to show / guard link selection.

export interface IncomeTypeOption {
  id:               string
  name:             string
  color:            string
  special_config_id: string | null
}

export function useIncomeTypeOptions() {
  const orgId = useOrgStore((s) => s.orgId)

  const [options,  setOptions]  = useState<IncomeTypeOption[]>([])
  const [loading,  setLoading]  = useState(true)

  const reload = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    supabase
      .from('income_types')
      .select('id, name, color, special_config_id')
      .eq('org_id', orgId)
      .order('name')
      .then(({ data }) => {
        setOptions((data ?? []) as IncomeTypeOption[])
        setLoading(false)
      })
  }, [orgId])

  useEffect(() => { reload() }, [reload])

  return { options, loading, reload }
}

// ── setIncomeTypeConfigLink ────────────────────────────────────────────────────
// Atomically clears the old link (if any) then sets the new one.
// Pass null as incomeTypeId to only clear.

export async function setIncomeTypeConfigLink(
  configId:     string,
  incomeTypeId: string | null,
  prevIncomeTypeId: string | null,
): Promise<void> {
  // Clear previous link
  if (prevIncomeTypeId && prevIncomeTypeId !== incomeTypeId) {
    const { error } = await supabase
      .from('income_types')
      .update({ special_config_id: null })
      .eq('id', prevIncomeTypeId)
    if (error) throw new Error(error.message)
  }
  // Set new link
  if (incomeTypeId) {
    const { error } = await supabase
      .from('income_types')
      .update({ special_config_id: configId })
      .eq('id', incomeTypeId)
    if (error) throw new Error(error.message)
  }
}

// ── useSpecialConfigOptions ────────────────────────────────────────────────────
// Lightweight fetch of special configs for the dropdown in AddIncomeTypeModal.

export interface SpecialConfigOption {
  id:   string
  name: string
}

export function useSpecialConfigOptions() {
  const orgId = useOrgStore((s) => s.orgId)

  const [options,  setOptions]  = useState<SpecialConfigOption[]>([])
  const [loading,  setLoading]  = useState(true)

  const reload = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    supabase
      .from('allocation_configs')
      .select('id, name')
      .eq('org_id', orgId)
      .eq('is_special', true)
      .order('name')
      .then(({ data }) => {
        setOptions((data ?? []) as SpecialConfigOption[])
        setLoading(false)
      })
  }, [orgId])

  useEffect(() => { reload() }, [reload])

  return { options, loading, reload }
}

// ── useSpecialConfigGroupOptions ───────────────────────────────────────────────

export interface SpecialConfigGroupOption {
  id:   string
  name: string
}

export function useSpecialConfigGroupOptions() {
  const orgId = useOrgStore((s) => s.orgId)

  const [options,  setOptions]  = useState<SpecialConfigGroupOption[]>([])
  const [loading,  setLoading]  = useState(true)

  const reload = useCallback(() => {
    if (!orgId) { setLoading(false); return }
    supabase
      .from('special_config_groups')
      .select('id, name')
      .eq('org_id', orgId)
      .order('name')
      .then(({ data }) => {
        setOptions((data ?? []) as SpecialConfigGroupOption[])
        setLoading(false)
      })
  }, [orgId])

  useEffect(() => { reload() }, [reload])

  return { options, loading, reload }
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export interface IncomeTypeInput {
  name:                    string
  description?:            string
  color:                   string
  special_config_id?:      string | null
  special_config_group_id?: string | null
  rules:                   { rule_type: 'keyword' | 'stage_code' | 'bank'; rule_value: string }[]
}

export async function saveIncomeType(input: IncomeTypeInput, existingId?: string): Promise<string> {
  const { orgId } = useOrgStore.getState()
  if (!orgId) throw new Error('No active organisation.')
  let id = existingId ?? ''

  if (existingId) {
    const { error } = await supabase
      .from('income_types')
      .update({
        name:             input.name,
        description:      input.description || null,
        color:            input.color,
        special_config_id: input.special_config_id || null,
        ...(input.special_config_group_id !== undefined ? { special_config_group_id: input.special_config_group_id || null } : {}),
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
        ...(input.special_config_group_id !== undefined ? { special_config_group_id: input.special_config_group_id || null } : {}),
        org_id: orgId!,
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
        .map(r => ({ income_type_id: id, rule_type: r.rule_type, rule_value: r.rule_value.trim(), org_id: orgId }))
    )
    if (error) throw new Error(error.message)
  }

  return id
}

export async function deleteIncomeType(id: string): Promise<void> {
  const { error } = await supabase.from('income_types').delete().eq('id', id)
  if (error) throw new Error(error.message)
}
