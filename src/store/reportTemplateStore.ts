import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface ReportTemplateState {
  pinnedTemplateId: string | null
  pin: (id: string) => void
  unpin: () => void
  clearPin: () => void
}

export const useReportTemplateStore = create<ReportTemplateState>()(
  persist(
    (set) => ({
      pinnedTemplateId: null,
      pin: (id) => set({ pinnedTemplateId: id }),
      unpin: () => set({ pinnedTemplateId: null }),
      clearPin: () => set({ pinnedTemplateId: null }),
    }),
    { name: 'church-finance-report-template-pin' },
  ),
)
