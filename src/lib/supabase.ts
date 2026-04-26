import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Holds the client reference so the fetch wrapper can trigger auth recovery.
// Set immediately after createClient() below — safe because fetch is never
// called during module initialisation, only later when user code runs.
let _client: ReturnType<typeof createClient> | null = null

// Apply a 20-second timeout ONLY to data (PostgREST) requests.
// Auth requests (/auth/v1/*) are excluded — aborting a token refresh causes
// the Supabase SDK to retry indefinitely, making things worse not better.
// On a 401 response we proactively refresh the session so the next request
// uses a fresh JWT without the user having to reload.
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL ? input.href : (input as Request).url

  if (url.includes('/auth/v1/')) {
    return fetch(input, init)
  }

  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), 20_000)

  return fetch(input, { ...init, signal: controller.signal })
    .then(response => {
      if (response.status === 401) {
        // Session has expired — refresh it so the next query succeeds
        _client?.auth.refreshSession().catch(() => {})
      }
      return response
    })
    .finally(() => clearTimeout(timer))
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: false,
  },
})

_client = supabase
