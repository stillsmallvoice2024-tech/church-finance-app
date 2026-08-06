// Edge Function: stripe-webhook
// Public endpoint (no Supabase auth — verified via Stripe signature instead).
// Keeps organizations.plan_tier / plan_status / trial_ends_at / plan_expires_at
// in sync with the org's Stripe subscription. This is the single source of
// truth for plan changes once Checkout is wired up — the mailto flow in
// BillingTab.tsx is retired once this is live.
//
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// Configure in Stripe Dashboard → Webhooks → endpoint URL, events:
//   checkout.session.completed, customer.subscription.updated,
//   customer.subscription.deleted, invoice.payment_failed
// Required env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
//   STRIPE_PRICE_LEVEL1_MONTHLY, STRIPE_PRICE_LEVEL1_ANNUAL,
//   STRIPE_PRICE_FULL_MONTHLY,   STRIPE_PRICE_FULL_ANNUAL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY')!
const WEBHOOK_SECRET       = Deno.env.get('STRIPE_WEBHOOK_SECRET')!

type PlanTier = 'free' | 'level1' | 'full'

// Reverse of BillingTab's price lookup — a Price ID always maps back to
// exactly one tier, so subscription.updated events (which carry the Price,
// not our tier name) can resolve the right plan_tier to store.
const PRICE_TO_TIER: Record<string, PlanTier> = {}
for (const [tier, ids] of Object.entries({
  level1: [Deno.env.get('STRIPE_PRICE_LEVEL1_MONTHLY'), Deno.env.get('STRIPE_PRICE_LEVEL1_ANNUAL')],
  full:   [Deno.env.get('STRIPE_PRICE_FULL_MONTHLY'),   Deno.env.get('STRIPE_PRICE_FULL_ANNUAL')],
})) {
  for (const id of ids) if (id) PRICE_TO_TIER[id] = tier as PlanTier
}

const stripe  = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })
const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

function tierFromSubscription(sub: Stripe.Subscription): PlanTier | null {
  const priceId = sub.items.data[0]?.price?.id
  return priceId ? PRICE_TO_TIER[priceId] ?? null : null
}

async function orgIdForCustomer(customerId: string): Promise<string | null> {
  const { data } = await service
    .from('organizations')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  return data?.id ?? null
}

async function syncSubscription(sub: Stripe.Subscription) {
  const orgId = sub.metadata?.org_id || await orgIdForCustomer(sub.customer as string)
  if (!orgId) {
    console.error(`[stripe-webhook] No org found for customer ${sub.customer}`)
    return
  }

  const tier = tierFromSubscription(sub)
  if (!tier) {
    console.error(`[stripe-webhook] Unrecognised price on subscription ${sub.id}`)
    return
  }

  const status = sub.status // 'trialing' | 'active' | 'past_due' | 'canceled' | ...

  await service.from('organizations').update({
    stripe_subscription_id: sub.id,
    plan_tier:               status === 'canceled' ? 'free' : tier,
    plan_status:              status,
    trial_ends_at:  sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
    // plan_expires_at is the *hard* cutoff org_effective_plan_tier() checks —
    // only set it when the subscription is actually ending; an active/trialing
    // sub should keep full access without a client-side expiry race.
    plan_expires_at: status === 'canceled'
      ? new Date().toISOString()
      : (sub.cancel_at ? new Date(sub.cancel_at * 1000).toISOString() : null),
  }).eq('id', orgId)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const signature = req.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })

  const rawBody = await req.text()

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(rawBody, signature, WEBHOOK_SECRET)
  } catch (err) {
    console.error('[stripe-webhook] Signature verification failed:', err)
    return new Response('Invalid signature', { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        if (session.mode === 'subscription' && session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string)
          await syncSubscription(sub)
        }
        break
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        await syncSubscription(sub)
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        if (invoice.subscription) {
          const sub = await stripe.subscriptions.retrieve(invoice.subscription as string)
          await syncSubscription(sub) // picks up sub.status === 'past_due'
        }
        break
      }

      default:
        break // ignore events we don't act on
    }
  } catch (err) {
    console.error(`[stripe-webhook] Failed handling ${event.type}:`, err)
    return new Response('Internal error', { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
