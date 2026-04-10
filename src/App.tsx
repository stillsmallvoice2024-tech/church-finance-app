import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthListener } from './hooks/useAuth'
import { AuthGuard } from './components/auth/AuthGuard'
import { Layout } from './components/layout/Layout'
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

export default function App() {
  // Initialize the Supabase auth listener once.
  // Hydrates authStore from the existing session on load,
  // then keeps it in sync for sign-in / sign-out / token refresh.
  useAuthListener()

  return (
    <BrowserRouter>
      <Routes>
        {/* Public */}
        <Route path="/login" element={<LoginPage />} />

        {/* Protected — AuthGuard checks auth + provides RoleContext */}
        <Route element={<AuthGuard />}>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="inflows" element={<Inflows />} />
            <Route path="outflows" element={<Outflows />} />
            <Route path="accounts" element={<Accounts />} />
            <Route path="special-projects" element={<SpecialProjects />} />
            <Route path="foreign-currency" element={<ForeignCurrency />} />
            <Route path="intra-flow" element={<IntraFlow />} />
            <Route path="reports" element={<Reports />} />
            <Route path="settings" element={<Settings />} />
            <Route path="users" element={<UserManagement />} />
          </Route>
        </Route>

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
