import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

interface ThemeState {
  theme: Theme
  toggle: () => void
  setTheme: (t: Theme) => void
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
}

// Apply stored theme immediately on module load to avoid flash
try {
  const raw = localStorage.getItem('church-finance-theme')
  if (raw) {
    const parsed = JSON.parse(raw)
    if (parsed?.state?.theme === 'dark') {
      document.documentElement.classList.add('dark')
    }
  }
} catch { /* ignore */ }

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      toggle: () => {
        const next = get().theme === 'light' ? 'dark' : 'light'
        set({ theme: next })
        applyTheme(next)
      },
      setTheme: (t) => {
        set({ theme: t })
        applyTheme(t)
      },
    }),
    { name: 'church-finance-theme' },
  ),
)
