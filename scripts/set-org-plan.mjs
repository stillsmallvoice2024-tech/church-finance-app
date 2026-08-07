#!/usr/bin/env node
// Manual plan override — the "money arrived outside Stripe" path.
//
// 20260807000000_plan_enforcement locked plan_tier/plan_expires_at/plan_status/
// stripe_* /imported_rows_* on organizations to the service role, closing the
// hole where any org admin could set their own plan by editing the row through
// the app. That trigger explicitly still allows the service role through — the
// same door the Stripe webhook uses — so this script goes through that door
// too, deliberately, from the operator's own machine rather than the app.
//
// Usage:
//   node --env-file=.env.local scripts/set-org-plan.mjs --find "st mary"
//   node --env-file=.env.local scripts/set-org-plan.mjs --org st-marys --tier level1 --months 12
//   node --env-file=.env.local scripts/set-org-plan.mjs --org st-marys --tier full --expires 2027-12-31
//   node --env-file=.env.local scripts/set-org-plan.mjs --org st-marys --tier free
//
// Requires SUPABASE_SERVICE_ROLE_KEY (Supabase dashboard → Project Settings →
// API → service_role secret) and VITE_SUPABASE_URL, both already in
// .env.local for the edge functions. --env-file needs Node 20.6+.
//
// Never commit the service role key or paste it into chat — it bypasses
// every RLS policy in the database, not just the plan guard.

import { createClient } from '@supabase/supabase-js'

const VALID_TIERS = ['free', 'level1', 'full']

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i]
    if (!tok.startsWith('--')) continue
    const key = tok.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) { args[key] = true; continue }
    args[key] = next
    i++
  }
  return args
}

function fail(message) {
  console.error(`\n✗ ${message}\n`)
  process.exit(1)
}

function requireEnv(name) {
  const v = process.env[name]
  if (!v) {
    fail(
      `Missing ${name}.\n\n` +
      `  Run with:  node --env-file=.env.local scripts/set-org-plan.mjs ...\n` +
      `  (SUPABASE_SERVICE_ROLE_KEY is under Supabase dashboard → Project Settings → API → service_role secret.\n` +
      `   Add it to .env.local — that file is already gitignored.)`,
    )
  }
  return v
}

function formatDate(iso) {
  return iso ? new Date(iso).toISOString().slice(0, 10) : '—'
}

// Date#setUTCMonth() overflows into the following month when the current
// day-of-month doesn't exist there (Jan 31 + 1 month lands on Mar 3, not
// Feb 28) — clamp to the target month's last day instead.
function addMonthsUTC(date, months) {
  const day = date.getUTCDate()
  const d = new Date(date.getTime())
  d.setUTCDate(1)
  d.setUTCMonth(d.getUTCMonth() + months)
  const daysInTargetMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
  d.setUTCDate(Math.min(day, daysInTargetMonth))
  return d
}

async function promptYesNo(question) {
  process.stdout.write(`${question} [y/N] `)
  const chunk = await new Promise((resolve) => {
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    process.stdin.once('data', (d) => { process.stdin.pause(); resolve(d) })
  })
  return /^y(es)?$/i.test(chunk.trim())
}

async function main() {
  const args = parseArgs(process.argv.slice(2))

  const url        = requireEnv('VITE_SUPABASE_URL')
  const serviceKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY')
  const supabase   = createClient(url, serviceKey, { auth: { persistSession: false } })

  // ── --find: look up an org id/slug by name, slug or a member's email ──────
  if (args.find) {
    const query = String(args.find)
    console.log(`\nSearching for organizations matching "${query}"...\n`)

    const { data: byName, error: nameErr } = await supabase
      .from('organizations')
      .select('id, name, slug, plan_tier, plan_expires_at, stripe_subscription_id')
      .or(`name.ilike.%${query}%,slug.ilike.%${query}%`)
    if (nameErr) fail(`Lookup failed: ${nameErr.message}`)

    // org_members has two FKs into profiles (user_id, invited_by), so the
    // embed needs the constraint name — otherwise PostgREST can't tell which
    // relationship to follow and rejects the query outright.
    const { data: byEmail, error: emailErr } = await supabase
      .from('profiles')
      .select('id, email, org_members!org_members_user_id_fkey(org_id, organizations(id, name, slug, plan_tier, plan_expires_at, stripe_subscription_id))')
      .ilike('email', `%${query}%`)
    if (emailErr) fail(`Email lookup failed: ${emailErr.message}`)

    const seen = new Map()
    for (const o of byName ?? []) seen.set(o.id, o)
    for (const p of byEmail ?? []) {
      for (const m of p.org_members ?? []) {
        const o = m.organizations
        if (o) seen.set(o.id, { ...o, matchedVia: `member ${p.email}` })
      }
    }

    if (seen.size === 0) { console.log('No matches.\n'); return }

    for (const o of seen.values()) {
      console.log(
        `  ${o.slug ?? o.id.slice(0, 8)}` +
        (o.matchedVia ? ` (${o.matchedVia})` : '') +
        `\n    id: ${o.id}\n    name: ${o.name}\n    plan: ${o.plan_tier}` +
        `  expires: ${formatDate(o.plan_expires_at)}` +
        (o.stripe_subscription_id ? '  [on Stripe — see warning below if you also set --org]' : '') +
        '\n',
      )
    }
    return
  }

  // ── Set a plan ─────────────────────────────────────────────────────────────
  if (!args.org) fail('Pass --org <slug or id> (use --find "<name>" first if you don\'t have it).')
  if (!args.tier) fail('Pass --tier free|level1|full')
  const tier = String(args.tier)
  if (!VALID_TIERS.includes(tier)) fail(`--tier must be one of: ${VALID_TIERS.join(', ')}`)

  const orgRef = String(args.org)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgRef)
  const { data: org, error: orgErr } = await supabase
    .from('organizations')
    .select('id, name, slug, plan_tier, plan_status, plan_expires_at, stripe_subscription_id')
    .eq(isUuid ? 'id' : 'slug', orgRef)
    .maybeSingle()
  if (orgErr) fail(`Could not look up org: ${orgErr.message}`)
  if (!org) fail(`No organization found for --org ${orgRef}. Try --find "<part of the name>" first.`)

  if (org.stripe_subscription_id && !args.force) {
    fail(
      `${org.name} has a live Stripe subscription (${org.stripe_subscription_id}).\n\n` +
      `  Setting its plan by hand here will be overwritten the next time Stripe's\n` +
      `  webhook fires for that subscription. If that's really what you want\n` +
      `  (e.g. a one-off manual comp on top of a cancelled subscription),\n` +
      `  re-run with --force.`,
    )
  }

  let expiresAt = null
  if (tier !== 'free') {
    if (args.expires) {
      const d = new Date(String(args.expires))
      if (Number.isNaN(d.getTime())) fail(`--expires "${args.expires}" is not a valid date (use YYYY-MM-DD).`)
      expiresAt = d.toISOString()
    } else if (args.months) {
      const n = Number(args.months)
      if (!Number.isFinite(n) || n <= 0) fail(`--months must be a positive number, got "${args.months}".`)
      expiresAt = addMonthsUTC(new Date(), n).toISOString()
    } else {
      fail(`Paid tiers need an end date — pass --months <n> or --expires YYYY-MM-DD.`)
    }
  } else if (args.expires || args.months) {
    fail(`--expires/--months apply to paid tiers only; the free tier never expires.`)
  }

  console.log('\n──────────────────────────────────────────────')
  console.log(` Organization : ${org.name}  (${org.slug ?? org.id})`)
  console.log(` Current plan : ${org.plan_tier}   expires: ${formatDate(org.plan_expires_at)}`)
  console.log(` New plan     : ${tier}   expires: ${formatDate(expiresAt)}`)
  console.log('──────────────────────────────────────────────\n')

  if (!args.yes && !(await promptYesNo('Apply this change?'))) {
    console.log('\nCancelled — nothing was changed.\n')
    return
  }

  const { data: updated, error: updateErr } = await supabase
    .from('organizations')
    .update({
      plan_tier:       tier,
      plan_started_at: new Date().toISOString(),
      plan_expires_at: expiresAt,
      plan_status:     'active',
    })
    .eq('id', org.id)
    .select('name, plan_tier, plan_started_at, plan_expires_at')
    .single()
  if (updateErr) fail(`Update failed: ${updateErr.message}`)

  console.log(
    `✓ ${updated.name} is now on ${updated.plan_tier}` +
    (updated.plan_expires_at ? ` until ${formatDate(updated.plan_expires_at)}` : '') +
    '.\n',
  )
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)))
