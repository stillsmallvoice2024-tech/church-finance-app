# Stage 3 (deferred): move the percentage-allocation engine into Postgres

> Not started. Written as an instruction for whoever picks this up next —
> possibly a future me. Do not begin without re-running Stage 0's measurement
> script first; this may still not be needed.

## Why this file exists

The August 2026 audit found that every balance screen (Dashboard, Category
Accounts, Regular Funds, Savings Funds, Designated Gifts, Bank Ledger)
downloaded the org's entire transaction history to the browser and summed it
in JavaScript. That work shipped in three stages:

- **Stage 0** — `scripts/measure-balance-load.mjs` measures real row counts
  per org instead of guessing.
- **Stage 1** — pushed the discard-filters the JS already applied (percentage-
  allocation rows only, no offsets, no non-allocatable transaction types) down
  to the query, and made the four fund pages share one fetch instead of four.
- **Stage 2** — moved five plain SUM/GROUP BY queries (Specific Seed in/out,
  Savings in/out, percentage-outflow totals, bank in/out) into three Postgres
  functions: `org_bank_balance_totals`, `org_category_fund_totals`,
  `org_seed_target_totals` (migration `20260807000003_balance_aggregate_rpcs.sql`).
  Every one of those was pure arithmetic — no rules, no dates, no
  interpretation — so moving them was low-risk.

**One query was deliberately left alone**: the all-inflows scan in
`src/utils/fundBuckets.ts` that resolves each inflow to the percentage-
allocation config in force on its date, then splits it across categories by
percentage or fixed amount. That is `computeFundBuckets`'s biggest remaining
cost, and it is the one piece of this problem that is *not* a plain sum — it
is a rules engine. This file is the plan for moving it, when the numbers say
it's time.

## Why this one is different, and why it waited

Stage 2's functions can be verified by eyeballing the SQL against the JS —
`sum(...) filter (where ...)` next to a `for` loop with an `if`. The
allocation engine cannot be verified that way. Its correctness depends on:

- **Version resolution** — for a special config group, or the general config
  when none is given, picking the *locked* version whose
  `[effective_from, effective_to]` range contains the transaction's date,
  preferring the latest `effective_from` within range
  (`buildVersionIndex`/`getSpecialConfigVersionForDate` in
  `src/store/allocationStore.ts`).
- **Explicit override** — `allocation_config_id` on the transaction wins over
  date resolution when present, but falls back to date resolution if the
  referenced config no longer exists in the fetched set
  (`fundBuckets.ts:122-125`, the `??` chain).
- **Row-level split logic** — a config row with `amount > 0` allocates that
  fixed amount; otherwise `percentage` allocates `allocatePercent(txnAmount,
  pct)`; a row with neither is skipped (`src/utils/financeMath.ts`'s rounding
  behavior matters here — verify it before porting).
- **Non-contributing exclusion** — `isNonContributing()` in
  `src/utils/transactionTypes.ts`: offset rows and five transaction types
  (`balance_brought_forward`, `reversal`, `refund`, `bank_deposit`,
  `intrabank_transfer`) never allocate.
- **Bucket routing by `budget_portion`** — `Specific Seed` → seed bucket
  (with a seed-target label from `description`), `Savings` → savings bucket,
  anything else → percentage bucket.

This is the app's core financial logic — the numbers that tell a church how
much of its Regular Funds, Designated Gifts, and Savings it actually has. A
silent divergence between a JS version and a SQL version of this engine would
not crash anything; it would just show two different balances in two different
screens, or the same screen at two different times, with no error to flag
which one is wrong. In a finance app that is the worst class of bug: quiet
and consequential. That is why this is Effort: High and was not bundled into
Stages 1–2, and why it should not ship without the comparison gate below.

## When to actually do this

Run `node --env-file=.env.local scripts/measure-balance-load.mjs` (Stage 0's
script) across all orgs. Stage 1 + 2 already cut the browser-facing row count
for the fund pages to roughly `pctEligibleInflows + activeIntraFlows` — the
one query this stage would still shrink. Reasonable trigger points, in order
of how the script phrases them:

- Largest org's fund-page row count still comfortably under ~5,000 rows →
  don't do this yet. Stage 1+2 already bought years of headroom.
- 5,000–25,000 → worth scoping, not urgent.
- 25,000+, or a support ticket about a slow Regular Funds tab specifically →
  do it.

## The plan, when it's time

1. **Write a Postgres function that mirrors the resolution logic exactly**,
   not a reinterpretation of it:
   ```sql
   create function public.org_percentage_allocation_totals(p_org_id uuid)
   returns table (category_id uuid, stage_code_1 text, budget_portion text, amount numeric)
   ```
   It needs `allocation_configs` (locked, `config_group_id`,
   `effective_from`/`effective_to`, `version_number`), `special_config_groups`
   (`is_default`), `income_types.special_config_group_id`, and the inflow
   columns already selected by `percentageEligibleInflows()` in
   `fundBuckets.ts`. A `LATERAL` join per transaction row, resolving the
   correct config version, is the natural shape — but benchmark it; if it's
   slow, a materialized `transaction_allocation_snapshots`-style precompute
   (the table already exists for a different purpose — see `db-rules.md`'s
   Special Config Versioning section) may be the better fit.

2. **Do not cut over the JS path.** Add the SQL path *alongside* it, behind a
   feature flag or an env var, both running by default.

3. **Build a reconciliation check that runs both and diffs them** — per
   category, per bucket, to the kobo — across every org's real data. Surface
   mismatches somewhere visible (a Setup → Database diagnostics panel, or a
   one-off script that alerts if a diff is nonzero). This should run
   automatically for some period (a week of production traffic is a
   reasonable bar) with zero diffs before cutover is even considered.

4. **Cut over one query at a time**, starting with `computeFundBuckets`'s
   inflow-distribution pass, leaving `financeMath.ts::allocatePercent`'s
   rounding rule as the single source of truth for how a naira amount splits
   — port its exact rounding into SQL (`round()` half-up vs Postgres's
   default banker's rounding will disagree on ties; check this explicitly).

5. **Keep the JS path as the fallback** for at least one release cycle the
   same way Stage 2's RPCs fall back to the raw-row path when the migration
   hasn't run — `aggregateRpcAvailable` in `fundBuckets.ts` is the pattern to
   copy.

6. Only after a full cycle with zero reconciliation diffs, remove the JS
   engine and the fallback.

## What NOT to do

- Don't "simplify while you're in there." Any behavior change to allocation
  math belongs in its own migration with its own before/after reconciliation
  against real org data, reviewed on its own — never bundled with a
  performance change.
- Don't skip the parallel-run period because the diff-checker passed once in
  dev. Dev data doesn't have the edge cases — draft configs mid-transition,
  amended versions, backdated recalculations — that real church data
  accumulates over years.
