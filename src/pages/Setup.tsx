import { useState, useEffect } from 'react'
import { CalendarDays, CheckCircle2, Pencil, Trash2, Landmark, AlertCircle, Plus, Layers, Lock, FileEdit } from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useAccountingYearStore } from '../store/accountingYearStore'
import { useBanks, type DbBank } from '../hooks/useBanks'
import { AddBankModal } from '../components/modals/AddBankModal'
import { DeleteDialog }  from '../components/ui/DeleteDialog'
import { useDeleteBank } from '../hooks/useMutations'
import { useToastStore } from '../store/toastStore'
import { useAllocationStore, type AllocationConfig } from '../store/allocationStore'
import { AllocationConfigModal } from '../components/modals/AllocationConfigModal'
import { formatDate } from '../utils/formatters'

const TABS = ['General', 'Banks', 'Allocation'] as const
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

function AllocationTab({ onNew, onEdit }: { onNew: () => void; onEdit: (c: AllocationConfig) => void }) {
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
                <th className="px-4 py-3 w-12" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {configs.map(config => {
                const total    = config.rows.reduce((s, r) => s + r.percentage, 0)
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
                      {config.status === 'draft' && (
                        <button
                          onClick={() => onEdit(config)}
                          className="p-1.5 rounded-lg text-gray-400 hover:text-primary hover:bg-blue-50 transition-colors"
                          title="Edit"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
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

// ── Page ───────────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const [activeTab,      setActiveTab]      = useState<Tab>('General')
  const [bankModalOpen,  setBankModalOpen]  = useState(false)
  const [editBankRecord, setEditBankRecord] = useState<DbBank | null>(null)
  const [bankRefetch,    setBankRefetch]    = useState(0)
  const [deleteBankRecord, setDeleteBankRecord] = useState<DbBank | null>(null)
  const [allocModalOpen,  setAllocModalOpen]  = useState(false)
  const [editAllocRecord, setEditAllocRecord] = useState<AllocationConfig | null>(null)
  const { reload: reloadAllocs } = useAllocationStore()

  const { push: toast } = useToastStore()
  const { mutate: deleteBank, loading: deletingBank } = useDeleteBank()

  usePageTitle('Setup')

  const handleNewAlloc    = () => { setEditAllocRecord(null); setAllocModalOpen(true) }
  const handleEditAlloc   = (c: AllocationConfig) => { setEditAllocRecord(c); setAllocModalOpen(true) }
  const handleAllocSuccess = () => { reloadAllocs() }

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
          {activeTab === 'General'    && <GeneralTab />}
          {activeTab === 'Banks'      && <BanksTab key={bankRefetch} onAdd={handleAddBank} onEdit={handleEditBank} onDelete={handleDeleteBank} />}
          {activeTab === 'Allocation' && <AllocationTab onNew={handleNewAlloc} onEdit={handleEditAlloc} />}
        </div>
      </div>

      <AllocationConfigModal
        open={allocModalOpen}
        onClose={() => { setAllocModalOpen(false); setEditAllocRecord(null) }}
        onSuccess={handleAllocSuccess}
        editRecord={editAllocRecord}
      />
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
    </>
  )
}
