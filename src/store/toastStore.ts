import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id:       string
  message:  string
  type:     ToastType
  duration: number  // ms; 0 = persistent (no auto-dismiss)
}

const MAX_TOASTS = 3

// Default auto-dismiss durations by type
const DEFAULT_DURATION: Record<ToastType, number> = {
  success: 3000,
  info:    4000,
  warning: 4000,
  error:   5000,
}

interface ToastState {
  toasts: Toast[]
  push:    (message: string, type?: ToastType, duration?: number) => void
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (message, type = 'info', duration) =>
    set((s) => {
      const resolvedDuration = duration !== undefined ? duration : DEFAULT_DURATION[type]
      const next = [...s.toasts, { id: crypto.randomUUID(), message, type, duration: resolvedDuration }]
      return { toasts: next.slice(-MAX_TOASTS) }
    }),

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// ── Convenience hook ───────────────────────────────────────────────────────────
export function useToast() {
  const { push } = useToastStore()
  return {
    success:    (msg: string, duration?: number) => push(msg, 'success', duration),
    error:      (msg: string, duration?: number) => push(msg, 'error',   duration),
    warning:    (msg: string, duration?: number) => push(msg, 'warning', duration),
    info:       (msg: string, duration?: number) => push(msg, 'info',    duration),
    persistent: (msg: string, type: ToastType = 'info') => push(msg, type, 0),
    push,
  }
}
