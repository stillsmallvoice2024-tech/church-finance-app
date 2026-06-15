import { create } from 'zustand'

interface TransactionSyncState {
  outflowVersion:   number
  bumpOutflow:      () => void
  intraflowVersion: number
  bumpIntraflow:    () => void
  inflowVersion:    number
  bumpInflow:       () => void
  reset:            () => void
}

export const useTransactionSyncStore = create<TransactionSyncState>((set) => ({
  outflowVersion:   0,
  bumpOutflow:      () => set(s => ({ outflowVersion:   s.outflowVersion   + 1 })),
  intraflowVersion: 0,
  bumpIntraflow:    () => set(s => ({ intraflowVersion: s.intraflowVersion + 1 })),
  inflowVersion:    0,
  bumpInflow:       () => set(s => ({ inflowVersion:    s.inflowVersion    + 1 })),
  reset:            () => set({ outflowVersion: 0, intraflowVersion: 0, inflowVersion: 0 }),
}))
