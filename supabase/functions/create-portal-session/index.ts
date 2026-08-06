// Edge Function: create-portal-session
// Called from BillingTab by an existing subscriber ("Manage billing") to
// open Stripe's hosted Billing Portal — cancel, change card, view invoices.
//
// Deploy: supabase functions deploy create-portal-session
// Required env vars: STRIPE_SECRET_KEY, APP_URL

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@17?target=deno'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const STRIPE_SECRET_KEY    = Deno.env.get('STRIPE_SECRET_KEY')!
const APP_URL              = Deno.env.get('APP_URL') ?? 'https://clariva.app'

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' })

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ ok: false, error: 'Unauthorized' }, 401)

  const token   = authHeader.slice(7)
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  const { data: { user }, error: authErr } = await service.auth.getUser(token)
  if (authErr || !user) return json({ ok: false, error: 'Unauthorized' }, 401)

  let body: { org_id?: string }
  try {
    body = await req.json()
  } catch {
    return json({ ok: false, error: 'Invalid JSON' }, 400)
  }

  const { org_id } = body
  if (!org_id) return json({ ok: false, error: 'org_id is required' }, 400)

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
    .select('stripe_customer_id')
    .eq('id', org_id)
    .single()

  if (orgErr || !org?.stripe_customer_id) {
    return json({ ok: false, error: 'No billing account on file for this organisation' }, 404)
  }

  const portalSession = await stripe.billingPortal.sessions.create({
    customer:   org.stripe_customer_id,
    return_url: `${APP_URL}/settings?tab=billing`,
  })

  return json({ ok: true, url: portalSession.url })
})
