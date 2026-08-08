#!/usr/bin/env node
// Stage 0 of the "balance views download the whole ledger" fix — measure before
// optimising.
//
// The audit that prompted this work assumed 50,000 transactions per org. Nobody
// had checked. This script reports, per organisation, how many rows each balance
// screen actually pulls into the browser today, so the remaining stages can be
// sized against real numbers instead of a hypothetical.
//
// Usage:
//   node --env-file=.env.local scripts/measure-balance-load.mjs
//   node --env-file=.env.local scripts/measure-balance-load.mjs --org st-marys
//
// Requires SUPABASE_SERVICE_ROLE_KEY and VITE_SUPABASE_URL in .env.local (same
// pair scripts/set-org-plan.mjs uses). The service role is needed because these
// are cross-org counts — RLS would otherwise limit the script to whichever org
// the running user belongs to. Read-only: this script issues no writes.
//
// Never commit the service role key or paste it into chat.

import { createClient } from '@supabase/supabase-js'

const PAGE_SIZE = 1000 // must match src/utils/fetchAllRows.ts

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) args[a.slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i]
  }
  return args
}

const url = process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !key) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  console.error('Run with: node --env-file=.env.local scripts/measure-balance-load.mjs')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

// Count rows matching a filter without transferring them. head:true + exact
// makes PostgREST return only the Content-Range count.
async function count(table, apply) {
  let q = db.from(table).select('*', { count: 'exact', head: true })
  q = apply(q)
  const { count: n, error } = await q
  if (error) throw new Error(`${table}: ${error.message}`)
  return n ?? 0
}

const NON_ALLOCATABLE = 'balance_brought_forward,reversal,refund,bank_deposit,intrabank_transfer'

async function measureOrg(org) {
  const orgEq = q => q.eq('org_id', org.id)

  const [
    inflowTotal, outflowTotal, intraFlows,
    seedIn, seedOut, savIn, savOut, pctOut,
    pctEligible,
  ] = await Promise.all([
    count('inflow_transactions',  orgEq),
    count('outflow_transactions', orgEq),
    count('intra_flows',          q => orgEq(q).eq('status', 'active')),

    count('inflow_transactions',  q => orgEq(q).eq('stage_code_2', 'Specific Seed')),
    count('outflow_transactions', q => orgEq(q).eq('stage_code_2', 'Specific Seed')),
    count('inflow_transactions',  q => orgEq(q).eq('stage_code_2', 'Savings')),
    count('outflow_transactions', q => orgEq(q).eq('stage_code_2', 'Savings')),
    count('outflow_transactions', q => orgEq(q)
      .not('stage_code_2', 'eq', 'Specific Seed')
      .not('stage_code_2', 'eq', 'Savings')),

    // What the big fundBuckets inflow query SHOULD be pulling once Stage 1
    // pushes the discard-filters to the server: percentage-allocation rows
    // only, excluding offsets and non-allocatable transaction types.
    count('inflow_transactions', q => orgEq(q)
      .or('stage_code_2.is.null,stage_code_2.eq.Percentage Allocation')
      .or('offset_role.is.null,offset_role.neq.offset')
      .or(`transaction_type.is.null,transaction_type.not.in.(${NON_ALLOCATABLE})`)),
  ])

  const pages = n => Math.max(1, Math.ceil(n / PAGE_SIZE))

  // Today: computeFundBuckets fires 9 queries; the 5 aggregate ones plus the
  // unfiltered all-inflows scan are the row-heavy ones. Four pages each call it
  // on mount with no shared cache.
  const fundRowsToday = seedIn + seedOut + savIn + savOut + pctOut + inflowTotal + intraFlows
  const fundRoundTripsToday =
    pages(seedIn) + pages(seedOut) + pages(savIn) + pages(savOut) + pages(pctOut) +
    pages(inflowTotal) + pages(intraFlows)

  // After Stage 1 (server-side filters + one shared fetch for all four pages)
  // and Stage 2 (the five aggregate queries answered by Postgres).
  const fundRowsAfter = pctEligible + intraFlows
  const fundRoundTripsAfter = pages(pctEligible) + pages(intraFlows) + 2 // + 2 RPCs

  const bankRowsToday = inflowTotal + outflowTotal
  const bankRoundTripsToday = pages(inflowTotal) + pages(outflowTotal)

  return {
    org,
    inflowTotal, outflowTotal, intraFlows,
    fundRowsToday, fundRoundTripsToday,
    fundRowsAfter, fundRoundTripsAfter,
    bankRowsToday, bankRoundTripsToday,
  }
}

const n = x => x.toLocaleString('en-US')

// Rough wire-size estimate. Transaction rows come back as PostgREST JSON with
// 8-10 selected columns; ~250 bytes/row is a conservative middle figure. This
// is an order-of-magnitude signal, not a measurement.
const BYTES_PER_ROW = 250
const mb = rows => `${((rows * BYTES_PER_ROW) / 1_000_000).toFixed(1)} MB`

async function main() {
  const args = parseArgs(process.argv.slice(2))

  let q = db.from('organizations').select('id, name, slug').order('name')
  if (args.org) q = q.eq('slug', args.org)
  const { data: orgs, error } = await q
  if (error) { console.error(`Could not list organizations: ${error.message}`); process.exit(1) }
  if (!orgs?.length) { console.error(args.org ? `No org with slug "${args.org}".` : 'No organizations found.'); process.exit(1) }

  console.log(`\nBalance-view data load — ${orgs.length} organisation(s)\n`)

  const results = []
  for (const org of orgs) {
    try { results.push(await measureOrg(org)) }
    catch (e) { console.error(`  ${org.name}: ${e.message}`) }
  }

  results.sort((a, b) => b.fundRowsToday - a.fundRowsToday)

  for (const r of results) {
    console.log(`── ${r.org.name} (${r.org.slug})`)
    console.log(`   ledger size        inflows ${n(r.inflowTotal)} · outflows ${n(r.outflowTotal)} · internal transfers ${n(r.intraFlows)}`)
    console.log(`   fund pages  today  ${n(r.fundRowsToday)} rows, ${r.fundRoundTripsToday} round-trips, ~${mb(r.fundRowsToday)}  (×4 pages, uncached)`)
    console.log(`               after  ${n(r.fundRowsAfter)} rows, ${r.fundRoundTripsAfter} round-trips, ~${mb(r.fundRowsAfter)}  (×1, shared)`)
    console.log(`   bank ledger today  ${n(r.bankRowsToday)} rows, ${r.bankRoundTripsToday} round-trips, ~${mb(r.bankRowsToday)}`)
    console.log(`               after  1 round-trip, one row per bank`)
    console.log('')
  }

  const worst = results[0]
  if (worst) {
    const perVisit4 = worst.fundRowsToday * 4
    const perVisit4After = worst.fundRowsAfter
    console.log('── Summary')
    console.log(`   Largest org: ${worst.org.name}`)
    console.log(`   Visiting all four fund pages downloads ${n(perVisit4)} rows today (~${mb(perVisit4)}),`)
    console.log(`   versus ${n(perVisit4After)} rows (~${mb(perVisit4After)}) after Stages 1 and 2.`)
    if (worst.fundRowsToday < 5_000) {
      console.log(`   At this size the problem is real but not yet urgent — Stage 1 alone buys years of headroom.`)
    } else if (worst.fundRowsToday < 25_000) {
      console.log(`   At this size Stage 1 + Stage 2 are clearly worth doing now.`)
    } else {
      console.log(`   At this size Stage 3 (moving the allocation engine into Postgres) should be scheduled — see rebuild_allocation.md.`)
    }
    console.log('')
  }
}

main().catch(e => { console.error(e); process.exit(1) })
