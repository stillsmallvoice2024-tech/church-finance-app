import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  X, ChevronRight, ChevronLeft, Check, Clock, Building2, Landmark,
  ArrowDownCircle, ArrowUpCircle, Users, Upload, Sparkles, Loader2,
  Plus, AlertCircle, CheckCircle2, ExternalLink, SkipForward, Tag,
} from 'lucide-react'
import { useOnboardingStore } from '../../store/onboardingStore'
import { useUserPreferences } from '../../hooks/useUserPreferences'
import { useOrgStore } from '../../store/orgStore'
import { useAuthStore } from '../../store/authStore'
import { useRole } from '../../hooks/useRole'
import { useDepartments, saveDepartment } from '../../hooks/useDepartments'
import { useBanks } from '../../hooks/useBanks'
import { useAddBank } from '../../hooks/useMutations'
import { useIncomeTypes, saveIncomeType } from '../../hooks/useIncomeTypes'
import { useOutflowTypes, saveOutflowType } from '../../hooks/useOutflowTypes'
import { useCategories } from '../../hooks/useCategories'
import { useAddCategory } from '../../hooks/useMutations'
import { useCurrencies } from '../../hooks/useCurrencies'
import { supabase } from '../../lib/supabase'
import { useToastStore } from '../../store/toastStore'
import { WIZARD_STEPS } from '../../onboarding/wizard/definitions'
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
  'dark:bg-gray-700 dark:border-gray-600 dark:text-white dark:focus:border-primary'

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

// ── Step 2: Departments ───────────────────────────────────────────────────────

function DepartmentsStep() {
  const { departments, loading, refetch } = useDepartments()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { push: toast } = useToastStore()

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
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="Which teams or groups are in your church?"
        description="Think of the departments or ministries that handle money — Youth, Women's Fellowship, Administration, Choir. You'll be able to assign spending to each one so you can see exactly where funds go."
      />

      {!loading && departments.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {departments.map(d => <ItemBadge key={d.id} label={d.name} />)}
        </div>
      )}
      {loading && (
        <div className="flex gap-2">
          {[1, 2, 3].map(i => <div key={i} className="h-6 w-20 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />)}
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
            placeholder="e.g. Youth Ministry, Administration…"
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
          No departments yet. Add at least one to continue.
        </p>
      )}

      <EditLaterNote where="Setup → Departments" />
    </div>
  )
}

// ── Step 3: Banks ─────────────────────────────────────────────────────────────

function BanksStep() {
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
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="Which bank accounts does your church use?"
        description="Add every account the church operates — your main account, a building fund account, a foreign currency account. The name you enter here must match your bank statement exactly when you import transactions."
      />

      {!loading && banks.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {banks.map(b => <ItemBadge key={b.id} label={`${b.name}${b.currency && b.currency !== 'NGN' ? ` (${b.currency})` : ''}`} />)}
        </div>
      )}
      {loading && (
        <div className="flex gap-2">
          {[1, 2].map(i => <div key={i} className="h-6 w-24 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />)}
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
        <div className="flex gap-2">
          <input
            type="text"
            value={acctNum}
            onChange={e => setAcctNum(e.target.value)}
            placeholder="Account number (optional)"
            className={`${inputCls} flex-1`}
          />
          <select
            value={currency}
            onChange={e => setCurrency(e.target.value)}
            className={`${inputCls} w-28`}
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

function IncomeTypesStep() {
  const { incomeTypes, loading, refetch } = useIncomeTypes()
  const { push: toast } = useToastStore()
  const [name, setName]     = useState('')
  const [colour, setColour] = useState(COLOUR_SWATCHES[0])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const userIncomeTypes = incomeTypes.filter(t => !t.name.startsWith('_'))

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
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="How does money come into your church?"
        description="Give each income stream its own label. For example: Tithes, Sunday Offering, Midweek Offering, Donations, Building Levy. When you import a bank statement, every credit will be tagged with one of these so you know exactly what kind of income it was."
      />

      {!loading && userIncomeTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {userIncomeTypes.map(t => (
            <ItemBadge key={t.id} label={t.name} />
          ))}
        </div>
      )}
      {loading && (
        <div className="flex gap-2">
          {[1, 2, 3].map(i => <div key={i} className="h-6 w-20 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />)}
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
            placeholder="e.g. Tithes, Offerings, Donations…"
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
          No income types yet. Add at least one to continue.
        </p>
      )}

      <EditLaterNote where="Setup → Income Types" />
    </div>
  )
}

// ── Step 5: Outflow Types ─────────────────────────────────────────────────────

function OutflowTypesStep() {
  const { outflowTypes, loading, refetch } = useOutflowTypes()
  const { push: toast } = useToastStore()
  const [name, setName]     = useState('')
  const [colour, setColour] = useState(COLOUR_SWATCHES[2])
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState<string | null>(null)

  const userTypes = outflowTypes.filter(t => !t.is_system)

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
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="What does your church spend money on?"
        description="Think of your regular expense categories — paying staff, covering utility bills, running programmes, buying supplies. Every debit on your bank statement will be tagged with one of these so you can see exactly what the money went to."
      />

      {!loading && userTypes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {userTypes.map(t => <ItemBadge key={t.id} label={t.name} />)}
        </div>
      )}
      {loading && (
        <div className="flex gap-2">
          {[1, 2].map(i => <div key={i} className="h-6 w-20 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />)}
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
            placeholder="e.g. Salaries, Utilities, Programmes…"
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
          No outflow types yet. Add at least one to continue.
        </p>
      )}

      <EditLaterNote where="Setup → Outflow Types" />
    </div>
  )
}

// ── Step 6: Categories (Funds) ────────────────────────────────────────────────

const CATEGORY_STARTERS = [
  'General Fund',
  'Building Fund',
  'Welfare',
  'Missions',
  'Youth Fund',
  'Special Projects',
  'Benevolence',
]

function CategoriesStep() {
  const { categories, loading, refetch } = useCategories()
  const { mutate: addCategory } = useAddCategory()
  const { push: toast } = useToastStore()
  const [name, setName]               = useState('')
  const [saving, setSaving]           = useState(false)
  const [addingTemplate, setAddingTemplate] = useState<string | null>(null)
  const [error, setError]             = useState<string | null>(null)

  const visibleCategories = categories.filter(c => !c.is_hidden)
  const existingNames = new Set(categories.map(c => c.name.toLowerCase()))

  const handleAddTemplate = async (tpl: string) => {
    if (existingNames.has(tpl.toLowerCase()) || addingTemplate) return
    setAddingTemplate(tpl); setError(null)
    try {
      await addCategory({ name: tpl })
      toast(`${tpl} added`, 'success')
      refetch()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setAddingTemplate(null)
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
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <StepHeading
        title="What funds or pots does your church manage?"
        description="A fund is like a dedicated wallet for a purpose — General Fund, Building Fund, Welfare. When income comes in, it gets split into these pockets based on your distribution rules. You can watch each fund grow over time."
      />

      {/* Quick-start template chips */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
          Common funds — tap any to add instantly:
        </p>
        <div className="flex flex-wrap gap-2">
          {CATEGORY_STARTERS.map(tpl => {
            const added    = existingNames.has(tpl.toLowerCase())
            const isAdding = addingTemplate === tpl
            return (
              <button
                key={tpl}
                type="button"
                disabled={added || !!addingTemplate}
                onClick={() => handleAddTemplate(tpl)}
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
                {tpl}
              </button>
            )
          })}
        </div>
      </div>

      {/* Funds added so far */}
      {!loading && visibleCategories.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {visibleCategories.map(c => <ItemBadge key={c.id} label={c.name} />)}
        </div>
      )}
      {loading && (
        <div className="flex gap-2">
          {[1, 2, 3].map(i => <div key={i} className="h-6 w-24 bg-gray-100 dark:bg-gray-700 rounded-lg animate-pulse" />)}
        </div>
      )}

      {/* Custom fund input */}
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

// ── Step 7: Team Members (optional) ──────────────────────────────────────────

function TeamMembersStep() {
  const orgId    = useOrgStore(s => s.orgId)
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
        title="Who else helps manage your church's finances?"
        description="Invite your treasurer, accountant, or a church leader. They'll get a link to create their account. Set them as Admin (full access), Accountant (can record transactions), or Viewer (read-only)."
      />

      {members.length > 0 && (
        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700">
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
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="colleague@example.com"
            className={`${inputCls} flex-1`}
          />
          <select
            value={role}
            onChange={e => setRole(e.target.value as typeof role)}
            className={`${inputCls} w-32`}
          >
            <option value="admin">Admin</option>
            <option value="accountant">Accountant</option>
            <option value="viewer">Viewer</option>
          </select>
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
        description="Download a statement from your bank's online portal in Excel or CSV format, then upload it here. The app maps the columns, identifies your transactions, and links each one to the right bank and income or expense type."
      />

      <div className="space-y-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
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
        <h2 className="text-xl font-bold text-gray-900 dark:text-white">Your church is all set up!</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Everything you've added can be updated anytime from the <strong>Setup</strong> page in the sidebar. Here's where to go next.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-left">
        {[
          { icon: Upload, label: 'Import Statement', desc: 'Upload your first bank statement', href: '/import' },
          { icon: Landmark, label: 'Bank Ledger', desc: 'View transactions by account', href: '/bank-ledger' },
          { icon: ArrowDownCircle, label: 'Inflows', desc: 'Browse income records', href: '/inflows' },
          { icon: Tag, label: 'Categories', desc: 'Manage your funds and pots', href: '/categories' },
        ].map(({ icon: Icon, label, desc, href }) => (
          <button
            key={href}
            type="button"
            onClick={() => { onClose(); navigate(href) }}
            className="flex items-start gap-2.5 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700 hover:border-primary/40 hover:bg-primary/5 transition-colors text-left"
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

// ── Step validation ───────────────────────────────────────────────────────────

function useStepCanContinue(stepId: WizardStepId): boolean {
  const { departments } = useDepartments()
  const { banks }       = useBanks()
  const { incomeTypes } = useIncomeTypes()
  const { outflowTypes } = useOutflowTypes()
  const { categories }  = useCategories()

  switch (stepId) {
    case 'departments':   return departments.length > 0
    case 'banks':         return banks.length > 0
    case 'income-types':  return incomeTypes.filter(t => !t.name.startsWith('_')).length > 0
    case 'outflow-types': return outflowTypes.filter(t => !t.is_system).length > 0
    case 'categories':    return categories.filter(c => !c.is_hidden).length > 0
    default:              return true
  }
}

// ── Step icon map ─────────────────────────────────────────────────────────────

const STEP_ICONS: Record<WizardStepId, React.ElementType> = {
  'org-details':       Sparkles,
  'departments':       Building2,
  'banks':             Landmark,
  'income-types':      ArrowDownCircle,
  'outflow-types':     ArrowUpCircle,
  'categories':        Tag,
  'team-members':      Users,
  'import-statement':  Upload,
  'finish':            Check,
}

// ── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / (total - 1)) * 100)
  return (
    <div className="h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
      <div
        className="h-full bg-primary rounded-full transition-all duration-300"
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

// ── Main SetupWizard ──────────────────────────────────────────────────────────

// Displayed step IDs (skip 'org-details' — already covered by Onboarding.tsx)
const WIZARD_STEP_IDS: WizardStepId[] = [
  'departments',
  'banks',
  'income-types',
  'outflow-types',
  'categories',
  'team-members',
  'import-statement',
  'finish',
]

export function SetupWizard() {
  const { isWizardOpen, closeWizard } = useOnboardingStore()
  const { prefs, updatePrefs }        = useUserPreferences()
  const { canWrite }                  = useRole()

  const savedStep = Math.min(prefs.wizard_step, WIZARD_STEP_IDS.length - 1)
  const [currentIdx, setCurrentIdx] = useState(savedStep)

  useEffect(() => {
    if (isWizardOpen) {
      setCurrentIdx(Math.min(prefs.wizard_step, WIZARD_STEP_IDS.length - 1))
    }
  }, [isWizardOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  const stepId = WIZARD_STEP_IDS[currentIdx]
  const stepDef = WIZARD_STEPS.find(s => s.id === stepId)!
  const isLast  = currentIdx === WIZARD_STEP_IDS.length - 1
  const canContinue = useStepCanContinue(stepId)

  const goToStep = useCallback((idx: number) => {
    const clamped = Math.max(0, Math.min(idx, WIZARD_STEP_IDS.length - 1))
    setCurrentIdx(clamped)
    updatePrefs({ wizard_step: clamped })
  }, [updatePrefs])

  const handleNext = () => {
    if (isLast) {
      updatePrefs({ wizard_completed: true, wizard_step: WIZARD_STEP_IDS.length - 1 })
      closeWizard()
    } else {
      goToStep(currentIdx + 1)
    }
  }

  const handleBack = () => { if (currentIdx > 0) goToStep(currentIdx - 1) }

  const handleSkip = () => { goToStep(currentIdx + 1) }

  const handleClose = () => {
    updatePrefs({ wizard_step: currentIdx })
    closeWizard()
  }

  if (!isWizardOpen || !canWrite()) return null

  const remainingMinutes = WIZARD_STEPS
    .filter(s => WIZARD_STEP_IDS.slice(currentIdx).includes(s.id as WizardStepId))
    .reduce((sum, s) => sum + s.estimatedMinutes, 0)

  return (
    <div
      className="fixed inset-0 z-[9990] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-gray-100 dark:border-gray-800">
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
          <ProgressBar current={currentIdx} total={WIZARD_STEP_IDS.length} />
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            Step {currentIdx + 1} of {WIZARD_STEP_IDS.length}
          </p>
        </div>

        {/* Step sidebar + content: side-by-side on ≥ sm */}
        <div className="flex flex-1 min-h-0">
          {/* Sidebar — hidden on mobile */}
          <aside className="hidden sm:flex flex-col w-44 flex-shrink-0 border-r border-gray-100 dark:border-gray-800 py-4 px-3 gap-1 overflow-y-auto">
            {WIZARD_STEP_IDS.map((id, idx) => {
              const def  = WIZARD_STEPS.find(s => s.id === id)
              const Icon = STEP_ICONS[id]
              const done = idx < currentIdx
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
                    active ? 'bg-white/20' : done ? 'bg-green-100 dark:bg-green-900/30' : 'bg-gray-100 dark:bg-gray-800'
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

          {/* Main content */}
          <main className="flex-1 overflow-y-auto p-6">
            {stepId === 'departments'      && <DepartmentsStep />}
            {stepId === 'banks'            && <BanksStep />}
            {stepId === 'income-types'     && <IncomeTypesStep />}
            {stepId === 'outflow-types'    && <OutflowTypesStep />}
            {stepId === 'categories'       && <CategoriesStep />}
            {stepId === 'team-members'     && <TeamMembersStep />}
            {stepId === 'import-statement' && <ImportStatementStep onClose={closeWizard} />}
            {stepId === 'finish'           && <FinishStep onClose={closeWizard} />}
          </main>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 dark:border-gray-800 gap-3">
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

// ── Auto-show hook ────────────────────────────────────────────────────────────
// Call from Dashboard to show wizard automatically on first session after org setup.

export function useWizardAutoShow() {
  const { prefs, loading } = useUserPreferences()
  const orgId              = useOrgStore(s => s.orgId)
  const orgRole            = useOrgStore(s => s.orgRole)
  const openWizard         = useOnboardingStore(s => s.openWizard)
  const isWizardOpen       = useOnboardingStore(s => s.isWizardOpen)

  useEffect(() => {
    if (loading)        return
    if (!orgId)         return
    if (isWizardOpen)   return
    if (prefs.wizard_completed) return
    if (orgRole !== 'owner' && orgRole !== 'admin') return

    const sessionKey = `wizard-shown-${orgId}`
    if (sessionStorage.getItem(sessionKey)) return
    sessionStorage.setItem(sessionKey, '1')
    openWizard()
  }, [loading, orgId, orgRole, prefs.wizard_completed]) // eslint-disable-line react-hooks/exhaustive-deps
}
