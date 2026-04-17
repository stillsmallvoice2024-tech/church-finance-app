import { useState, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import {
  Search, Plus, Download, BookOpen, TrendingUp, TrendingDown,
  Wallet, PlusCircle, ArrowUp, ArrowDown, Pencil, Trash2, LockOpen,
} from 'lucide-react'
import { Card }                     from '../components/ui/Card'
import { Badge }                    from '../components/ui/Badge'
import { DeleteDialog }             from '../components/ui/DeleteDialog'
import { Modal }                    from '../components/ui/Modal'
import { AddAccountModal }          from '../components/modals/AddAccountModal'
import { AddLedgerEntryModal }      from '../components/modals/AddLedgerEntryModal'
import { useAccounts, useAccountLatestBalances, useLedgerEntries } from '../hooks/useLedger'
import { useYearRange } from '../hooks/useYearRange'
import type { DbAccount }           from '../hooks/useLedger'
import { useDeleteTransaction, useDeleteAccount } from '../hooks/useMutations'
import { useToastStore }            from '../store/toastStore'
import { usePageTitle }             from '../hooks/usePageTitle'
import { formatDate, formatCurrency, formatCurrencyCompact } from '../utils/formatters'
import { exportCSV }                from '../utils/csvExport'
import { supabase }                 from '../lib/supabase'

// ── Category config ────────────────────────────────────────────────────────────

const CATEGORY_ORDER = ['income', 'expense', 'savings', 'ministry', 'special', 'foreign'] as const
const CATEGORY_LABELS: Record<string, string> = {
  income: 'Income', expense: 'Expense', savings: 'Savings',
  ministry: 'Ministry', special: 'Special', foreign: 'Foreign',
}
const CATEGORY_BADGE: Record<string, 'success' | 'danger' | 'primary' | 'warning' | 'neutral'> = {
  income: 'success', expense: 'danger', savings: 'primary',
  ministry: 'warning', special: 'neutral', foreign: 'neutral',
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AccountsPage() {
  const [selectedId,        setSelectedId]        = useState<string | null>(null)
  const [search,            setSearch]            = useState('')
  const [addAccountOpen,    setAddAccountOpen]    = useState(false)
  const [editAccountRecord, setEditAccountRecord] = useState<DbAccount | null>(null)
  const [deleteAccountId,   setDeleteAccountId]   = useState<string | null>(null)
  const [addEntryOpen,      setAddEntryOpen]      = useState(false)
  const [deleteLedgerId,    setDeleteLedgerId]    = useState<string | null>(null)
  const [balRefetch,        setBalRefetch]        = useState(0)

  const { push: toast }   = useToastStore()

  // ── Edit-mode password gate ────────────────────────────────────────────────
  const [editUnlocked,     setEditUnlocked]     = useState(false)
  const [passwordOpen,     setPasswordOpen]     = useState(false)
  const [passwordInput,    setPasswordInput]    = useState('')
  const [passwordError,    setPasswordError]    = useState<string | null>(null)
  const [passwordChecking, setPasswordChecking] = useState(false)
  const [pendingAction,    setPendingAction]    = useState<(() => void) | null>(null)

  const withAuth = (action: () => void) => {
    if (editUnlocked) { action(); return }
    setPendingAction(() => action)
    setPasswordOpen(true)
  }

  const closePasswordModal = () => {
    setPasswordOpen(false)
    setPasswordInput('')
    setPasswordError(null)
    setPendingAction(null)
  }

  const handlePasswordSubmit = async () => {
    if (!passwordInput) return
    setPasswordChecking(true)
    setPasswordError(null)
    try {
      const { data, error } = await supabase.rpc('verify_edit_password', { input_password: passwordInput })
      if (error) throw error
      if (data === true) {
        setEditUnlocked(true)
        setPasswordOpen(false)
        setPasswordInput('')
        pendingAction?.()
        setPendingAction(null)
      } else {
        setPasswordError('Incorrect password. Please try again.')
      }
    } catch (e: unknown) {
      setPasswordError(e instanceof Error ? e.message : 'Verification failed')
    } finally {
      setPasswordChecking(false)
    }
  }

  usePageTitle('Accounts')

  // ── Data ───────────────────────────────────────────────────────────────────
  const { dateFrom: yearStart, dateTo: yearEnd } = useYearRange()
  const { accounts, loading: acctLoading, error: acctError, refetch: refetchAccounts } = useAccounts()
  const { balances }                                                  = useAccountLatestBalances(balRefetch)

  const selectedAccount = useMemo(
    () => accounts.find(a => a.id === selectedId) ?? null,
    [accounts, selectedId],
  )

  const { entries, runningBalance, loading: ledgerLoading, refetch: refetchLedger } =
    useLedgerEntries(selectedId ?? '', { dateFrom: yearStart, dateTo: yearEnd })

  // ── Sidebar groups ─────────────────────────────────────────────────────────
  const filtered = useMemo(
    () => accounts.filter(a => a.name.toLowerCase().includes(search.toLowerCase()) ||
                               a.code.includes(search)),
    [accounts, search],
  )
  const grouped = useMemo(
    () => CATEGORY_ORDER.map(cat => ({
      cat,
      items: filtered.filter(a => a.category === cat),
    })).filter(g => g.items.length > 0),
    [filtered],
  )

  // ── Account stats ──────────────────────────────────────────────────────────
  const totalInflow   = useMemo(() => entries.reduce((s, e) => s + Number(e.inflow) + Number(e.refund_intraflow), 0), [entries])
  const totalOutflow  = useMemo(() => entries.reduce((s, e) => s + Number(e.outflow), 0), [entries])
  const openingBal    = selectedAccount ? Number(selectedAccount.opening_balance) : 0
  const currentBal    = entries.length > 0 ? runningBalance : openingBal
  const netChange     = currentBal - openingBal

  // ── Chart data ─────────────────────────────────────────────────────────────
  const chartData = useMemo(() => entries.map(e => ({
    date:    e.date,
    balance: Number(e.balance),
  })), [entries])

  // ── Ledger totals row ──────────────────────────────────────────────────────
  const totals = useMemo(() => ({
    inflow:           entries.reduce((s, e) => s + Number(e.inflow), 0),
    refund_intraflow: entries.reduce((s, e) => s + Number(e.refund_intraflow), 0),
    outflow:          entries.reduce((s, e) => s + Number(e.outflow), 0),
  }), [entries])

  // ── Delete account ─────────────────────────────────────────────────────────
  const { mutate: deleteAccount, loading: deletingAccount } = useDeleteAccount()

  const handleDeleteAccount = async () => {
    if (!deleteAccountId) return
    try {
      await deleteAccount(deleteAccountId)
      toast('Account deleted', 'success')
      if (selectedId === deleteAccountId) setSelectedId(null)
      setDeleteAccountId(null)
      refetchAccounts()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error')
    }
  }

  // ── Delete ledger entry ────────────────────────────────────────────────────
  const { loading: deleting } = useDeleteTransaction('inflow_transactions')
  // Note: ledger_entries deletion would need its own hook; for now just use a generic approach
  const handleDeleteLedger = async () => {
    if (!deleteLedgerId) return
    try {
      // Direct delete via supabase (no dedicated hook yet)
      const { error } = await import('../lib/supabase').then(m =>
        m.supabase.from('ledger_entries').delete().eq('id', deleteLedgerId)
      )
      if (error) throw error
      toast('Entry deleted', 'success')
      setDeleteLedgerId(null)
      refetchLedger()
      setBalRefetch(t => t + 1)
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error')
    }
  }

  const handleExport = () => {
    if (!selectedAccount) return
    exportCSV(
      `ledger-${selectedAccount.code}-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Date', 'Description', 'Inflow (₦)', 'Refund/Intra (₦)', 'Outflow (₦)', 'Balance (₦)', 'Seed Description'],
      entries.map(e => [e.date, e.description, e.inflow, e.refund_intraflow, e.outflow, e.balance, e.special_seed_description]),
    )
  }

  const handleEntrySuccess = () => {
    toast('Ledger entry added', 'success')
    refetchLedger()
    setBalRefetch(t => t + 1)
  }

  const handleAccountSuccess = () => {
    toast(editAccountRecord ? 'Account updated' : 'Account created', 'success')
    setEditAccountRecord(null)
    refetchAccounts()
  }

  return (
    <>
      <div className="flex h-[calc(100vh-64px-2rem)] gap-0 -mx-4 lg:-mx-6 -my-4 lg:-my-6 overflow-hidden">

        {/* ── LEFT PANEL ──────────────────────────────────────────────────── */}
        <aside className="w-72 shrink-0 flex flex-col border-r border-gray-100 bg-white overflow-hidden">
          {/* Top actions */}
          <div className="px-4 pt-4 pb-3 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Accounts</h2>
              <div className="flex items-center gap-1.5">
                {editUnlocked && (
                  <button
                    onClick={() => setEditUnlocked(false)}
                    title="Click to lock"
                    className="flex items-center gap-1 px-2 py-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
                  >
                    <LockOpen className="w-3 h-3" /> Editing
                  </button>
                )}
                <button
                  onClick={() => withAuth(() => setAddAccountOpen(true))}
                  className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </div>
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Search accounts…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
          </div>

          {/* Account list */}
          <div className="overflow-y-auto flex-1 pb-4">
            {acctLoading ? (
              <div className="px-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
                ))}
              </div>
            ) : acctError ? (
              <div className="mx-4 mt-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
                {acctError}
              </div>
            ) : grouped.length === 0 ? (
              <p className="text-center text-sm text-gray-400 mt-8">No accounts found.</p>
            ) : (
              grouped.map(({ cat, items }) => (
                <div key={cat}>
                  <p className="px-4 pt-3 pb-1 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                    {CATEGORY_LABELS[cat]}
                  </p>
                  {items.map(acct => {
                    const bal        = balances.get(acct.id) ?? Number(acct.opening_balance)
                    const isSelected = acct.id === selectedId
                    return (
                      <div
                        key={acct.id}
                        onClick={() => setSelectedId(acct.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={e => e.key === 'Enter' && setSelectedId(acct.id)}
                        className={`w-full cursor-pointer px-4 py-2.5 transition-colors flex items-center justify-between gap-2 group ${
                          isSelected
                            ? 'bg-primary text-white'
                            : 'hover:bg-gray-50 text-gray-800'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={`text-sm font-medium truncate ${isSelected ? 'text-white' : 'text-gray-800'}`}>
                            {acct.name}
                          </p>
                          <span className={`text-xs font-mono ${isSelected ? 'text-blue-200' : 'text-gray-400'}`}>
                            {acct.code}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className={`text-sm font-semibold tabular-nums ${
                            isSelected ? 'text-white' : bal >= 0 ? 'text-success' : 'text-danger'
                          }`}>
                            {formatCurrencyCompact(bal)}
                          </span>
                          <button
                            onClick={e => { e.stopPropagation(); withAuth(() => { setEditAccountRecord(acct); setAddAccountOpen(true) }) }}
                            className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity ${isSelected ? 'hover:bg-white/20 text-white' : 'hover:bg-gray-200 text-gray-500'}`}
                            title="Edit account"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={e => { e.stopPropagation(); withAuth(() => setDeleteAccountId(acct.id)) }}
                            className={`opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity ${isSelected ? 'hover:bg-white/20 text-white' : 'hover:bg-red-50 text-danger'}`}
                            title="Delete account"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* ── RIGHT PANEL ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto bg-gray-50 p-4 lg:p-6 space-y-5">
          {!selectedAccount ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-gray-400">
              <BookOpen className="w-14 h-14 text-gray-200" />
              <p className="text-sm">Select an account to view its ledger.</p>
            </div>
          ) : (
            <>
              {/* ── A. Account header card ─────────────────────────────── */}
              <Card>
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h1 className="text-xl font-bold text-gray-900">{selectedAccount.name}</h1>
                      <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-600">{selectedAccount.code}</span>
                    </div>
                    <Badge label={CATEGORY_LABELS[selectedAccount.category]} variant={CATEGORY_BADGE[selectedAccount.category]} />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleExport}
                      disabled={entries.length === 0}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" /> Export CSV
                    </button>
                    <button
                      onClick={() => withAuth(() => setAddEntryOpen(true))}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
                    >
                      <PlusCircle className="w-3.5 h-3.5" /> Add Entry
                    </button>
                  </div>
                </div>

                {/* Stats row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-5 pt-5 border-t border-gray-100">
                  {[
                    { label: 'Opening Balance', value: openingBal, icon: <Wallet className="w-4 h-4" /> },
                    { label: 'Total Inflows',   value: totalInflow,  icon: <TrendingUp  className="w-4 h-4 text-success" /> },
                    { label: 'Total Outflows',  value: totalOutflow, icon: <TrendingDown className="w-4 h-4 text-danger" /> },
                    { label: 'Current Balance', value: currentBal,   icon: <Wallet className="w-4 h-4 text-primary" /> },
                  ].map(({ label, value, icon }) => (
                    <div key={label}>
                      <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-1">{icon}{label}</div>
                      <p className={`text-lg font-bold ${
                        label === 'Total Outflows' ? 'text-danger' :
                        label === 'Total Inflows'  ? 'text-success' :
                        label === 'Current Balance' && value < 0 ? 'text-danger' : 'text-gray-900'
                      }`}>
                        {formatCurrencyCompact(value)}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Net change */}
                <div className={`mt-3 flex items-center gap-1.5 text-sm font-medium ${netChange >= 0 ? 'text-success' : 'text-danger'}`}>
                  {netChange >= 0 ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
                  Net change: {netChange >= 0 ? '+' : ''}{formatCurrency(netChange)}
                </div>
              </Card>

              {/* ── B. Balance trend chart ─────────────────────────────── */}
              <Card>
                <h2 className="text-sm font-semibold text-gray-800 mb-4">Balance Trend</h2>
                {ledgerLoading ? (
                  <div className="h-48 flex items-center justify-center">
                    <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : chartData.length < 2 ? (
                  <div className="h-48 flex items-center justify-center text-sm text-gray-400">
                    Not enough data to display a trend.
                  </div>
                ) : (
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                        <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} />
                        <YAxis tickFormatter={v => formatCurrencyCompact(v)} tick={{ fontSize: 11, fill: '#6B7280' }} axisLine={false} tickLine={false} width={64} />
                        <Tooltip formatter={(v: number) => [formatCurrency(v), 'Balance']} contentStyle={{ borderRadius: '0.75rem', fontSize: '13px' }} />
                        <Line type="monotone" dataKey="balance" stroke="#1E3A8A" strokeWidth={2} dot={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Card>

              {/* ── C. Ledger entries table ────────────────────────────── */}
              <Card padding={false}>
                <div className="px-4 py-3 border-b border-gray-100">
                  <h2 className="text-sm font-semibold text-gray-800">Ledger Entries</h2>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Date', 'Description', 'Inflow (₦)', 'Refund/Intra', 'Outflow (₦)', 'Balance (₦)', 'Actions'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {ledgerLoading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <tr key={i}>{Array.from({ length: 7 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-gray-200 rounded animate-pulse" /></td>)}</tr>
                        ))
                      ) : entries.length === 0 ? (
                        <tr><td colSpan={7} className="py-12 text-center text-sm text-gray-400">No ledger entries yet.</td></tr>
                      ) : (
                        entries.map(e => (
                          <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{formatDate(e.date)}</td>
                            <td className="px-4 py-3 text-sm text-gray-800 max-w-[200px] truncate">{e.description ?? '—'}</td>
                            <td className="px-4 py-3 text-sm font-medium text-success whitespace-nowrap">
                              {Number(e.inflow) > 0 ? formatCurrency(Number(e.inflow)) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                              {Number(e.refund_intraflow) > 0 ? formatCurrency(Number(e.refund_intraflow)) : '—'}
                            </td>
                            <td className="px-4 py-3 text-sm font-medium text-danger whitespace-nowrap">
                              {Number(e.outflow) > 0 ? formatCurrency(Number(e.outflow)) : '—'}
                            </td>
                            <td className={`px-4 py-3 text-sm font-bold whitespace-nowrap ${Number(e.balance) >= 0 ? 'text-success' : 'text-danger'}`}>
                              {formatCurrency(Number(e.balance))}
                            </td>
                            <td className="px-4 py-3">
                              <button onClick={() => withAuth(() => setDeleteLedgerId(e.id))} className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors">
                                <span className="text-xs font-medium">Del</span>
                              </button>
                            </td>
                          </tr>
                        ))
                      )}

                      {/* Totals row */}
                      {entries.length > 0 && (
                        <tr className="bg-gray-50 font-semibold border-t border-gray-200">
                          <td colSpan={2} className="px-4 py-3 text-sm text-gray-600">Totals</td>
                          <td className="px-4 py-3 text-sm text-success">{formatCurrency(totals.inflow)}</td>
                          <td className="px-4 py-3 text-sm text-gray-600">{formatCurrency(totals.refund_intraflow)}</td>
                          <td className="px-4 py-3 text-sm text-danger">{formatCurrency(totals.outflow)}</td>
                          <td className="px-4 py-3 text-sm">{formatCurrency(currentBal)}</td>
                          <td />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            </>
          )}
        </main>
      </div>

      {/* ── Modals ────────────────────────────────────────────────────────────── */}
      <AddAccountModal
        open={addAccountOpen}
        onClose={() => { setAddAccountOpen(false); setEditAccountRecord(null) }}
        onSuccess={handleAccountSuccess}
        editRecord={editAccountRecord}
      />
      <DeleteDialog
        open={!!deleteAccountId}
        onClose={() => setDeleteAccountId(null)}
        onConfirm={handleDeleteAccount}
        loading={deletingAccount}
        label="this account"
      />
      <AddLedgerEntryModal
        open={addEntryOpen}
        onClose={() => setAddEntryOpen(false)}
        onSuccess={handleEntrySuccess}
        accountId={selectedId ?? ''}
        previousBalance={entries.length > 0 ? runningBalance : openingBal}
      />
      <DeleteDialog
        open={!!deleteLedgerId}
        onClose={() => setDeleteLedgerId(null)}
        onConfirm={handleDeleteLedger}
        loading={deleting}
        label="this ledger entry"
      />

      {/* ── Password gate ──────────────────────────────────────────────────── */}
      <Modal open={passwordOpen} onClose={closePasswordModal} title="Edit Access" size="max-w-sm">
        <form
          onSubmit={e => { e.preventDefault(); handlePasswordSubmit() }}
          className="space-y-4"
        >
          <p className="text-sm text-gray-600">
            Enter the edit password to make changes to accounts and ledger entries.
          </p>
          <div className="space-y-1">
            <input
              type="password"
              autoFocus
              placeholder="Password"
              value={passwordInput}
              onChange={e => { setPasswordInput(e.target.value); setPasswordError(null) }}
              className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            {passwordError && <p className="text-xs text-red-500">{passwordError}</p>}
          </div>
          <p className="text-xs text-gray-400">
            Once unlocked, you can make multiple edits without re-entering the password.
          </p>
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closePasswordModal}
              disabled={passwordChecking}
              className="px-4 py-2 text-sm border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={passwordChecking || !passwordInput}
              className="flex items-center gap-2 px-4 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-light disabled:opacity-60"
            >
              {passwordChecking && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              {passwordChecking ? 'Checking…' : 'Unlock'}
            </button>
          </div>
        </form>
      </Modal>
    </>
  )
}
