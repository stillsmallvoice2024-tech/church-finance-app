import { create } from 'zustand'
import type { HealthStatus } from '../utils/reconciliationAggregator'

const HEALTH_KEY  = 'church-recon-last-health'
const SKIPPED_KEY = 'church-recon-skipped'
const CLEAN_KEY   = 'church-recon-clean-since'

function readHealth(): { status: HealthStatus; runAt: string } | null {
  try {
    const raw = localStorage.getItem(HEALTH_KEY)
    return raw ? (JSON.parse(raw) as { status: HealthStatus; runAt: string }) : null
  } catch { return null }
}

function readSkipped(): boolean {
  try { return localStorage.getItem(SKIPPED_KEY) === 'true' } catch { return false }
}

function readCleanSince(): string | null {
  try { return localStorage.getItem(CLEAN_KEY) } catch { return null }
}

interface HealthState {
  status:  HealthStatus | null
  runAt:   string | null
  skipped: boolean
  /** Timestamp of the first run in the current unbroken streak of healthy checks. */
  cleanSince: string | null
  /** Called after a reconciliation run — clears any skip. */
  setHealth:  (status: HealthStatus, runAt: string) => void
  /** Dismiss (grey-out) both the Dashboard strip and TopBar badge. */
  setSkipped: (v: boolean) => void
  /** Clear all health state and localStorage — call on org switch or sign-out. */
  clearHealth: () => void
}

const stored = readHealth()

export const useHealthStore = create<HealthState>((set, get) => ({
  status:  stored?.status ?? null,
  runAt:   stored?.runAt  ?? null,
  skipped: readSkipped(),
  cleanSince: readCleanSince(),

  setHealth: (status, runAt) => {
    // Track the start of an unbroken healthy streak; reset on any non-healthy run.
    let cleanSince = get().cleanSince
    if (status === 'healthy') {
      if (!cleanSince) cleanSince = runAt
    } else {
      cleanSince = null
    }
    try {
      localStorage.setItem(HEALTH_KEY, JSON.stringify({ status, runAt }))
      localStorage.removeItem(SKIPPED_KEY)
      if (cleanSince) localStorage.setItem(CLEAN_KEY, cleanSince)
      else            localStorage.removeItem(CLEAN_KEY)
    } catch { /* storage unavailable */ }
    set({ status, runAt, skipped: false, cleanSince })
  },

  setSkipped: (v) => {
    try {
      if (v) localStorage.setItem(SKIPPED_KEY, 'true')
      else   localStorage.removeItem(SKIPPED_KEY)
    } catch { /* storage unavailable */ }
    set({ skipped: v })
  },

  clearHealth: () => {
    try {
      localStorage.removeItem(HEALTH_KEY)
      localStorage.removeItem(SKIPPED_KEY)
      localStorage.removeItem(CLEAN_KEY)
    } catch { /* storage unavailable */ }
    set({ status: null, runAt: null, skipped: false, cleanSince: null })
  },
}))
