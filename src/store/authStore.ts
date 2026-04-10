import { create } from 'zustand'
import type { User, Session } from '@supabase/supabase-js'
import type { UserRole } from '../types'

interface AuthState {
  user: User | null
  session: Session | null
  role: UserRole | null
  fullName: string
  isLoading: boolean
  setSession: (session: Session | null) => void
  setRole: (role: UserRole | null) => void
  setFullName: (name: string) => void
  setLoading: (loading: boolean) => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  role: null,
  fullName: '',
  isLoading: true,
  setSession: (session) => set({ session, user: session?.user ?? null }),
  setRole: (role) => set({ role }),
  setFullName: (fullName) => set({ fullName }),
  setLoading: (isLoading) => set({ isLoading }),
}))
