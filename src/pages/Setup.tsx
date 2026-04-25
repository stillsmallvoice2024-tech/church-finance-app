import { useState, useEffect } from 'react'
import { CalendarDays, CheckCircle2, Pencil, Trash2, Landmark, AlertCircle, Plus, Layers, Lock, LockOpen, FileEdit, Copy, Terminal, ShieldAlert } from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useAccountingYearStore } from '../store/accountingYearStore'
import { useBanks, type DbBank } from '../hooks/useBanks'
import { AddBankModal } from '../components/modals/AddBankModal'
import { DeleteDialog }  from '../components/ui/DeleteDialog'
import { useDeleteBank } from '../hooks/useMutations'
import { useToastStore } from '../store/toastStore'
import { useAllocationStore, type AllocationConfig } from '../store/allocationStore'
import { AllocationConfigModal } from '../components/modals/AllocationConfigModal'
import { CreateSpecialConfigModal } from '../components/modals/CreateSpecialConfigModal'
import { ResetDataModal }           from '../components/modals/ResetDataModal'
import {
  useLockAllocationConfig,
  useUnlockAllocationConfig,
} from '../hooks/useMutations'
import { Modal } from '../components/ui/Modal'
import { formatDate } from '../utils/formatters'
import { supabase } from '../lib/supabase'

const TABS = ['General', 'Banks', 'Allocation', 'Special Configs', 'Database'] as const
type Tab = typeof TABS[number]

// ── General tab ────────────────────────────────────────────────────────────────

function buildYearOptions(): number[] {
  const current = new Date().getFullYear()
  const years: number[] = []
  for (let y = current - 2; y <= current + 2; y++) years.push(y)
  return years
}

const YEAR_OPTIONS = buildYearOptions()

function GeneralTab() {
  const { year, setYear } = useAccountingYearStore()
  const [saved, setSaved] = useState(false)
  const [pending, setPending] = useState(year)

  const handleSave = () => {
    setYear(pending)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="bg-white border border-gray-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-gray-800">
          <CalendarDays className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold">Accounting Year</h2>
        </div>
        <p className="text-sm text-gray-500">
          Select the financial year you are currently working in. All transaction views and reports will reflect this period.
        </p>

        <div className="flex flex-wrap gap-2 pt-1">
          {YEAR_OPTIONS.map(y => (
            <button
              key={y}
              onClick={() => setPending(y)}
              className={`px-5 py-2 rounded-lg text-sm font-semibold border transition-colors ${
                pending === y
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-primary hover:text-primary'
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={handleSave}
            disabled={pending === year}
            className="px-5 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light disabled:opacity-50 transition-colors"
          >
            Save
          </button>
          {saved && (
            <span className="flex items-center gap-1.5 text-sm text-success font-medium">
              <CheckCircle2 className="w-4 h-4" /> Saved
            </span>
          )}
          {pending !== year && !saved && (
            <span className="text-xs text-gray-400">Unsaved change</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Banks tab ──────────────────────────────────────────────────────────────────

function BanksTab({ onAdd, onEdit, onDelete }: {
  onAdd:    () => void
  onEdit:   (bank: DbBank) => void
  onDelete: (bank: DbBank) => void
}) {
  const { banks, loading, error } = useBanks()

  if (loading) {
    return (
      <div className="max-w-2xl space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-2xl flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
        <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
        {error}
      </div>
    )
  }

  if (banks.length === 0) {
    return (
      <div className="max-w-2xl space-y-3">
        <div className="flex justify-end">
          <button
            onClick={onAdd}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Bank
          </button>
        </div>
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center border border-dashed border-gray-300 rounded-xl bg-gray-50">
          <Landmark className="w-10 h-10 text-gray-300" />
          <div>
            <p className="text-sm font-medium text-gray-600">No banks configured yet</p>
            <p className="text-xs text-gray-400 mt-1">Add a bank to link it to your transactions and reports.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex justify-end">
        <button
          onClick={onAdd}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Bank
        </button>
      </div>
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Bank Name</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Account Number</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
              <th className="px-4 py-3 w-24" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {banks.map(bank => (
              <tr key={bank.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-900">{bank.name}</td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">
                  {bank.account_number ?? <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs">
                  {bank.account_type ?? <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      onClick={() => onEdit(bank)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => onDelete(bank)}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                      title="Delete"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-gray-400">{banks.length} bank{banks.length !== 1 ? 's' : ''} configured</p>
    </div>
  )
}

// ── Allocation tab ─────────────────────────────────────────────────────────────

function AllocationTab({ onNew, onEdit, onLock, onEditLocked }: {
  onNew:       () => void
  onEdit:      (c: AllocationConfig) => void
  onLock:      (c: AllocationConfig) => void
  onEditLocked:(c: AllocationConfig) => void
}) {
  const { configs, loading, error, fetch } = useAllocationStore()

  useEffect(() => { fetch() }, [fetch])

  const statusBadge = (config: AllocationConfig) => {
    const isLocked = config.status === 'locked'
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
        isLocked
          ? 'bg-green-50 text-green-700 border border-green-200'
          : 'bg-amber-50 text-amber-700 border border-amber-200'
      }`}>
        {isLocked ? <Lock className="w-3 h-3" /> : <FileEdit className="w-3 h-3" />}
        {isLocked ? 'Locked' : 'Draft'}
      </span>
    )
  }

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex justify-end">
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <Plus className="w-4 h-4" /> New Configuration
        </button>
      </div>

      {loading && (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && configs.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center border border-dashed border-gray-300 rounded-xl bg-gray-50">
          <Layers className="w-10 h-10 text-gray-300" />
          <div>
            <p className="text-sm font-medium text-gray-600">No allocation configurations yet</p>
            <p className="text-xs text-gray-400 mt-1">Create a configuration to define how income is split across categories.</p>
          </div>
        </div>
      )}

      {!loading && !error && configs.length > 0 && (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Effective From</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Total %</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 w-28" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {configs.map(config => {
                const total    = config.rows.reduce((s, r) => s + (r.percentage ?? 0), 0)
                const balanced = Math.abs(total - 100) < 0.01
                return (
                  <tr key={config.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{config.name}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(config.start_date)}</td>
                    <td className={`px-4 py-3 text-right font-mono font-semibold ${balanced ? 'text-success' : 'text-danger'}`}>
                      {total.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3">{statusBadge(config)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {config.status === 'draft' ? (
                          <>
                            <button
                              onClick={() => onLock(config)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors"
                              title="Approve & Lock"
                            >
                              <Lock className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => onEdit(config)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                              title="Edit"
                            >
                              <Pencil className="w-4 h-4" />
                            </button>
                          </>
                        ) : (
                          <button
                            onClick={() => onEditLocked(config)}
                            className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                            title="Edit locked config"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && configs.length > 0 && (
        <p className="text-xs text-gray-400">
          {configs.length} configuration{configs.length !== 1 ? 's' : ''}
        </p>
      )}
    </div>
  )
}

// ── Special Configs tab ────────────────────────────────────────────────────────

function SpecialConfigsTab({ onNew, onEdit, onDelete }: {
  onNew:    () => void
  onEdit:   (c: AllocationConfig) => void
  onDelete: (c: AllocationConfig) => void
}) {
  const [configs,  setConfigs]  = useState<AllocationConfig[]>([])
  const [loading,  setLoading]  = useState(true)
  const [err,      setErr]      = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('allocation_configs')
      .select('*')
      .eq('is_special', true)
      .order('created_at', { ascending: false })
    if (error) setErr(error.message)
    else setConfigs((data ?? []) as AllocationConfig[])
    setLoading(false)
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <div className="max-w-2xl space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="h-12 bg-gray-100 rounded-lg animate-pulse" />
      ))}
    </div>
  )

  if (err) return (
    <div className="max-w-2xl flex items-start gap-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
      <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{err}
    </div>
  )

  return (
    <div className="max-w-2xl space-y-3">
      <div className="flex justify-end">
        <button
          onClick={onNew}
          className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-light transition-colors"
        >
          <Plus className="w-4 h-4" /> Create Special Config
        </button>
      </div>

      {configs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center border border-dashed border-gray-300 rounded-xl bg-gray-50">
          <Layers className="w-10 h-10 text-gray-300" />
          <div>
            <p className="text-sm font-medium text-gray-600">No special configurations yet</p>
            <p className="text-xs text-gray-400 mt-1">Create a special config to override the regular allocation for specific transactions.</p>
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Total</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">Rows</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                <th className="px-4 py-3 w-20" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {configs.map(c => {
                const isAmt = c.allocation_type === 'amount'
                const total = c.rows.reduce((s, r) => s + (isAmt ? (r.amount ?? 0) : (r.percentage ?? 0)), 0)
                return (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        isAmt ? 'bg-blue-50 text-blue-700 border border-blue-200' : 'bg-purple-50 text-purple-700 border border-purple-200'
                      }`}>
                        {isAmt ? 'Amount ₦' : 'Percentage %'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-gray-700">
                      {isAmt ? `₦${total.toLocaleString()}` : `${total.toFixed(1)}%`}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500">{c.rows.length}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{formatDate(c.created_at?.slice(0, 10) ?? '')}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onEdit(c)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => onDelete(c)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-danger hover:bg-red-50 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-gray-400">{configs.length} special config{configs.length !== 1 ? 's' : ''}</p>
    </div>
  )
}

// ── Database tab ───────────────────────────────────────────────────────────────

const MIGRATION_SQL = `-- Add bank_name to inflow/outflow
ALTER TABLE inflow_transactions  ADD COLUMN IF NOT EXISTS bank_name text;
ALTER TABLE outflow_transactions ADD COLUMN IF NOT EXISTS bank_name text;

-- FX fields
ALTER TABLE inflow_transactions
  ADD COLUMN IF NOT EXISTS fx_currency text,
  ADD COLUMN IF NOT EXISTS fx_amount   numeric(15,4),
  ADD COLUMN IF NOT EXISTS fx_rate     numeric(15,6);

ALTER TABLE outflow_transactions
  ADD COLUMN IF NOT EXISTS fx_currency text,
  ADD COLUMN IF NOT EXISTS fx_amount   numeric(15,4),
  ADD COLUMN IF NOT EXISTS fx_rate     numeric(15,6);

-- Transaction type + original reference
ALTER TABLE inflow_transactions
  ADD COLUMN IF NOT EXISTS transaction_type          text,
  ADD COLUMN IF NOT EXISTS original_transaction_id   text;

ALTER TABLE outflow_transactions
  ADD COLUMN IF NOT EXISTS transaction_type          text,
  ADD COLUMN IF NOT EXISTS original_transaction_id   text;

-- Bank deposits table
CREATE TABLE IF NOT EXISTS bank_deposits (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date NOT NULL,
  bank_id             uuid REFERENCES banks(id),
  bank_name           text,
  amount              numeric(15,2) NOT NULL,
  description         text,
  transaction_ref     text,
  remarks             text,
  created_at          timestamptz DEFAULT now()
);

-- Intrabank transfers table
CREATE TABLE IF NOT EXISTS intrabank_transfers (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date                date NOT NULL,
  from_bank_id        uuid REFERENCES banks(id),
  from_bank_name      text,
  to_bank_id          uuid REFERENCES banks(id),
  to_bank_name        text,
  amount              numeric(15,2) NOT NULL,
  description         text,
  transaction_ref     text,
  remarks             text,
  created_at          timestamptz DEFAULT now()
);`

function DatabaseTab() {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(MIGRATION_SQL)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Terminal className="w-5 h-5 text-primary" />
          <h2 className="text-base font-semibold text-gray-900">Database Migration</h2>
        </div>
        <p className="text-sm text-gray-500">
          Run the following SQL in your Supabase SQL editor to add the columns and tables required for new features.
          All statements use <code className="font-mono text-xs bg-gray-100 px-1 rounded">IF NOT EXISTS</code> — safe to run multiple times.
        </p>

        <div className="rounded-xl border border-gray-200 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
            <span className="text-xs font-medium text-gray-400 font-mono">SQL</span>
            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center gap-1.5 text-xs text-gray-300 hover:text-white transition-colors"
            >
              <Copy className="w-3.5 h-3.5" />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre className="text-xs font-mono text-gray-200 bg-gray-900 p-4 overflow-x-auto whitespace-pre leading-relaxed max-h-[500px] overflow-y-auto">
            {MIGRATION_SQL}
          </pre>
        </div>

        <div className="flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 px-4 py-3 text-sm text-blue-700">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            After running this migration, enable Row Level Security on the new tables if your project uses RLS.
            Go to <strong>Supabase → Table Editor → bank_deposits / intrabank_transfers → RLS</strong> and add appropriate policies.
          </span>
        </div>
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const [activeTab,      setActiveTab]      = useState<Tab>('General')
  const [bankModalOpen,  setBankModalOpen]  = useState(false)
  const [editBankRecord, setEditBankRecord] = useState<DbBank | null>(null)
  const [bankRefetch,    setBankRefetch]    = useState(0)
  const [deleteBankRecord, setDeleteBankRecord] = useState<DbBank | null>(null)
  const [allocModalOpen,  setAllocModalOpen]  = useState(false)
  const [editAllocRecord, setEditAllocRecord] = useState<AllocationConfig | null>(null)
  const [lockTarget,      setLockTarget]      = useState<AllocationConfig | null>(null)
  const [editLockedTarget, setEditLockedTarget] = useState<AllocationConfig | null>(null)
  const [specialModalOpen,  setSpecialModalOpen]  = useState(false)
  const [editSpecialRecord, setEditSpecialRecord] = useState<AllocationConfig | null>(null)
  const [deleteSpecialTarget, setDeleteSpecialTarget] = useState<AllocationConfig | null>(null)
  const [specialRefetch,   setSpecialRefetch]   = useState(0)
  const [resetModalOpen,   setResetModalOpen]   = useState(false)
  const { configs, reload: reloadAllocs } = useAllocationStore()

  const { push: toast } = useToastStore()
  const { mutate: deleteBank, loading: deletingBank } = useDeleteBank()
  const { mutate: lockConfig,   loading: locking   } = useLockAllocationConfig()
  const { mutate: unlockConfig, loading: unlocking } = useUnlockAllocationConfig()

  usePageTitle('Setup')

  const handleNewAlloc    = () => { setEditAllocRecord(null); setAllocModalOpen(true) }
  const handleEditAlloc   = (c: AllocationConfig) => { setEditAllocRecord(c); setAllocModalOpen(true) }
  const handleAllocSuccess = () => { reloadAllocs() }

  const handleLock       = (c: AllocationConfig) => setLockTarget(c)
  const handleEditLocked = (c: AllocationConfig) => setEditLockedTarget(c)

  const confirmLock = async () => {
    if (!lockTarget) return
    try {
      await lockConfig(lockTarget.id)
      toast(`"${lockTarget.name}" approved and locked`, 'success')
      setLockTarget(null)
      reloadAllocs()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Lock failed', 'error')
    }
  }

  const handleUnlockAndEdit = async () => {
    if (!editLockedTarget) return
    try {
      await unlockConfig(editLockedTarget.id)
      toast(`"${editLockedTarget.name}" unlocked`, 'success')
      const target = editLockedTarget
      setEditLockedTarget(null)
      setEditAllocRecord(target)
      setAllocModalOpen(true)
      reloadAllocs()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Unlock failed', 'error')
    }
  }

  const handleCreateCopy = () => {
    if (!editLockedTarget) return
    const source = editLockedTarget
    setEditLockedTarget(null)
    setEditAllocRecord({
      ...source,
      id:         '',
      name:       `${source.name} (copy)`,
      status:     'draft',
      created_at: '',
    })
    setAllocModalOpen(true)
  }

  const handleAddBank     = () => { setEditBankRecord(null); setBankModalOpen(true) }
  const handleEditBank    = (bank: DbBank) => { setEditBankRecord(bank); setBankModalOpen(true) }
  const handleDeleteBank  = (bank: DbBank) => { setDeleteBankRecord(bank) }
  const handleBankSuccess = () => { setBankRefetch(n => n + 1) }

  const confirmDeleteBank = async () => {
    if (!deleteBankRecord) return
    try {
      await deleteBank(deleteBankRecord.id)
      toast('Bank deleted', 'success')
      setDeleteBankRecord(null)
      setBankRefetch(n => n + 1)
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error')
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Setup</h1>
          <p className="text-sm text-gray-500 mt-1">Configure your church finance settings</p>
        </div>

        {/* Tab bar */}
        <div className="border-b border-gray-200">
          <nav className="-mb-px flex gap-6">
            {TABS.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        <div>
          {activeTab === 'General'        && <GeneralTab />}
          {activeTab === 'Banks'          && <BanksTab key={bankRefetch} onAdd={handleAddBank} onEdit={handleEditBank} onDelete={handleDeleteBank} />}
          {activeTab === 'Allocation'     && <AllocationTab onNew={handleNewAlloc} onEdit={handleEditAlloc} onLock={handleLock} onEditLocked={handleEditLocked} />}
          {activeTab === 'Special Configs' && (
            <SpecialConfigsTab
              key={specialRefetch}
              onNew={() => { setEditSpecialRecord(null); setSpecialModalOpen(true) }}
              onEdit={c => { setEditSpecialRecord(c); setSpecialModalOpen(true) }}
              onDelete={c => setDeleteSpecialTarget(c)}
            />
          )}
          {activeTab === 'Database'       && <DatabaseTab />}
        </div>

        {/* Danger Zone */}
        <div className="border border-red-200 rounded-xl p-5 space-y-3 bg-red-50/40">
          <div className="flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600 shrink-0" />
            <h2 className="text-base font-semibold text-red-700">Danger Zone</h2>
          </div>
          <p className="text-sm text-gray-600">
            Permanently delete all transaction data. All data is exported to CSV before deletion. Categories, banks, and user accounts are preserved.
          </p>
          <button
            onClick={() => setResetModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-danger rounded-lg hover:bg-red-700 transition-colors"
          >
            <Trash2 className="w-4 h-4" /> Reset All Data
          </button>
        </div>
      </div>

      <AllocationConfigModal
        open={allocModalOpen}
        onClose={() => { setAllocModalOpen(false); setEditAllocRecord(null) }}
        onSuccess={handleAllocSuccess}
        editRecord={editAllocRecord}
        existingConfigs={configs}
      />

      {/* Lock confirmation dialog */}
      <Modal
        open={!!lockTarget}
        onClose={() => setLockTarget(null)}
        title="Approve & Lock Configuration"
        size="max-w-sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Lock <span className="font-semibold">"{lockTarget?.name}"</span>? Locked configurations are read-only and cannot be edited directly.
          </p>
          <div className="flex justify-end gap-3">
            <button
              onClick={() => setLockTarget(null)}
              disabled={locking}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={confirmLock}
              disabled={locking}
              className="flex items-center gap-2 px-4 py-2 text-sm text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60"
            >
              {locking && <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
              Approve & Lock
            </button>
          </div>
        </div>
      </Modal>

      {/* Edit-locked choice dialog */}
      <Modal
        open={!!editLockedTarget}
        onClose={() => setEditLockedTarget(null)}
        title="Edit Locked Configuration"
        size="max-w-sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            <span className="font-semibold">"{editLockedTarget?.name}"</span> is locked. How would you like to proceed?
          </p>
          <div className="space-y-2">
            <button
              onClick={handleUnlockAndEdit}
              disabled={unlocking}
              className="w-full flex items-center gap-3 px-4 py-3 text-left border border-amber-200 rounded-lg hover:bg-amber-50 transition-colors disabled:opacity-60"
            >
              <LockOpen className="w-5 h-5 text-amber-600 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900">Unlock &amp; Edit</p>
                <p className="text-xs text-gray-500">Reverts status to draft so you can make changes.</p>
              </div>
              {unlocking && <span className="ml-auto w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />}
            </button>
            <button
              onClick={handleCreateCopy}
              className="w-full flex items-center gap-3 px-4 py-3 text-left border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Copy className="w-5 h-5 text-gray-500 shrink-0" />
              <div>
                <p className="text-sm font-medium text-gray-900">Create a Copy</p>
                <p className="text-xs text-gray-500">Opens a new draft pre-filled with this config's data.</p>
              </div>
            </button>
          </div>
          <div className="flex justify-end">
            <button
              onClick={() => setEditLockedTarget(null)}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
      <AddBankModal
        open={bankModalOpen}
        onClose={() => { setBankModalOpen(false); setEditBankRecord(null) }}
        onSuccess={handleBankSuccess}
        editRecord={editBankRecord}
      />
      <DeleteDialog
        open={!!deleteBankRecord}
        onClose={() => setDeleteBankRecord(null)}
        onConfirm={confirmDeleteBank}
        loading={deletingBank}
        label={deleteBankRecord ? `"${deleteBankRecord.name}"` : 'this bank'}
      />
      <CreateSpecialConfigModal
        open={specialModalOpen}
        onClose={() => { setSpecialModalOpen(false); setEditSpecialRecord(null) }}
        onSaved={() => { setSpecialModalOpen(false); setEditSpecialRecord(null); setSpecialRefetch(n => n + 1) }}
        editRecord={editSpecialRecord}
      />
      <DeleteDialog
        open={!!deleteSpecialTarget}
        onClose={() => setDeleteSpecialTarget(null)}
        onConfirm={async () => {
          if (!deleteSpecialTarget) return
          await supabase.from('allocation_configs').delete().eq('id', deleteSpecialTarget.id)
          setDeleteSpecialTarget(null)
          setSpecialRefetch(n => n + 1)
        }}
        loading={false}
        label={deleteSpecialTarget ? `"${deleteSpecialTarget.name}"` : 'this config'}
      />
      <ResetDataModal
        open={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        onDone={() => toast('All data deleted successfully', 'success')}
      />
    </>
  )
}
