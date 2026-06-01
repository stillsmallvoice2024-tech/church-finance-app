import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Building2, Settings, CheckCircle2, ChevronRight, ChevronLeft, Loader2, AlertCircle } from 'lucide-react'
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
    <svg viewBox="0 0 32 32" className="h-8 w-8" fill="currentColor" aria-hidden="true">
      <rect x="13" y="2" width="6" height="28" rx="2" />
      <rect x="4" y="9" width="24" height="6" rx="2" />
    </svg>
  )
}

const inputCls =
  'w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors bg-white'

const STEPS = [
  { n: 1, label: 'Organisation', Icon: Building2 },
  { n: 2, label: 'Setup',        Icon: Settings   },
  { n: 3, label: 'Ready',        Icon: CheckCircle2 },
]

export default function Onboarding() {
  const navigate      = useNavigate()
  const [searchParams] = useSearchParams()
  const isNewOrg      = searchParams.get('new') === 'true'
  const storeOrgId   = useOrgStore(s => s.orgId)
  const storeOrgName = useOrgStore(s => s.orgName)
  const storeOrgRole = useOrgStore(s => s.orgRole)
  const { currencies } = useCurrencies()

  // Only inherit an existing org when the user is already its admin (i.e. the
  // org was just created by create_organization() in LoginPage for the
  // email-confirmation-disabled flow).  A viewer membership means the user was
  // auto-attached to an existing org by the DB trigger — never adopt that org.
  const isAdminOfStoredOrg = storeOrgRole === 'admin'

  const [step,       setStep]       = useState(1)
  const [localOrgId, setLocalOrgId] = useState<string | null>(isAdminOfStoredOrg ? storeOrgId : null)
  const [name,       setName]       = useState(isAdminOfStoredOrg ? (storeOrgName ?? '') : '')
  const [currency,   setCurrency]   = useState('')
  const [yearStart,  setYearStart]  = useState(1)
  const [timezone,   setTimezone]   = useState('Africa/Lagos')
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
        role:                'admin' as UserRole,
        onboarding_complete: false,
      }
      useOrgStore.getState().setOrg(membership)
      useOrgStore.getState().setMemberships([membership])
    }

    setStep(2)
  }

  // ── Step 3: Complete ──────────────────────────────────────────────────────
  const handleComplete = async () => {
    setError(null)
    const id = localOrgId ?? storeOrgId
    if (!id) { setError('No organisation ID found — please refresh and try again.'); return }

    setLoading(true)
    const { error: rpcErr } = await supabase.rpc('complete_org_onboarding', {
      p_org_id:            id,
      p_name:              name.trim(),
      p_default_currency:  currency,
      p_fiscal_year_start: yearStart,
      p_timezone:          timezone,
    })
    setLoading(false)
    if (rpcErr) { setError(rpcErr.message); return }

    // Update store so OnboardingGuard stops redirecting before re-fetch completes
    useOrgStore.getState().setOrg({
      org_id:              id,
      org_name:            name.trim(),
      role:                'admin' as UserRole,
      onboarding_complete: true,
      default_currency:    currency,
    })
    useOrgStore.getState().setOnboardingComplete(true)

    // Trigger auth listener re-fetch so all org data is fresh from the server
    window.dispatchEvent(new Event('focus'))

    navigate('/', { replace: true })
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-lg">

        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white shadow-lg">
            <AppIcon />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
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
                <span className={`text-[10px] font-semibold uppercase tracking-wider ${
                  step >= s.n ? 'text-primary' : 'text-gray-400'
                }`}>
                  {s.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-20 h-0.5 mx-1 mt-4 transition-colors ${
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
                  placeholder="e.g. Grace Community Church"
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

          {/* ── Step 3: Ready ──────────────────────────────────────────────── */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">You're all set!</h2>
                <p className="mt-1 text-sm text-gray-500">Review your setup before entering the app.</p>
              </div>

              <div className="rounded-xl bg-gray-50 border border-gray-100 divide-y divide-gray-100">
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
              </div>

              <div className="rounded-lg bg-blue-50 border border-blue-100 px-4 py-3 text-xs text-blue-700">
                Default income types and an outflow type will be seeded automatically.
                You can add more from the Setup page.
              </div>

              <div className="pt-1 flex justify-between">
                <button
                  onClick={() => { setError(null); setStep(2) }}
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

        <p className="mt-4 text-center text-xs text-gray-400">
          You can change these settings later from the Setup page.
        </p>

      </div>
    </div>
  )
}
