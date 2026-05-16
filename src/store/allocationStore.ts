import { create } from 'zustand'
import { supabase } from '../lib/supabase'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AllocationRow {
  category_name:  string
  budget_portion?: string  // 'Percentage' | 'Specific Seed' | 'Savings'
  percentage?:    number
  amount?:        number
}

export interface AllocationConfig {
  id:              string
  name:            string
  start_date:      string
  status:          'draft' | 'locked'
  is_special?:     boolean
  allocation_type?: 'percentage' | 'amount'
  total_amount?:   number
  rows:            AllocationRow[]
  created_at:      string
  config_group_id?: string | null
  effective_from?:  string | null
  effective_to?:    string | null
  version_number?:  number
}

export interface SpecialConfigGroup {
  id:         string
  name:       string
  created_at: string
}

// ── Helper ─────────────────────────────────────────────────────────────────────

/**
 * Returns the allocation config that was active on the given ISO date string.
 * "Active" means the config with the most recent start_date that is on or
 * before the target date. Considers all statuses unless you pre-filter.
 * Returns null if no config qualifies.
 */
export function getConfigForDate(
  configs: AllocationConfig[],
  date: string,
): AllocationConfig | null {
  // Only locked (approved) configs are eligible — draft configs are never applied
  const eligible = configs
    .filter(c => c.status === 'locked' && !c.is_special && c.start_date <= date)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))

  return eligible[0] ?? null
}

export function getSpecialConfigVersionForDate(
  configs: AllocationConfig[],
  groupId: string,
  date: string,
): AllocationConfig | null {
  const eligible = configs
    .filter(c =>
      c.status === 'locked' &&
      c.config_group_id === groupId &&
      c.effective_from != null &&
      c.effective_from <= date &&
      (c.effective_to == null || c.effective_to >= date)
    )
    .sort((a, b) => b.effective_from!.localeCompare(a.effective_from!))
  return eligible[0] ?? null
}

// ── Store ──────────────────────────────────────────────────────────────────────

interface AllocationState {
  configs:  AllocationConfig[]
  loading:  boolean
  error:    string | null
  loaded:   boolean
  fetch:    () => Promise<void>
  /** Force a fresh fetch even if already loaded. */
  reload:   () => Promise<void>
  /** Convenience wrapper around the exported getConfigForDate helper. */
  forDate:  (date: string) => AllocationConfig | null
}

export const useAllocationStore = create<AllocationState>((set, get) => ({
  configs: [],
  loading: false,
  error:   null,
  loaded:  false,

  fetch: async () => {
    if (get().loading) return
    set({ loading: true, error: null })

    const { data, error } = await supabase
      .from('allocation_configs')
      .select('*')
      .order('start_date', { ascending: true })

    if (error) {
      set({ error: error.message, loading: false })
    } else {
      set({ configs: (data ?? []) as AllocationConfig[], loading: false, loaded: true })
    }
  },

  reload: async () => {
    set({ loaded: false })
    await get().fetch()
  },

  forDate: (date) => getConfigForDate(get().configs, date),
}))
