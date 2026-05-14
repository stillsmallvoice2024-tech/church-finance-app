import { create } from 'zustand'

interface TransactionSyncState {
  outflowVersion: number
  bumpOutflow: () => void
}

export const useTransactionSyncStore = create<TransactionSyncState>((set) => ({
  outflowVersion: 0,
  bumpOutflow: () => set(s => ({ outflowVersion: s.outflowVersion + 1 })),
}))
