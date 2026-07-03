import { useState, useEffect, useCallback, Fragment } from 'react'
import {
  Plus, Pencil, Trash2, Scale, Package, Landmark, ChevronDown, ChevronRight,
  Copy, Check, Terminal,
} from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useRole } from '../hooks/useRole'
import { useOrgStore } from '../store/orgStore'
import { useOrgCurrency } from '../hooks/useOrgCurrency'
import { supabase } from '../lib/supabase'
import { Card } from '../components/ui/Card'
import { DeleteDialog } from '../components/ui/DeleteDialog'
import { AddAssetModal } from '../components/modals/AddAssetModal'
import { AddLiabilityModal } from '../components/modals/AddLiabilityModal'
import { useAssets, deleteAsset, netBookValue, ASSETS_MIGRATION_SQL, type Asset } from '../hooks/useAssets'
import { useLiabilities, deleteLiability, type Liability } from '../hooks/useLiabilities'
import { useToastStore } from '../store/toastStore'

// ── Types ──────────────────────────────────────────────────────────────────────

type Tab = 'assets' | 'liabilities' | 'balance-sheet'

interface CashPosition {
  totalInflow:    number
  totalOutflow:   number
  openingBalance: number
  net:            number
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(value: number, formatAmount: (n: number) => string): string {
  return formatAmount(value)
}

// ── Migration banner ───────────────────────────────────────────────────────────

function MigrationBanner() {
  const [open,   setOpen]   = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = () => {
    navigator.clipboard.writeText(ASSETS_MIGRATION_SQL).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="border border-amber-200 bg-amber-50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <div className="flex items-center gap-3">
          <Terminal className="w-4 h-4 text-amber-500 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">One-time database setup required</p>
            <p className="text-xs text-amber-600 mt-0.5">
              Run the migration SQL in your Supabase SQL editor to enable the asset and liability registers.
            </p>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-amber-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-amber-200 px-5 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-amber-700">Copy and run in Supabase → SQL Editor:</p>
            <button
              onClick={copy}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 transition-colors"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copied!' : 'Copy SQL'}
            </button>
          </div>
          <pre className="text-xs font-mono bg-white border border-amber-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all select-all text-gray-700 max-h-60">
            {ASSETS_MIGRATION_SQL}
          </pre>
        </div>
      )}
    </div>
  )
}

// ── Assets Tab ─────────────────────────────────────────────────────────────────

function AssetsTab() {
  const { assets, loading, error, refetch } = useAssets()
  const { canWrite } = useRole()
  const { formatAmount } = useOrgCurrency()
  const { push } = useToastStore()

  const [addOpen,    setAddOpen]    = useState(false)
  const [editRecord, setEditRecord] = useState<Asset | null>(null)
  const [delRecord,  setDelRecord]  = useState<Asset | null>(null)
  const [deleting,   setDeleting]   = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const needsMigration = !!error && /relation.*does not exist/i.test(error)

  const handleDelete = async () => {
    if (!delRecord) return
    setDeleting(true)
    try {
      await deleteAsset(delRecord.id)
      push('Asset deleted', 'success')
      refetch()
      setDelRecord(null)
    } catch (e) {
      push(e instanceof Error ? e.message : 'Delete failed', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const totalCost  = assets.reduce((s, a) => s + a.cost, 0)
  const totalValue = assets.reduce((s, a) => s + netBookValue(a), 0)

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-gray-500">
            {assets.length} {assets.length === 1 ? 'asset' : 'assets'} · Cost: <span className="font-semibold text-gray-700">{fmt(totalCost, formatAmount)}</span> · Net value: <span className="font-semibold text-gray-700">{fmt(totalValue, formatAmount)}</span>
          </p>
        </div>
        {canWrite() && (
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Asset
          </button>
        )}
      </div>

      {needsMigration && <MigrationBanner />}

      {!needsMigration && !loading && assets.length === 0 && (
        <Card className="text-center py-12">
          <Package className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No assets recorded yet</p>
          <p className="text-xs text-gray-400 mt-1">Add equipment, vehicles, or property to track depreciation</p>
        </Card>
      )}

      {assets.length > 0 && (
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide w-8"></th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Purchased</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 text-xs uppercase tracking-wide">Cost</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 text-xs uppercase tracking-wide">Net Book Value</th>
                  {canWrite() && <th className="px-4 py-3 w-20"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {assets.map(asset => {
                  const isExpanded = expandedId === asset.id
                  const nbv = netBookValue(asset)
                  return (
                    <Fragment key={asset.id}>
                      <tr className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : asset.id)}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded
                              ? <ChevronDown className="w-3.5 h-3.5" />
                              : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{asset.name}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-slate-100 text-slate-600 rounded-full px-2 py-0.5 font-medium">
                            {asset.asset_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{asset.purchase_date}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-gray-700 whitespace-nowrap">
                          {fmt(asset.cost, formatAmount)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold whitespace-nowrap">
                          <span className={nbv < asset.cost ? 'text-amber-700' : 'text-gray-700'}>
                            {fmt(nbv, formatAmount)}
                          </span>
                        </td>
                        {canWrite() && (
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setEditRecord(asset)}
                                className="p-1.5 text-gray-400 hover:text-primary rounded-lg transition-colors"
                                aria-label="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDelRecord(asset)}
                                className="p-1.5 text-gray-400 hover:text-danger rounded-lg transition-colors"
                                aria-label="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50/70">
                          <td colSpan={canWrite() ? 7 : 6} className="px-8 py-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                              <div>
                                <p className="text-gray-400 mb-0.5">Salvage Value</p>
                                <p className="font-medium text-gray-700">{fmt(asset.salvage_value, formatAmount)}</p>
                              </div>
                              {asset.useful_life_years && (
                                <div>
                                  <p className="text-gray-400 mb-0.5">Useful Life</p>
                                  <p className="font-medium text-gray-700">{asset.useful_life_years} years</p>
                                </div>
                              )}
                              <div>
                                <p className="text-gray-400 mb-0.5">Depreciated</p>
                                <p className="font-medium text-amber-700">{fmt(asset.cost - nbv, formatAmount)}</p>
                              </div>
                              {asset.notes && (
                                <div className="col-span-2 sm:col-span-1">
                                  <p className="text-gray-400 mb-0.5">Notes</p>
                                  <p className="text-gray-600 break-words">{asset.notes}</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <AddAssetModal
        open={addOpen || !!editRecord}
        onClose={() => { setAddOpen(false); setEditRecord(null) }}
        onSaved={refetch}
        editRecord={editRecord}
      />

      <DeleteDialog
        open={!!delRecord}
        onClose={() => setDelRecord(null)}
        onConfirm={handleDelete}
        loading={deleting}
        label={delRecord?.name ?? 'this asset'}
      />
    </>
  )
}

// ── Liabilities Tab ────────────────────────────────────────────────────────────

function LiabilitiesTab() {
  const { liabilities, loading, error, refetch } = useLiabilities()
  const { canWrite } = useRole()
  const { formatAmount } = useOrgCurrency()
  const { push } = useToastStore()

  const [addOpen,    setAddOpen]    = useState(false)
  const [editRecord, setEditRecord] = useState<Liability | null>(null)
  const [delRecord,  setDelRecord]  = useState<Liability | null>(null)
  const [deleting,   setDeleting]   = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const needsMigration = !!error && /relation.*does not exist/i.test(error)

  const handleDelete = async () => {
    if (!delRecord) return
    setDeleting(true)
    try {
      await deleteLiability(delRecord.id)
      push('Liability deleted', 'success')
      refetch()
      setDelRecord(null)
    } catch (e) {
      push(e instanceof Error ? e.message : 'Delete failed', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const totalOutstanding = liabilities.reduce((s, l) => s + l.outstanding_balance, 0)
  const totalPrincipal   = liabilities.reduce((s, l) => s + l.principal_amount, 0)

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm text-gray-500">
            {liabilities.length} {liabilities.length === 1 ? 'liability' : 'liabilities'} · Outstanding: <span className="font-semibold text-danger">{fmt(totalOutstanding, formatAmount)}</span>
          </p>
        </div>
        {canWrite() && (
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Liability
          </button>
        )}
      </div>

      {needsMigration && <MigrationBanner />}

      {!needsMigration && !loading && liabilities.length === 0 && (
        <Card className="text-center py-12">
          <Landmark className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-500">No liabilities recorded yet</p>
          <p className="text-xs text-gray-400 mt-1">Add loans, accounts payable, or credit lines</p>
        </Card>
      )}

      {liabilities.length > 0 && (
        <Card padding={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide w-8"></th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600 text-xs uppercase tracking-wide">Lender</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 text-xs uppercase tracking-wide">Principal</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600 text-xs uppercase tracking-wide">Outstanding</th>
                  {canWrite() && <th className="px-4 py-3 w-20"></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {liabilities.map(lib => {
                  const isExpanded = expandedId === lib.id
                  const repaid = lib.principal_amount - lib.outstanding_balance
                  return (
                    <Fragment key={lib.id}>
                      <tr className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setExpandedId(isExpanded ? null : lib.id)}
                            className="text-gray-400 hover:text-gray-600 transition-colors"
                            aria-label={isExpanded ? 'Collapse' : 'Expand'}
                          >
                            {isExpanded
                              ? <ChevronDown className="w-3.5 h-3.5" />
                              : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">{lib.name}</td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-red-50 text-red-600 rounded-full px-2 py-0.5 font-medium">
                            {lib.liability_type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">{lib.lender ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-gray-700 whitespace-nowrap">
                          {fmt(lib.principal_amount, formatAmount)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold text-danger whitespace-nowrap">
                          {fmt(lib.outstanding_balance, formatAmount)}
                        </td>
                        {canWrite() && (
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => setEditRecord(lib)}
                                className="p-1.5 text-gray-400 hover:text-primary rounded-lg transition-colors"
                                aria-label="Edit"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => setDelRecord(lib)}
                                className="p-1.5 text-gray-400 hover:text-danger rounded-lg transition-colors"
                                aria-label="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                      {isExpanded && (
                        <tr className="bg-gray-50/70">
                          <td colSpan={canWrite() ? 7 : 6} className="px-8 py-3">
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                              {lib.interest_rate != null && (
                                <div>
                                  <p className="text-gray-400 mb-0.5">Interest Rate</p>
                                  <p className="font-medium text-gray-700">{lib.interest_rate}% p.a.</p>
                                </div>
                              )}
                              <div>
                                <p className="text-gray-400 mb-0.5">Repaid</p>
                                <p className="font-medium text-success">{fmt(repaid, formatAmount)}</p>
                              </div>
                              {lib.due_date && (
                                <div>
                                  <p className="text-gray-400 mb-0.5">Due Date</p>
                                  <p className="font-medium text-gray-700">{lib.due_date}</p>
                                </div>
                              )}
                              {lib.repayment_notes && (
                                <div className="col-span-2">
                                  <p className="text-gray-400 mb-0.5">Repayment Schedule</p>
                                  <p className="text-gray-600">{lib.repayment_notes}</p>
                                </div>
                              )}
                              {lib.notes && (
                                <div className="col-span-2">
                                  <p className="text-gray-400 mb-0.5">Notes</p>
                                  <p className="text-gray-600 break-words">{lib.notes}</p>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={canWrite() ? 5 : 4} className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Total
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-gray-700 whitespace-nowrap text-sm">
                    {fmt(totalPrincipal, formatAmount)}
                  </td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-danger whitespace-nowrap text-sm">
                    {fmt(totalOutstanding, formatAmount)}
                  </td>
                  {canWrite() && <td />}
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      <AddLiabilityModal
        open={addOpen || !!editRecord}
        onClose={() => { setAddOpen(false); setEditRecord(null) }}
        onSaved={refetch}
        editRecord={editRecord}
      />

      <DeleteDialog
        open={!!delRecord}
        onClose={() => setDelRecord(null)}
        onConfirm={handleDelete}
        loading={deleting}
        label={delRecord?.name ?? 'this liability'}
      />
    </>
  )
}

// ── Balance Sheet Tab ──────────────────────────────────────────────────────────

function BalanceSheetLine({
  label, value, indent = false, bold = false, separator = false, formatAmount,
}: {
  label: string
  value?: number
  indent?: boolean
  bold?: boolean
  separator?: boolean
  formatAmount: (n: number) => string
}) {
  return (
    <div className={`flex items-center justify-between py-2.5 ${separator ? 'border-t border-gray-200 mt-1' : ''}`}>
      <span className={`text-sm ${indent ? 'pl-6 text-gray-500' : bold ? 'font-semibold text-gray-800' : 'text-gray-700'}`}>
        {label}
      </span>
      {value !== undefined && (
        <span className={`font-mono text-sm whitespace-nowrap ${bold ? 'font-bold text-gray-900' : 'font-semibold text-gray-700'}`}>
          {fmt(value, formatAmount)}
        </span>
      )}
    </div>
  )
}

function BalanceSheetTab() {
  const orgId = useOrgStore(s => s.orgId)
  const { assets } = useAssets()
  const { liabilities } = useLiabilities()
  const { formatAmount } = useOrgCurrency()

  const [cash,    setCash]    = useState<CashPosition | null>(null)
  const [loading, setLoading] = useState(true)

  const fetchCash = useCallback(async () => {
    if (!orgId) { setLoading(false); return }
    setLoading(true)
    const typeFilter = 'transaction_type.is.null,transaction_type.not.in.(bank_deposit,intrabank_transfer)'

    const [inflowRes, outflowRes, bankRes] = await Promise.all([
      supabase
        .from('inflow_transactions')
        .select('amount')
        .eq('org_id', orgId)
        .or(typeFilter),
      supabase
        .from('outflow_transactions')
        .select('amount_disbursed')
        .eq('org_id', orgId)
        .or(typeFilter),
      supabase
        .from('banks')
        .select('starting_balance')
        .eq('org_id', orgId)
        .eq('is_foreign_currency', false),
    ])

    const totalInflow    = (inflowRes.data  ?? []).reduce((s, r: { amount: number }) => s + Number(r.amount), 0)
    const totalOutflow   = (outflowRes.data ?? []).reduce((s, r: { amount_disbursed: number }) => s + Number(r.amount_disbursed), 0)
    const openingBalance = (bankRes.data    ?? []).reduce((s, r: { starting_balance: number }) => s + Number(r.starting_balance ?? 0), 0)

    setCash({ totalInflow, totalOutflow, openingBalance, net: totalInflow - totalOutflow + openingBalance })
    setLoading(false)
  }, [orgId])

  useEffect(() => { fetchCash() }, [fetchCash])

  const cashTotal       = cash?.net ?? 0
  const assetsByType    = assets.reduce<Record<string, { cost: number; nbv: number }>>((acc, a) => {
    if (!acc[a.asset_type]) acc[a.asset_type] = { cost: 0, nbv: 0 }
    acc[a.asset_type].cost += a.cost
    acc[a.asset_type].nbv  += netBookValue(a)
    return acc
  }, {})
  const totalFixedAssets  = Object.values(assetsByType).reduce((s, v) => s + v.nbv, 0)
  const totalAssets       = cashTotal + totalFixedAssets

  const liabsByType  = liabilities.reduce<Record<string, number>>((acc, l) => {
    acc[l.liability_type] = (acc[l.liability_type] ?? 0) + l.outstanding_balance
    return acc
  }, {})
  const totalLiabilities = liabilities.reduce((s, l) => s + l.outstanding_balance, 0)
  const netAssets        = totalAssets - totalLiabilities

  const today = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })

  if (loading) {
    return (
      <Card className="flex items-center justify-center py-16">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </Card>
    )
  }

  return (
    <div className="max-w-2xl">
      <Card>
        <div className="text-center mb-6 pb-5 border-b border-gray-100">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-1">Statement of Financial Position</p>
          <p className="text-xs text-gray-400">As at {today}</p>
        </div>

        {/* ASSETS */}
        <div className="mb-6">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Assets</p>

          <div className="space-y-0 divide-y divide-gray-50">
            {/* Cash */}
            <BalanceSheetLine label="Cash & Bank Balances" indent value={cashTotal} formatAmount={formatAmount} />

            {/* Fixed assets by type */}
            {Object.entries(assetsByType).map(([type, { nbv }]) => (
              <BalanceSheetLine key={type} label={`${type} (net)`} indent value={nbv} formatAmount={formatAmount} />
            ))}

            <BalanceSheetLine label="Total Assets" value={totalAssets} bold separator formatAmount={formatAmount} />
          </div>
        </div>

        {/* LIABILITIES */}
        <div className="mb-6">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-2">Liabilities</p>

          <div className="divide-y divide-gray-50">
            {Object.entries(liabsByType).map(([type, amount]) => (
              <BalanceSheetLine key={type} label={type} indent value={amount} formatAmount={formatAmount} />
            ))}
            {liabilities.length === 0 && (
              <p className="text-sm text-gray-400 italic py-2">No liabilities recorded</p>
            )}
            <BalanceSheetLine label="Total Liabilities" value={totalLiabilities} bold separator formatAmount={formatAmount} />
          </div>
        </div>

        {/* NET ASSETS */}
        <div className={`rounded-xl p-4 ${netAssets >= 0 ? 'bg-green-50 border border-green-100' : 'bg-red-50 border border-red-100'}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Net Assets</p>
              <p className="text-xs text-gray-400 mt-0.5">Total Assets − Total Liabilities</p>
            </div>
            <p className={`font-mono font-bold text-xl ${netAssets >= 0 ? 'text-success' : 'text-danger'}`}>
              {fmt(netAssets, formatAmount)}
            </p>
          </div>
        </div>

        {/* Footnote */}
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-1">
          <p className="text-[10px] text-gray-400">
            · Cash figure is all-time net cash position (inflows − outflows + opening bank balances, base currency only).
          </p>
          <p className="text-[10px] text-gray-400">
            · Fixed asset values use straight-line depreciation from purchase date.
          </p>
          <p className="text-[10px] text-gray-400">
            · Foreign currency positions are not included in this statement.
          </p>
        </div>
      </Card>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function HealthCentre() {
  usePageTitle('Health Centre')
  const [tab, setTab] = useState<Tab>('assets')

  const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
    { id: 'assets',        label: 'Asset Register',     icon: Package  },
    { id: 'liabilities',   label: 'Liability Register', icon: Landmark },
    { id: 'balance-sheet', label: 'Balance Sheet',      icon: Scale    },
  ]

  return (
    <div className="space-y-5">
      {/* Page header */}
      <div>
        <div className="flex items-center gap-2.5">
          <Scale className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-bold text-gray-900">Health Centre</h1>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">Know your financial position — assets, liabilities, and net worth.</p>
      </div>

      {/* Tab bar */}
      <div className="border-b border-gray-200 -mt-1">
        <nav className="-mb-px flex gap-0 overflow-x-auto">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                tab === id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {tab === 'assets'        && <AssetsTab />}
      {tab === 'liabilities'   && <LiabilitiesTab />}
      {tab === 'balance-sheet' && <BalanceSheetTab />}
    </div>
  )
}
