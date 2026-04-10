import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

// Cross SVG for the church logo
function ChurchCross() {
  return (
    <svg viewBox="0 0 32 32" className="w-10 h-10" fill="currentColor" aria-hidden="true">
      <rect x="13" y="2" width="6" height="28" rx="2" />
      <rect x="4" y="9" width="24" height="6" rx="2" />
    </svg>
  )
}

export default function LoginPage() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true })
  }, [isAuthenticated, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {/* Logo & title */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-primary text-white mb-4">
            <ChurchCross />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">The Standing Church International</h1>
          <p className="text-sm text-accent font-semibold mt-1 uppercase tracking-widest">
            Finance 2024
          </p>
        </div>

        {/* Auth card */}
        <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-8">
          <h2 className="text-lg font-semibold text-gray-800 mb-6 text-center">Sign in to continue</h2>
          <Auth
            supabaseClient={supabase}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: '#1E3A8A',
                    brandAccent: '#2547A4',
                    inputBorder: '#E5E7EB',
                    inputLabelText: '#374151',
                  },
                  radii: {
                    borderRadiusButton: '0.75rem',
                    inputBorderRadius: '0.75rem',
                  },
                },
              },
            }}
            providers={[]}
            redirectTo={window.location.origin}
          />
        </div>

        <p className="text-center text-xs text-gray-400 mt-6">
          © {new Date().getFullYear()} The Standing Church International
        </p>
      </div>
    </div>
  )
}
