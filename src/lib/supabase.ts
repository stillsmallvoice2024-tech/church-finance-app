import { createClient } from '@supabase/supabase-js'

const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Holds the client reference so the fetch wrapper can trigger auth recovery.
// Set immediately after createClient() below — safe because fetch is never
// called during module initialisation, only later when user code runs.
let _client: { auth: { refreshSession(): Promise<unknown> } } | null = null

// Reads are capped tightly; a slow SELECT is safe to abandon and retry.
// Writes get a much longer window: aborting an in-flight INSERT/UPDATE does
// NOT roll it back server-side, it only hides the outcome from the user, who
// then retries and hits duplicate-key or lock-contention errors.
const READ_TIMEOUT_MS  = 20_000
const WRITE_TIMEOUT_MS = 60_000

// Names the PostgREST resource so the timeout message says what timed out
// instead of the opaque browser default ("signal is aborted without reason").
function resourceLabel(url: string): string {
  const m = /\/rest\/v1\/(rpc\/)?([A-Za-z0-9_]+)/.exec(url)
  if (!m) return 'request'
  return m[1] ? `${m[2]}()` : m[2]
}

function timeoutReason(url: string, ms: number): Error {
  const message =
    `The ${resourceLabel(url)} request took longer than ${Math.round(ms / 1000)}s and was cancelled. ` +
    `It may still have completed on the server — reload before retrying.`
  // Keep the AbortError name: postgrest-js uses it to decide never to retry.
  if (typeof DOMException === 'function') return new DOMException(message, 'AbortError')
  const err = new Error(message)
  err.name = 'AbortError'
  return err
}

// Apply a timeout ONLY to data (PostgREST) requests.
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

  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase()
  const timeoutMs = method === 'GET' || method === 'HEAD' ? READ_TIMEOUT_MS : WRITE_TIMEOUT_MS

  const controller = new AbortController()

  // Honour a caller-supplied signal (postgrest-js passes one through `init`)
  // instead of silently discarding it by overwriting `signal` below.
  const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : null)
  const forwardAbort = () => controller.abort(callerSignal?.reason)
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort(callerSignal.reason)
    else callerSignal.addEventListener('abort', forwardAbort, { once: true })
  }

  const timer = setTimeout(() => controller.abort(timeoutReason(url, timeoutMs)), timeoutMs)

  return fetch(input, { ...init, signal: controller.signal })
    .then(response => {
      if (response.status === 401) {
        // Session has expired — refresh it so the next query succeeds
        _client?.auth.refreshSession().catch(() => {})
      }
      return response
    })
    .finally(() => {
      clearTimeout(timer)
      callerSignal?.removeEventListener('abort', forwardAbort)
    })
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: fetchWithTimeout },
  auth: {
    autoRefreshToken:   true,
    persistSession:     true,
    detectSessionInUrl: true,
  },
})

_client = supabase
