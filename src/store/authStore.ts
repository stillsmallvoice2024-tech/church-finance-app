import { create } from 'zustand'
import type { User } from '@supabase/supabase-js'
import type { UserProfile, UserRole } from '../types'

interface AuthState {
  user: User | null
  profile: UserProfile | null
  role: UserRole | null
  loading: boolean
  profileFetchFailed: boolean
  // Actions
  setUser: (user: User | null) => void
  setProfile: (profile: UserProfile | null) => void
  setLoading: (loading: boolean) => void
  setProfileFetchFailed: (failed: boolean) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  profile: null,
  role: null,
  loading: true,
  profileFetchFailed: false,

  setUser: (user) => set({ user }),

  // setProfile atomically updates profile + role together and clears any prior fetch error
  setProfile: (profile) =>
    set({
      profile,
      role: (profile?.role ?? null) as UserRole | null,
      profileFetchFailed: false,
    }),

  setLoading: (loading) => set({ loading }),

  setProfileFetchFailed: (failed) => set({ profileFetchFailed: failed }),

  clearAuth: () =>
    set({ user: null, profile: null, role: null, loading: false, profileFetchFailed: false }),
}))
