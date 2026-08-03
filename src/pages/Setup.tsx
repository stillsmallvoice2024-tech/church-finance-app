import React, { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Trash2, Landmark, Layers, LockOpen, Copy, ShieldAlert, Globe, Settings2, TrendingUp, TrendingDown, Users, UserCog } from 'lucide-react'
import { usePageTitle } from '../hooks/usePageTitle'
import { useRole } from '../hooks/useRole'
import { type DbBank } from '../hooks/useBanks'
import { AddBankModal } from '../components/modals/AddBankModal'
import { DeleteDialog }  from '../components/ui/DeleteDialog'
import { useDeleteBank } from '../hooks/useMutations'
import { useToastStore } from '../store/toastStore'
import { useAllocationStore, type AllocationConfig } from '../store/allocationStore'
import { AllocationConfigModal } from '../components/modals/AllocationConfigModal'
import { CreateSpecialConfigModal } from '../components/modals/CreateSpecialConfigModal'
import { type SpecialConfigGroupWithVersions } from '../hooks/useSpecialConfigGroups'
import { ResetDataModal }           from '../components/modals/ResetDataModal'
import { AddIncomeTypeModal }        from '../components/modals/AddIncomeTypeModal'
import { deleteIncomeType, type IncomeType } from '../hooks/useIncomeTypes'
import { AddOutflowTypeModal }       from '../components/modals/AddOutflowTypeModal'
import { deleteOutflowType, type OutflowType } from '../hooks/useOutflowTypes'
import { AddDepartmentModal }        from '../components/modals/AddDepartmentModal'
import { deleteDepartment, type Department } from '../hooks/useDepartments'
import { useLockAllocationConfig, useUnlockAllocationConfig, useDeleteAllocationConfig } from '../hooks/useMutations'
import { Modal } from '../components/ui/Modal'
import { friendlyError } from '../utils/friendlyError'
import Settings from './Settings'
import { GeneralTab } from './setup/GeneralTab'
import { BanksTab } from './setup/BanksTab'
import { DistributionRulesTab } from './setup/DistributionRulesTab'
import { CurrenciesTab } from './setup/CurrenciesTab'
import { IncomeTypesTab } from './setup/IncomeTypesTab'
import { OutflowTypesTab } from './setup/OutflowTypesTab'
import { DepartmentsTab } from './setup/DepartmentsTab'

const TABS = ['Account & Preferences', 'General', 'Banks', 'Distribution Rules', 'Income Types', 'Outflow Types', 'Departments', 'Currencies'] as const
type Tab = typeof TABS[number]

const TAB_CARDS: { tab: Tab; Icon: React.FC<{ className?: string }>; label: string }[] = [
  { tab: 'Account & Preferences', Icon: UserCog,   label: 'My Account' },
  { tab: 'General',            Icon: Settings2,    label: 'General'      },
  { tab: 'Banks',              Icon: Landmark,     label: 'Banks'        },
  { tab: 'Distribution Rules', Icon: Layers,       label: 'Distribution Rules' },
  { tab: 'Income Types',       Icon: TrendingUp,   label: 'Income Types'       },
  { tab: 'Outflow Types',      Icon: TrendingDown, label: 'Outflow Types'      },
  { tab: 'Departments',        Icon: Users,        label: 'Departments'  },
  { tab: 'Currencies',         Icon: Globe,        label: 'Currencies'   },
]

// URL slug per tab, so old deep links and redirects land on the right section.
const TAB_SLUGS: Record<Tab, string> = {
  'Account & Preferences': 'account',
  'General':               'general',
  'Banks':                 'banks',
  'Distribution Rules':    'distribution-rules',
  'Income Types':          'income-types',
  'Outflow Types':         'outflow-types',
  'Departments':           'departments',
  'Currencies':            'currencies',
}
const SLUG_TO_TAB: Record<string, Tab> = Object.fromEntries(
  Object.entries(TAB_SLUGS).map(([tab, slug]) => [slug, tab as Tab]),
)
SLUG_TO_TAB['setup'] = 'General' // legacy /settings?tab=setup links

// ── Page ──────────────────────────────────────────────────────────────────────────────

export default function SetupPage() {
  const { canWrite } = useRole()
  const write = canWrite()

  // Viewers see only Account & Preferences; finance tabs need write access
  // (same rule the old CanWriteGuard enforced on /setup).
  const visibleCards = write ? TAB_CARDS : TAB_CARDS.filter(c => c.tab === 'Account & Preferences')

  // Active tab lives in ?tab= so redirects and onboarding links can deep-link.
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedTab = SLUG_TO_TAB[searchParams.get('tab') ?? '']
  const activeTab: Tab = requestedTab && visibleCards.some(c => c.tab === requestedTab)
    ? requestedTab
    : 'Account & Preferences'
  const setActiveTab = (tab: Tab) =>
    setSearchParams(tab === 'Account & Preferences' ? {} : { tab: TAB_SLUGS[tab] }, { replace: true })
  const [bankModalOpen,  setBankModalOpen]  = useState(false)
  const [editBankRecord, setEditBankRecord] = useState<DbBank | null>(null)
  const [bankRefetch,    setBankRefetch]    = useState(0)
  const [deleteBankRecord, setDeleteBankRecord] = useState<DbBank | null>(null)
  const [allocModalOpen,  setAllocModalOpen]  = useState(false)
  const [editAllocRecord, setEditAllocRecord] = useState<AllocationConfig | null>(null)
  const [lockTarget,        setLockTarget]        = useState<AllocationConfig | null>(null)
  const [editLockedTarget,  setEditLockedTarget]  = useState<AllocationConfig | null>(null)
  const [deleteAllocTarget, setDeleteAllocTarget] = useState<AllocationConfig | null>(null)
  const [specialModalOpen,      setSpecialModalOpen]      = useState(false)
  const [specialModalMode,      setSpecialModalMode]      = useState<'new_group' | 'new_version' | 'amend_version'>('new_group')
  const [selectedSpecialGroup,  setSelectedSpecialGroup]  = useState<SpecialConfigGroupWithVersions | null>(null)
  const [copyFromVersion,       setCopyFromVersion]       = useState<AllocationConfig | null>(null)
  const [amendVersionRecord,    setAmendVersionRecord]    = useState<AllocationConfig | null>(null)
  const [specialRefetch,        setSpecialRefetch]        = useState(0)
  const [resetModalOpen,       setResetModalOpen]       = useState(false)
  const [incomeTypeModalOpen,    setIncomeTypeModalOpen]    = useState(false)
  const [editIncomeType,         setEditIncomeType]         = useState<IncomeType | null>(null)
  const [deleteIncomeTypeTarget, setDeleteIncomeTypeTarget] = useState<IncomeType | null>(null)
  const [incomeTypeRefetch,      setIncomeTypeRefetch]      = useState(0)
  const [outflowTypeModalOpen,   setOutflowTypeModalOpen]   = useState(false)
  const [editOutflowType,        setEditOutflowType]        = useState<OutflowType | null>(null)
  const [deleteOutflowTypeTarget, setDeleteOutflowTypeTarget] = useState<OutflowType | null>(null)
  const [outflowTypeRefetch,     setOutflowTypeRefetch]     = useState(0)
  const [departmentModalOpen,    setDepartmentModalOpen]    = useState(false)
  const [editDepartment,         setEditDepartment]         = useState<Department | null>(null)
  const [deleteDepartmentTarget, setDeleteDepartmentTarget] = useState<Department | null>(null)
  const [departmentRefetch,      setDepartmentRefetch]      = useState(0)

  const { configs, reload: reloadAllocs } = useAllocationStore()

  const { push: toast } = useToastStore()
  const { mutate: deleteBank, loading: deletingBank } = useDeleteBank()
  const { mutate: lockConfig,   loading: locking   } = useLockAllocationConfig()
  const { mutate: unlockConfig, loading: unlocking } = useUnlockAllocationConfig()
  const { mutate: deleteAllocConfig               } = useDeleteAllocationConfig()

  usePageTitle('Settings')

  const handleAllocSuccess = () => { reloadAllocs() }

  const confirmDeleteAlloc = async () => {
    if (!deleteAllocTarget) return
    try {
      await deleteAllocConfig(deleteAllocTarget.id)
      toast(`"${deleteAllocTarget.name}" deleted`, 'success')
      setDeleteAllocTarget(null)
      reloadAllocs()
    } catch (e: unknown) {
      toast(friendlyError(e, 'delete'), 'error')
    }
  }

  const confirmLock = async () => {
    if (!lockTarget) return
    try {
      await lockConfig(lockTarget.id)
      toast(`"${lockTarget.name}" approved and locked`, 'success')
      setLockTarget(null)
      reloadAllocs()
    } catch (e: unknown) {
      toast(friendlyError(e, 'lock the config'), 'error')
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
      toast(friendlyError(e, 'unlock the config'), 'error')
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

  const handleNewGroup = () => {
    setSpecialModalMode('new_group')
    setSelectedSpecialGroup(null)
    setCopyFromVersion(null)
    setSpecialModalOpen(true)
  }

  const handleNewVersion = (group: SpecialConfigGroupWithVersions, copyFrom: AllocationConfig | null) => {
    setSpecialModalMode('new_version')
    setSelectedSpecialGroup(group)
    setCopyFromVersion(copyFrom)
    setAmendVersionRecord(null)
    setSpecialModalOpen(true)
  }

  const handleAmendVersion = (group: SpecialConfigGroupWithVersions, version: AllocationConfig) => {
    setSpecialModalMode('amend_version')
    setSelectedSpecialGroup(group)
    setCopyFromVersion(null)
    setAmendVersionRecord(version)
    setSpecialModalOpen(true)
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
      toast(friendlyError(e, 'delete'), 'error')
    }
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Settings</h1>
          <p className="text-sm text-gray-500 mt-1">Account preferences and organisation finance configuration</p>
        </div>

        {/* Mobile: icon + label card grid */}
        {visibleCards.length > 1 && (
        <div className="grid grid-cols-4 gap-2 md:hidden">
          {visibleCards.map(({ tab, Icon, label }) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex flex-col items-center justify-center gap-1.5 py-3 px-1 rounded-xl transition-colors ${
                activeTab === tab
                  ? 'bg-primary text-white'
                  : 'bg-gray-100 text-gray-500 active:bg-gray-200'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span className="text-[10px] font-medium leading-tight text-center">{label}</span>
            </button>
          ))}
        </div>
        )}

        {/* Desktop: sidebar nav + content */}
        <div className="flex gap-7 items-start">
          {visibleCards.length > 1 && (
          <nav className="hidden md:flex flex-col w-48 shrink-0 gap-0.5">
            {visibleCards.map(({ tab, Icon, label }) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors leading-tight ${
                  activeTab === tab
                    ? 'bg-gray-100 text-gray-900 font-semibold'
                    : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {label}
              </button>
            ))}
          </nav>
          )}

          <div className="flex-1 min-w-0">
            {activeTab === 'Account & Preferences' && <Settings />}
            {activeTab === 'General'        && <GeneralTab />}
            {activeTab === 'Banks'          && <BanksTab key={bankRefetch} onAdd={handleAddBank} onEdit={handleEditBank} onDelete={handleDeleteBank} />}
            {activeTab === 'Distribution Rules' && (
              <DistributionRulesTab
                onNewCustom={handleNewGroup}
                onNewVersion={handleNewVersion}
                onAmend={handleAmendVersion}
                refetchKey={specialRefetch}
                onRefetch={() => setSpecialRefetch(n => n + 1)}
              />
            )}
            {activeTab === 'Income Types' && (
              <IncomeTypesTab
                key={incomeTypeRefetch}
                onAdd={() => { setEditIncomeType(null); setIncomeTypeModalOpen(true) }}
                onEdit={t => { setEditIncomeType(t); setIncomeTypeModalOpen(true) }}
                onDelete={t => setDeleteIncomeTypeTarget(t)}
              />
            )}
            {activeTab === 'Outflow Types' && (
              <OutflowTypesTab
                key={outflowTypeRefetch}
                onAdd={() => { setEditOutflowType(null); setOutflowTypeModalOpen(true) }}
                onEdit={t => { setEditOutflowType(t); setOutflowTypeModalOpen(true) }}
                onDelete={t => setDeleteOutflowTypeTarget(t)}
              />
            )}
            {activeTab === 'Departments' && (
              <DepartmentsTab
                key={departmentRefetch}
                onAdd={() => { setEditDepartment(null); setDepartmentModalOpen(true) }}
                onEdit={d => { setEditDepartment(d); setDepartmentModalOpen(true) }}
                onDelete={d => setDeleteDepartmentTarget(d)}
              />
            )}
            {activeTab === 'Currencies'     && <CurrenciesTab />}
          </div>
        </div>

        {/* Danger Zone — write roles only; hidden on the personal Account tab */}
        {write && activeTab !== 'Account & Preferences' && (
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
        )}
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
            Lock <span className="font-semibold">"{lockTarget?.name}"</span>? Locked distribution rules are read-only and cannot be edited directly.
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
              className="w-full flex items-center gap-3 px-4 py-3 text-left border border-gray-200 rounded-lg hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
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
      <DeleteDialog
        open={!!deleteAllocTarget}
        onClose={() => setDeleteAllocTarget(null)}
        onConfirm={confirmDeleteAlloc}
        label={deleteAllocTarget ? `"${deleteAllocTarget.name}"` : 'this distribution rule'}
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
      <CreateSpecialConfigModal
        open={specialModalOpen}
        onClose={() => { setSpecialModalOpen(false) }}
        onSaved={() => { setSpecialModalOpen(false); setSpecialRefetch(n => n + 1); reloadAllocs() }}
        mode={specialModalMode}
        group={selectedSpecialGroup}
        copyFromVersion={copyFromVersion}
        versionToAmend={amendVersionRecord}
      />
      <ResetDataModal
        open={resetModalOpen}
        onClose={() => setResetModalOpen(false)}
        onDone={() => toast('All data deleted successfully', 'success')}
      />
      <AddIncomeTypeModal
        open={incomeTypeModalOpen}
        onClose={() => { setIncomeTypeModalOpen(false); setEditIncomeType(null) }}
        onSaved={() => { setIncomeTypeModalOpen(false); setEditIncomeType(null); setIncomeTypeRefetch(n => n + 1) }}
        editRecord={editIncomeType}
      />
      <DeleteDialog
        open={!!deleteIncomeTypeTarget}
        onClose={() => setDeleteIncomeTypeTarget(null)}
        onConfirm={async () => {
          if (!deleteIncomeTypeTarget) return
          try {
            await deleteIncomeType(deleteIncomeTypeTarget.id)
            setDeleteIncomeTypeTarget(null)
            setIncomeTypeRefetch(n => n + 1)
            toast('Income type deleted', 'success')
          } catch (e) {
            toast(friendlyError(e, 'delete'), 'error')
          }
        }}
        loading={false}
        label={deleteIncomeTypeTarget ? `"${deleteIncomeTypeTarget.name}"` : 'this income type'}
      />
      <AddOutflowTypeModal
        open={outflowTypeModalOpen}
        onClose={() => { setOutflowTypeModalOpen(false); setEditOutflowType(null) }}
        onSaved={() => { setOutflowTypeModalOpen(false); setEditOutflowType(null); setOutflowTypeRefetch(n => n + 1) }}
        editRecord={editOutflowType}
      />
      <DeleteDialog
        open={!!deleteOutflowTypeTarget}
        onClose={() => setDeleteOutflowTypeTarget(null)}
        onConfirm={async () => {
          if (!deleteOutflowTypeTarget) return
          try {
            await deleteOutflowType(deleteOutflowTypeTarget.id)
            setDeleteOutflowTypeTarget(null)
            setOutflowTypeRefetch(n => n + 1)
            toast('Outflow type deleted', 'success')
          } catch (e) {
            toast(friendlyError(e, 'delete'), 'error')
          }
        }}
        loading={false}
        label={deleteOutflowTypeTarget ? `"${deleteOutflowTypeTarget.name}"` : 'this outflow type'}
      />
      <AddDepartmentModal
        open={departmentModalOpen}
        onClose={() => { setDepartmentModalOpen(false); setEditDepartment(null) }}
        onSaved={() => { setDepartmentModalOpen(false); setEditDepartment(null); setDepartmentRefetch(n => n + 1) }}
        editRecord={editDepartment}
      />
      <DeleteDialog
        open={!!deleteDepartmentTarget}
        onClose={() => setDeleteDepartmentTarget(null)}
        onConfirm={async () => {
          if (!deleteDepartmentTarget) return
          try {
            await deleteDepartment(deleteDepartmentTarget.id)
            setDeleteDepartmentTarget(null)
            setDepartmentRefetch(n => n + 1)
            toast('Department deleted', 'success')
          } catch (e) {
            toast(friendlyError(e, 'delete'), 'error')
          }
        }}
        loading={false}
        label={deleteDepartmentTarget ? `"${deleteDepartmentTarget.name}"` : 'this department'}
      />
    </>
  )
}
