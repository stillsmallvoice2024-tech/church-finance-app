import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { ACCOUNT_NAMES, type AccountEntry } from '../utils/accountNames'
import { useOrgStore } from './orgStore'

interface AccountCodesState {
  codes: AccountEntry[]
  loaded: boolean
  loading: boolean
  fetch: () => Promise<void>
  /** Clear cached codes — call on org switch or logout. */
  reset: () => void
  getLabel: (code: string | null | undefined) => string
}

export const useAccountCodesStore = create<AccountCodesState>((set, get) => ({
  codes: ACCOUNT_NAMES, // start with hardcoded fallback
  loaded: false,
  loading: false,

  fetch: async () => {
    const orgId = useOrgStore.getState().orgId
    if (!orgId || get().loaded || get().loading) return
    set({ loading: true })
    const { data, error } = await supabase
      .from('accounts')
      .select('code, name, category')
      .eq('org_id', orgId)
      .eq('is_active', true)
      .order('code', { ascending: true })
    if (!error && data && data.length > 0) {
      set({ codes: data as AccountEntry[], loaded: true, loading: false })
    } else {
      set({ loaded: true, loading: false })
    }
  },

  reset: () => set({ codes: ACCOUNT_NAMES, loaded: false, loading: false }),

  getLabel: (code) => {
    if (!code) return '—'
    const entry = get().codes.find(a => a.code === code)
    return entry ? `${code} — ${entry.name}` : code
  },
}))
