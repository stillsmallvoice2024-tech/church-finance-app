import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { useAuthStore } from './store/authStore'
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
import type { UserRole } from './types'

export default function App() {
  const { setSession, setRole, setFullName, setLoading } = useAuthStore()

  useEffect(() => {
    const fetchProfile = async (userId: string) => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', userId)
        .single()

      if (data) {
        setRole(data.role as UserRole)
        setFullName(data.full_name ?? '')
      } else {
        // Fallback while profiles table is being set up
        setRole('viewer')
      }
    }

    const initAuth = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()
      setSession(session)
      if (session?.user) await fetchProfile(session.user.id)
      setLoading(false)
    }

    initAuth()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session)
      if (session?.user) {
        await fetchProfile(session.user.id)
      } else {
        setRole(null)
        setFullName('')
      }
    })

    return () => subscription.unsubscribe()
  }, [setSession, setRole, setFullName, setLoading])

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />

        {/* All protected routes share AuthGuard + Layout */}
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

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
