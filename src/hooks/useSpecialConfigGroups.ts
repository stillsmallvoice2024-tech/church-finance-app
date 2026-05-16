import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { AllocationConfig } from '../store/allocationStore'

export interface SpecialConfigGroupWithVersions {
  id:                        string
  name:                      string
  created_at:                string
  versions:                  AllocationConfig[]
  active_version:            AllocationConfig | null
  linked_income_type_id:     string | null
  linked_income_type_name:   string | null
}

export function useSpecialConfigGroups() {
  const [groups,  setGroups]  = useState<SpecialConfigGroupWithVersions[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    const { data: groupRows, error: gErr } = await supabase
      .from('special_config_groups')
      .select('id, name, created_at')
      .order('created_at', { ascending: false })
    if (gErr) { setError(gErr.message); setLoading(false); return }

    const { data: versions, error: vErr } = await supabase
      .from('allocation_configs')
      .select('*')
      .not('config_group_id', 'is', null)
      .order('effective_from', { ascending: false })
    if (vErr) { setError(vErr.message); setLoading(false); return }

    const { data: itRows } = await supabase
      .from('income_types')
      .select('id, name, special_config_group_id')
      .not('special_config_group_id', 'is', null)

    const itMap = new Map<string, { id: string; name: string }>()
    ;(itRows ?? []).forEach((r: Record<string, unknown>) => {
      itMap.set(r.special_config_group_id as string, { id: r.id as string, name: r.name as string })
    })

    const today = new Date().toISOString().slice(0, 10)
    const built: SpecialConfigGroupWithVersions[] = (groupRows ?? []).map((g: Record<string, unknown>) => {
      const gVersions = (versions ?? [] as AllocationConfig[]).filter(
        (v: AllocationConfig) => v.config_group_id === g.id
      )
      const active = gVersions.find(
        (v: AllocationConfig) =>
          v.status === 'locked' &&
          v.effective_from != null &&
          v.effective_from <= today &&
          (v.effective_to == null || v.effective_to >= today)
      ) ?? null
      const it = itMap.get(g.id as string) ?? null
      return {
        id:                      g.id as string,
        name:                    g.name as string,
        created_at:              g.created_at as string,
        versions:                gVersions,
        active_version:          active,
        linked_income_type_id:   it?.id ?? null,
        linked_income_type_name: it?.name ?? null,
      }
    })
    setGroups(built)
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  return { groups, loading, error, refetch: load }
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export async function createGroupWithFirstVersion(params: {
  name:            string
  allocation_type: 'percentage' | 'amount'
  total_amount?:   number | null
  rows:            AllocationConfig['rows']
  effective_from:  string
  status:          'draft' | 'locked'
  income_type_id?: string | null
  prev_income_type_id?: string | null
}): Promise<string> {
  const { data: grp, error: gErr } = await supabase
    .from('special_config_groups')
    .insert({ name: params.name })
    .select('id')
    .single()
  if (gErr) throw new Error(gErr.message)
  const groupId = (grp as { id: string }).id

  const { error: vErr } = await supabase
    .from('allocation_configs')
    .insert({
      name:            params.name,
      is_special:      true,
      allocation_type: params.allocation_type,
      total_amount:    params.total_amount ?? null,
      rows:            params.rows,
      effective_from:  params.effective_from,
      effective_to:    null,
      version_number:  1,
      config_group_id: groupId,
      start_date:      params.effective_from,
      status:          params.status,
    })
  if (vErr) throw new Error(vErr.message)

  if (params.income_type_id) {
    await setGroupIncomeTypeLink(groupId, params.income_type_id, params.prev_income_type_id ?? null)
  }

  return groupId
}

export async function createNewVersion(params: {
  group:           SpecialConfigGroupWithVersions
  allocation_type: 'percentage' | 'amount'
  total_amount?:   number | null
  rows:            AllocationConfig['rows']
  effective_from:  string
  status:          'draft' | 'locked'
}): Promise<string> {
  const { group, effective_from } = params

  const covering = group.versions.find(v =>
    v.effective_from != null &&
    v.effective_from <= effective_from &&
    (v.effective_to == null || v.effective_to >= effective_from)
  )

  const sorted = group.versions
    .filter(v => v.effective_from != null && v.effective_from > effective_from)
    .sort((a, b) => a.effective_from!.localeCompare(b.effective_from!))
  const nextVersion = sorted.length > 0 ? sorted[0] : null

  const newEffectiveTo = nextVersion
    ? subtractOneDay(nextVersion.effective_from!)
    : null

  if (covering) {
    const newCoveringTo = subtractOneDay(effective_from)
    const { error: closeErr } = await supabase
      .from('allocation_configs')
      .update({ effective_to: newCoveringTo })
      .eq('id', covering.id)
    if (closeErr) throw new Error(closeErr.message)
  }

  const maxVer = group.versions.reduce((m, v) => Math.max(m, v.version_number ?? 1), 0)

  const { data: newVer, error: vErr } = await supabase
    .from('allocation_configs')
    .insert({
      name:            group.name,
      is_special:      true,
      allocation_type: params.allocation_type,
      total_amount:    params.total_amount ?? null,
      rows:            params.rows,
      effective_from:  effective_from,
      effective_to:    newEffectiveTo,
      version_number:  maxVer + 1,
      config_group_id: group.id,
      start_date:      effective_from,
      status:          params.status,
    })
    .select('id')
    .single()
  if (vErr) throw new Error(vErr.message)

  return (newVer as { id: string }).id
}

export async function setGroupIncomeTypeLink(
  groupId:          string,
  incomeTypeId:     string | null,
  prevIncomeTypeId: string | null,
): Promise<void> {
  if (prevIncomeTypeId && prevIncomeTypeId !== incomeTypeId) {
    const { error } = await supabase
      .from('income_types')
      .update({ special_config_group_id: null })
      .eq('id', prevIncomeTypeId)
    if (error) throw new Error(error.message)
  }
  if (incomeTypeId) {
    const { error } = await supabase
      .from('income_types')
      .update({ special_config_group_id: groupId })
      .eq('id', incomeTypeId)
    if (error) throw new Error(error.message)
  }
}

export async function getImpactedTransactionCount(
  groupId:      string,
  effectiveFrom: string,
  effectiveTo:   string | null,
): Promise<number> {
  const { data: itRows } = await supabase
    .from('income_types')
    .select('id')
    .eq('special_config_group_id', groupId)
  const itIds = (itRows ?? []).map((r: Record<string, unknown>) => r.id as string)
  if (itIds.length === 0) return 0

  let q = supabase
    .from('inflow_transactions')
    .select('id', { count: 'exact', head: true })
    .in('income_type_id', itIds)
    .gte('date', effectiveFrom)
  if (effectiveTo) q = q.lte('date', effectiveTo)

  const { count } = await q
  return count ?? 0
}

export async function recalculateTransactions(params: {
  groupId:       string
  newVersionId:  string
  effectiveFrom: string
  effectiveTo:   string | null
  rows:          AllocationConfig['rows']
  allocationType: 'percentage' | 'amount'
  reason:        string
  userId:        string
}): Promise<number> {
  const { groupId, newVersionId, effectiveFrom, effectiveTo, reason, userId } = params

  const { data: itRows } = await supabase
    .from('income_types')
    .select('id')
    .eq('special_config_group_id', groupId)
  const itIds = (itRows ?? []).map((r: Record<string, unknown>) => r.id as string)
  if (itIds.length === 0) return 0

  let q = supabase
    .from('inflow_transactions')
    .select('id')
    .in('income_type_id', itIds)
    .gte('date', effectiveFrom)
  if (effectiveTo) q = q.lte('date', effectiveTo)
  const { data: txns } = await q
  const ids = (txns ?? []).map((r: Record<string, unknown>) => r.id as string)
  if (ids.length === 0) return 0

  const { error: upErr } = await supabase
    .from('inflow_transactions')
    .update({ allocation_config_id: newVersionId })
    .in('id', ids)
  if (upErr) throw new Error(upErr.message)

  const snapshots = ids.map(txId => ({
    transaction_id:    txId,
    config_version_id: newVersionId,
    config_group_id:   groupId,
    resolved_rows:     params.rows,
    allocation_type:   params.allocationType,
    is_recalculated:   true,
    recalculated_at:   new Date().toISOString(),
  }))
  for (let i = 0; i < snapshots.length; i += 100) {
    const { error: snapErr } = await supabase
      .from('transaction_allocation_snapshots')
      .upsert(snapshots.slice(i, i + 100), { onConflict: 'transaction_id' })
    if (snapErr) throw new Error(snapErr.message)
  }

  await supabase.from('recalculation_logs').insert({
    config_group_id:   groupId,
    config_version_id: newVersionId,
    performed_by:      userId,
    affected_count:    ids.length,
    reason,
    action_summary:    `Recalculated ${ids.length} transaction(s) for version effective ${effectiveFrom}`,
  })

  return ids.length
}

// ── Snapshot ───────────────────────────────────────────────────────────────────

export async function createTransactionSnapshot(
  transactionId:  string,
  configVersionId: string,
  groupId:         string,
  rows:            AllocationConfig['rows'],
  allocationType:  string,
): Promise<void> {
  await supabase
    .from('transaction_allocation_snapshots')
    .upsert({
      transaction_id:    transactionId,
      config_version_id: configVersionId,
      config_group_id:   groupId,
      resolved_rows:     rows,
      allocation_type:   allocationType,
      is_recalculated:   false,
    }, { onConflict: 'transaction_id' })
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function subtractOneDay(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}
