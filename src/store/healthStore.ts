import { create } from 'zustand'
import type { HealthStatus } from '../utils/reconciliationAggregator'

const HEALTH_KEY  = 'church-recon-last-health'
const SKIPPED_KEY = 'church-recon-skipped'

function readHealth(): { status: HealthStatus; runAt: string } | null {
  try {
    const raw = localStorage.getItem(HEALTH_KEY)
    return raw ? (JSON.parse(raw) as { status: HealthStatus; runAt: string }) : null
  } catch { return null }
}

function readSkipped(): boolean {
  try { return localStorage.getItem(SKIPPED_KEY) === 'true' } catch { return false }
}

interface HealthState {
  status:  HealthStatus | null
  runAt:   string | null
  skipped: boolean
  /** Called after a reconciliation run — clears any skip. */
  setHealth:  (status: HealthStatus, runAt: string) => void
  /** Dismiss (grey-out) both the Dashboard strip and TopBar badge. */
  setSkipped: (v: boolean) => void
}

const stored = readHealth()

export const useHealthStore = create<HealthState>((set) => ({
  status:  stored?.status ?? null,
  runAt:   stored?.runAt  ?? null,
  skipped: readSkipped(),

  setHealth: (status, runAt) => {
    try {
      localStorage.setItem(HEALTH_KEY, JSON.stringify({ status, runAt }))
      localStorage.removeItem(SKIPPED_KEY)
    } catch { /* storage unavailable */ }
    set({ status, runAt, skipped: false })
  },

  setSkipped: (v) => {
    try {
      if (v) localStorage.setItem(SKIPPED_KEY, 'true')
      else   localStorage.removeItem(SKIPPED_KEY)
    } catch { /* storage unavailable */ }
    set({ skipped: v })
  },
}))
