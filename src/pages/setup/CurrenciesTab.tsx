import React, { useState } from 'react'
import { Trash2, AlertCircle, Plus } from 'lucide-react'
import { useToastStore } from '../../store/toastStore'
import { useCurrencies, useAddCurrency, useDeleteCurrency } from '../../hooks/useCurrencies'
import { friendlyError } from '../../utils/friendlyError'

// ── Currencies tab ───────────────────────────────────────────────────────────────────

export function CurrenciesTab() {
  const { currencies, loading, error, refetch } = useCurrencies()
  const { mutate: addCurrency, loading: adding, error: addError, reset: resetAdd } = useAddCurrency()
  const { mutate: deleteCurrency } = useDeleteCurrency()
  const { push: toast } = useToastStore()

  const [code,   setCode]   = useState('')
  const [name,   setName]   = useState('')
  const [symbol, setSymbol] = useState('')
  const [flag,   setFlag]   = useState('')
  const [formErr, setFormErr] = useState<string | null>(null)

  const isMigrationError = !!error && /relation.*does not exist|does not exist/i.test(error)

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormErr(null)
    if (!code.trim())   { setFormErr('Currency code is required (e.g. CHF)'); return }
    if (!name.trim())   { setFormErr('Name is required'); return }
    if (!symbol.trim()) { setFormErr('Symbol is required (e.g. Fr.)'); return }
    try {
      await addCurrency({ code: code.trim().toUpperCase(), name: name.trim(), symbol: symbol.trim(), flag: flag.trim() || undefined })
      toast(`${code.toUpperCase()} added`, 'success')
      setCode(''); setName(''); setSymbol(''); setFlag('')
      resetAdd()
      refetch()
    } catch { /* error surfaced via addError */ }
  }

  const handleDelete = async (currCode: string) => {
    try {
      await deleteCurrency(currCode)
      toast(`${currCode} removed`, 'success')
      refetch()
    } catch (e: unknown) {
      toast(friendlyError(e, 'delete'), 'error')
    }
  }

  const iCls = 'px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary'

  return (
    <div className="max-w-2xl space-y-5">
      {/* Migration hint */}
      {isMigrationError && (
        <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>The currencies table is missing — please run the latest database migration, then refresh.</span>
        </div>
      )}

      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Manage the currencies available across banks, FX transactions, and deposits.</p>
      </div>

      {/* Add form */}
      <form onSubmit={handleAdd} className="border border-gray-200 rounded-xl p-4 space-y-3 bg-gray-50">
        <p className="text-xs font-semibold text-gray-500">Add Currency</p>
        {(formErr || addError) && (
          <p className="text-xs text-red-600">{formErr ?? addError}</p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Code *</label>
            <input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={6}
              placeholder="e.g. CHF" className={`${iCls} uppercase`} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Symbol *</label>
            <input value={symbol} onChange={e => setSymbol(e.target.value)} maxLength={6}
              placeholder="e.g. Fr." className={iCls} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              placeholder="e.g. Swiss Franc" className={iCls} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-600">Flag emoji</label>
            <input value={flag} onChange={e => setFlag(e.target.value)} maxLength={4}
              placeholder="e.g. 🇨🇭" className={iCls} />
          </div>
        </div>
        <div className="flex justify-end">
          <button type="submit" disabled={adding}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-60">
            {adding ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Plus className="w-4 h-4" />}
            {adding ? 'Adding…' : 'Add Currency'}
          </button>
        </div>
      </form>

      {/* Currency list */}
      {loading ? (
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-12 bg-gray-100 rounded-xl animate-pulse" />)}
        </div>
      ) : (
        <div className="border border-gray-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b-2 border-black/[0.06] dark:border-white/[0.07]">
                <th className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Code</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Name</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Symbol</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-bold text-gray-400 uppercase tracking-widest">Flag</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {currencies.map(c => (
                <tr key={c.code} className="hover:bg-gray-50">
                  <td className="px-4 py-2.5 font-mono font-semibold text-gray-800">{c.code}</td>
                  <td className="px-4 py-2.5 text-gray-700">{c.name}</td>
                  <td className="px-4 py-2.5 font-mono text-gray-600">{c.symbol}</td>
                  <td className="px-4 py-2.5 text-lg">{c.flag ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => handleDelete(c.code)}
                      className="touch-target p-1.5 rounded hover:bg-red-50 text-gray-300 hover:text-danger transition-colors"
                      title={`Remove ${c.code}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
