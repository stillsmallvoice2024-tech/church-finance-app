import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuthListener } from './hooks/useAuth'
import { useAccountCodesStore } from './store/accountCodesStore'
import { useOrgStore } from './store/orgStore'
import './store/themeStore' // side-effect: applies stored theme class immediately
import { supabase } from './lib/supabase'
import { AuthGuard } from './components/auth/AuthGuard'
import { OrgLockedScreen } from './components/layout/OrgLockedScreen'
import { useRole } from './hooks/useRole'
import { usePlan, type PlanFeature } from './hooks/usePlan'
import { Layout } from './components/layout/Layout'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import { RouteFallback } from './components/ui/RouteFallback'

// Route components are lazy-loaded so heavy dependencies (pdfjs, xlsx, jspdf,
// recharts) are code-split per route instead of shipping in the initial bundle.
const LoginPage             = lazy(() => import('./components/auth/LoginPage'))
const Onboarding            = lazy(() => import('./pages/Onboarding'))
const Dashboard             = lazy(() => import('./pages/Dashboard'))
const Inflows               = lazy(() => import('./pages/Inflows'))
const Outflows              = lazy(() => import('./pages/Outflows'))
const Categories            = lazy(() => import('./pages/Categories'))
const ForeignCurrency       = lazy(() => import('./pages/ForeignCurrency'))
const IntraFlow             = lazy(() => import('./pages/IntraFlow'))
const ReportCentre          = lazy(() => import('./pages/ReportCentre'))
const DynamicReportEditor   = lazy(() => import('./pages/DynamicReportEditor'))
const SettingsPage          = lazy(() => import('./pages/Setup'))
const UserManagement        = lazy(() => import('./pages/UserManagement'))
const Import                = lazy(() => import('./pages/Import'))
const Adjustments           = lazy(() => import('./pages/Adjustments'))
const PercentageAllocations = lazy(() => import('./pages/PercentageAllocations'))
const Funds                 = lazy(() => import('./pages/Funds'))
const BankLedger            = lazy(() => import('./pages/BankLedger'))
const BankMovement          = lazy(() => import('./pages/BankMovement'))
const Receipts              = lazy(() => import('./pages/Receipts'))
const ChangeLog             = lazy(() => import('./pages/ChangeLog'))
const ReconciliationCenter  = lazy(() => import('./pages/ReconciliationCenter'))
const ResetPassword         = lazy(() => import('./pages/ResetPassword'))
const AcceptInvite          = lazy(() => import('./pages/AcceptInvite'))
const Tutorial              = lazy(() => import('./pages/Tutorial'))

// ── Route-level role guards ────────────────────────────────────────────────────
// These run inside AuthGuard (loading=false, user set) so canWrite/isAdmin resolve correctly.

function CanWriteGuard() {
  const { canWrite } = useRole()
  if (!canWrite()) return <Navigate to="/" replace />
  return <Outlet />
}

function AdminOnlyGuard() {
  const { isAdmin } = useRole()
  if (!isAdmin()) return <Navigate to="/" replace />
  return <Outlet />
}

// Redirects to the Billing tab (with a ?locked= flag it reads to explain why)
// when the active org's plan doesn't unlock the given feature.
function FeatureGuard({ feature }: { feature: PlanFeature }) {
  const { hasFeature } = usePlan()
  if (!hasFeature(feature)) return <Navigate to={`/settings?tab=billing&locked=${feature}`} replace />
  return <Outlet />
}

// Redirects to /onboarding when the active org has not completed onboarding.
// Runs inside AuthGuard (loading=false, org resolved).
function OnboardingGuard() {
  const orgId              = useOrgStore(s => s.orgId)
  const onboardingComplete = useOrgStore(s => s.onboardingComplete)

  if (orgId && onboardingComplete === false) {
    return <Navigate to="/onboarding" replace />
  }
  return <Outlet />
}

// Shows OrgLockedScreen when org is pending_deletion.
// Owner sees the locked screen with restore/download controls.
// Non-owners see an access-denied message.
function OrgLockedGuard() {
  const orgStatus = useOrgStore(s => s.orgStatus)

  if (orgStatus === 'pending_deletion') {
    return <OrgLockedScreen />
  }
  return <Outlet />
}

export default function App() {
  useAuthListener()
  const fetchCodes = useAccountCodesStore(s => s.fetch)
  const orgId      = useOrgStore(s => s.orgId)
  // Pre-fetch account codes once the active org is known.
  useEffect(() => { if (orgId) fetchCodes() }, [orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  // A successful mount means this load's chunks resolved fine — clear the
  // stale-chunk reload guard so a future genuine chunk error can self-heal again.
  useEffect(() => { sessionStorage.removeItem('chunk-load-reload-attempted') }, [])

  // When the tab becomes visible again after being minimised or backgrounded,
  // force a token refresh before any data queries fire so the JWT isn't stale.
  // Also stop/start the SDK's own auto-refresh timer to match visibility state —
  // this is the pattern Supabase recommends for browser apps.
  useEffect(() => {
    const handleVisibility = async () => {
      if (document.visibilityState === 'visible') {
        supabase.auth.startAutoRefresh()
        // Force an actual server round-trip (not a cache read) to renew the JWT
        await supabase.auth.refreshSession().catch(() => {
          // If refresh fails the SDK will fire SIGNED_OUT via onAuthStateChange,
          // which clearAuth() already handles — nothing extra needed here.
        })
      } else {
        supabase.auth.stopAutoRefresh()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [])

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/invite/:token" element={<AcceptInvite />} />

        {/* Protected — AuthGuard checks auth + provides RoleContext */}
        <Route element={<AuthGuard />}>

          {/* Onboarding wizard — accessible without a completed org */}
          <Route path="onboarding" element={<Onboarding />} />

          {/* App routes — OnboardingGuard redirects to /onboarding if setup incomplete */}
          <Route element={<OnboardingGuard />}>
          {/* OrgLockedGuard shows lock screen when org is pending_deletion */}
          <Route element={<OrgLockedGuard />}>
          <Route element={<Layout />}>
            <Route index element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
            <Route path="inflows" element={<ErrorBoundary><Inflows /></ErrorBoundary>} />
            <Route path="outflows" element={<ErrorBoundary><Outflows /></ErrorBoundary>} />
            <Route path="categories" element={<ErrorBoundary><Categories /></ErrorBoundary>} />
            <Route element={<FeatureGuard feature="fx" />}>
              <Route path="foreign-currency" element={<ErrorBoundary><ForeignCurrency /></ErrorBoundary>} />
            </Route>
            <Route path="intra-flow" element={<ErrorBoundary><IntraFlow /></ErrorBoundary>} />
            {/* Report Centre — old report routes redirect into its tabs */}
            <Route element={<FeatureGuard feature="reports" />}>
              <Route path="reports" element={<ErrorBoundary><ReportCentre /></ErrorBoundary>} />
              <Route path="financial-report" element={<Navigate to="/reports?tab=financial" replace />} />
              <Route path="dynamic-reports" element={<Navigate to="/reports?tab=custom" replace />} />
            </Route>
            <Route element={<FeatureGuard feature="dynamicReports" />}>
              <Route path="dynamic-reports/:id" element={<ErrorBoundary><DynamicReportEditor /></ErrorBoundary>} />
            </Route>
            {/* Unified Settings — /setup redirects into the finance General tab (role-gated inside) */}
            <Route path="settings" element={<ErrorBoundary><SettingsPage /></ErrorBoundary>} />
            <Route path="setup" element={<Navigate to="/settings?tab=general" replace />} />
            {/* Viewer-blocked routes: admin + accountant only */}
            <Route element={<CanWriteGuard />}>
              <Route path="import" element={<ErrorBoundary><Import /></ErrorBoundary>} />
            </Route>
            {/* Admin-only routes */}
            <Route element={<AdminOnlyGuard />}>
              <Route path="users" element={<ErrorBoundary><UserManagement /></ErrorBoundary>} />
              <Route element={<FeatureGuard feature="changeLog" />}>
                <Route path="change-log" element={<ErrorBoundary><ChangeLog /></ErrorBoundary>} />
              </Route>
            </Route>
            <Route element={<FeatureGuard feature="customDistributionRules" />}>
              <Route path="percentage-allocations" element={<ErrorBoundary><PercentageAllocations /></ErrorBoundary>} />
            </Route>
            {/* Funds — old fund-view routes redirect into its tabs */}
            <Route path="funds" element={<ErrorBoundary><Funds /></ErrorBoundary>} />
            <Route path="category-ledger"      element={<Navigate to="/funds?tab=accounts" replace />} />
            <Route path="percentage-allocation" element={<Navigate to="/funds?tab=regular" replace />} />
            <Route path="specific-givings"     element={<Navigate to="/funds?tab=designated" replace />} />
            <Route path="savings-portions"     element={<Navigate to="/funds?tab=savings" replace />} />
            <Route path="bank-ledger"           element={<ErrorBoundary><BankLedger /></ErrorBoundary>} />
            <Route element={<FeatureGuard feature="reconciliation" />}>
              <Route path="reconciliation"      element={<ErrorBoundary><ReconciliationCenter /></ErrorBoundary>} />
            </Route>
            <Route element={<FeatureGuard feature="bankMovement" />}>
              <Route path="bank-movement"       element={<ErrorBoundary><BankMovement /></ErrorBoundary>} />
            </Route>
            {/* Adjustments — old routes redirect into its tabs */}
            <Route element={<FeatureGuard feature="adjustments" />}>
              <Route path="adjustments" element={<ErrorBoundary><Adjustments /></ErrorBoundary>} />
              <Route path="pending-deductions"   element={<Navigate to="/adjustments?tab=upcoming" replace />} />
              <Route path="refunds"              element={<Navigate to="/adjustments?tab=refunds" replace />} />
              <Route path="reversals"            element={<Navigate to="/adjustments?tab=reversals" replace />} />
            </Route>
            <Route element={<FeatureGuard feature="receipts" />}>
              <Route path="receipts"           element={<ErrorBoundary><Receipts /></ErrorBoundary>} />
            </Route>
            <Route path="tutorial"             element={<ErrorBoundary><Tutorial /></ErrorBoundary>} />
            <Route path="tutorial/:chapterId"  element={<ErrorBoundary><Tutorial /></ErrorBoundary>} />
          </Route>
          </Route> {/* OrgLockedGuard */}
          </Route> {/* OnboardingGuard */}
        </Route> {/* AuthGuard */}

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
