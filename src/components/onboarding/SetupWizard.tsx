import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, ChevronRight, ChevronLeft, Check, Clock, Building2, Landmark,
  ArrowDownCircle, ArrowUpCircle, Users, Upload, Sparkles, Loader2,
  Plus, AlertCircle, CheckCircle2, ExternalLink, SkipForward, Tag,
  Heart, Globe, GraduationCap, Briefcase, Wallet, SlidersHorizontal, Zap,
  Trash2, Mail,
} from 'lucide-react'
import { useOnboardingStore } from '../../store/onboardingStore'
import { useUserPreferences } from '../../hooks/useUserPreferences'
import { useOrgStore } from '../../store/orgStore'
import { useAuthStore } from '../../store/authStore'
import { useRole } from '../../hooks/useRole'
import { useDepartments, saveDepartment, deleteDepartment } from '../../hooks/useDepartments'
import { useBanks } from '../../hooks/useBanks'
import { useAddBank, useAddCategory, useDeleteCategory } from '../../hooks/useMutations'
import { useIncomeTypes, saveIncomeType, deleteIncomeType } from '../../hooks/useIncomeTypes'
import { useOutflowTypes, saveOutflowType, deleteOutflowType } from '../../hooks/useOutflowTypes'
import { useCategories } from '../../hooks/useCategories'
import { useCurrencies } from '../../hooks/useCurrencies'
import { supabase } from '../../lib/supabase'
import { useAllocationStore } from '../../store/allocationStore'
import { createGroupWithFirstVersion, setGeneralRuleLive, useSpecialConfigGroups } from '../../hooks/useSpecialConfigGroups'
import { useToastStore } from '../../store/toastStore'
import { friendlyError } from '../../utils/friendlyError'
import { WIZARD_STEPS } from '../../onboarding/wizard/definitions'
import { getOrgTypeContent } from '../../onboarding/wizard/orgTypeContent'
import type { OrgType } from '../../onboarding/wizard/orgTypeContent'
import type { WizardStepId } from '../../types/onboarding'

// ── Colour palette for types ──────────────────────────────────────────────────

const COLOUR_SWATCHES = [
  '#1E3A8A', '#0369A1', '#065F46', '#047857',
  '#D97706', '#DC2626', '#7C3AED', '#DB2777',
  '#64748B', '#374151',
]

function ColourPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLOUR_SWATCHES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          title={c}
          className={`w-6 h-6 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-primary/50 ${
            value === c ? 'ring-2 ring-offset-1 ring-gray-400 scale-110' : ''
          }`}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────────────────

const inputCls =
  'w-full px-3 py-2 text-sm border border-gray-300 rounded-lg outline-none ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors bg-white ' +
  'dark:bg-[#1c1c1e] dark:border-white/[0.10] dark:text-white dark:focus:border-primary'

function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-5">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{title}</h2>
      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{description}</p>
    </div>
  )
}

function ItemBadge({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium bg-primary/10 text-primary rounded-lg border border-primary/20">
      <CheckCircle2 className="w-3 h-3" />
      {label}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 text-primary/60 hover:text-primary"
          aria-label={`Remove ${label}`}
        >
          <X className="w-3 h-3" />
        </button>
      )}
    </div>
  )
}

function EditLaterNote({ where }: { where: string }) {
  return (
    <p className="text-xs text-gray-400 dark:text-gray-500 italic mt-1">
      You can add, rename, or remove these later in {where}.
    </p>
  )
}

function StarterChips({
  starters,
  existingNames,
  addingStarter,
  onAdd,
  label,
}: {
  starters: string[]
  existingNames: Set<string>
  addingStarter: string | null
  onAdd: (s: string) => void
  label: string
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</p>
      <div className="flex flex-wrap gap-2">
        {starters.map(s => {
          const added    = existingNames.has(s.toLowerCase())
          const isAdding = addingStarter === s
          return (
            <button
              key={s}
              type="button"
              disabled={added || !!addingStarter}
              onClick={() => onAdd(s)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-lg border transition-colors ${
                added
                  ? 'bg-primary/10 border-primary/20 text-primary cursor-default'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-primary hover:text-primary disabled:opacity-50'
              }`}
            >
              {isAdding
                ? <Loader2 className="w-3 h-3 animate-spin" />
                : added
                  ? <Check className="w-3 h-3" />
                  : <Plus className="w-3 h-3" />
              }
              {s}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Step 1: Org Type ──────────────────────────────────────────────────────────

type OrgCard = { type: OrgType; label: string; tagline: string; Icon: React.ElementType }

const ORG_CARDS: OrgCard[] = [
  { type: 'church',  label: 'Church / Faith Community',  tagline: 'Worship communities, congregations, and faith-based groups',  Icon: Heart         },
  { type: 'ngo',    label: 'NGO / Non-Profit',           tagline: 'Humanitarian, advocacy, and development organisations',        Icon: Globe         },
  { type: 'school', label: 'School / Institution',       tagline: 'Schools, colleges, training centres, and academies',          Icon: GraduationCap },
  { type: 'project',label: 'Project-Based Organisation', tagline: 'Construction, consulting, creative, and contract-based work', Icon: Briefcase     },
]

const PERSONAL_CARD: OrgCard = {
  type: 'personal',
  label: 'Clariva Personal',
  tagline: 'Track your own income, expenses, and savings as an individual',
  Icon: Wallet,
}

function OrgTypeCard({
  card, isSelected, isSaving, disabled, onSelect,
}: {
  card: OrgCard; isSelected: boolean; isSaving: boolean; disabled: boolean; onSelect: () => void
}) {
  const { label, tagline, Icon } = card
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={`flex items-start gap-3 p-4 rounded-xl border-2 text-left transition-all disabled:opacity-60 ${
        isSelected
          ? 'border-primary bg-primary/5 dark:bg-primary/10'
          : 'border-gray-200 dark:border-gray-700 hover:border-primary/40 hover:bg-gray-50 dark:hover:bg-gray-800/50'
      }`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
        isSelected ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
      }`}>
        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Icon className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${isSelected ? 'text-primary' : 'text-gray-800 dark:text-gray-200'}`}>
          {label}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{tagline}</p>
      </div>
      {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />}
    </button>
  )
}

function OrgTypeStep({ onDataReady }: { onDataReady: (ready: boolean) => void }) {
  const orgId      = useOrgStore(s => s.orgId)
  const orgType    = useOrgStore(s => s.orgType)
  const setOrgType = useOrgStore(s => s.setOrgType)
  const { push: toast } = useToastStore()
  const [saving, setSaving] = useState<OrgType | null>(null)

  useEffect(() => {
    onDataReady(!!orgType)
  }, [orgType, onDataReady])

  const handleSelect = async (type: OrgType) => {
    if (!orgId || saving) return
    if (type === orgType) { onDataReady(true); return }
    setSaving(type)
    try {
      const { data: current } = await supabase
        .from('organizations').select('metadata').eq('id', orgId).single()
      await supabase
        .from('organizations')
        .update({ metadata: { ...(current?.metadata ?? {}), org_type: type } })
        .eq('id', orgId)
      setOrgType(type)
    } catch {
      toast('Could not save your selection. Please try again.', 'error')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="What kind of organisation are you setting up for?"
        description="This helps us suggest the right labels, fund names, and examples throughout the setup — so you're not starting from scratch."
      />

      {/* Organisation types — 2×2 grid */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {ORG_CARDS.map(card => (
          <OrgTypeCard
            key={card.type}
            card={card}
            isSelected={orgType === card.type}
            isSaving={saving === card.type}
            disabled={!!saving}
            onSelect={() => handleSelect(card.type)}
          />
        ))}
      </div>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
        <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">or, for personal use</span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
      </div>

      {/* Clariva Personal — full-width */}
      <OrgTypeCard
        card={PERSONAL_CARD}
        isSelected={orgType === 'personal'}
        isSaving={saving === 'personal'}
        disabled={!!saving}
        onSelect={() => handleSelect('personal')}
      />

      <p className="text-xs text-gray-400 dark:text-gray-500 italic">
        You can change this later in Settings. Skipping will use generic suggestions.
      </p>
    </div>
  )
}

// ── Step 2: Departments ───────────────────────────────────────────────────────

function DepartmentsStep({ onDataReady }: { onDataReady: (ready: boolean) => void }) {
  const { departments, loading, refetch } = useDepartments()
  const orgType = useOrgStore(s => s.orgType)
  const content = getOrgTypeContent(orgType)
  const { push: toast } = useToastStore()

  const [name, setName]                   = useState('')
  const [saving, setSaving]               = useState(false)
  const [addingStarter, setAddingStarter] = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  const existingNames = new Set(departments.map(d => d.name.toLowerCase()))

  useEffect(() => {
    if (!loading) onDataReady(departments.length > 0)
  }, [departments, loading, onDataReady])

  const handleDeleteDepartment = async (id: string) => {
    try {
      await deleteDepartment(id)
      refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  const handleAddStarter = async (starter: string) => {
    if (existingNames.has(starter.toLowerCase()) || addingStarter) return
    setAddingStarter(starter); setError(null)
    try {
      await saveDepartment({ name: starter, active: true })
      toast(`${starter} added`, 'success')
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save'))
    } finally {
      setAddingStarter(null)
    }
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true); setError(null)
    try {
      await saveDepartment({ name: name.trim(), active: true })
      toast(`${name.trim()} added`, 'success')
      setName('')
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save'))
    } finally {
      setSaving(false)
    }
  }

  const isPersonal = orgType === 'personal'

  return (
    <div className="space-y-4">
      <StepHeading
        title={isPersonal
          ? "Which areas of your life do you want to track?"
          : "Which teams or units make up your organisation?"
        }
        description={isPersonal
          ? "Think of the different parts of your life — housing, work, family, health. You'll be able to tag every transaction to the right area so nothing gets lost."
          : "Add the groups that handle or spend money. You'll be able to assign transactions to each one so you can see exactly where funds go."
        }
      />

      <StarterChips
        starters={content.departmentStarters}
        existingNames={existingNames}
        addingStarter={addingStarter}
        onAdd={handleAddStarter}
        label="Common teams — tap any to add instantly:"
      />

      {!loading && departments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {departments.map(d => <ItemBadge key={d.id} label={d.name} onRemove={() => handleDeleteDepartment(d.id)} />)}
        </div>
      )}
      {loading && (
        <div className="flex gap-2">
          {[1, 2, 3].map(i => <div key={i} className="h-6 w-20 bg-gray-100 dark:bg-[#1c1c1e] rounded-lg animate-pulse" />)}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-2">
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={content.departmentPlaceholder}
            className={`${inputCls} flex-1`}
          />
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
      </form>

      {!loading && departments.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-500 italic">
          No teams yet. Tap one above or type a name to get started.
        </p>
      )}

      <EditLaterNote where="Setup → Departments" />
    </div>
  )
}

// ── Step 3: Banks ─────────────────────────────────────────────────────────────

function BanksStep({ onDataReady }: { onDataReady: (ready: boolean) => void }) {
  const { banks, loading, refetch } = useBanks()
  const { currencies } = useCurrencies()
  const { mutate: addBank } = useAddBank()
  const { push: toast } = useToastStore()
  const defaultCurrency = useOrgStore(s => s.defaultCurrency)

  const [name, setName]         = useState('')
  const [acctNum, setAcctNum]   = useState('')
  const [currency, setCurrency] = useState(defaultCurrency ?? 'NGN')
  const [saving, setSaving]     = useState(false)
  const [error, setError]       = useState<string | null>(null)

  useEffect(() => {
    if (defaultCurrency && !currency) setCurrency(defaultCurrency)
  }, [defaultCurrency]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!loading) onDataReady(banks.length > 0)
  }, [banks, loading, onDataReady])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true); setError(null)
    try {
      await addBank({ name: name.trim(), account_number: acctNum.trim() || undefined, currency })
      toast(`${name.trim()} added`, 'success')
      setName(''); setAcctNum('')
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="Which bank accounts does your organisation use?"
        description="Add every account your organisation operates — your main account, a project account, a foreign currency account. The name you enter here must match your bank statement exactly when you import transactions."
      />

      {!loading && banks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {banks.map(b => <ItemBadge key={b.id} label={`${b.name}${b.currency && b.currency !== 'NGN' ? ` (${b.currency})` : ''}`} />)}
        </div>
      )}
      {loading && (
        <div className="flex gap-2">
          {[1, 2].map(i => <div key={i} className="h-6 w-24 bg-gray-100 dark:bg-[#1c1c1e] rounded-lg animate-pulse" />)}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-2">
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Bank name (e.g. GTBank, Access Bank…)"
            className={`${inputCls} flex-1`}
          />
        </div>
        <input
          type="text"
          value={acctNum}
          onChange={e => setAcctNum(e.target.value)}
          placeholder="Account number (optional)"
          className={inputCls}
        />
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-gray-500 dark:text-gray-400 flex-shrink-0 w-16">Currency</span>
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value)}
            className={`${inputCls} flex-1`}
          >
            {currencies.map(c => (
              <option key={c.code} value={c.code}>{c.code}</option>
            ))}
          </select>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add Bank
          </button>
        </div>
      </form>

      {!loading && banks.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-500 italic">
          No banks yet. Add at least one to continue.
        </p>
      )}

      <EditLaterNote where="Setup → Banks" />
    </div>
  )
}

// ── Step 4: Income Types ──────────────────────────────────────────────────────

function IncomeTypesStep({ onDataReady }: { onDataReady: (ready: boolean) => void }) {
  const { incomeTypes, loading, refetch } = useIncomeTypes()
  const orgType = useOrgStore(s => s.orgType)
  const content = getOrgTypeContent(orgType)
  const { push: toast } = useToastStore()

  const [name, setName]                   = useState('')
  const [colour, setColour]               = useState(COLOUR_SWATCHES[0])
  const [saving, setSaving]               = useState(false)
  const [addingStarter, setAddingStarter] = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  const userIncomeTypes = incomeTypes.filter(t => !t.name.startsWith('_'))
  const existingNames   = new Set(userIncomeTypes.map(t => t.name.toLowerCase()))
  const seededRef = useRef(false)

  useEffect(() => {
    if (!loading) onDataReady(userIncomeTypes.length > 0)
  }, [userIncomeTypes, loading, onDataReady])

  useEffect(() => {
    if (loading || seededRef.current || userIncomeTypes.length > 0) return
    seededRef.current = true
    const seed = async () => {
      try {
        await saveIncomeType({ name: 'General Donation', color: COLOUR_SWATCHES[0], rules: [] })
        refetch()
      } catch { seededRef.current = false }
    }
    seed()
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteIncomeType = async (id: string) => {
    try {
      await deleteIncomeType(id)
      refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  const handleAddStarter = async (starter: string) => {
    if (existingNames.has(starter.toLowerCase()) || addingStarter) return
    setAddingStarter(starter); setError(null)
    try {
      await saveIncomeType({ name: starter, color: COLOUR_SWATCHES[0], rules: [] })
      toast(`${starter} added`, 'success')
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save'))
    } finally {
      setAddingStarter(null)
    }
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true); setError(null)
    try {
      await saveIncomeType({ name: name.trim(), color: colour, rules: [] })
      toast(`${name.trim()} added`, 'success')
      setName('')
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="How does money come into your organisation?"
        description="Give each income stream its own label. When you import a bank statement, every credit will be tagged with one of these so you know exactly what kind of income it was."
      />

      <StarterChips
        starters={content.incomeTypeStarters}
        existingNames={existingNames}
        addingStarter={addingStarter}
        onAdd={handleAddStarter}
        label="Common income types — tap any to add instantly:"
      />

      {!loading && userIncomeTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {userIncomeTypes.map(t => <ItemBadge key={t.id} label={t.name} onRemove={() => handleDeleteIncomeType(t.id)} />)}
        </div>
      )}
      {loading && (
        <div className="flex gap-2">
          {[1, 2, 3].map(i => <div key={i} className="h-6 w-20 bg-gray-100 dark:bg-[#1c1c1e] rounded-lg animate-pulse" />)}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-3">
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={content.incomeTypePlaceholder}
            className={`${inputCls} flex-1`}
          />
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Colour</label>
          <ColourPicker value={colour} onChange={setColour} />
        </div>
      </form>

      {!loading && userIncomeTypes.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-500 italic">
          No income types yet. Tap one above or type a name to get started.
        </p>
      )}

      <EditLaterNote where="Setup → Income Types" />
    </div>
  )
}

// ── Step 5: Outflow Types ─────────────────────────────────────────────────────

function OutflowTypesStep({ onDataReady }: { onDataReady: (ready: boolean) => void }) {
  const { outflowTypes, loading, refetch } = useOutflowTypes()
  const orgType = useOrgStore(s => s.orgType)
  const content = getOrgTypeContent(orgType)
  const { push: toast } = useToastStore()

  const [name, setName]                   = useState('')
  const [colour, setColour]               = useState(COLOUR_SWATCHES[2])
  const [saving, setSaving]               = useState(false)
  const [addingStarter, setAddingStarter] = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  const userTypes     = outflowTypes.filter(t => !t.is_system)
  const existingNames = new Set(userTypes.map(t => t.name.toLowerCase()))

  useEffect(() => {
    if (!loading) onDataReady(userTypes.length > 0)
  }, [userTypes, loading, onDataReady])

  const handleDeleteOutflowType = async (id: string) => {
    try {
      await deleteOutflowType(id)
      refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  const handleAddStarter = async (starter: string) => {
    if (existingNames.has(starter.toLowerCase()) || addingStarter) return
    setAddingStarter(starter); setError(null)
    try {
      await saveOutflowType({ name: starter, color: COLOUR_SWATCHES[2] })
      toast(`${starter} added`, 'success')
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save'))
    } finally {
      setAddingStarter(null)
    }
  }

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true); setError(null)
    try {
      await saveOutflowType({ name: name.trim(), color: colour })
      toast(`${name.trim()} added`, 'success')
      setName('')
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="What does your organisation spend money on?"
        description="Think of your regular expense categories. Every debit on your bank statement will be tagged with one of these so you can see exactly what the money went to."
      />

      <StarterChips
        starters={content.outflowTypeStarters}
        existingNames={existingNames}
        addingStarter={addingStarter}
        onAdd={handleAddStarter}
        label="Common expense types — tap any to add instantly:"
      />

      {!loading && userTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {userTypes.map(t => <ItemBadge key={t.id} label={t.name} onRemove={() => handleDeleteOutflowType(t.id)} />)}
        </div>
      )}
      {loading && (
        <div className="flex gap-2">
          {[1, 2].map(i => <div key={i} className="h-6 w-20 bg-gray-100 dark:bg-[#1c1c1e] rounded-lg animate-pulse" />)}
        </div>
      )}

      <form onSubmit={handleAdd} className="space-y-3">
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder={content.outflowTypePlaceholder}
            className={`${inputCls} flex-1`}
          />
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Colour</label>
          <ColourPicker value={colour} onChange={setColour} />
        </div>
      </form>

      {!loading && userTypes.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-500 italic">
          No expense types yet. Tap one above or type a name to get started.
        </p>
      )}

      <EditLaterNote where="Setup → Outflow Types" />
    </div>
  )
}

// ── Step 6: Categories (Funds) ────────────────────────────────────────────────

function CategoriesStep({ onDataReady }: { onDataReady: (ready: boolean) => void }) {
  const { categories, loading, refetch } = useCategories()
  const orgType = useOrgStore(s => s.orgType)
  const content = getOrgTypeContent(orgType)
  const { mutate: addCategory } = useAddCategory()
  const { mutate: deleteCategory } = useDeleteCategory()
  const { push: toast } = useToastStore()

  const [name, setName]                   = useState('')
  const [saving, setSaving]               = useState(false)
  const [addingStarter, setAddingStarter] = useState<string | null>(null)
  const [error, setError]                 = useState<string | null>(null)

  const visibleCategories = categories.filter(c => !c.is_hidden)
  const existingNames     = new Set(categories.map(c => c.name.toLowerCase()))
  const catSeededRef = useRef(false)

  useEffect(() => {
    if (!loading) onDataReady(visibleCategories.length > 0)
  }, [visibleCategories, loading, onDataReady])

  useEffect(() => {
    if (loading || catSeededRef.current || visibleCategories.length > 0) return
    catSeededRef.current = true
    const seed = async () => {
      try {
        await addCategory({ name: 'General Fund' })
        refetch()
      } catch { catSeededRef.current = false }
    }
    seed()
  }, [loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeleteCategory = async (id: string) => {
    try {
      await deleteCategory(id)
      refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove')
    }
  }

  const handleAddStarter = async (starter: string) => {
    if (existingNames.has(starter.toLowerCase()) || addingStarter) return
    setAddingStarter(starter); setError(null)
    try {
      await addCategory({ name: starter })
      toast(`${starter} added`, 'success')
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save'))
    } finally {
      setAddingStarter(null)
    }
  }

  const handleCustomSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    setSaving(true); setError(null)
    try {
      await addCategory({ name: trimmed })
      toast(`${trimmed} added`, 'success')
      setName('')
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="What funds or pots does your organisation manage?"
        description="A fund is like a dedicated wallet for a purpose. When income comes in, it gets split into these pockets based on your distribution rules. You can watch each fund grow over time."
      />

      <StarterChips
        starters={content.categoryStarters}
        existingNames={existingNames}
        addingStarter={addingStarter}
        onAdd={handleAddStarter}
        label="Common funds — tap any to add instantly:"
      />

      {!loading && visibleCategories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {visibleCategories.map(c => <ItemBadge key={c.id} label={c.name} onRemove={() => handleDeleteCategory(c.id)} />)}
        </div>
      )}
      {loading && (
        <div className="flex gap-2">
          {[1, 2, 3].map(i => <div key={i} className="h-6 w-24 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />)}
        </div>
      )}

      <form onSubmit={handleCustomSubmit} className="space-y-2">
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="flex gap-2">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Or type a custom fund name…"
            className={`${inputCls} flex-1`}
          />
          <button
            type="submit"
            disabled={!name.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors flex-shrink-0"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Add
          </button>
        </div>
      </form>

      {!loading && visibleCategories.length === 0 && (
        <p className="text-xs text-gray-500 dark:text-gray-500 italic">
          No funds yet. Tap one above or type a name to get started.
        </p>
      )}

      <EditLaterNote where="Budget & Allocation → Categories" />
    </div>
  )
}

// ── Step 7: Distribution Rules (optional) ────────────────────────────────────

type DistTemplate = { label: string; description: string; rows: Array<{ category_name: string; percentage: number }> }

function buildDistributionTemplates(catNames: string[]): DistTemplate[] {
  if (catNames.length < 2) return []
  const [a, b, c, d] = catNames
  const templates: DistTemplate[] = []
  templates.push({
    label: '50 / 50 Split',
    description: `${a} and ${b}, equally`,
    rows: [{ category_name: a, percentage: 50 }, { category_name: b, percentage: 50 }],
  })
  if (c) {
    templates.push({
      label: '70 / 20 / 10',
      description: `Priority: ${a} → ${b} → ${c}`,
      rows: [{ category_name: a, percentage: 70 }, { category_name: b, percentage: 20 }, { category_name: c, percentage: 10 }],
    })
  }
  const top = [a, b, c, d].filter(Boolean) as string[]
  if (top.length >= 3) {
    const pct = Math.floor(100 / top.length)
    templates.push({
      label: `Equal Spread — ${top.length} funds`,
      description: top.join(' · '),
      rows: top.map((name, i) => ({ category_name: name, percentage: i === 0 ? 100 - pct * (top.length - 1) : pct })),
    })
  }
  return templates
}

type SplitRow = { category_name: string; percentage: number }

const SPLIT_GRID = 'grid grid-cols-[minmax(0,1fr)_4.5rem_1.25rem] gap-2 items-center'

/** Fund + share editor. Select can shrink/ellipsize, and picks are echoed as chips. */
function FundSplitRows({ rows, catNames, onChange }: {
  rows: SplitRow[]
  catNames: string[]
  onChange: (rows: SplitRow[]) => void
}) {
  const patch    = (i: number, p: Partial<SplitRow>) => onChange(rows.map((r, j) => j === i ? { ...r, ...p } : r))
  const selected = rows.filter(r => r.category_name)

  return (
    <div className="space-y-1">
      <div className={`${SPLIT_GRID} pb-0.5`}>
        <span className="text-xs font-medium text-gray-400 dark:text-gray-500 pl-1">Fund</span>
        <span className="text-xs font-medium text-gray-400 dark:text-gray-500 text-center">Share&nbsp;(%)</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={i} className={SPLIT_GRID}>
          <select
            value={row.category_name}
            title={row.category_name || undefined}
            onChange={e => patch(i, { category_name: e.target.value })}
            className={`${inputCls} min-w-0 truncate`}
          >
            <option value="">Select fund…</option>
            {catNames.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <input
            type="number"
            min={0}
            max={100}
            value={row.percentage}
            onChange={e => patch(i, { percentage: Number(e.target.value) })}
            className={`${inputCls} min-w-0 px-1 text-center`}
          />
          {rows.length > 1 ? (
            <button
              type="button"
              aria-label={`Remove ${row.category_name || 'fund'}`}
              onClick={() => onChange(rows.filter((_, j) => j !== i))}
              className="text-red-400 hover:text-red-500"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          ) : <span />}
        </div>
      ))}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1.5">
          {selected.map((r, i) => (
            <span
              key={i}
              className="text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary dark:bg-primary/20"
            >
              {r.category_name} · {r.percentage}%
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function DistributionRulesStep({ onDataReady }: { onDataReady: (ready: boolean) => void }) {
  const { categories }         = useCategories()
  const configs                = useAllocationStore(s => s.configs)
  const groups                 = useAllocationStore(s => s.groups)
  const loaded                 = useAllocationStore(s => s.loaded)
  const { push: toast }        = useToastStore()
  const [creating, setCreating]  = useState<number | null>(null)
  const [error, setError]        = useState<string | null>(null)
  const [showCustom, setShowCustom]   = useState(false)
  const [customName, setCustomName]   = useState('')
  const [customRows, setCustomRows]   = useState<Array<{ category_name: string; percentage: number }>>([{ category_name: '', percentage: 100 }])
  const [savingCustom, setSavingCustom] = useState(false)

  useEffect(() => { if (!loaded) useAllocationStore.getState().fetch() }, [loaded])
  useEffect(() => { onDataReady(true) }, [onDataReady])

  const catNames       = useMemo(() => categories.filter(c => !c.is_hidden).map(c => c.name), [categories])
  const templates      = useMemo(() => buildDistributionTemplates(catNames), [catNames])

  // Rules created here are versions of the General rule group. Configs written
  // without a config_group_id are orphans: they never show up in Setup →
  // Distribution Rules and are skipped by buildVersionIndex(), so they can
  // never apply to a transaction.
  const generalGroupId = useMemo(() => groups.find(g => g.is_default)?.id ?? null, [groups])
  const regularConfigs = useMemo(
    () => (generalGroupId ? configs.filter(c => c.config_group_id === generalGroupId) : []),
    [configs, generalGroupId],
  )

  const saveGeneralRule = async (label: string, rows: SplitRow[]) => {
    const today = new Date().toISOString().slice(0, 10)
    await setGeneralRuleLive({
      name:           label,
      rows:           rows.map(r => ({ category_name: r.category_name, budget_portion: 'Percentage', percentage: r.percentage })),
      effective_from: today,
    })
    await useAllocationStore.getState().reload()
  }

  const handleCreate = async (idx: number, t: DistTemplate) => {
    if (creating !== null) return
    setCreating(idx); setError(null)
    try {
      await saveGeneralRule(t.label, t.rows)
      toast(`"${t.label}" is now your live General rule`, 'success')
    } catch (err) {
      setError(friendlyError(err, 'save the rule'))
    } finally {
      setCreating(null)
    }
  }

  const handleCustomCreate = async () => {
    if (!customName.trim() || savingCustom) return
    const total = customRows.reduce((s, r) => s + r.percentage, 0)
    if (total !== 100 || customRows.some(r => !r.category_name)) return
    setSavingCustom(true); setError(null)
    try {
      await saveGeneralRule(customName.trim(), customRows)
      toast(`"${customName.trim()}" is now your live General rule`, 'success')
      setShowCustom(false); setCustomName(''); setCustomRows([{ category_name: '', percentage: 100 }])
    } catch (err) {
      setError(friendlyError(err, 'save the rule'))
    } finally {
      setSavingCustom(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="How should income be split across your funds?"
        description="A distribution rule tells Clariva how to divide incoming money — for example, 70% to General Fund, 20% to Building Fund, 10% to Welfare. These are your default rules for income that is general and not earmarked for a specific cause."
      />

      <div className="flex gap-3 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-700 dark:text-amber-400">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>The rule you pick here <strong>goes live immediately</strong> as your General rule. Pick a different one to replace it, or change it any time in Settings → Distribution Rules.</p>
      </div>

      {regularConfigs.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Created so far:</p>
          <div className="flex flex-wrap gap-2">
            {regularConfigs.map(r => <ItemBadge key={r.id} label={r.name} />)}
          </div>
        </div>
      )}

      {catNames.length < 2 ? (
        <p className="text-xs text-gray-500 dark:text-gray-500 italic p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          Add at least 2 funds in the previous step before setting up distribution rules.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Quick-start templates — tap any to make it your live rule:</p>
          {templates.map((t, idx) => {
            const alreadyCreated = regularConfigs.some(r => r.name === t.label)
            const isCreating     = creating === idx
            return (
              <button
                key={idx}
                type="button"
                disabled={alreadyCreated || creating !== null}
                onClick={() => handleCreate(idx, t)}
                className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-colors disabled:opacity-50 ${
                  alreadyCreated
                    ? 'border-primary/20 bg-primary/5 dark:bg-primary/10'
                    : 'border-gray-200 dark:border-gray-700 hover:border-primary/40 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  alreadyCreated ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                }`}>
                  {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : alreadyCreated ? <Check className="w-4 h-4" /> : <SlidersHorizontal className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${alreadyCreated ? 'text-primary' : 'text-gray-800 dark:text-gray-200'}`}>{t.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {t.rows.map(r => (
                      <span key={r.category_name} className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-600 dark:text-gray-400">
                        {r.category_name} {r.percentage}%
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="border-t border-gray-100 dark:border-white/[0.07] pt-3 space-y-2">
        {!showCustom ? (
          <button
            type="button"
            onClick={() => setShowCustom(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <Plus className="w-3.5 h-3.5" />
            Create a custom rule
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Custom distribution rule</p>
            <input
              type="text"
              value={customName}
              onChange={e => setCustomName(e.target.value)}
              placeholder="Rule name (e.g. My Custom Split)"
              className={inputCls}
            />
            <FundSplitRows rows={customRows} catNames={catNames} onChange={setCustomRows} />
            {(() => {
              const total = customRows.reduce((s, r) => s + r.percentage, 0)
              return total !== 100 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">Total: {total}% — must equal 100%</p>
              ) : (
                <p className="text-xs text-green-600 dark:text-green-400">Total: 100% ✓</p>
              )
            })()}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setCustomRows(rows => [...rows, { category_name: '', percentage: 0 }])}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="w-3 h-3" /> Add fund
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCustom(false); setCustomName(''); setCustomRows([{ category_name: '', percentage: 100 }]) }}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!customName.trim() || customRows.some(r => !r.category_name) || customRows.reduce((s, r) => s + r.percentage, 0) !== 100 || savingCustom}
                  onClick={handleCustomCreate}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {savingCustom ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Save rule
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <EditLaterNote where="Settings → Distribution Rules" />
    </div>
  )
}

// ── Step 8: Special Rules (optional) ─────────────────────────────────────────

type SpecialTemplate = { label: string; description: string; incomeTypeId: string; rows: Array<{ category_name: string; percentage: number }> }

function buildSpecialTemplates(
  incomeTypes: { id: string; name: string }[],
  catNames:    string[],
): SpecialTemplate[] {
  if (!incomeTypes.length || !catNames.length) return []
  const [cat0, cat1] = catNames
  const [it0, it1]   = incomeTypes
  const templates: SpecialTemplate[] = []
  templates.push({
    label:        `${it0.name} → All to ${cat0}`,
    description:  `100% of "${it0.name}" goes directly into ${cat0}`,
    incomeTypeId: it0.id,
    rows:         [{ category_name: cat0, percentage: 100 }],
  })
  if (it1 && cat1) {
    templates.push({
      label:        `${it1.name}: 60 / 40`,
      description:  `60% to ${cat0}, 40% to ${cat1}`,
      incomeTypeId: it1.id,
      rows:         [{ category_name: cat0, percentage: 60 }, { category_name: cat1, percentage: 40 }],
    })
  }
  return templates
}

function SpecialRulesStep({ onDataReady }: { onDataReady: (ready: boolean) => void }) {
  const { categories }                                     = useCategories()
  const { incomeTypes }                                    = useIncomeTypes()
  const { groups, loading: groupsLoading, refetch }        = useSpecialConfigGroups()
  const { push: toast }                                    = useToastStore()
  const [creating, setCreating]                            = useState<number | null>(null)
  const [error, setError]                                  = useState<string | null>(null)
  const [showCustomSpecial, setShowCustomSpecial]          = useState(false)
  const [customSpecialName, setCustomSpecialName]          = useState('')
  const [customSpecialTypeId, setCustomSpecialTypeId]      = useState('')
  const [customSpecialRows, setCustomSpecialRows]          = useState<Array<{ category_name: string; percentage: number }>>([{ category_name: '', percentage: 100 }])
  const [savingCustomSpecial, setSavingCustomSpecial]      = useState(false)

  useEffect(() => { onDataReady(true) }, [onDataReady])

  const catNames  = useMemo(() => categories.filter(c => !c.is_hidden).map(c => c.name), [categories])
  const userTypes = useMemo(() => incomeTypes.filter(t => !t.name.startsWith('_')), [incomeTypes])
  const templates = useMemo(() => buildSpecialTemplates(userTypes, catNames), [userTypes, catNames])

  const handleCreate = async (idx: number, t: SpecialTemplate) => {
    if (creating !== null) return
    setCreating(idx); setError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      await createGroupWithFirstVersion({
        name:            t.label,
        allocation_type: 'percentage',
        total_amount:    null,
        rows:            t.rows.map(r => ({ category_name: r.category_name, budget_portion: 'Percentage' as const, percentage: r.percentage })),
        effective_from:  today,
        status:          'locked',
        income_type_id:  t.incomeTypeId,
      })
      toast(`"${t.label}" special rule is now live`, 'success')
      await useAllocationStore.getState().reload()
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save the rule'))
    } finally {
      setCreating(null)
    }
  }

  const handleCustomSpecialCreate = async () => {
    if (!customSpecialName.trim() || !customSpecialTypeId || savingCustomSpecial) return
    const total = customSpecialRows.reduce((s, r) => s + r.percentage, 0)
    if (total !== 100 || customSpecialRows.some(r => !r.category_name)) return
    setSavingCustomSpecial(true); setError(null)
    try {
      const today = new Date().toISOString().slice(0, 10)
      await createGroupWithFirstVersion({
        name:            customSpecialName.trim(),
        allocation_type: 'percentage',
        total_amount:    null,
        rows:            customSpecialRows.map(r => ({ category_name: r.category_name, budget_portion: 'Percentage' as const, percentage: r.percentage })),
        effective_from:  today,
        status:          'locked',
        income_type_id:  customSpecialTypeId,
      })
      toast(`"${customSpecialName.trim()}" special rule is now live`, 'success')
      setShowCustomSpecial(false); setCustomSpecialName(''); setCustomSpecialTypeId(''); setCustomSpecialRows([{ category_name: '', percentage: 100 }])
      await useAllocationStore.getState().reload()
      refetch()
    } catch (err) {
      setError(friendlyError(err, 'save the rule'))
    } finally {
      setSavingCustomSpecial(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="Do any income types need their own split?"
        description="A special rule overrides the default distribution for a specific income type — these are rules set for income that is given for a specific cause. Example: a &ldquo;Building Fund Drive&rdquo; offering always goes 100% to the Building Fund, not the regular split."
      />

      <div className="flex gap-3 p-3 bg-violet-50 dark:bg-violet-950/20 border border-violet-200 dark:border-violet-800 rounded-xl text-xs text-violet-700 dark:text-violet-400">
        <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
        <p>Special rules are linked to a specific income type and kick in whenever that type is selected — overriding the normal distribution rule.</p>
      </div>

      {!groupsLoading && groups.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Created so far:</p>
          <div className="flex flex-wrap gap-2">
            {groups.map(g => <ItemBadge key={g.id} label={g.name} />)}
          </div>
        </div>
      )}

      {templates.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-gray-500 italic p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
          Add income types and funds first to unlock example special rules here.
        </p>
      ) : (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Example rules — tap any to make it live:</p>
          {templates.map((t, idx) => {
            const alreadyCreated = groups.some(g => g.name === t.label)
            const isCreating     = creating === idx
            return (
              <button
                key={idx}
                type="button"
                disabled={alreadyCreated || creating !== null}
                onClick={() => handleCreate(idx, t)}
                className={`w-full flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-colors disabled:opacity-50 ${
                  alreadyCreated
                    ? 'border-primary/20 bg-primary/5 dark:bg-primary/10'
                    : 'border-gray-200 dark:border-gray-700 hover:border-primary/40 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
              >
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${
                  alreadyCreated ? 'bg-primary text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-400'
                }`}>
                  {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : alreadyCreated ? <Check className="w-4 h-4" /> : <Zap className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${alreadyCreated ? 'text-primary' : 'text-gray-800 dark:text-gray-200'}`}>{t.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.description}</p>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {t.rows.map(r => (
                      <span key={r.category_name} className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded text-gray-600 dark:text-gray-400">
                        {r.category_name} {r.percentage}%
                      </span>
                    ))}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="border-t border-gray-100 dark:border-white/[0.07] pt-3 space-y-2">
        {!showCustomSpecial ? (
          <button
            type="button"
            onClick={() => setShowCustomSpecial(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <Plus className="w-3.5 h-3.5" />
            Create a custom special rule
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200">Custom special rule</p>
            <input
              type="text"
              value={customSpecialName}
              onChange={e => setCustomSpecialName(e.target.value)}
              placeholder="Rule name (e.g. Building Fund Drive)"
              className={inputCls}
            />
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Income type this rule applies to</label>
              <select
                value={customSpecialTypeId}
                onChange={e => setCustomSpecialTypeId(e.target.value)}
                className={inputCls}
              >
                <option value="">Select income type…</option>
                {userTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400">How to split it</label>
              <FundSplitRows rows={customSpecialRows} catNames={catNames} onChange={setCustomSpecialRows} />
            </div>
            {(() => {
              const total = customSpecialRows.reduce((s, r) => s + r.percentage, 0)
              return total !== 100 ? (
                <p className="text-xs text-amber-600 dark:text-amber-400">Total: {total}% — must equal 100%</p>
              ) : (
                <p className="text-xs text-green-600 dark:text-green-400">Total: 100% ✓</p>
              )
            })()}
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => setCustomSpecialRows(rows => [...rows, { category_name: '', percentage: 0 }])}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="w-3 h-3" /> Add fund
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setShowCustomSpecial(false); setCustomSpecialName(''); setCustomSpecialTypeId(''); setCustomSpecialRows([{ category_name: '', percentage: 100 }]) }}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={!customSpecialName.trim() || !customSpecialTypeId || customSpecialRows.some(r => !r.category_name) || customSpecialRows.reduce((s, r) => s + r.percentage, 0) !== 100 || savingCustomSpecial}
                  onClick={handleCustomSpecialCreate}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
                >
                  {savingCustomSpecial ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Save rule
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <EditLaterNote where="Budget & Allocation → Special Rules" />
    </div>
  )
}

// ── Step 9: Team Members (optional) ──────────────────────────────────────────

function TeamMembersStep() {
  const orgId    = useOrgStore(s => s.orgId)
  const orgType  = useOrgStore(s => s.orgType)
  const content  = getOrgTypeContent(orgType)
  const user     = useAuthStore(s => s.user)
  const { push: toast } = useToastStore()
  const [members, setMembers] = useState<{ id: string; email: string; role: string }[]>([])
  const [email,   setEmail]   = useState('')
  const [role,    setRole]    = useState<'admin' | 'accountant' | 'viewer'>('accountant')
  const [saving,  setSaving]  = useState(false)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [error,   setError]   = useState<string | null>(null)

  const loadMembers = useCallback(async () => {
    if (!orgId) return
    const { data } = await supabase
      .from('org_members')
      .select('id, user_id, role, profiles(email)')
      .eq('org_id', orgId)
      .eq('status', 'active')
    if (data) {
      setMembers(data.map((m: Record<string, unknown>) => ({
        id:    m.id as string,
        email: (m.profiles as { email: string } | null)?.email ?? '—',
        role:  m.role as string,
      })))
    }
  }, [orgId])

  useEffect(() => { loadMembers() }, [loadMembers])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !orgId || !user) return
    setSaving(true); setError(null); setInviteUrl(null)

    const { data: existing } = await supabase
      .from('invitations')
      .select('token')
      .eq('email', email.trim())
      .eq('org_id', orgId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (existing) {
      setInviteUrl(`${window.location.origin}/invite/${existing.token}`)
      setSaving(false)
      return
    }

    const token     = crypto.randomUUID()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { error: err } = await supabase.from('invitations').insert({
      email:      email.trim(),
      role,
      invited_by: user.id,
      status:     'pending',
      token,
      expires_at: expiresAt,
      org_id:     orgId,
    })
    setSaving(false)
    if (err) {
      setError(err.message)
    } else {
      setInviteUrl(`${window.location.origin}/invite/${token}`)
      toast(`Invitation sent to ${email.trim()}`, 'success')
      setEmail('')
    }
  }

  const handleCopy = () => {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl)
      .then(() => toast('Link copied!', 'success'))
      .catch(() => {})
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="Who else helps manage your organisation's finances?"
        description={`Invite your ${content.teamRoleLabel}. They'll get a link to create their account. Set them as Admin (full access), Accountant (can record transactions), or Viewer (read-only).`}
      />

      {members.length > 0 && (
        <div className="bg-gray-50 dark:bg-[#141416] rounded-xl border border-gray-200 dark:border-white/[0.07] divide-y divide-gray-100 dark:divide-white/[0.07]">
          {members.map(m => (
            <div key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-gray-700 dark:text-gray-300 truncate">{m.email}</span>
              <span className="text-xs text-gray-500 capitalize flex-shrink-0 ml-2">{m.role}</span>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={handleInvite} className="space-y-2">
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg border border-red-200 dark:border-red-800">
            <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
            {error}
          </div>
        )}
        <div className="space-y-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400 flex items-center gap-1">
              <Mail className="w-3 h-3" />
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="colleague@example.com"
              className={inputCls}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-500 dark:text-gray-400">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as typeof role)}
              className={inputCls}
            >
              <option value="admin">Admin</option>
              <option value="accountant">Accountant</option>
              <option value="viewer">Viewer</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!email.trim() || saving}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            Send Invite
          </button>
        </div>
      </form>

      {inviteUrl && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-xs">
          <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0" />
          <span className="text-green-700 dark:text-green-400 truncate flex-1">{inviteUrl}</span>
          <button
            type="button"
            onClick={handleCopy}
            className="text-green-700 dark:text-green-400 hover:underline font-medium flex-shrink-0"
          >
            Copy
          </button>
        </div>
      )}

      <EditLaterNote where="Administration → Team Members" />
    </div>
  )
}

// ── Step 8: Import Statement (optional) ──────────────────────────────────────

function ImportStatementStep({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()

  const handleGoToImport = () => {
    onClose()
    navigate('/import')
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="Ready to load your first bank statement?"
        description="Download a statement from your bank's online portal in Excel or CSV format, then upload it here. The app maps the columns, identifies your transactions, and links each one to the right bank account, income type, and expense category."
      />

      <div className="space-y-3 bg-gray-50 dark:bg-[#141416] rounded-xl border border-gray-200 dark:border-white/[0.07] p-4">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300">How it works:</p>
        <ol className="space-y-2 text-sm text-gray-600 dark:text-gray-400">
          {[
            'Download a statement from your bank\'s online portal',
            'Go to the Import page and drag your file onto the upload zone',
            'Map the columns (date, description, amount)',
            'Review and confirm — transactions are imported instantly',
          ].map((step, i) => (
            <li key={i} className="flex items-start gap-2.5">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <button
        type="button"
        onClick={handleGoToImport}
        className="flex items-center gap-2 w-full justify-center px-4 py-3 text-sm font-medium text-white bg-primary rounded-xl hover:bg-primary-dark transition-colors"
      >
        <Upload className="w-4 h-4" />
        Go to Import Page
        <ExternalLink className="w-3.5 h-3.5 opacity-70" />
      </button>

      <p className="text-xs text-center text-gray-400 dark:text-gray-500">
        You can also import later from the sidebar under Daily Finance → Import.
      </p>
    </div>
  )
}

// ── Step 9: Finish ────────────────────────────────────────────────────────────

function FinishStep({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()

  return (
    <div className="space-y-5 text-center">
      <div className="flex items-center justify-center">
        <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
          <CheckCircle2 className="w-8 h-8 text-green-600 dark:text-green-400" />
        </div>
      </div>
      <div className="space-y-1">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Your organisation is all set up!</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Everything you've added can be updated anytime from the <strong>Setup</strong> page in the sidebar. Here's where to go next.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-left">
        {[
          { icon: Upload,        label: 'Import Statement',  desc: 'Upload your first bank statement',   href: '/import'      },
          { icon: Landmark,      label: 'Bank Ledger',       desc: 'View transactions by account',       href: '/bank-ledger' },
          { icon: ArrowDownCircle, label: 'Inflows',         desc: 'Browse income records',              href: '/inflows'     },
          { icon: Tag,           label: 'Categories',        desc: 'Manage your funds and pots',         href: '/categories'  },
        ].map(({ icon: Icon, label, desc, href }) => (
          <button
            key={href}
            type="button"
            onClick={() => { onClose(); navigate(href) }}
            className="flex items-start gap-2.5 p-3 bg-gray-50 dark:bg-[#141416] rounded-xl border border-gray-200 dark:border-white/[0.07] hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
          >
            <Icon className="w-4 h-4 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{label}</p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{desc}</p>
            </div>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="w-full flex items-center justify-center gap-2 py-2 text-sm text-primary hover:text-primary-dark font-medium transition-colors"
      >
        <CheckCircle2 className="w-4 h-4" />
        View setup checklist
      </button>
    </div>
  )
}

// ── Steps that always allow Continue (no minimum data required) ───────────────

const UNVALIDATED_STEPS: WizardStepId[] = ['org-type', 'distribution-rules', 'special-rules', 'team-members', 'import-statement', 'finish']

// ── Step icon map ─────────────────────────────────────────────────────────────

const STEP_ICONS: Record<WizardStepId, React.ElementType> = {
  'org-details':          Sparkles,
  'org-type':             Sparkles,
  'departments':          Building2,
  'banks':                Landmark,
  'income-types':         ArrowDownCircle,
  'outflow-types':        ArrowUpCircle,
  'categories':           Tag,
  'distribution-rules':   SlidersHorizontal,
  'special-rules':        Zap,
  'team-members':         Users,
  'import-statement':     Upload,
  'finish':               Check,
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / (total - 1)) * 100)
  return (
    <div className="h-1 bg-gray-200 dark:bg-[#1c1c1e] rounded-full overflow-hidden">
      <div
        className="h-full bg-primary rounded-full transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ── Main SetupWizard ──────────────────────────────────────────────────────────

const BASE_WIZARD_STEP_IDS: WizardStepId[] = [
  'org-type',
  'departments',
  'banks',
  'income-types',
  'outflow-types',
  'categories',
  'distribution-rules',
  'special-rules',
  'team-members',
  'import-statement',
  'finish',
]

export function SetupWizard() {
  const { isWizardOpen, closeWizard } = useOnboardingStore()
  const { prefs, updatePrefs }        = useUserPreferences()
  const { canWrite }                  = useRole()
  const orgType                       = useOrgStore(s => s.orgType)
  const user                          = useAuthStore(s => s.user)

  const activeStepIds = useMemo<WizardStepId[]>(
    () => orgType === 'personal'
      ? BASE_WIZARD_STEP_IDS.filter(s => s !== 'team-members' && s !== 'departments')
      : BASE_WIZARD_STEP_IDS,
    [orgType],
  )

  const savedStep = Math.min(prefs.wizard_step, activeStepIds.length - 1)
  const [currentIdx, setCurrentIdx] = useState(savedStep)
  const [stepDataReady, setStepDataReady] = useState(false)

  useEffect(() => {
    if (isWizardOpen) {
      setCurrentIdx(Math.min(prefs.wizard_step, activeStepIds.length - 1))
    }
  }, [isWizardOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const stepId  = activeStepIds[currentIdx]
  const stepDef = WIZARD_STEPS.find(s => s.id === stepId)!
  const isLast  = currentIdx === activeStepIds.length - 1

  useEffect(() => { setStepDataReady(false) }, [stepId])

  const notifyDataReady = useCallback((ready: boolean) => setStepDataReady(ready), [])
  const canContinue = UNVALIDATED_STEPS.includes(stepId) || stepDataReady

  const goToStep = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, activeStepIds.length - 1))
    setCurrentIdx(clamped)
    updatePrefs({ wizard_step: clamped })
  }, [activeStepIds.length, updatePrefs])

  const handleNext = () => {
    if (isLast) {
      updatePrefs({ wizard_completed: true, wizard_step: activeStepIds.length - 1 })
      closeWizard()
    } else {
      goToStep(currentIdx + 1)
    }
  }

  const handleBack  = () => { if (currentIdx > 0) goToStep(currentIdx - 1) }
  const handleSkip  = () => { goToStep(currentIdx + 1) }
  const handleClose = () => {
    updatePrefs({ wizard_step: currentIdx, wizard_auto_show_dismissed: true })
    markWizardDismissed(user?.id)
    closeWizard()
  }

  if (!isWizardOpen || !canWrite()) return null

  const remainingMinutes = WIZARD_STEPS
    .filter(s => activeStepIds.slice(currentIdx).includes(s.id as WizardStepId))
    .reduce((sum, s) => sum + s.estimatedMinutes, 0)

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-white dark:bg-[#0c0c0e] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100 dark:border-white/[0.07]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center flex-shrink-0">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-gray-900 dark:text-white">Getting You Set Up</h1>
              {remainingMinutes > 0 && (
                <p className="text-xs text-gray-500 dark:text-gray-500 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  ~{remainingMinutes} min remaining
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Save and exit wizard"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1 rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Progress */}
        <div className="px-6 py-2">
          <ProgressBar current={currentIdx} total={activeStepIds.length} />
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Step {currentIdx + 1} of {activeStepIds.length}
          </p>
        </div>

        {/* Step sidebar + content */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar — hidden on mobile */}
          <aside className="hidden sm:flex flex-col w-44 flex-shrink-0 border-r border-gray-100 dark:border-white/[0.07] py-4 px-3 gap-1 overflow-y-auto">
            {activeStepIds.map((id, idx) => {
              const def    = WIZARD_STEPS.find(s => s.id === id)
              const Icon   = STEP_ICONS[id]
              const done   = idx < currentIdx
              const active = idx === currentIdx
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => idx <= currentIdx && goToStep(idx)}
                  disabled={idx > currentIdx}
                  className={`flex items-center gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition-colors ${
                    active
                      ? 'bg-primary text-white font-semibold'
                      : done
                        ? 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'
                        : 'text-gray-400 dark:text-gray-600 cursor-not-allowed'
                  }`}
                >
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                    active ? 'bg-white/20' : done ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-[#141416]'
                  }`}>
                    {done
                      ? <Check className="w-3 h-3 text-green-600 dark:text-green-400" />
                      : <Icon className={`w-3 h-3 ${active ? 'text-white' : 'text-gray-400'}`} />
                    }
                  </div>
                  <span className="truncate">{def?.title ?? id}</span>
                </button>
              )
            })}
          </aside>

          <main className="flex-1 overflow-y-auto p-6">
            {stepId === 'org-type'        && <OrgTypeStep onDataReady={notifyDataReady} />}
            {stepId === 'departments'     && <DepartmentsStep onDataReady={notifyDataReady} />}
            {stepId === 'banks'           && <BanksStep onDataReady={notifyDataReady} />}
            {stepId === 'income-types'    && <IncomeTypesStep onDataReady={notifyDataReady} />}
            {stepId === 'outflow-types'   && <OutflowTypesStep onDataReady={notifyDataReady} />}
            {stepId === 'categories'           && <CategoriesStep onDataReady={notifyDataReady} />}
            {stepId === 'distribution-rules'   && <DistributionRulesStep onDataReady={notifyDataReady} />}
            {stepId === 'special-rules'        && <SpecialRulesStep onDataReady={notifyDataReady} />}
            {stepId === 'team-members'         && <TeamMembersStep />}
            {stepId === 'import-statement'&& <ImportStatementStep onClose={closeWizard} />}
            {stepId === 'finish'          && <FinishStep onClose={closeWizard} />}
          </main>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-white/[0.07] gap-3">
          <button
            type="button"
            onClick={handleBack}
            disabled={currentIdx === 0}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 disabled:opacity-40 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>

          <div className="flex items-center gap-2">
            {stepDef?.skippable && !isLast && (
              <button
                type="button"
                onClick={handleSkip}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <SkipForward className="w-3.5 h-3.5" />
                Skip
              </button>
            )}
            {!isLast && (
              <button
                type="button"
                onClick={handleNext}
                disabled={!canContinue && !stepDef?.skippable}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark disabled:opacity-50 transition-colors"
              >
                Continue
                <ChevronRight className="w-4 h-4" />
              </button>
            )}
            {isLast && (
              <button
                type="button"
                onClick={handleNext}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-semibold text-white bg-primary rounded-lg hover:bg-primary-dark transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                Done
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Wizard-dismissed localStorage layer (user-scoped, resilient to DB issues) ─

function wizardDismissedKey(userId: string | undefined) {
  return userId ? `clariva-wizard-dismissed-${userId}` : null
}

function getWizardDismissed(userId: string | undefined): boolean {
  const k = wizardDismissedKey(userId)
  if (!k) return false
  try { return localStorage.getItem(k) === '1' } catch { return false }
}

function markWizardDismissed(userId: string | undefined) {
  const k = wizardDismissedKey(userId)
  if (!k) return
  try { localStorage.setItem(k, '1') } catch { /* storage unavailable */ }
}

// ── Auto-show hook ────────────────────────────────────────────────────────────

export function useWizardAutoShow() {
  const { prefs, loading } = useUserPreferences()
  const user               = useAuthStore(s => s.user)
  const orgId              = useOrgStore(s => s.orgId)
  const orgRole            = useOrgStore(s => s.orgRole)
  const openWizard         = useOnboardingStore(s => s.openWizard)
  const isWizardOpen       = useOnboardingStore(s => s.isWizardOpen)

  useEffect(() => {
    if (loading)                                    return
    if (!orgId)                                     return
    if (isWizardOpen)                               return
    if (prefs.wizard_completed)                     return
    if (prefs.wizard_auto_show_dismissed)           return
    if (getWizardDismissed(user?.id))               return
    if (orgRole !== 'owner' && orgRole !== 'admin') return
    openWizard()
  }, [loading, orgId, orgRole, prefs.wizard_completed, prefs.wizard_auto_show_dismissed, user?.id]) // eslint-disable-line react-hooks/exhaustive-deps
}
