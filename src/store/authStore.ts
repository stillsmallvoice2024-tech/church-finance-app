import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import type { UserProfile, UserRole } from '../types'

interface AuthState {
  user: User | null
  profile: UserProfile | null
  role: UserRole | null
  loading: boolean
  // Actions
  setUser: (user: User | null) => void
  setProfile: (profile: UserProfile | null) => void
  setLoading: (loading: boolean) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  role: null,
  loading: true,

  setUser: (user) => set({ user }),

  // setProfile atomically updates profile + role together
  setProfile: (profile) =>
    set({
      profile,
      role: (profile?.role ?? null) as UserRole | null,
    }),

  setLoading: (loading) => set({ loading }),

  clearAuth: () =>
    set({ user: null, profile: null, role: null, loading: false }),
}))
