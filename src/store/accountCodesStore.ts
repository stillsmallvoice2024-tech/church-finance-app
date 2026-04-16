import { create } from 'zustand'
import { supabase } from '../lib/supabase'
import { ACCOUNT_NAMES, type AccountEntry } from '../utils/accountNames'

interface AccountCodesState {
  codes: AccountEntry[]
  loaded: boolean
  loading: boolean
  fetch: () => Promise<void>
  getLabel: (code: string | null | undefined) => string
}

export const useAccountCodesStore = create<AccountCodesState>((set, get) => ({
  codes: ACCOUNT_NAMES, // start with hardcoded fallback
  loaded: false,
  loading: false,

  fetch: async () => {
    if (get().loaded || get().loading) return
    set({ loading: true })
    const { data, error } = await supabase
      .from('accounts')
      .select('code, name, category')
      .eq('is_active', true)
      .order('code', { ascending: true })
    if (!error && data && data.length > 0) {
      set({ codes: data as AccountEntry[], loaded: true, loading: false })
    } else {
      // keep fallback on error, still mark loaded so we don't retry on every render
      set({ loaded: true, loading: false })
    }
  },

  getLabel: (code) => {
    if (!code) return '—'
    const entry = get().codes.find(a => a.code === code)
    return entry ? `${code} — ${entry.name}` : code
  },
}))
