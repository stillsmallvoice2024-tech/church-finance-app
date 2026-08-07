// Edge Function: username-auth
//
// WHY THIS EXISTS
// ---------------
// Username login needs a username → email lookup, but Supabase Auth only
// accepts an email address.  The old design exposed a `resolve_username()`
// RPC to the `anon` role, which meant ANY unauthenticated caller could turn a
// guessed username into a real email address — an unmetered harvesting oracle
// for the email addresses of church finance administrators, plus a membership
// oracle ("username taken" = "account exists").
//
// This function moves the whole flow server-side.  The browser sends a
// username + password and gets back a session; it never receives an email
// address it did not already know.
//
// SECURITY PROPERTIES
//   * The email address is never returned to an unauthenticated caller.
//   * Unknown username and wrong password are indistinguishable — same body,
//     same status, same timing (all failures are padded to MIN_RESPONSE_MS).
//   * Per-IP and per-username rate limits, enforced in Postgres, survive
//     cold starts (an in-memory counter would not).
//   * Client IPs are stored only as salted SHA-256 hashes.
//
// PROTOCOL NOTE
// Expected outcomes (bad credentials, unconfirmed email, rate limited) return
// HTTP 200 with `{ ok: false, code }`.  Only malformed requests and genuine
// server faults return non-2xx.  This keeps supabase-js `functions.invoke()`
// from throwing on ordinary login failures.
//
// Deploy: supabase functions deploy username-auth --no-verify-jwt
// Env vars: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//           (all auto-injected), APP_URL, AUTH_RATE_LIMIT_SALT (optional)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY    = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const APP_URL              = Deno.env.get('APP_URL') ?? 'https://clariva.app'
const RATE_LIMIT_SALT      = Deno.env.get('AUTH_RATE_LIMIT_SALT') ?? 'clariva-auth-rate-limit-v1'

// Every response — success or failure — takes at least this long, so an
// attacker cannot separate "no such username" from "wrong password" by clock.
const MIN_RESPONSE_MS = 700

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

type Mode = 'signin' | 'reset' | 'resend'

interface RequestBody {
  mode?:        Mode
  identifier?:  string
  password?:    string
  redirect_to?: string
}

const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/** Pad the response so every outcome takes the same minimum wall-clock time. */
async function settle(startedAt: number, body: unknown, status = 200): Promise<Response> {
  const elapsed = Date.now() - startedAt
  if (elapsed < MIN_RESPONSE_MS) {
    await new Promise((r) => setTimeout(r, MIN_RESPONSE_MS - elapsed))
  }
  return json(body, status)
}

async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/** First hop in X-Forwarded-For is the real client; fall back to a constant. */
function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('cf-connecting-ip') ?? req.headers.get('x-real-ip') ?? 'unknown'
}

/**
 * Records the attempt and returns false once a limit is exceeded.
 * Fails OPEN on a database error — a broken rate limiter must not lock the
 * whole congregation out of their books.
 */
async function withinRateLimit(ipHash: string, usernameHash: string): Promise<boolean> {
  const { data, error } = await service.rpc('check_auth_rate_limit', {
    p_ip_hash:       ipHash,
    p_username_hash: usernameHash,
  })
  if (error) {
    console.error('[username-auth] rate limit check failed:', error.message)
    return true
  }
  return data !== false
}

/**
 * Resolves a login identifier to an email address.  Returns null when the
 * username is unknown — the caller must NOT surface that distinction.
 */
async function resolveEmail(identifier: string): Promise<string | null> {
  if (identifier.includes('@')) return identifier
  const { data, error } = await service
    .from('profiles')
    .select('email')
    .eq('username', identifier)
    .maybeSingle()
  if (error) {
    console.error('[username-auth] profile lookup failed:', error.message)
    return null
  }
  return data?.email ?? null
}

/** Only allow password-reset redirects back to our own app. */
function safeRedirect(candidate: string | undefined): string {
  const fallback = `${APP_URL}/reset-password`
  if (!candidate) return fallback
  try {
    const url = new URL(candidate)
    const allowed =
      url.origin === new URL(APP_URL).origin ||
      url.hostname === 'localhost' ||
      url.hostname === '127.0.0.1'
    return allowed ? candidate : fallback
  } catch {
    return fallback
  }
}

interface GoTrueBody {
  access_token?:  string
  refresh_token?: string
  error_code?:    string
  error?:         string
  msg?:           string
}

/** Calls GoTrue directly — supabase-js would try to persist a session here. */
async function goTrue(
  path: string,
  payload: unknown,
): Promise<{ status: number; body: GoTrueBody | null }> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/${path}`, {
    method:  'POST',
    headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  })
  let body: GoTrueBody | null = null
  try { body = await res.json() } catch { /* empty body is fine */ }
  return { status: res.status, body }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST')    return json({ ok: false, code: 'method_not_allowed' }, 405)

  const startedAt = Date.now()

  let body: RequestBody
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, code: 'invalid_request' }, 400)
  }

  const mode       = body.mode ?? 'signin'
  const identifier = (body.identifier ?? '').trim().toLowerCase()
  const password   = body.password ?? ''

  if (!identifier) return json({ ok: false, code: 'invalid_request' }, 400)
  if (mode !== 'signin' && mode !== 'reset' && mode !== 'resend') {
    return json({ ok: false, code: 'invalid_request' }, 400)
  }
  if (mode === 'signin' && !password) return json({ ok: false, code: 'invalid_request' }, 400)

  // ── Rate limit ────────────────────────────────────────────────────────────
  const [ipHash, usernameHash] = await Promise.all([
    sha256(clientIp(req) + RATE_LIMIT_SALT),
    sha256(identifier + RATE_LIMIT_SALT),
  ])
  if (!(await withinRateLimit(ipHash, usernameHash))) {
    return settle(startedAt, { ok: false, code: 'rate_limited' })
  }

  // ── Resolve identifier ────────────────────────────────────────────────────
  // A miss is deliberately NOT reported. Sign-in returns the same generic
  // failure as a wrong password; reset and resend always claim success.
  const email = await resolveEmail(identifier)

  // ── Password reset ────────────────────────────────────────────────────────
  if (mode === 'reset') {
    if (email) {
      // GoTrue reads redirect_to from the query string, not the body.
      const target = encodeURIComponent(safeRedirect(body.redirect_to))
      const { status } = await goTrue(`recover?redirect_to=${target}`, { email })
        .catch(() => ({ status: 0 }))
      if (status >= 500) console.error('[username-auth] recover failed with', status)
    }
    // Identical answer whether or not the account exists.
    return settle(startedAt, { ok: true })
  }

  // ── Resend confirmation ───────────────────────────────────────────────────
  if (mode === 'resend') {
    if (email) {
      await goTrue('resend', { type: 'signup', email }).catch(() => null)
    }
    return settle(startedAt, { ok: true })
  }

  // ── Sign in ───────────────────────────────────────────────────────────────
  if (!email) {
    return settle(startedAt, { ok: false, code: 'invalid_credentials' })
  }

  const { status, body: auth } = await goTrue('token?grant_type=password', { email, password })

  if (status === 200 && auth?.access_token && auth?.refresh_token) {
    return settle(startedAt, {
      ok:            true,
      access_token:  auth.access_token,
      refresh_token: auth.refresh_token,
    })
  }

  const errorCode: string = auth?.error_code ?? auth?.error ?? ''
  if (errorCode === 'email_not_confirmed' || auth?.msg === 'Email not confirmed') {
    // Safe to admit: the caller supplied the correct password for this account.
    return settle(startedAt, { ok: false, code: 'email_not_confirmed' })
  }
  if (status >= 500) {
    console.error('[username-auth] token endpoint failed with', status)
    return settle(startedAt, { ok: false, code: 'server_error' })
  }

  return settle(startedAt, { ok: false, code: 'invalid_credentials' })
})
