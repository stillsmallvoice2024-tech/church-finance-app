import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'warning' | 'info'

export interface Toast {
  id:      string
  message: string
  type:    ToastType
}

const MAX_TOASTS = 3

interface ToastState {
  toasts: Toast[]
  push:    (message: string, type?: ToastType) => void
  dismiss: (id: string) => void
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  push: (message, type = 'info') =>
    set((s) => {
      const next = [...s.toasts, { id: crypto.randomUUID(), message, type }]
      return { toasts: next.slice(-MAX_TOASTS) }
    }),

  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

// ── Convenience hook ───────────────────────────────────────────────────────────
export function useToast() {
  const { push } = useToastStore()
  return {
    success: (msg: string) => push(msg, 'success'),
    error:   (msg: string) => push(msg, 'error'),
    warning: (msg: string) => push(msg, 'warning'),
    info:    (msg: string) => push(msg, 'info'),
    push,
  }
}
