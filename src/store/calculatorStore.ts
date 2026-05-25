import { create } from 'zustand'

export interface HistoryEntry {
  expression: string
  result: string
  timestamp: number
}

interface PageCalcState {
  displayValue: string
  operator: string | null
  prevValue: string | null
  waitingForOperand: boolean
  expression: string
  history: HistoryEntry[]
  justEvaluated: boolean
}

const mkPage = (): PageCalcState => ({
  displayValue: '0',
  operator: null,
  prevValue: null,
  waitingForOperand: false,
  expression: '',
  history: [],
  justEvaluated: false,
})

function fmt(value: number): string {
  if (!isFinite(value)) return 'Error'
  if (value === 0) return '0'
  const rounded = parseFloat(value.toPrecision(12))
  if (Math.abs(rounded) >= 1e12 || (Math.abs(rounded) < 1e-9 && rounded !== 0)) {
    return rounded.toExponential(4)
  }
  return rounded.toString()
}

function calc(a: string, b: string, op: string): string {
  const n1 = parseFloat(a)
  const n2 = parseFloat(b)
  switch (op) {
    case '+': return fmt(n1 + n2)
    case '-': return fmt(n1 - n2)
    case '×': return fmt(n1 * n2)
    case '÷': return n2 === 0 ? 'Error' : fmt(n1 / n2)
    default: return b
  }
}

interface CalculatorStore {
  pages: Record<string, PageCalcState>
  isOpen: boolean
  isActive: boolean
  showHistory: boolean
  currentPage: string

  setCurrentPage: (page: string) => void
  setOpen: (open: boolean) => void
  setActive: (active: boolean) => void
  setShowHistory: (show: boolean) => void
  clearAllHistories: () => void
  clearPageHistory: () => void
  recallFromHistory: (value: string) => void
  handleKey: (key: string) => void
}

export const useCalculatorStore = create<CalculatorStore>((set, get) => {
  const getPage = (): PageCalcState => {
    const { pages, currentPage } = get()
    return pages[currentPage] ?? mkPage()
  }

  const setPage = (next: Partial<PageCalcState>) => {
    const { pages, currentPage } = get()
    set({
      pages: {
        ...pages,
        [currentPage]: { ...(pages[currentPage] ?? mkPage()), ...next },
      },
    })
  }

  return {
    pages: {},
    isOpen: false,
    isActive: true,
    showHistory: false,
    currentPage: '/',

    setCurrentPage: (page) => set({ currentPage: page }),
    setOpen: (isOpen) => set({ isOpen, ...(isOpen ? { isActive: true } : {}) }),
    setActive: (isActive) => set({ isActive }),
    setShowHistory: (showHistory) => set({ showHistory }),

    clearAllHistories: () =>
      set({ pages: {}, isOpen: false, showHistory: false }),

    clearPageHistory: () => {
      const { pages, currentPage } = get()
      set({
        pages: {
          ...pages,
          [currentPage]: { ...(pages[currentPage] ?? mkPage()), history: [] },
        },
      })
    },

    recallFromHistory: (value: string) => {
      const { pages, currentPage } = get()
      set({
        pages: {
          ...pages,
          [currentPage]: {
            ...(pages[currentPage] ?? mkPage()),
            displayValue: value,
            operator: null,
            prevValue: null,
            waitingForOperand: false,
            expression: '',
            justEvaluated: true,
          },
        },
        showHistory: false,
      })
    },

    handleKey: (key: string) => {
      const s = getPage()

      if (key === 'AC') {
        setPage(mkPage())
        return
      }

      if (key === 'CE') {
        setPage({ displayValue: '0', waitingForOperand: false })
        return
      }

      if (key === 'Backspace') {
        if (s.waitingForOperand || s.displayValue === 'Error') return
        const next = s.displayValue.length > 1 ? s.displayValue.slice(0, -1) : '0'
        setPage({ displayValue: next })
        return
      }

      if (key === '+/-') {
        if (s.displayValue === 'Error' || s.displayValue === '0') return
        setPage({ displayValue: fmt(-parseFloat(s.displayValue)), waitingForOperand: false })
        return
      }

      if (key === '%') {
        if (s.displayValue === 'Error') return
        const val = parseFloat(s.displayValue)
        const result = s.operator && s.prevValue
          ? fmt(parseFloat(s.prevValue) * val / 100)
          : fmt(val / 100)
        setPage({ displayValue: result, waitingForOperand: false })
        return
      }

      if (['+', '-', '×', '÷'].includes(key)) {
        if (s.displayValue === 'Error') {
          setPage({ ...mkPage(), operator: key, prevValue: '0', waitingForOperand: true, expression: `0 ${key}` })
          return
        }
        if (s.operator && !s.waitingForOperand) {
          const result = calc(s.prevValue!, s.displayValue, s.operator)
          setPage({
            displayValue: result,
            prevValue: result,
            operator: key,
            waitingForOperand: true,
            expression: `${result} ${key}`,
            justEvaluated: false,
          })
        } else {
          setPage({
            operator: key,
            prevValue: s.displayValue,
            waitingForOperand: true,
            expression: `${s.displayValue} ${key}`,
            justEvaluated: false,
          })
        }
        return
      }

      if (key === '=') {
        if (!s.operator || !s.prevValue) return
        const result = calc(s.prevValue, s.displayValue, s.operator)
        const expr = `${s.prevValue} ${s.operator} ${s.displayValue} =`
        const entry: HistoryEntry = { expression: expr, result, timestamp: Date.now() }
        setPage({
          displayValue: result,
          expression: expr,
          operator: null,
          prevValue: null,
          waitingForOperand: true,
          justEvaluated: true,
          history: [entry, ...s.history].slice(0, 50),
        })
        return
      }

      if (key === '.') {
        if (s.displayValue === 'Error') return
        if (s.waitingForOperand) {
          setPage({ displayValue: '0.', waitingForOperand: false })
        } else if (!s.displayValue.includes('.')) {
          setPage({ displayValue: s.displayValue + '.' })
        }
        return
      }

      if (/^[0-9]$/.test(key)) {
        if (s.displayValue === 'Error') {
          setPage({ displayValue: key, waitingForOperand: false, justEvaluated: false })
          return
        }
        if (s.waitingForOperand) {
          setPage({ displayValue: key, waitingForOperand: false, justEvaluated: false })
        } else {
          const digitCount = s.displayValue.replace(/[^0-9]/g, '').length
          if (digitCount >= 12) return
          const next = s.displayValue === '0' ? key : s.displayValue + key
          setPage({ displayValue: next, justEvaluated: false })
        }
        return
      }
    },
  }
})
