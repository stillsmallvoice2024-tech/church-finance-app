import { create } from 'zustand'
import type { Transaction, Account, SpecialProject, ForeignCurrencyHolding, IntraFlowTransaction } from '../types'

interface FinanceState {
  transactions: Transaction[]
  accounts: Account[]
  projects: SpecialProject[]
  foreignHoldings: ForeignCurrencyHolding[]
  intraFlows: IntraFlowTransaction[]
  isLoading: boolean
  setTransactions: (txns: Transaction[]) => void
  setAccounts: (accounts: Account[]) => void
  setProjects: (projects: SpecialProject[]) => void
  setForeignHoldings: (holdings: ForeignCurrencyHolding[]) => void
  setIntraFlows: (flows: IntraFlowTransaction[]) => void
  setLoading: (loading: boolean) => void
  reset: () => void
}

export const useFinanceStore = create<FinanceState>((set) => ({
  transactions: [],
  accounts: [],
  projects: [],
  foreignHoldings: [],
  intraFlows: [],
  isLoading: false,
  setTransactions: (transactions) => set({ transactions }),
  setAccounts: (accounts) => set({ accounts }),
  setProjects: (projects) => set({ projects }),
  setForeignHoldings: (foreignHoldings) => set({ foreignHoldings }),
  setIntraFlows: (intraFlows) => set({ intraFlows }),
  setLoading: (isLoading) => set({ isLoading }),
  reset: () => set({ transactions: [], accounts: [], projects: [], foreignHoldings: [], intraFlows: [], isLoading: false }),
}))
