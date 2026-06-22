import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { useOrgStore } from './orgStore'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AllocationRow {
  category_name:  string
  budget_portion?: string  // 'Percentage' | 'Specific Seed' | 'Savings'
  percentage?:    number
  amount?:        number
}

export interface AllocationConfig {
  id:               string
  name:             string
  start_date:       string
  status:           'draft' | 'locked'
  is_special?:      boolean
  allocation_type?: 'percentage' | 'amount'
  total_amount?:    number
  rows:             AllocationRow[]
  created_at:       string
  config_group_id?:  string | null
  effective_from?:   string | null
  effective_to?:     string | null
  version_number?:   number
  superseded_by_id?: string | null
  superseded_at?:    string | null
  change_type?:      'initial' | 'new_version' | 'date_split' | 'amendment' | null
  source_version_id?: string | null
  amendment_reason?:  string | null
}

export interface SpecialConfigGroup {
  id:         string
  name:       string
  is_default: boolean
  created_at: string
}

// ── Resolution helpers ────────────────────────────────────────────────────────

/**
 * Builds an in-memory resolution index for batch processing many transactions.
 * Call once per report/ledger load, then call resolve() for each transaction.
 *
 * O(k log k) to build, O(log k) per resolve — k = total locked versions.
 */
export function buildVersionIndex(
  configs: AllocationConfig[],
  groups:  SpecialConfigGroup[],
): {
  generalGroupId: string | null
  resolve: (groupId: string | null, date: string) => AllocationConfig | null
} {
  const generalGroupId = groups.find(g => g.is_default)?.id ?? null

  // Group locked versions by config_group_id, sorted by effective_from ASC
  const byGroup = new Map<string, AllocationConfig[]>()
  for (const c of configs) {
    if (!c.config_group_id || c.status !== 'locked' || c.effective_from == null) continue
    if (c.superseded_by_id != null) continue
    const arr = byGroup.get(c.config_group_id) ?? []
    arr.push(c)
    byGroup.set(c.config_group_id, arr)
  }
  for (const arr of byGroup.values()) {
    arr.sort((a, b) => a.effective_from!.localeCompare(b.effective_from!))
  }

  return {
    generalGroupId,
    resolve(groupId: string | null, date: string): AllocationConfig | null {
      const target = groupId ?? generalGroupId
      if (!target) return null
      const versions = byGroup.get(target) ?? []
      let result: AllocationConfig | null = null
      for (const v of versions) {
        if (v.effective_from! <= date && (v.effective_to == null || v.effective_to >= date)) {
          result = v
        }
      }
      return result
    },
  }
}

// ── Store ──────────────────────────────────────────────────────────────────────

interface AllocationState {
  configs:  AllocationConfig[]
  groups:   SpecialConfigGroup[]
  loading:  boolean
  error:    string | null
  loaded:   boolean
  fetch:    () => Promise<void>
  /** Force a fresh fetch even if already loaded. */
  reload:   () => Promise<void>
  /** Clear cached data — call on org switch or logout. */
  reset:    () => void
  /** Resolves which config applies to a group+date (builds index per call). */
  resolve:  (groupId: string | null, date: string) => AllocationConfig | null
}

export const useAllocationStore = create<AllocationState>((set, get) => ({
  configs: [],
  groups:  [],
  loading: false,
  error:   null,
  loaded:  false,

  fetch: async () => {
    const orgId = useOrgStore.getState().orgId
    if (!orgId || get().loading) return
    set({ loading: true, error: null })

    const [configsRes, groupsRes] = await Promise.all([
      supabase
        .from('allocation_configs')
        .select('*')
        .eq('org_id', orgId)
        .order('effective_from', { ascending: true }),
      supabase
        .from('special_config_groups')
        .select('id, name, is_default, created_at')
        .eq('org_id', orgId),
    ])

    if (configsRes.error || groupsRes.error) {
      set({ error: (configsRes.error ?? groupsRes.error)!.message, loading: false })
    } else {
      set({
        configs: (configsRes.data ?? []) as AllocationConfig[],
        groups:  (groupsRes.data ?? []) as SpecialConfigGroup[],
        loading: false,
        loaded:  true,
      })
    }
  },

  reload: async () => {
    set({ loaded: false })
    await get().fetch()
  },

  reset: () => set({ configs: [], groups: [], loading: false, error: null, loaded: false }),

  resolve: (groupId, date) => buildVersionIndex(get().configs, get().groups).resolve(groupId, date),
}))
