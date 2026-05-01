import { useState, useMemo } from 'react'
import { Plus, Download, TrendingUp, TrendingDown, RefreshCw, AlertCircle } from 'lucide-react'
import { useRole } from '../hooks/useRole'
import { usePageTitle } from '../hooks/usePageTitle'
import { useFXTransactions } from '../hooks/useFX'
import { useFXConversions } from '../hooks/useFXConversions'
import { AddFXModal } from '../components/modals/AddFXModal'
import { AddFXConversionModal } from '../components/modals/AddFXConversionModal'
import { exportCSV } from '../utils/csvExport'

type FXCurrency = 'USD' | 'GBP' | 'EUR' | 'CNY'

const FX_META: { code: FXCurrency; symbol: string; flag: string; name: string }[] = [
  { code: 'USD', symbol: '$', flag: '🇺🇸', name: 'US Dollar'      },
  { code: 'GBP', symbol: '£', flag: '🇬🇧', name: 'British Pound'  },
  { code: 'EUR', symbol: '€', flag: '🇪🇺', name: 'Euro'           },
  { code: 'CNY', symbol: '¥', flag: '🇨🇳', name: 'Chinese Yuan'   },
]

function fmtFX(n: number, dp = 4) {
  return n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })
}
function fmtNGN(n: number) {
  return n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function ForeignCurrency() {
  const [addOpen,         setAddOpen]         = useState(false)
  const [filterCcy,       setFilterCcy]       = useState<FXCurrency | ''>('')
  const [convertOpen,     setConvertOpen]     = useState(false)
  const [convertCcy,      setConvertCcy]      = useState<string>('USD')
  const [showConversions, setShowConversions] = useState(false)
  const [rates, setRates] = useState<Record<FXCurrency, number>>({
    USD: 0, GBP: 0, EUR: 0, CNY: 0,
  })

  const { canWrite }                                = useRole()
  const { transactions, summaries, loading, error, refetch } =
    useFXTransactions(filterCcy || undefined)
  const { conversions, loading: convLoading, refetch: refetchConversions } =
    useFXConversions()

  usePageTitle('Foreign Currency')

  // Full unfiltered summaries for the conversion modal
  const { summaries: allSummaries } = useFXTransactions()
  const summaryMap = useMemo(() => {
    const m = new Map(summaries.map(s => [s.currency, s]))
    return m
  }, [summaries])

  // Map passed to add modal for balance preview
  const currentBalances = useMemo(
    () => new Map(summaries.map(s => [s.currency, s.currentBalance])),
    [summaries],
  )

  // Currencies with unconverted balance (reconciliation prompt)
  const unconvertedBalances = FX_META.filter(m => (summaryMap.get(m.code)?.currentBalance ?? 0) > 0)

  const handleExport = () => {
    exportCSV(
      'fx_transactions',
      ['Date', 'Currency', 'Type', 'Amount', 'Running Balance', 'Narration', 'Ref'],
      transactions.map(t => [
        t.date,
        t.currency,
        t.deposit > 0 ? 'Deposit' : 'Withdrawal',
        t.deposit > 0 ? t.deposit : t.withdrawal,
        t.running_balance,
        t.narration ?? '',
        t.transaction_ref ?? '',
      ]),
    )
  }

  const totalNairaEquivalent = FX_META.reduce((sum, m) => {
    const bal  = summaryMap.get(m.code)?.currentBalance ?? 0
    const rate = rates[m.code]
    return sum + bal * rate
  }, 0)

  const openConvert = (code: string) => {
    setConvertCcy(code)
    setConvertOpen(true)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Foreign Currency</h1>
          <p className="text-sm text-gray-500 mt-0.5">FX holdings across USD, GBP, EUR, and CNY</p>
        </div>
        <div className="flex items-center gap-2">
          {canWrite() && unconvertedBalances.length > 0 && (
            <button
              onClick={() => openConvert(unconvertedBalances[0].code)}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-lg hover:bg-amber-600"
            >
              <RefreshCw className="w-4 h-4" /> Convert to NGN
            </button>
          )}
          {canWrite() && (
            <button
              onClick={() => setAddOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary-light"
            >
              <Plus className="w-4 h-4" /> Add Transaction
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Reconciliation prompt */}
      {unconvertedBalances.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <div>
            <span className="font-medium">Unconverted FX balances: </span>
            {unconvertedBalances.map(m => {
              const bal = summaryMap.get(m.code)?.currentBalance ?? 0
              return (
                <button
                  key={m.code}
                  onClick={() => openConvert(m.code)}
                  className="inline-flex items-center gap-1 mr-2 font-mono text-xs bg-amber-100 hover:bg-amber-200 px-1.5 py-0.5 rounded transition-colors"
                >
                  {m.flag} {m.code} {m.symbol}{fmtFX(bal, 2)}
                </button>
              )
            })}
            {canWrite() && (
              <span className="text-amber-700 text-xs">— Click a currency to record a conversion.</span>
            )}
          </div>
        </div>
      )}

      {/* Currency Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {FX_META.map(meta => {
          const s       = summaryMap.get(meta.code)
          const balance = s?.currentBalance ?? 0
          const active  = balance > 0
          return (
            <div
              key={meta.code}
              className={`rounded-xl border-2 p-4 transition-all select-none ${
                filterCcy === meta.code
                  ? 'border-primary bg-primary/5'
                  : 'border-gray-200 bg-white hover:border-gray-300'
              } ${!active ? 'opacity-60' : ''}`}
            >
              <div
                className="cursor-pointer"
                onClick={() => setFilterCcy(prev => prev === meta.code ? '' : meta.code)}
              >
                <div className="flex items-start justify-between mb-3">
                  <span className="text-2xl">{meta.flag}</span>
                  <span className="text-xs font-mono font-semibold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                    {meta.code}
                  </span>
                </div>
                <div className={`text-xl font-bold ${active ? 'text-gray-900' : 'text-gray-400'}`}>
                  {meta.symbol}{fmtFX(balance)}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">{meta.name}</div>
                {s && (
                  <div className="mt-3 grid grid-cols-2 gap-1 text-xs">
                    <div className="text-success">↑ {meta.symbol}{fmtFX(s.totalDeposits)}</div>
                    <div className="text-danger">↓ {meta.symbol}{fmtFX(s.totalWithdrawals)}</div>
                  </div>
                )}
              </div>
              {canWrite() && active && (
                <button
                  onClick={() => openConvert(meta.code)}
                  className="mt-3 w-full flex items-center justify-center gap-1 px-2 py-1.5 text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
                >
                  <RefreshCw className="w-3 h-3" /> Convert to NGN
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Naira Equivalent */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">
          Naira Equivalent (Enter Rates)
        </h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
          {FX_META.map(meta => {
            const bal   = summaryMap.get(meta.code)?.currentBalance ?? 0
            const rate  = rates[meta.code]
            const equiv = bal * rate
            return (
              <div key={meta.code} className="space-y-1.5">
                <label className="text-xs font-medium text-gray-500">
                  {meta.code} Rate (₦ per {meta.code})
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={rates[meta.code] || ''}
                  onChange={e =>
                    setRates(r => ({ ...r, [meta.code]: Number(e.target.value) }))
                  }
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                />
                <div className="text-xs text-gray-400">
                  {meta.symbol}{fmtFX(bal)} → ₦{fmtNGN(equiv)}
                </div>
              </div>
            )
          })}
        </div>
        <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">Total Naira Equivalent</span>
          <span className="text-lg font-bold text-primary">₦{fmtNGN(totalNairaEquivalent)}</span>
        </div>
      </div>

      {/* Conversion History */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowConversions(v => !v)}
          className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-amber-500" />
            <h2 className="text-sm font-semibold text-gray-700">
              Conversion History ({conversions.length})
            </h2>
          </div>
          <span className="text-xs text-gray-400">{showConversions ? 'Hide' : 'Show'}</span>
        </button>

        {showConversions && (
          convLoading ? (
            <div className="space-y-2 p-5">
              {[1,2,3].map(i => <div key={i} className="h-9 rounded bg-gray-100 animate-pulse" />)}
            </div>
          ) : conversions.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400 border-t border-gray-100">
              No conversions recorded yet.
            </div>
          ) : (
            <div className="overflow-x-auto border-t border-gray-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Currency</th>
                    <th className="px-4 py-3 text-right font-medium">FX Amount</th>
                    <th className="px-4 py-3 text-right font-medium">Rate (₦)</th>
                    <th className="px-4 py-3 text-right font-medium">NGN Received</th>
                    <th className="px-4 py-3 text-left font-medium">Notes</th>
                    <th className="px-4 py-3 text-center font-medium">Partial</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {conversions.map(c => {
                    const meta = FX_META.find(m => m.code === c.fx_currency)
                    return (
                      <tr key={c.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{c.date}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-xs font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                            {c.fx_currency}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right text-danger font-semibold">
                          {meta?.symbol}{fmtFX(c.fx_amount)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600 font-mono text-xs">
                          ₦{fmtNGN(c.exchange_rate)}
                        </td>
                        <td className="px-4 py-3 text-right text-success font-semibold">
                          ₦{fmtNGN(c.naira_amount)}
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs max-w-[160px] truncate">
                          {c.notes ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {c.is_partial && (
                            <span className="text-xs text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">Partial</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {/* Transaction Table */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold text-gray-700">
              Transactions{filterCcy ? ` — ${filterCcy}` : ' (All)'}
            </h2>
            {filterCcy && (
              <button
                onClick={() => setFilterCcy('')}
                className="text-xs text-primary underline"
              >
                Clear
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <div className="flex gap-1">
              {FX_META.map(m => (
                <button
                  key={m.code}
                  onClick={() => setFilterCcy(prev => prev === m.code ? '' : m.code)}
                  className={`px-2 py-1 text-xs rounded-md font-mono transition-colors ${
                    filterCcy === m.code
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {m.code}
                </button>
              ))}
            </div>
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-300 text-gray-600 rounded-lg hover:bg-gray-50"
            >
              <Download className="w-3 h-3" /> CSV
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-2 p-5">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            No transactions found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <th className="px-4 py-3 text-left font-medium">Date</th>
                  <th className="px-4 py-3 text-left font-medium">Currency</th>
                  <th className="px-4 py-3 text-left font-medium">Type</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3 text-right font-medium">Running Balance</th>
                  <th className="px-4 py-3 text-left font-medium">Narration</th>
                  <th className="px-4 py-3 text-left font-medium">Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {transactions.map(t => {
                  const isDeposit = t.deposit > 0
                  const meta      = FX_META.find(m => m.code === t.currency)!
                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{t.date}</td>
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-semibold bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          {t.currency}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                            isDeposit
                              ? 'bg-green-50 text-success'
                              : 'bg-red-50 text-danger'
                          }`}
                        >
                          {isDeposit
                            ? <TrendingUp className="w-3 h-3" />
                            : <TrendingDown className="w-3 h-3" />}
                          {isDeposit ? 'Deposit' : 'Withdrawal'}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-semibold ${
                          isDeposit ? 'text-success' : 'text-danger'
                        }`}
                      >
                        {meta.symbol}{fmtFX(isDeposit ? t.deposit : t.withdrawal)}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-700">
                        {meta.symbol}{fmtFX(t.running_balance)}
                      </td>
                      <td className="px-4 py-3 text-gray-600 max-w-[200px] truncate">
                        {t.narration ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-400 font-mono text-xs">
                        {t.transaction_ref ?? '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddFXModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={refetch}
        currentBalances={currentBalances}
      />
      <AddFXConversionModal
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        onSuccess={() => { refetch(); refetchConversions() }}
        summaries={allSummaries}
        defaultCurrency={convertCcy}
      />
    </div>
  )
}
