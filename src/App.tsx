import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthListener } from './hooks/useAuth'
import { useAccountCodesStore } from './store/accountCodesStore'
import './store/themeStore' // side-effect: applies stored theme class immediately
import { supabase } from './lib/supabase'
import { AuthGuard } from './components/auth/AuthGuard'
import { Layout } from './components/layout/Layout'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import LoginPage from './components/auth/LoginPage'
import Dashboard from './pages/Dashboard'
import Inflows from './pages/Inflows'
import Outflows from './pages/Outflows'
import Categories from './pages/Categories'
import SpecialProjects from './pages/SpecialProjects'
import ForeignCurrency from './pages/ForeignCurrency'
import IntraFlow from './pages/IntraFlow'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import UserManagement from './pages/UserManagement'
import Import from './pages/Import'
import PendingDeductions from './pages/PendingDeductions'
import Setup from './pages/Setup'
import PercentageAllocations from './pages/PercentageAllocations'
import SpecificGivings from './pages/SpecificGivings'
import SavingsPortions from './pages/SavingsPortions'
import CategoryLedger       from './pages/CategoryLedger'
import BankLedger           from './pages/BankLedger'
import BankDeposits         from './pages/BankDeposits'
import IntraBankTransfers   from './pages/IntraBankTransfers'
import RefundTransactions   from './pages/RefundTransactions'
import ReversalTransactions from './pages/ReversalTransactions'
import Receipts             from './pages/Receipts'

export default function App() {
  useAuthListener()
  const fetchCodes = useAccountCodesStore(s => s.fetch)
  // Pre-fetch account codes so dropdowns are ready before any form page loads
  useEffect(() => { fetchCodes() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // When the tab becomes visible again after being minimised or backgrounded,
  // proactively refresh the Supabase session so the first query after a long
  // idle doesn't fail with a stale JWT.
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        supabase.auth.getSession()
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

        {/* Protected — AuthGuard checks auth + provides RoleContext */}
        <Route element={<AuthGuard />}>
          <Route element={<Layout />}>
            <Route index element={<ErrorBoundary><Dashboard /></ErrorBoundary>} />
            <Route path="inflows" element={<ErrorBoundary><Inflows /></ErrorBoundary>} />
            <Route path="outflows" element={<ErrorBoundary><Outflows /></ErrorBoundary>} />
            <Route path="categories" element={<ErrorBoundary><Categories /></ErrorBoundary>} />
            <Route path="special-projects" element={<ErrorBoundary><SpecialProjects /></ErrorBoundary>} />
            <Route path="foreign-currency" element={<ErrorBoundary><ForeignCurrency /></ErrorBoundary>} />
            <Route path="intra-flow" element={<ErrorBoundary><IntraFlow /></ErrorBoundary>} />
            <Route path="reports" element={<ErrorBoundary><Reports /></ErrorBoundary>} />
            <Route path="settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
            <Route path="users" element={<ErrorBoundary><UserManagement /></ErrorBoundary>} />
            <Route path="import" element={<ErrorBoundary><Import /></ErrorBoundary>} />
            <Route path="pending-deductions" element={<ErrorBoundary><PendingDeductions /></ErrorBoundary>} />
            <Route path="setup" element={<ErrorBoundary><Setup /></ErrorBoundary>} />
            <Route path="percentage-allocations" element={<ErrorBoundary><PercentageAllocations /></ErrorBoundary>} />
            <Route path="specific-givings" element={<ErrorBoundary><SpecificGivings /></ErrorBoundary>} />
            <Route path="savings-portions" element={<ErrorBoundary><SavingsPortions /></ErrorBoundary>} />
            <Route path="category-ledger"      element={<ErrorBoundary><CategoryLedger /></ErrorBoundary>} />
            <Route path="bank-ledger"          element={<ErrorBoundary><BankLedger /></ErrorBoundary>} />
            <Route path="bank-deposits"        element={<ErrorBoundary><BankDeposits /></ErrorBoundary>} />
            <Route path="intrabank-transfers"  element={<ErrorBoundary><IntraBankTransfers /></ErrorBoundary>} />
            <Route path="refunds"              element={<ErrorBoundary><RefundTransactions /></ErrorBoundary>} />
            <Route path="reversals"            element={<ErrorBoundary><ReversalTransactions /></ErrorBoundary>} />
            <Route path="receipts"             element={<ErrorBoundary><Receipts /></ErrorBoundary>} />
          </Route>
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
