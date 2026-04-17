import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthListener } from './hooks/useAuth'
import { useAccountCodesStore } from './store/accountCodesStore'
import './store/themeStore' // side-effect: applies stored theme class immediately
import { AuthGuard } from './components/auth/AuthGuard'
import { Layout } from './components/layout/Layout'
import { ErrorBoundary } from './components/ui/ErrorBoundary'
import LoginPage from './components/auth/LoginPage'
import Dashboard from './pages/Dashboard'
import Inflows from './pages/Inflows'
import Outflows from './pages/Outflows'
import Accounts from './pages/Accounts'
import SpecialProjects from './pages/SpecialProjects'
import ForeignCurrency from './pages/ForeignCurrency'
import IntraFlow from './pages/IntraFlow'
import Reports from './pages/Reports'
import Settings from './pages/Settings'
import UserManagement from './pages/UserManagement'
import Import from './pages/Import'
import PendingDeductions from './pages/PendingDeductions'
import Setup from './pages/Setup'

export default function App() {
  useAuthListener()
  const fetchCodes = useAccountCodesStore(s => s.fetch)
  // Pre-fetch account codes so dropdowns are ready before any form page loads
  useEffect(() => { fetchCodes() }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
            <Route path="accounts" element={<ErrorBoundary><Accounts /></ErrorBoundary>} />
            <Route path="special-projects" element={<ErrorBoundary><SpecialProjects /></ErrorBoundary>} />
            <Route path="foreign-currency" element={<ErrorBoundary><ForeignCurrency /></ErrorBoundary>} />
            <Route path="intra-flow" element={<ErrorBoundary><IntraFlow /></ErrorBoundary>} />
            <Route path="reports" element={<ErrorBoundary><Reports /></ErrorBoundary>} />
            <Route path="settings" element={<ErrorBoundary><Settings /></ErrorBoundary>} />
            <Route path="users" element={<ErrorBoundary><UserManagement /></ErrorBoundary>} />
            <Route path="import" element={<ErrorBoundary><Import /></ErrorBoundary>} />
            <Route path="pending-deductions" element={<ErrorBoundary><PendingDeductions /></ErrorBoundary>} />
            <Route path="setup" element={<ErrorBoundary><Setup /></ErrorBoundary>} />
          </Route>
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
