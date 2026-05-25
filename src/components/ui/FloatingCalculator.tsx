import { useEffect, useRef, useState, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { Calculator, X, Copy, Check, History, Trash2, ChevronLeft } from 'lucide-react'
import { useCalculatorStore } from '../../store/calculatorStore'
import { useAuthStore } from '../../store/authStore'

interface CalcButton {
  label: string
  key: string
  type: 'fn' | 'op' | 'num' | 'eq'
}

const BUTTONS: CalcButton[] = [
  { label: 'AC', key: 'AC',        type: 'fn'  },
  { label: '+/-', key: '+/-',      type: 'fn'  },
  { label: '%',  key: '%',         type: 'fn'  },
  { label: '÷',  key: '÷',         type: 'op'  },
  { label: '7',  key: '7',         type: 'num' },
  { label: '8',  key: '8',         type: 'num' },
  { label: '9',  key: '9',         type: 'num' },
  { label: '×',  key: '×',         type: 'op'  },
  { label: '4',  key: '4',         type: 'num' },
  { label: '5',  key: '5',         type: 'num' },
  { label: '6',  key: '6',         type: 'num' },
  { label: '−',  key: '-',         type: 'op'  },
  { label: '1',  key: '1',         type: 'num' },
  { label: '2',  key: '2',         type: 'num' },
  { label: '3',  key: '3',         type: 'num' },
  { label: '+',  key: '+',         type: 'op'  },
  { label: '⌫',  key: 'Backspace', type: 'fn'  },
  { label: '0',  key: '0',         type: 'num' },
  { label: '.',  key: '.',         type: 'num' },
  { label: '=',  key: '=',         type: 'eq'  },
]

const KEYBOARD_MAP: Record<string, string> = {
  '0': '0', '1': '1', '2': '2', '3': '3', '4': '4',
  '5': '5', '6': '6', '7': '7', '8': '8', '9': '9',
  '.': '.', ',': '.',
  '+': '+', '-': '-',
  '*': '×', 'x': '×',
  '/': '÷',
  'Enter': '=', '=': '=',
  'Escape': 'AC',
  'Backspace': 'Backspace',
  'Delete': 'CE',
  '%': '%',
}

function formatDisplay(val: string): string {
  if (val === 'Error') return 'Error'
  if (val.length <= 9) return val
  // For long values, try exponential notation
  const num = parseFloat(val)
  if (!isFinite(num)) return val
  return num.toExponential(3)
}

export function FloatingCalculator() {
  const location = useLocation()
  const user = useAuthStore(s => s.user)
  const {
    isOpen, setOpen,
    isActive, setActive,
    showHistory, setShowHistory,
    setCurrentPage,
    clearAllHistories,
    clearPageHistory,
    recallFromHistory,
    handleKey,
    pages,
    currentPage,
  } = useCalculatorStore()

  const panelRef = useRef<HTMLDivElement>(null)
  const [copied, setCopied] = useState(false)

  const pageState = pages[currentPage] ?? {
    displayValue: '0',
    operator: null,
    prevValue: null,
    waitingForOperand: false,
    expression: '',
    history: [],
    justEvaluated: false,
  }

  // Sync route → store current page key
  useEffect(() => {
    setCurrentPage(location.pathname)
  }, [location.pathname, setCurrentPage])

  // Clear all histories on logout
  useEffect(() => {
    if (!user) clearAllHistories()
  }, [user, clearAllHistories])

  // Deactivate (fade) when clicking outside the panel
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setActive(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [isOpen, setActive])

  // Keyboard input handler
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when a blocking modal is open
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return

      const target = e.target as HTMLElement
      // Don't intercept keys from external form elements
      const isExternalForm =
        !panelRef.current?.contains(target) &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable ||
          target.tagName === 'SELECT')
      if (isExternalForm) return

      // Skip browser shortcuts
      if (e.altKey || e.ctrlKey || e.metaKey) return

      const calcKey = KEYBOARD_MAP[e.key]
      if (!calcKey) return

      e.preventDefault()
      setActive(true)
      handleKey(calcKey)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, handleKey, setActive])

  const handleCopy = useCallback(async () => {
    const val = pageState.displayValue
    if (val === 'Error' || val === '0') return
    try {
      await navigator.clipboard.writeText(val)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* clipboard access denied */ }
  }, [pageState.displayValue])

  // AC shows when display is '0' or waiting; CE shows when there's an active entry
  const acLabel = !pageState.waitingForOperand && pageState.displayValue !== '0' ? 'CE' : 'AC'

  const displayStr = formatDisplay(pageState.displayValue)
  const displayFontSize = displayStr.length > 8 ? 'text-2xl' : displayStr.length > 6 ? 'text-3xl' : 'text-4xl'

  if (!user) return null

  return (
    <div
      className="fixed bottom-20 right-4 lg:bottom-6 lg:right-6 flex flex-col items-end gap-2 z-[49]"
      style={{ pointerEvents: 'none' }}
    >
      {/* Calculator Panel */}
      {isOpen && (
        <div
          ref={panelRef}
          style={{ pointerEvents: 'auto' }}
          onMouseDown={() => setActive(true)}
          className={[
            'w-72 rounded-2xl shadow-2xl border bg-white overflow-hidden',
            'transition-all duration-200',
            isActive
              ? 'opacity-100 border-gray-200 shadow-2xl'
              : 'opacity-60 border-gray-300 shadow-lg',
          ].join(' ')}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 bg-gray-50 border-b border-gray-100">
            <span className="text-xs font-semibold text-gray-500 flex items-center gap-1.5 select-none">
              <Calculator className="w-3.5 h-3.5" />
              Calculator
            </span>
            <div className="flex items-center gap-0.5">
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); setShowHistory(!showHistory) }}
                title={showHistory ? 'Back to calculator' : 'Show history'}
                aria-label={showHistory ? 'Back to calculator' : 'Show history'}
                className={[
                  'w-7 h-7 flex items-center justify-center rounded-lg transition-colors',
                  showHistory
                    ? 'bg-primary/10 text-primary'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-200',
                ].join(' ')}
              >
                <History className="w-3.5 h-3.5" />
              </button>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.stopPropagation(); setOpen(false); setShowHistory(false) }}
                title="Close calculator"
                aria-label="Close calculator"
                className="w-7 h-7 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Body: calculator face OR history */}
          {showHistory ? (
            <HistoryPanel
              history={pageState.history}
              onRecall={recallFromHistory}
              onClear={clearPageHistory}
              onBack={() => setShowHistory(false)}
            />
          ) : (
            <>
              {/* Display */}
              <div className="bg-gray-900 px-4 pt-3 pb-4 select-none">
                {/* Expression row */}
                <div className="text-right text-xs text-gray-500 min-h-[18px] truncate mb-1">
                  {pageState.expression}
                </div>
                {/* Value row */}
                <div className="flex items-end justify-end gap-2">
                  <button
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={handleCopy}
                    title="Copy result"
                    aria-label="Copy result"
                    className={[
                      'mb-1 transition-colors flex-shrink-0',
                      pageState.displayValue === '0' || pageState.displayValue === 'Error'
                        ? 'opacity-0 pointer-events-none'
                        : 'text-gray-500 hover:text-gray-300',
                    ].join(' ')}
                  >
                    {copied
                      ? <Check className="w-3.5 h-3.5 text-green-400" />
                      : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <span
                    className={[
                      'font-mono font-bold text-white leading-none tracking-tight min-w-0 break-all',
                      displayFontSize,
                      pageState.displayValue === 'Error' ? 'text-red-400 text-2xl' : '',
                    ].join(' ')}
                  >
                    {displayStr}
                  </span>
                </div>
              </div>

              {/* Buttons */}
              <div className="grid grid-cols-4 gap-1.5 p-3 bg-white">
                {BUTTONS.map(({ label, key, type }) => {
                  const isAcBtn = key === 'AC'
                  const displayLabel = isAcBtn ? acLabel : label
                  const effectiveKey = isAcBtn ? acLabel : key
                  const isActiveOp =
                    !isAcBtn &&
                    ['+', '-', '×', '÷'].includes(key) &&
                    pageState.operator === key &&
                    pageState.waitingForOperand

                  let btnCls = ''
                  if (type === 'eq') {
                    btnCls = 'bg-primary hover:bg-primary-dark text-white'
                  } else if (type === 'op') {
                    btnCls = isActiveOp
                      ? 'bg-primary text-white'
                      : 'bg-blue-50 hover:bg-blue-100 text-primary font-bold'
                  } else if (type === 'fn') {
                    btnCls = 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                  } else {
                    btnCls = 'bg-gray-50 hover:bg-gray-100 text-gray-800'
                  }

                  return (
                    <button
                      key={key}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation()
                        handleKey(effectiveKey)
                      }}
                      aria-label={displayLabel}
                      className={[
                        'h-12 rounded-xl text-sm font-semibold transition-colors',
                        'active:brightness-90 active:scale-95',
                        btnCls,
                      ].join(' ')}
                    >
                      {displayLabel}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* FAB */}
      <button
        style={{ pointerEvents: 'auto' }}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          if (isOpen) {
            setOpen(false)
            setShowHistory(false)
          } else {
            setOpen(true)
          }
        }}
        title={isOpen ? 'Close calculator' : 'Open calculator'}
        aria-label={isOpen ? 'Close calculator' : 'Open calculator'}
        className={[
          'w-10 h-10 rounded-full shadow-lg flex items-center justify-center',
          'transition-all duration-300',
          isOpen
            ? 'opacity-100 bg-gray-700 hover:bg-gray-800 text-white'
            : 'opacity-30 hover:opacity-100 focus:opacity-100 bg-primary hover:bg-primary-dark text-white',
        ].join(' ')}
      >
        {isOpen
          ? <X className="w-4 h-4" />
          : <Calculator className="w-4 h-4" />}
      </button>
    </div>
  )
}

interface HistoryPanelProps {
  history: import('../../store/calculatorStore').HistoryEntry[]
  onRecall: (value: string) => void
  onClear: () => void
  onBack: () => void
}

function HistoryPanel({ history, onRecall, onClear, onBack }: HistoryPanelProps) {
  return (
    <div className="flex flex-col" style={{ minHeight: '336px' }}>
      {/* History header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 bg-gray-50">
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={onBack}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <span className="text-xs font-semibold text-gray-500">This page</span>
        {history.length > 0 && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={onClear}
            className="flex items-center gap-1 text-xs text-red-500 hover:text-red-700 transition-colors"
          >
            <Trash2 className="w-3 h-3" />
            Clear
          </button>
        )}
        {history.length === 0 && <span className="w-12" />}
      </div>

      {/* History list */}
      <div className="overflow-y-auto flex-1" style={{ maxHeight: '320px' }}>
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <History className="w-6 h-6 text-gray-300 mb-2" />
            <p className="text-xs text-gray-400">No calculations yet on this page</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {history.map((entry) => (
              <button
                key={entry.timestamp}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onRecall(entry.result)}
                title="Use this result"
                className="w-full px-4 py-2.5 text-right hover:bg-gray-50 transition-colors block"
              >
                <div className="text-[11px] text-gray-400 truncate">{entry.expression}</div>
                <div className="text-sm font-mono font-semibold text-gray-800">{entry.result}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
