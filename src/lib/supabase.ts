import { createClient } from '@supabase/supabase-js'

const supabaseUrl    = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Wrap every request with a 20-second timeout so a hung connection
// (e.g. after the browser throttles a background tab) fails fast rather
// than blocking the app indefinitely.
function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), 20_000)
  return fetch(input, { ...init, signal: controller.signal })
    .finally(() => clearTimeout(timer))
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
  },
})
