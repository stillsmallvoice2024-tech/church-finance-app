import { create } from 'zustand'
import type { TourId } from '../types/onboarding'

interface OnboardingState {
  activeTourId: TourId | null
  activeTourStep: number
  isTourOpen: boolean

  startTour: (tourId: TourId, fromStep?: number) => void
  nextStep: () => void
  prevStep: () => void
  setStep: (step: number) => void
  exitTour: () => void
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  activeTourId: null,
  activeTourStep: 0,
  isTourOpen: false,

  startTour: (tourId, fromStep = 0) =>
    set({ activeTourId: tourId, activeTourStep: fromStep, isTourOpen: true }),

  nextStep: () =>
    set((s) => ({ activeTourStep: s.activeTourStep + 1 })),

  prevStep: () =>
    set((s) => ({ activeTourStep: Math.max(0, s.activeTourStep - 1) })),

  setStep: (step) =>
    set({ activeTourStep: step }),

  exitTour: () =>
    set({ isTourOpen: false, activeTourId: null, activeTourStep: 0 }),
}))
