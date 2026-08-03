import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import type { AllocationConfig } from '../store/allocationStore'

function orgPayload(): { org_id: string } {
  const { orgId } = useOrgStore.getState()
  if (!orgId) throw new Error('No active organisation.')
  return { org_id: orgId }
}

export interface SpecialConfigGroupWithVersions {
  id:                        string
  name:                      string
  is_default:                boolean
  is_archived:               boolean
  created_at:                string
  versions:                  AllocationConfig[]
  active_version:            AllocationConfig | null
  linked_income_type_id:     string | null
  linked_income_type_name:   string | null
}

export function useSpecialConfigGroups() {
  const orgId = useOrgStore((s) => s.orgId)

  const [groups,         setGroups]         = useState<SpecialConfigGroupWithVersions[]>([])
  const [archivedGroups, setArchivedGroups] = useState<SpecialConfigGroupWithVersions[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true); setError(null)
    const { data: groupRows, error: gErr } = await supabase
      .from('special_config_groups')
      .select('id, name, is_default, is_archived, created_at')
      .eq('org_id', orgId)
      .eq('is_default', false)   // General rule group is managed separately
      .order('created_at', { ascending: false })
    if (gErr) { setError(gErr.message); setLoading(false); return }

    const { data: versions, error: vErr } = await supabase
      .from('allocation_configs')
      .select('*')
      .eq('org_id', orgId)
      .not('config_group_id', 'is', null)
      .order('effective_from', { ascending: false })
    if (vErr) { setError(vErr.message); setLoading(false); return }

    const { data: itRows } = await supabase
      .from('income_types')
      .select('id, name, special_config_group_id')
      .eq('org_id', orgId)
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
          (v.effective_to == null || v.effective_to >= today) &&
          v.superseded_by_id == null
      ) ?? null
      const it = itMap.get(g.id as string) ?? null
      return {
        id:                      g.id as string,
        name:                    g.name as string,
        is_default:              (g.is_default as boolean) ?? false,
        is_archived:             (g.is_archived as boolean) ?? false,
        created_at:              g.created_at as string,
        versions:                gVersions,
        active_version:          active,
        linked_income_type_id:   it?.id ?? null,
        linked_income_type_name: it?.name ?? null,
      }
    })
    setGroups(built.filter(g => !g.is_archived))
    setArchivedGroups(built.filter(g => g.is_archived))
    setLoading(false)
  }, [orgId])

  useEffect(() => { load() }, [load])

  return { groups, archivedGroups, loading, error, refetch: load }
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
}): Promise<{ groupId: string; config: AllocationConfig }> {
  const org = orgPayload()
  const { data: grp, error: gErr } = await supabase
    .from('special_config_groups')
    .insert({ name: params.name, ...org })
    .select('id')
    .single()
  if (gErr) throw new Error(gErr.message)
  const groupId = (grp as { id: string }).id

  const { data: configRow, error: vErr } = await supabase
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
      ...org,
    })
    .select('*')
    .single()
  // These two inserts are not one transaction. If the version insert fails or
  // times out, drop the group we just created — otherwise the Distribution
  // Rules tab fills up with empty groups every time the user retries.
  if (vErr) {
    await supabase.from('special_config_groups').delete().eq('id', groupId)
    throw new Error(vErr.message)
  }

  if (params.income_type_id) {
    await setGroupIncomeTypeLink(groupId, params.income_type_id, params.prev_income_type_id ?? null)
  }

  return { groupId, config: configRow as AllocationConfig }
}

export async function createNewVersion(params: {
  group:           SpecialConfigGroupWithVersions
  allocation_type: 'percentage' | 'amount'
  total_amount?:   number | null
  rows:            AllocationConfig['rows']
  effective_from:  string
  status:          'draft' | 'locked'
}): Promise<string> {
  const { orgId } = useOrgStore.getState()
  if (!orgId) throw new Error('No active organisation.')

  const { data, error } = await supabase.rpc('create_special_config_version', {
    p_group_id:        params.group.id,
    p_org_id:          orgId,
    p_name:            params.group.name,
    p_allocation_type: params.allocation_type,
    p_total_amount:    params.total_amount ?? null,
    p_rows:            params.rows,
    p_effective_from:  params.effective_from,
    p_status:          params.status,
  })
  if (error) throw new Error(error.message)
  return data as string
}

// ── General (default) rule group ───────────────────────────────────────────────

/**
 * Returns the org's General rule group — the fallback every income type without
 * a custom rule resolves through. Created by `complete_org_onboarding()`; this
 * creates it on demand for orgs provisioned before that migration so callers
 * never have to deal with a missing General group.
 */
export async function ensureGeneralGroup(): Promise<{ id: string; name: string }> {
  const org = orgPayload()
  const { data: existing, error: selErr } = await supabase
    .from('special_config_groups')
    .select('id, name')
    .eq('org_id', org.org_id)
    .eq('is_default', true)
    .maybeSingle()
  if (selErr) throw new Error(selErr.message)
  if (existing) return existing as { id: string; name: string }

  const { data: created, error: insErr } = await supabase
    .from('special_config_groups')
    .insert({ name: 'General', is_default: true, ...org })
    .select('id, name')
    .single()
  if (insErr) throw new Error(insErr.message)
  return created as { id: string; name: string }
}

/**
 * Creates a version of the General rule. Used by the onboarding wizard so the
 * rules it creates land inside the General group — configs written without a
 * `config_group_id` are invisible to both the Distribution Rules tab and
 * `buildVersionIndex()`, so they never apply to any transaction.
 */
export async function createGeneralVersion(params: {
  rows:           AllocationConfig['rows']
  effective_from: string
  status:         'draft' | 'locked'
  name?:          string
}): Promise<string> {
  const { orgId } = useOrgStore.getState()
  if (!orgId) throw new Error('No active organisation.')
  const group = await ensureGeneralGroup()

  const { data, error } = await supabase.rpc('create_special_config_version', {
    p_group_id:        group.id,
    p_org_id:          orgId,
    p_name:            params.name ?? group.name,
    p_allocation_type: 'percentage',
    p_total_amount:    null,
    p_rows:            params.rows,
    p_effective_from:  params.effective_from,
    p_status:          params.status,
  })
  if (error) throw new Error(error.message)
  return data as string
}

/**
 * Sets the org's live General rule — the onboarding wizard's "pick a split".
 *
 * Re-picking a template on the same day rewrites the version already starting
 * that day rather than inserting a second one, which the partial unique index
 * on (config_group_id, effective_from) WHERE status='locked' would reject. It
 * also means the first pick replaces the 100% → General rule seeded at signup
 * instead of stacking on top of it.
 */
export async function setGeneralRuleLive(params: {
  rows:           AllocationConfig['rows']
  effective_from: string
  name?:          string
}): Promise<string> {
  const group = await ensureGeneralGroup()

  const { data: sameDay, error: selErr } = await supabase
    .from('allocation_configs')
    .select('id')
    .eq('config_group_id', group.id)
    .eq('status', 'locked')
    .eq('effective_from', params.effective_from)
    .maybeSingle()
  if (selErr) throw new Error(selErr.message)

  if (sameDay) {
    const { error } = await supabase
      .from('allocation_configs')
      .update({
        name:            params.name ?? group.name,
        rows:            params.rows,
        allocation_type: 'percentage',
        total_amount:    null,
      })
      .eq('id', (sameDay as { id: string }).id)
    if (error) throw new Error(error.message)
    return (sameDay as { id: string }).id
  }

  return createGeneralVersion({ ...params, status: 'locked' })
}

/**
 * Approves a draft version so it starts applying to transactions.
 *
 * Goes through an RPC rather than a status UPDATE: promoting a draft has to
 * close the version it supersedes and bound its own range, or the group ends up
 * with two locked versions covering the same day.
 */
export async function lockVersion(versionId: string): Promise<void> {
  const { error } = await supabase.rpc('approve_config_version', { p_version_id: versionId })
  if (error) throw new Error(error.message)
}

// ── Date helpers ───────────────────────────────────────────────────────────────

function addOneDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function subtractOneDay(date: string): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ── Overlap detection ───────────────────────────────────────────────────────────

export interface VersionOverlap {
  version:          AllocationConfig
  overlapStart:     string
  overlapEnd:       string | null
  wouldSplit:       boolean
  splitBeforeEnd:   string | null
  splitAfterStart:  string | null
}

export function detectVersionOverlap(
  versions:      AllocationConfig[],
  newFrom:       string,
  newTo:         string | null,
  excludeId?:    string,
): VersionOverlap[] {
  const candidates = versions.filter(
    v => v.status === 'locked' && v.superseded_by_id == null && v.id !== excludeId,
  )
  const overlaps: VersionOverlap[] = []
  for (const v of candidates) {
    if (v.effective_from == null) continue
    const vFrom = v.effective_from
    const vTo   = v.effective_to ?? null
    // Check if ranges overlap
    const newEnd  = newTo ?? '9999-12-31'
    const existEnd = vTo ?? '9999-12-31'
    if (newFrom > existEnd || vFrom > newEnd) continue
    // Compute actual overlap
    const overlapStart = newFrom > vFrom ? newFrom : vFrom
    const overlapEnd   = newTo != null && vTo != null
      ? (newTo < vTo ? newTo : vTo)
      : (newTo ?? vTo)
    const wouldSplit = vFrom < newFrom && (vTo == null || vTo > (newTo ?? vTo!))
    overlaps.push({
      version:         v,
      overlapStart,
      overlapEnd,
      wouldSplit,
      splitBeforeEnd:  vFrom < newFrom ? subtractOneDay(newFrom) : null,
      splitAfterStart: newTo != null && (vTo == null || vTo > newTo) ? addOneDay(newTo) : null,
    })
  }
  return overlaps
}

// ── Amendment mutation ──────────────────────────────────────────────────────────

export async function amendVersion(params: {
  original:        AllocationConfig
  allocation_type: 'percentage' | 'amount'
  total_amount?:   number | null
  rows:            AllocationConfig['rows']
  effective_from:  string
  effective_to:    string | null
  amendment_reason: string
}): Promise<string> {
  const { orgId } = useOrgStore.getState()
  if (!orgId) throw new Error('No active organisation.')

  // Insert new version as amendment
  const { data: newRow, error: insertErr } = await supabase
    .from('allocation_configs')
    .insert({
      org_id:           orgId,
      config_group_id:  params.original.config_group_id,
      name:             params.original.name,
      is_special:       params.original.is_special ?? true,
      allocation_type:  params.allocation_type,
      total_amount:     params.total_amount ?? null,
      rows:             params.rows,
      effective_from:   params.effective_from,
      effective_to:     params.effective_to,
      version_number:   (params.original.version_number ?? 1) + 1,
      start_date:       params.effective_from,
      status:           'locked',
      change_type:      'amendment',
      source_version_id: params.original.id,
      amendment_reason: params.amendment_reason,
    })
    .select('id')
    .single()
  if (insertErr) throw new Error(insertErr.message)
  const newId = (newRow as { id: string }).id

  // Mark original as superseded
  const { error: supErr } = await supabase
    .from('allocation_configs')
    .update({ superseded_by_id: newId, superseded_at: new Date().toISOString() })
    .eq('id', params.original.id)
  if (supErr) throw new Error(supErr.message)

  return newId
}

// ── Create version with optional date-split ────────────────────────────────────

export async function createVersionWithSplit(params: {
  group:           SpecialConfigGroupWithVersions
  allocation_type: 'percentage' | 'amount'
  total_amount?:   number | null
  rows:            AllocationConfig['rows']
  effective_from:  string
  effective_to:    string | null
  status:          'draft' | 'locked'
  overlaps:        VersionOverlap[]
}): Promise<string> {
  const { orgId } = useOrgStore.getState()
  if (!orgId) throw new Error('No active organisation.')

  // For each overlapping version, cap/split it first
  for (const ov of params.overlaps) {
    const v = ov.version
    if (ov.wouldSplit && ov.splitBeforeEnd && ov.splitAfterStart) {
      // Cap the existing version at splitBeforeEnd
      const { error: capErr } = await supabase
        .from('allocation_configs')
        .update({ effective_to: ov.splitBeforeEnd })
        .eq('id', v.id)
      if (capErr) throw new Error(capErr.message)

      // Create the after-split fragment
      const { error: splitErr } = await supabase
        .from('allocation_configs')
        .insert({
          org_id:           orgId,
          config_group_id:  v.config_group_id,
          name:             v.name,
          is_special:       v.is_special ?? true,
          allocation_type:  v.allocation_type,
          total_amount:     v.total_amount ?? null,
          rows:             v.rows,
          effective_from:   ov.splitAfterStart,
          effective_to:     v.effective_to,
          version_number:   (v.version_number ?? 1),
          start_date:       ov.splitAfterStart,
          status:           'locked',
          change_type:      'date_split',
          source_version_id: v.id,
        })
      if (splitErr) throw new Error(splitErr.message)
    } else if (!ov.wouldSplit) {
      // Trim the existing version to end before the new one starts
      const { error: trimErr } = await supabase
        .from('allocation_configs')
        .update({ effective_to: subtractOneDay(params.effective_from) })
        .eq('id', v.id)
      if (trimErr) throw new Error(trimErr.message)
    }
  }

  // Now create the new version
  const { data, error } = await supabase.rpc('create_special_config_version', {
    p_group_id:        params.group.id,
    p_org_id:          orgId,
    p_name:            params.group.name,
    p_allocation_type: params.allocation_type,
    p_total_amount:    params.total_amount ?? null,
    p_rows:            params.rows,
    p_effective_from:  params.effective_from,
    p_status:          params.status,
  })
  if (error) throw new Error(error.message)
  const newId = data as string

  // Set effective_to and change_type
  const { error: updateErr } = await supabase
    .from('allocation_configs')
    .update({ effective_to: params.effective_to, change_type: 'new_version' })
    .eq('id', newId)
  if (updateErr) throw new Error(updateErr.message)

  return newId
}

export async function archiveGroup(groupId: string): Promise<void> {
  const { error } = await supabase
    .from('special_config_groups')
    .update({ is_archived: true })
    .eq('id', groupId)
  if (error) throw new Error(error.message)
}

export async function restoreGroup(groupId: string): Promise<void> {
  const { error } = await supabase
    .from('special_config_groups')
    .update({ is_archived: false })
    .eq('id', groupId)
  if (error) throw new Error(error.message)
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


