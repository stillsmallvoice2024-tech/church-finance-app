import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { useAuthListener } from './hooks/useAuth'
import { useAccountCodesStore } from './store/accountCodesStore'
import { useOrgStore } from './store/orgStore'
import './store/themeStore' // side-effect: applies stored theme class immediately
import { supabase } from './lib/supabase'
import { AuthGuard } from './components/auth/AuthGuard'
import { OrgLockedScreen } from './components/layout/OrgLockedScreen'
import { useRole } from './hooks/useRole'
import { Layout } from './components/layout/Layout'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import LoginPage from './components/auth/LoginPage'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import Inflows from './pages/Inflows'
import Outflows from './pages/Outflows'
import Categories from './pages/Categories'
import ForeignCurrency from './pages/ForeignCurrency'
import IntraFlow from './pages/IntraFlow'
import Reports from './pages/Reports'
import FinancialReport from './pages/FinancialReport'
import DynamicReports from './pages/DynamicReports'
import DynamicReportEditor from './pages/DynamicReportEditor'
import Settings from './pages/Settings'
import UserManagement from './pages/UserManagement'
import Import from './pages/Import'
import PendingDeductions from './pages/PendingDeductions'
import Setup from './pages/Setup'
import PercentageAllocations from './pages/PercentageAllocations'
import PercentageAllocation from './pages/PercentageAllocation'
import SpecificGivings from './pages/SpecificGivings'
import SavingsPortions from './pages/SavingsPortions'
import CategoryLedger       from './pages/CategoryLedger'
import BankLedger           from './pages/BankLedger'
import BankMovement         from './pages/BankMovement'
import RefundTransactions   from './pages/RefundTransactions'
import ReversalTransactions from './pages/ReversalTransactions'
import Receipts             from './pages/Receipts'
import ChangeLog            from './pages/ChangeLog'
import Audit               from './pages/Audit'
import ReconciliationCenter from './pages/ReconciliationCenter'
import ResetPassword        from './pages/ResetPassword'
import AcceptInvite         from './pages/AcceptInvite'
import Tutorial             from './pages/Tutorial'

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
            <Route path="foreign-currency" element={<ErrorBoundary><ForeignCurrency /></ErrorBoundary>} />
            <Route path="intra-flow" element={<ErrorBoundary><IntraFlow /></ErrorBoundary>} />
            <Route path="reports" element={<ErrorBoundary><Reports /></ErrorBoundary>} />
            <Route path="financial-report" element={<ErrorBoundary><FinancialReport /></ErrorBoundary>} />
            <Route path="dynamic-reports" element={<ErrorBoundary><DynamicReports /></ErrorBoundary>} />
            <Route path="dynamic-reports/:id" element={<ErrorBoundary><DynamicReportEditor /></ErrorBoundary>} />
            <Route path="settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
            <Route path="pending-deductions" element={<ErrorBoundary><PendingDeductions /></ErrorBoundary>} />
            {/* Viewer-blocked routes: admin + accountant only */}
            <Route element={<CanWriteGuard />}>
              <Route path="import" element={<ErrorBoundary><Import /></ErrorBoundary>} />
              <Route path="setup" element={<ErrorBoundary><Setup /></ErrorBoundary>} />
              <Route path="audit" element={<ErrorBoundary><Audit /></ErrorBoundary>} />
            </Route>
            {/* Admin-only routes */}
            <Route element={<AdminOnlyGuard />}>
              <Route path="users" element={<ErrorBoundary><UserManagement /></ErrorBoundary>} />
              <Route path="change-log" element={<ErrorBoundary><ChangeLog /></ErrorBoundary>} />
            </Route>
            <Route path="percentage-allocations" element={<ErrorBoundary><PercentageAllocations /></ErrorBoundary>} />
            <Route path="percentage-allocation" element={<ErrorBoundary><PercentageAllocation /></ErrorBoundary>} />
            <Route path="specific-givings" element={<ErrorBoundary><SpecificGivings /></ErrorBoundary>} />
            <Route path="savings-portions" element={<ErrorBoundary><SavingsPortions /></ErrorBoundary>} />
            <Route path="category-ledger"      element={<ErrorBoundary><CategoryLedger /></ErrorBoundary>} />
            <Route path="bank-ledger"           element={<ErrorBoundary><BankLedger /></ErrorBoundary>} />
            <Route path="reconciliation"        element={<ErrorBoundary><ReconciliationCenter /></ErrorBoundary>} />
            <Route path="bank-movement"         element={<ErrorBoundary><BankMovement /></ErrorBoundary>} />
            <Route path="refunds"              element={<ErrorBoundary><RefundTransactions /></ErrorBoundary>} />
            <Route path="reversals"            element={<ErrorBoundary><ReversalTransactions /></ErrorBoundary>} />
            <Route path="receipts"             element={<ErrorBoundary><Receipts /></ErrorBoundary>} />
            <Route path="tutorial"             element={<ErrorBoundary><Tutorial /></ErrorBoundary>} />
            <Route path="tutorial/:chapterId"  element={<ErrorBoundary><Tutorial /></ErrorBoundary>} />
          </Route>
          </Route> {/* OrgLockedGuard */}
          </Route> {/* OnboardingGuard */}
        </Route> {/* AuthGuard */}

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
