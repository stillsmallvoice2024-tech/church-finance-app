import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  Building2, Settings, CheckCircle2, ChevronRight, ChevronLeft,
  Loader2, AlertCircle, Percent, Plus, Trash2,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useOrgStore } from '../store/orgStore'
import { useCurrencies } from '../hooks/useCurrencies'
import type { UserRole } from '../types'

const TIMEZONES = [
  'Africa/Lagos',
  'Africa/Nairobi',
  'Africa/Accra',
  'Africa/Johannesburg',
  'Africa/Cairo',
  'Africa/Dar_es_Salaam',
  'Africa/Abidjan',
  'Africa/Kigali',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Kolkata',
]

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function AppIcon() {
  return (
    <svg viewBox="0 0 64 64" className="h-8 w-8" fill="none" aria-hidden="true">
      <path d="M 43 51 A 22 22 0 1 0 21 51"
            stroke="currentColor" strokeWidth="5.5" strokeLinecap="round"/>
      <path d="M 44 58 C 42 50 37 38 32 32 C 27 38 22 50 20 58 Z"
            fill="currentColor" opacity="0.75"/>
    </svg>
  )
}

const inputCls =
  'w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors bg-white'

const STEPS = [
  { n: 1, label: 'Organisation', Icon: Building2   },
  { n: 2, label: 'Setup',        Icon: Settings    },
  { n: 3, label: 'Distribution', Icon: Percent     },
  { n: 4, label: 'Ready',        Icon: CheckCircle2 },
]

interface DistRow {
  category_name: string
  percentage:    number
}

export default function Onboarding() {
  const navigate      = useNavigate()
  const [searchParams] = useSearchParams()
  const isNewOrg      = searchParams.get('new') === 'true'
  const storeOrgId     = useOrgStore(s => s.orgId)
  const storeOrgName   = useOrgStore(s => s.orgName)
  const storeOrgRole   = useOrgStore(s => s.orgRole)
  const storeOrgStatus = useOrgStore(s => s.orgStatus)
  const { currencies } = useCurrencies()

  // Only inherit an existing org when the user is already its owner/admin (i.e.
  // the org was just created by create_organization()).  A viewer membership
  // means the user was auto-attached to an existing org by the DB trigger —
  // never adopt that org.  A pending_deletion org must never be adopted either —
  // treat it as if no org exists so a fresh one is created.
  const isAdminOfStoredOrg =
    (storeOrgRole === 'owner' || storeOrgRole === 'admin') &&
    storeOrgStatus !== 'pending_deletion'

  // Skip Step 1 when the org was already created (signup or CreateOrgModal).
  // Fall back to a pending name stored in localStorage for the email-confirmation path.
  const pendingOrgName = (() => { try { return localStorage.getItem('pendingOrgName') ?? '' } catch { return '' } })()
  const [step,       setStep]       = useState(isAdminOfStoredOrg && storeOrgId ? 2 : 1)
  const [localOrgId, setLocalOrgId] = useState<string | null>(isAdminOfStoredOrg ? storeOrgId : null)
  const [name,       setName]       = useState(isAdminOfStoredOrg ? (storeOrgName ?? '') : pendingOrgName)
  const [currency,   setCurrency]   = useState('')
  const [yearStart,  setYearStart]  = useState(1)
  const [timezone,   setTimezone]   = useState('Africa/Lagos')
  const [distRows,   setDistRows]   = useState<DistRow[]>([
    { category_name: 'General', percentage: 100 },
  ])
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  // Sync when the store loads — only if the user is admin of the stored org.
  useEffect(() => {
    if (!isAdminOfStoredOrg) return
    if (storeOrgId && !localOrgId) setLocalOrgId(storeOrgId)
    if (storeOrgName && !name)     setName(storeOrgName)
  }, [storeOrgId, storeOrgName, isAdminOfStoredOrg]) // eslint-disable-line react-hooks/exhaustive-deps

  // Default currency to the first option once currencies load
  useEffect(() => {
    if (!currency && currencies.length > 0) setCurrency(currencies[0].code)
  }, [currencies]) // eslint-disable-line react-hooks/exhaustive-deps

  const distTotal = distRows.reduce((s, r) => s + (r.percentage || 0), 0)

  const addDistRow = () =>
    setDistRows(prev => [...prev, { category_name: '', percentage: 0 }])

  const removeDistRow = (i: number) =>
    setDistRows(prev => prev.filter((_, idx) => idx !== i))

  const updateDistRow = (i: number, field: keyof DistRow, value: string | number) =>
    setDistRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r))

  // ── Step 1 → Step 2 ───────────────────────────────────────────────────────
  const handleNextStep1 = async () => {
    setError(null)
    if (!name.trim()) { setError('Organisation name is required.'); return }

    if (!localOrgId) {
      // No org yet — user arrived via NoOrgScreen without going through signup
      setLoading(true)
      const rpcParams = { p_name: name.trim() }
      const { data, error: rpcErr } = await supabase.rpc('create_organization', rpcParams)
      setLoading(false)
      if (rpcErr) {
        console.error('[onboarding] create_organization failed', {
          rpc:     'create_organization',
          params:  rpcParams,
          code:    (rpcErr as { code?: string }).code,
          details: (rpcErr as { details?: string }).details,
          hint:    (rpcErr as { hint?: string }).hint,
          message: rpcErr.message,
        })
        setError(rpcErr.message)
        return
      }

      const newOrgId = data as string
      setLocalOrgId(newOrgId)
      const membership = {
        org_id:              newOrgId,
        org_name:            name.trim(),
        role:                'owner' as UserRole,
        onboarding_complete: false,
      }
      useOrgStore.getState().setOrg(membership)
      useOrgStore.getState().setMemberships([membership])
      try { localStorage.removeItem('pendingOrgName') } catch { /* ignore */ }
    }

    setStep(2)
  }

  // ── Step 4: Complete ──────────────────────────────────────────────────────
  const handleComplete = async () => {
    setError(null)
    const id = localOrgId ?? storeOrgId
    if (!id) { setError('No organisation ID found — please refresh and try again.'); return }

    setLoading(true)

    // 1. Complete onboarding — seeds General category, group (is_default=true) + draft config
    const { error: rpcErr } = await supabase.rpc('complete_org_onboarding', {
      p_org_id:            id,
      p_name:              name.trim(),
      p_default_currency:  currency,
      p_fiscal_year_start: yearStart,
      p_timezone:          timezone,
    })
    if (rpcErr) { setLoading(false); setError(rpcErr.message); return }

    // 2. Locate the General rule group seeded by the RPC
    const { data: grpData, error: grpErr } = await supabase
      .from('special_config_groups')
      .select('id')
      .eq('org_id', id)
      .eq('is_default', true)
      .maybeSingle()
    if (grpErr || !grpData) {
      setLoading(false)
      setError(grpErr?.message ?? 'Could not find General rule group.')
      return
    }

    // 3. Locate a usable config in that group — prefer draft; fall back to locked.
    //    A locked config with non-empty rows means a previous onboarding run already
    //    completed successfully, so we can skip straight to navigation.
    const { data: cfgData, error: cfgErr } = await supabase
      .from('allocation_configs')
      .select('id, status, rows')
      .eq('config_group_id', grpData.id)
      .in('status', ['draft', 'locked'])
      .order('status', { ascending: true })  // 'draft' sorts before 'locked'
      .limit(1)
      .maybeSingle()
    if (cfgErr || !cfgData) {
      setLoading(false)
      setError(cfgErr?.message ?? 'Could not find distribution rule. Please refresh and try again.')
      return
    }

    // Already complete: a previous run locked the config with rows
    if (cfgData.status === 'locked' && Array.isArray(cfgData.rows) && (cfgData.rows as unknown[]).length > 0) {
      useOrgStore.getState().setOrg({
        org_id:              id,
        org_name:            name.trim(),
        role:                (storeOrgRole ?? 'owner') as UserRole,
        onboarding_complete: true,
        default_currency:    currency,
      })
      useOrgStore.getState().setOnboardingComplete(true)
      window.dispatchEvent(new Event('focus'))
      navigate('/', { replace: true })
      return
    }

    // 4. Compute a safe effective_from that won't conflict with existing locked configs.
    //    The unique index idx_alloc_configs_group_effrom_unique covers (config_group_id,
    //    effective_from) where status = 'locked', so we must pick a date not already taken.
    const { data: latestLocked } = await supabase
      .from('allocation_configs')
      .select('effective_from')
      .eq('config_group_id', grpData.id)
      .eq('status', 'locked')
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle()

    const today = new Date().toISOString().split('T')[0]
    let safeEffectiveFrom = today
    if (latestLocked?.effective_from) {
      const dayAfter = new Date(new Date(latestLocked.effective_from).getTime() + 86_400_000)
        .toISOString().split('T')[0]
      if (dayAfter > today) safeEffectiveFrom = dayAfter
    }

    // 5. Lock it with the user-defined rows and a conflict-free effective_from
    const rows = distRows.map(r => ({
      category_name:  r.category_name.trim(),
      budget_portion: 'Percentage',
      percentage:     r.percentage,
    }))
    const { error: updErr } = await supabase
      .from('allocation_configs')
      .update({ rows, status: 'locked', effective_from: safeEffectiveFrom, start_date: safeEffectiveFrom })
      .eq('id', cfgData.id)

    setLoading(false)
    if (updErr) { setError(updErr.message); return }

    // Update store so OnboardingGuard stops redirecting before re-fetch completes
    useOrgStore.getState().setOrg({
      org_id:              id,
      org_name:            name.trim(),
      role:                (storeOrgRole ?? 'owner') as UserRole,
      onboarding_complete: true,
      default_currency:    currency,
    })
    useOrgStore.getState().setOnboardingComplete(true)

    // Trigger auth listener re-fetch so all org data is fresh from the server
    window.dispatchEvent(new Event('focus'))

    navigate('/', { replace: true })
  }

  const distValid =
    distRows.length > 0 &&
    distRows.every(r => r.category_name.trim() !== '') &&
    distTotal === 100

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white shadow-lg">
            <AppIcon />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">
            {isNewOrg ? 'New Organisation' : 'Welcome!'}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {isNewOrg ? 'Set up your new organisation.' : 'Let\'s get your organisation set up.'}
          </p>
        </div>

        {/* Step indicators */}
        <div className="mb-8 flex items-start justify-center gap-0">
          {STEPS.map((s, i) => (
            <div key={s.n} className="flex items-start">
              <div className="flex flex-col items-center gap-1.5">
                <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold transition-all ${
                  step > s.n   ? 'bg-primary text-white'                     :
                  step === s.n ? 'bg-primary text-white ring-4 ring-primary/20' :
                                 'bg-gray-100 text-gray-400'
                }`}>
                  {step > s.n
                    ? <CheckCircle2 className="w-5 h-5" />
                    : s.n}
                </div>
                <span className={`text-xs font-semibold ${
                  step >= s.n ? 'text-primary' : 'text-gray-400'
                }`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-14 h-0.5 mx-1 mt-4 transition-colors ${
                  step > s.n ? 'bg-primary' : 'bg-gray-200'
                }`} />
              )}
            </div>
          ))}
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-gray-100 bg-white px-8 py-8 shadow-md">

          {error && (
            <div className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* ── Step 1: Organisation Details ───────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Organisation Details</h2>
                <p className="mt-1 text-sm text-gray-500">What is the name of your organisation?</p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Organisation Name *</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g. Grace Community Organisation"
                  autoFocus
                  className={inputCls}
                />
              </div>

              <div className="pt-1 flex justify-end">
                <button
                  onClick={handleNextStep1}
                  disabled={loading || !name.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? (localOrgId ? 'Saving…' : 'Creating…') : 'Next'}
                  {!loading && <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* ── Step 2: Financial Setup ────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Financial Setup</h2>
                <p className="mt-1 text-sm text-gray-500">Configure your financial preferences.</p>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Default Currency</label>
                <select
                  value={currency}
                  onChange={e => setCurrency(e.target.value)}
                  className={inputCls}
                >
                  {currencies.map(c => (
                    <option key={c.code} value={c.code}>{c.code} — {c.name}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Financial Year Starts In</label>
                <select
                  value={yearStart}
                  onChange={e => setYearStart(Number(e.target.value))}
                  className={inputCls}
                >
                  {MONTHS.map((m, i) => (
                    <option key={i + 1} value={i + 1}>{m}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600">Timezone</label>
                <select
                  value={timezone}
                  onChange={e => setTimezone(e.target.value)}
                  className={inputCls}
                >
                  {TIMEZONES.map(tz => (
                    <option key={tz} value={tz}>{tz.replace(/_/g, ' ')}</option>
                  ))}
                </select>
              </div>

              <div className="pt-1 flex justify-between">
                <button
                  onClick={() => { setError(null); setStep(1) }}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={() => { setError(null); setStep(3) }}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light transition-colors"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 3: General Distribution Rule ─────────────────────────── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">General Distribution Rule</h2>
                <p className="mt-1 text-sm text-gray-500">
                  Define how income is split across categories by default.
                  This rule applies to any income type without a custom rule.
                </p>
              </div>

              <div className="space-y-2">
                {/* Row headers */}
                <div className="grid grid-cols-[1fr_6rem_2rem] gap-2 px-1">
                  <span className="text-xs font-medium text-gray-500">Fund</span>
                  <span className="text-xs font-medium text-gray-500 text-right">Percentage</span>
                  <span />
                </div>

                {/* Rows */}
                {distRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_6rem_2rem] gap-2 items-center">
                    <input
                      type="text"
                      value={row.category_name}
                      onChange={e => updateDistRow(i, 'category_name', e.target.value)}
                      placeholder="Fund name"
                      className={inputCls}
                    />
                    <div className="relative">
                      <input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={row.percentage}
                        onChange={e => updateDistRow(i, 'percentage', Number(e.target.value) || 0)}
                        className={`${inputCls} pr-7 text-right`}
                      />
                      <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 pointer-events-none">%</span>
                    </div>
                    <button
                      onClick={() => removeDistRow(i)}
                      disabled={distRows.length === 1}
                      className="flex items-center justify-center w-8 h-8 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}

                {/* Total row */}
                <div className="grid grid-cols-[1fr_6rem_2rem] gap-2 items-center pt-1 border-t border-gray-100">
                  <span className="text-xs font-semibold text-gray-600 px-1">Total</span>
                  <span className={`text-sm font-bold text-right pr-2 ${
                    distTotal === 100 ? 'text-green-600' : 'text-red-500'
                  }`}>
                    {distTotal}%
                  </span>
                  <span />
                </div>

                {distTotal !== 100 && (
                  <p className="text-xs text-red-500 px-1">
                    Total must equal 100%. Currently {distTotal > 100 ? 'over' : 'under'} by {Math.abs(100 - distTotal)}%.
                  </p>
                )}
              </div>

              <button
                onClick={addDistRow}
                className="flex items-center gap-1.5 text-sm text-primary hover:text-primary-light font-medium transition-colors"
              >
                <Plus className="w-4 h-4" />
                Add category
              </button>

              <div className="pt-1 flex justify-between">
                <button
                  onClick={() => { setError(null); setStep(2) }}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={() => { setError(null); setStep(4) }}
                  disabled={!distValid}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* ── Step 4: Ready ──────────────────────────────────────────────── */}
          {step === 4 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">You're all set!</h2>
                <p className="mt-1 text-sm text-gray-500">Review your setup before entering the app.</p>
              </div>

              <div className="rounded-xl bg-gray-50 border border-gray-100 divide-y divide-black/[0.05]">
                {[
                  { label: 'Organisation',       value: name },
                  { label: 'Currency',           value: currency },
                  { label: 'Financial Year',     value: `Starts in ${MONTHS[yearStart - 1]}` },
                  { label: 'Timezone',           value: timezone.replace(/_/g, ' ') },
                ].map(row => (
                  <div key={row.label} className="flex justify-between px-4 py-2.5 text-sm">
                    <span className="text-gray-500">{row.label}</span>
                    <span className="font-medium text-gray-900">{row.value}</span>
                  </div>
                ))}
                <div className="px-4 py-2.5 text-sm">
                  <span className="text-gray-500">General Distribution Rule</span>
                  <div className="mt-1.5 space-y-0.5">
                    {distRows.map((r, i) => (
                      <div key={i} className="flex justify-between text-xs text-gray-700">
                        <span>{r.category_name}</span>
                        <span className="font-medium">{r.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700">
                Default income types and an outflow type will be seeded automatically.
                You can add more from the Setup page.
              </div>

              <div className="pt-1 flex justify-between">
                <button
                  onClick={() => { setError(null); setStep(3) }}
                  className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  Back
                </button>
                <button
                  onClick={handleComplete}
                  disabled={loading}
                  className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
                >
                  {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {loading ? 'Finishing…' : 'Enter Application'}
                  {!loading && <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-gray-500">
          You can change these settings later from the Setup page.
        </p>

      </div>
    </div>
  )
}
