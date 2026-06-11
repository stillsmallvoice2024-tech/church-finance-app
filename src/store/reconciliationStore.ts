import { create } from 'zustand'
import type { ReconciliationResult } from '../utils/reconciliationEngine'
import type { ReconciliationDiagnostics } from '../utils/reconciliationAggregator'

interface ReconciliationState {
  result:      ReconciliationResult | null
  diagnostics: ReconciliationDiagnostics | null
  /** Tracks which org the cached results belong to — cleared on org switch. */
  orgId:       string | null
  setResults:  (result: ReconciliationResult, diagnostics: ReconciliationDiagnostics, orgId: string) => void
  clearResults: () => void
}

export const useReconciliationStore = create<ReconciliationState>((set) => ({
  result:      null,
  diagnostics: null,
  orgId:       null,
  setResults:  (result, diagnostics, orgId) => set({ result, diagnostics, orgId }),
  clearResults: () => set({ result: null, diagnostics: null, orgId: null }),
}))
