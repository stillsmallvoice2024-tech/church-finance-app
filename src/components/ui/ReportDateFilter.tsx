import { useState, useEffect, useMemo } from 'react'

export type DateField = 'date' | 'recorded_at'
export type RangeMode = 'predefined' | 'custom'

export interface DateFilterRange {
  lo:      string   // YYYY-MM-DD (lower bound)
  hi:      string   // YYYY-MM-DD (upper bound, display)
  queryHi: string   // hi with T23:59:59 for recorded_at timestamptz
  col:     DateField
}

const CURRENT_YEAR = new Date().getFullYear()
const REPORT_YEARS = Array.from({ length: 6 }, (_, i) => CURRENT_YEAR - i)
const REPORT_MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

const CTL = 'text-sm border border-gray-300 rounded-lg px-3 py-1.5 outline-none focus:ring-2 focus:ring-primary/30 bg-white'

export function useReportDateFilter(initialYear: number) {
  const [rangeMode,  setRangeModeState] = useState<RangeMode>('predefined')
  const [year,       setYear]           = useState(initialYear)
  const [month,      setMonth]          = useState(0)
  const [dateFrom,   setDateFrom]       = useState('')
  const [dateTo,     setDateTo]         = useState('')
  const [dateField,  setDateField]      = useState<DateField>('date')

  useEffect(() => { setYear(initialYear) }, [initialYear])

  const predefinedLo = useMemo(() => {
    const y = year.toString()
    return month === 0
      ? `${y}-01-01`
      : `${y}-${String(month).padStart(2, '0')}-01`
  }, [year, month])

  const predefinedHi = useMemo(() => {
    const y = year.toString()
    return month === 0
      ? `${y}-12-31`
      : `${y}-${String(month).padStart(2, '0')}-${new Date(year, month, 0).getDate()}`
  }, [year, month])

  const setRangeMode = (mode: RangeMode) => {
    if (mode === 'custom' && !dateFrom && !dateTo) {
      setDateFrom(predefinedLo)
      setDateTo(predefinedHi)
    }
    setRangeModeState(mode)
  }

  const range = useMemo((): DateFilterRange => {
    const col = dateField
    const lo  = rangeMode === 'custom' ? (dateFrom || predefinedLo) : predefinedLo
    const hi  = rangeMode === 'custom' ? (dateTo   || predefinedHi) : predefinedHi
    return { lo, hi, queryHi: col === 'recorded_at' ? `${hi}T23:59:59` : hi, col }
  }, [rangeMode, dateFrom, dateTo, predefinedLo, predefinedHi, dateField])

  const periodLabel = rangeMode === 'custom'
    ? `${range.lo} to ${range.hi}`
    : month === 0
      ? String(year)
      : `${REPORT_MONTH_NAMES[month - 1]} ${year}`

  return {
    year, setYear,
    month, setMonth,
    rangeMode, setRangeMode,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    dateField, setDateField,
    range,
    periodLabel,
  }
}

export type ReportDateFilterHook = ReturnType<typeof useReportDateFilter>

export function ReportDateFilter({ hook }: { hook: ReportDateFilterHook }) {
  const {
    year, setYear,
    month, setMonth,
    rangeMode, setRangeMode,
    dateFrom, setDateFrom,
    dateTo, setDateTo,
    dateField, setDateField,
  } = hook

  const seg = (active: boolean) =>
    `px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
      active ? 'bg-primary text-white' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'
    }`

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Date field toggle */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
        <button type="button" onClick={() => setDateField('date')} className={seg(dateField === 'date')}>
          Txn Date
        </button>
        <button
          type="button"
          onClick={() => setDateField('recorded_at')}
          className={`border-l border-gray-200 ${seg(dateField === 'recorded_at')}`}
        >
          Recorded
        </button>
      </div>

      {/* Range mode toggle */}
      <div className="flex rounded-lg border border-gray-200 overflow-hidden shrink-0">
        <button type="button" onClick={() => setRangeMode('predefined')} className={seg(rangeMode === 'predefined')}>
          Preset
        </button>
        <button
          type="button"
          onClick={() => setRangeMode('custom')}
          className={`border-l border-gray-200 ${seg(rangeMode === 'custom')}`}
        >
          Custom
        </button>
      </div>

      {rangeMode === 'predefined' ? (
        <>
          <select
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            className={CTL}
          >
            <option value={0}>All months</option>
            {REPORT_MONTH_NAMES.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            className={CTL}
          >
            {REPORT_YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </>
      ) : (
        <>
          <input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className={CTL}
          />
          <span className="text-gray-400 text-xs shrink-0">–</span>
          <input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className={CTL}
          />
        </>
      )}
    </div>
  )
}
