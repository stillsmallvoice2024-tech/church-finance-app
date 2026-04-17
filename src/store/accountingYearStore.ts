import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AccountingYearState {
  year: number
  setYear: (year: number) => void
}

export const useAccountingYearStore = create<AccountingYearState>()(
  persist(
    (set) => ({
      year: new Date().getFullYear(),
      setYear: (year) => set({ year }),
    }),
    { name: 'church-finance-accounting-year' },
  ),
)
