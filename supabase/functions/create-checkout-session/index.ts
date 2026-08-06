// Edge Function: create-checkout-session
// Called by BillingTab when an org admin picks a paid tier. Creates (or
// reuses) a Stripe Customer for the org, starts a Stripe Checkout Session
// for the chosen tier/cycle, and returns the hosted checkout URL.
//
// Deploy: supabase functions deploy create-checkout-session
// Required env vars: STRIPE_SECRET_KEY, APP_URL,
//   STRIPE_PRICE_LEVEL1_MONTHLY, STRIPE_PRICE_LEVEL1_ANNUAL,
//   STRIPE_PRICE_FULL_MONTHLY,   STRIPE_PRICE_FULL_ANNUAL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY')!
const APP_URL              = Deno.env.get('APP_URL') ?? 'https://clariva.app'

// Trials only apply the first time an org ever starts a paid subscription —
// enforced below by checking stripe_subscription_id, not by a Stripe setting.
const TRIAL_PERIOD_DAYS = 14

type PayableTier = 'level1' | 'full'
type Cycle       = 'monthly' | 'annual'

const PRICE_IDS: Record<PayableTier, Record<Cycle, string | undefined>> = {
  level1: {
    monthly: Deno.env.get('STRIPE_PRICE_LEVEL1_MONTHLY'),
    annual:  Deno.env.get('STRIPE_PRICE_LEVEL1_ANNUAL'),
  },
  full: {
    monthly: Deno.env.get('STRIPE_PRICE_FULL_MONTHLY'),
    annual:  Deno.env.get('STRIPE_PRICE_FULL_ANNUAL'),
  },
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ ok: false, error: 'Unauthorized' }, 401)

  const token   = authHeader.slice(7)
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  const { data: { user }, error: authErr } = await service.auth.getUser(token)
  if (authErr || !user) return json({ ok: false, error: 'Unauthorized' }, 401)

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { org_id?: string; tier?: PayableTier; cycle?: Cycle }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400)
  }

  const { org_id, tier, cycle } = body
  if (!org_id || !tier || !cycle) {
    return json({ ok: false, error: 'org_id, tier and cycle are required' }, 400)
  }
  if (tier !== 'level1' && tier !== 'full') return json({ ok: false, error: 'Invalid tier' }, 400)
  if (cycle !== 'monthly' && cycle !== 'annual') return json({ ok: false, error: 'Invalid cycle' }, 400)

  const priceId = PRICE_IDS[tier][cycle]
  if (!priceId) {
    console.error(`[create-checkout-session] Missing Stripe price env for ${tier}/${cycle}`)
    return json({ ok: false, error: 'Billing is not configured for this plan yet' }, 500)
  }

  // Caller must be an active owner/admin of the org they're paying for.
  const { data: membership } = await service
    .from('org_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', org_id)
    .eq('status', 'active')
    .in('role', ['owner', 'admin'])
    .maybeSingle()

  if (!membership) return json({ ok: false, error: 'Forbidden' }, 403)

  const { data: org, error: orgErr } = await service
    .from('organizations')
    .select('id, name, stripe_customer_id, stripe_subscription_id')
    .eq('id', org_id)
    .single()

  if (orgErr || !org) return json({ ok: false, error: 'Organisation not found' }, 404)

  // ── Reuse or create the Stripe Customer ─────────────────────────────────
  let customerId = org.stripe_customer_id as string | null
  if (!customerId) {
    const customer = await stripe.customers.create({
      email:    user.email ?? undefined,
      name:     org.name ?? undefined,
      metadata: { org_id },
    })
    customerId = customer.id
    await service.from('organizations').update({ stripe_customer_id: customerId }).eq('id', org_id)
  }

  // Only orgs that have never had a subscription get a trial.
  const eligibleForTrial = !org.stripe_subscription_id

  const session = await stripe.checkout.sessions.create({
    mode:                 'subscription',
    customer:             customerId,
    line_items:           [{ price: priceId, quantity: 1 }],
    success_url:          `${APP_URL}/settings?tab=billing&checkout=success`,
    cancel_url:           `${APP_URL}/settings?tab=billing&checkout=cancelled`,
    client_reference_id:  org_id,
    subscription_data: {
      trial_period_days: eligibleForTrial ? TRIAL_PERIOD_DAYS : undefined,
      metadata:           { org_id, tier },
    },
    metadata: { org_id, tier },
  })

  return json({ ok: true, url: session.url })
})
