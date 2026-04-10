import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'

function ChurchCross() {
  return (
    <svg viewBox="0 0 32 32" className="h-10 w-10" fill="currentColor" aria-hidden="true">
      <rect x="13" y="2" width="6" height="28" rx="2" />
      <rect x="4" y="9" width="24" height="6" rx="2" />
    </svg>
  )
}

export default function LoginPage() {
  const { isAuthenticated } = useAuth()
  const navigate = useNavigate()

  // Redirect once the auth listener confirms the user is signed in
  useEffect(() => {
    if (isAuthenticated) navigate('/', { replace: true })
  }, [isAuthenticated, navigate])

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-md">

        {/* ── Logo & title ── */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 inline-flex h-20 w-20 items-center justify-center rounded-2xl bg-primary text-white shadow-lg">
            <ChurchCross />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">
            The Standing Church International
          </h1>
          <p className="mt-1 text-sm font-semibold uppercase tracking-widest text-accent">
            Financial Management System
          </p>
        </div>

        {/* ── Auth card ── */}
        <div className="rounded-2xl border border-gray-100 bg-white px-8 py-8 shadow-md">
          <p className="mb-6 text-center text-sm font-medium text-gray-600">
            Sign in with your church email
          </p>

          <Auth
            supabaseClient={supabase}
            appearance={{
              theme: ThemeSupa,
              variables: {
                default: {
                  colors: {
                    brand: '#1E3A8A',
                    brandAccent: '#2547A4',
                    brandButtonText: '#ffffff',
                    inputBorder: '#E5E7EB',
                    inputBorderFocus: '#1E3A8A',
                    inputBorderHover: '#93C5FD',
                    inputLabelText: '#374151',
                    inputText: '#111827',
                    inputPlaceholder: '#9CA3AF',
                    messageText: '#374151',
                    anchorTextColor: '#1E3A8A',
                    anchorTextHoverColor: '#2547A4',
                  },
                  radii: {
                    borderRadiusButton: '0.75rem',
                    buttonBorderRadius: '0.75rem',
                    inputBorderRadius: '0.75rem',
                  },
                  space: {
                    inputPadding: '0.75rem 1rem',
                    buttonPadding: '0.75rem 1rem',
                  },
                  fontSizes: {
                    baseBodySize: '0.875rem',
                    baseLabelSize: '0.8125rem',
                  },
                },
              },
              style: {
                button: {
                  fontWeight: '600',
                  letterSpacing: '0.01em',
                },
                input: {
                  boxShadow: 'none',
                },
                anchor: {
                  fontWeight: '500',
                },
              },
            }}
            providers={[]}
            onlyThirdPartyProviders={false}
            localization={{
              variables: {
                sign_in: {
                  email_label: 'Email address',
                  password_label: 'Password',
                  button_label: 'Sign in',
                  link_text: "Don't have an account? Contact your administrator",
                },
                sign_up: {
                  email_label: 'Email address',
                  password_label: 'Create a password',
                  button_label: 'Create account',
                },
              },
            }}
          />
        </div>

        {/* ── Footer ── */}
        <div className="mt-6 space-y-2 text-center">
          <p className="text-xs text-gray-500">
            Need access?{' '}
            <span className="font-medium text-primary">
              Contact your administrator to request an account.
            </span>
          </p>
          <p className="text-xs text-gray-400">
            © {new Date().getFullYear()} The Standing Church International
          </p>
        </div>
      </div>
    </div>
  )
}
