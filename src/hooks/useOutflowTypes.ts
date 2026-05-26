import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface OutflowType {
  id:               string
  name:             string
  color:            string
  created_at:       string
  is_system:        boolean
  is_locked:        boolean
  auto_created:     boolean
  manually_renamed: boolean
}

export interface OutflowTypeInput {
  name:  string
  color: string
}

export interface CategoryOutflowTypeMap {
  id:              string
  category_id:     string
  outflow_type_id: string
  created_at:      string
}

const OT_SELECT = 'id, name, color, created_at, is_system, is_locked, auto_created, manually_renamed'

// ── useOutflowTypes ────────────────────────────────────────────────────────────

export function useOutflowTypes() {
  const [outflowTypes, setOutflowTypes] = useState<OutflowType[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true); setError(null)
    const { data, error: err } = await supabase
      .from('outflow_types')
      .select(OT_SELECT)
      .order('name')
    if (err) {
      if (/relation.*does not exist/i.test(err.message)) {
        setOutflowTypes([])
      } else {
        setError(err.message)
      }
    } else {
      setOutflowTypes((data ?? []) as OutflowType[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { outflowTypes, loading, error, refetch: fetch }
}

// ── Lightweight option list ────────────────────────────────────────────────────

export function useOutflowTypeOptions() {
  const [options,  setOptions]  = useState<OutflowType[]>([])
  const [loading,  setLoading]  = useState(true)

  const reload = useCallback(() => {
    supabase
      .from('outflow_types')
      .select(OT_SELECT)
      .order('name')
      .then(({ data }) => {
        setOptions((data ?? []) as OutflowType[])
        setLoading(false)
      })
  }, [])

  useEffect(() => { reload() }, [reload])

  return { options, loading, reload }
}

// ── useCategoryOutflowTypeMaps ─────────────────────────────────────────────────

export function useCategoryOutflowTypeMaps() {
  const [maps,    setMaps]    = useState<CategoryOutflowTypeMap[]>([])
  const [loading, setLoading] = useState(true)

  const fetch = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('category_outflow_type_map')
      .select('id, category_id, outflow_type_id, created_at')
    setMaps((data ?? []) as CategoryOutflowTypeMap[])
    setLoading(false)
  }, [])

  useEffect(() => { fetch() }, [fetch])

  return { maps, loading, refetch: fetch }
}

// ── Pure helper: get default outflow type for a category ───────────────────────

export function getDefaultOutflowTypeForCategory(
  categoryId: string,
  maps: CategoryOutflowTypeMap[],
  outflowTypes: OutflowType[]
): OutflowType | null {
  const mapped = maps.filter(m => m.category_id === categoryId)
  if (mapped.length === 0) return null
  return outflowTypes.find(t => t.id === mapped[0].outflow_type_id) ?? null
}

// ── Pure helper: get all outflow type ids mapped to a category ─────────────────

export function getMappedOutflowTypeIds(
  categoryId: string,
  maps: CategoryOutflowTypeMap[]
): string[] {
  return maps.filter(m => m.category_id === categoryId).map(m => m.outflow_type_id)
}

// ── Mutations ──────────────────────────────────────────────────────────────────

export async function saveOutflowType(
  input: OutflowTypeInput,
  existingId?: string,
  markManuallyRenamed?: boolean
): Promise<string> {
  if (existingId) {
    const updates: Record<string, unknown> = { name: input.name, color: input.color }
    if (markManuallyRenamed) updates.manually_renamed = true
    const { error } = await supabase
      .from('outflow_types')
      .update(updates)
      .eq('id', existingId)
    if (error) throw new Error(error.message)
    return existingId
  } else {
    const { data, error } = await supabase
      .from('outflow_types')
      .insert({ name: input.name, color: input.color })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return (data as { id: string }).id
  }
}

export async function deleteOutflowType(id: string): Promise<void> {
  const { data: ot } = await supabase
    .from('outflow_types')
    .select('is_locked')
    .eq('id', id)
    .single()
  if ((ot as { is_locked: boolean } | null)?.is_locked) {
    throw new Error('This outflow type is locked and cannot be deleted.')
  }
  const { error } = await supabase.from('outflow_types').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Category-OutflowType map mutations ─────────────────────────────────────────

export async function linkOutflowTypeToCategory(
  categoryId: string,
  outflowTypeId: string
): Promise<void> {
  const { error } = await supabase
    .from('category_outflow_type_map')
    .insert({ category_id: categoryId, outflow_type_id: outflowTypeId })
  if (error && !/duplicate key|unique/i.test(error.message)) throw new Error(error.message)
}

export async function unlinkOutflowTypeFromCategory(
  categoryId: string,
  outflowTypeId: string
): Promise<void> {
  await supabase
    .from('category_outflow_type_map')
    .delete()
    .eq('category_id', categoryId)
    .eq('outflow_type_id', outflowTypeId)
}

// ── Auto-create linked outflow type for a new category ─────────────────────────

export async function autoCreateLinkedOutflowType(
  categoryId: string,
  categoryName: string
): Promise<string | null> {
  try {
    // Check if an outflow type with this exact name already exists
    const { data: existing } = await supabase
      .from('outflow_types')
      .select('id')
      .ilike('name', categoryName)
      .limit(1)

    let outflowTypeId: string

    if (existing && existing.length > 0) {
      outflowTypeId = (existing[0] as { id: string }).id
    } else {
      const { data, error } = await supabase
        .from('outflow_types')
        .insert({ name: categoryName, color: '#64748b', auto_created: true })
        .select('id')
        .single()
      if (error) throw error
      outflowTypeId = (data as { id: string }).id
    }

    await linkOutflowTypeToCategory(categoryId, outflowTypeId)
    return outflowTypeId
  } catch (err) {
    console.warn('[autoCreateLinkedOutflowType] failed:', err)
    return null
  }
}

// ── Sync outflow type name when a category is renamed ─────────────────────────

export async function syncLinkedOutflowTypeName(
  categoryId: string,
  newName: string,
  oldName: string
): Promise<void> {
  try {
    if (newName === oldName) return
    const { data: maps } = await supabase
      .from('category_outflow_type_map')
      .select('outflow_type_id')
      .eq('category_id', categoryId)
    if (!maps || maps.length === 0) return

    const typeIds = (maps as { outflow_type_id: string }[]).map(m => m.outflow_type_id)
    const { data: types } = await supabase
      .from('outflow_types')
      .select('id, name, auto_created, manually_renamed')
      .in('id', typeIds)
    if (!types) return

    for (const t of types as { id: string; name: string; auto_created: boolean; manually_renamed: boolean }[]) {
      if (t.auto_created && !t.manually_renamed && t.name.toLowerCase() === oldName.toLowerCase()) {
        await supabase.from('outflow_types').update({ name: newName }).eq('id', t.id)
      }
    }
  } catch (err) {
    console.warn('[syncLinkedOutflowTypeName] failed:', err)
  }
}

// ── Clean up outflow types when a category is deleted ─────────────────────────

export async function handleCategoryDeleteCleanup(categoryId: string): Promise<void> {
  try {
    const { data: maps } = await supabase
      .from('category_outflow_type_map')
      .select('outflow_type_id')
      .eq('category_id', categoryId)
    if (!maps || maps.length === 0) return

    const typeIds = (maps as { outflow_type_id: string }[]).map(m => m.outflow_type_id)
    const { data: types } = await supabase
      .from('outflow_types')
      .select('id, auto_created, is_locked')
      .in('id', typeIds)
    if (!types) return

    for (const t of types as { id: string; auto_created: boolean; is_locked: boolean }[]) {
      if (t.is_locked || !t.auto_created) continue

      const { count } = await supabase
        .from('outflow_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('outflow_type_id', t.id)

      // Only delete the outflow type if it has no transactions
      // (the mapping will be cascade-deleted when category is deleted)
      if ((count ?? 0) === 0) {
        await supabase.from('outflow_types').delete().eq('id', t.id)
      }
    }
  } catch (err) {
    console.warn('[handleCategoryDeleteCleanup] failed:', err)
  }
}

// ── Sync mapping on outflow type save (link/unlink categories) ─────────────────

export async function syncOutflowTypeCategoryMappings(
  outflowTypeId: string,
  newCategoryIds: string[]
): Promise<void> {
  const { data: existing } = await supabase
    .from('category_outflow_type_map')
    .select('id, category_id')
    .eq('outflow_type_id', outflowTypeId)

  const existingIds = (existing ?? []).map((r: { category_id: string }) => r.category_id)
  const toAdd    = newCategoryIds.filter(id => !existingIds.includes(id))
  const toRemove = existingIds.filter(id => !newCategoryIds.includes(id))

  if (toRemove.length > 0) {
    await supabase
      .from('category_outflow_type_map')
      .delete()
      .eq('outflow_type_id', outflowTypeId)
      .in('category_id', toRemove)
  }
  for (const catId of toAdd) {
    await linkOutflowTypeToCategory(catId, outflowTypeId)
  }
}

// ── Fetch mappings for a single outflow type ───────────────────────────────────

export async function fetchOutflowTypeMappings(outflowTypeId: string): Promise<string[]> {
  const { data } = await supabase
    .from('category_outflow_type_map')
    .select('category_id')
    .eq('outflow_type_id', outflowTypeId)
  return (data ?? []).map((r: { category_id: string }) => r.category_id)
}
