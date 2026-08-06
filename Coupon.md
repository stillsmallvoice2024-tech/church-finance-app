# App-Side Coupon Plan (Option B — no Stripe subscription)

Grants an org a paid tier for N days without going through Stripe Checkout —
for manual comps, beta partners, no-card-required promos. Sets
`plan_tier` + `plan_expires_at` directly; `resolveEffectiveTier()`
(`src/hooks/usePlan.ts`) already reverts to `free` once `plan_expires_at`
passes, so no client-side changes are needed there.

## 1. Schema — `supabase/migrations/<timestamp>_coupons.sql`

```sql
create table public.coupons (
  id              uuid primary key default gen_random_uuid(),
  code            text        not null unique,
  tier            text        not null check (tier in ('level1', 'full')),
  duration_days   int         not null check (duration_days > 0),
  max_redemptions int,                      -- null = unlimited
  redeemed_count  int         not null default 0,
  expires_at      timestamptz,              -- code itself expires (not the grant)
  created_by      uuid        references auth.users(id),
  created_at      timestamptz not null default now()
);

create table public.coupon_redemptions (
  id          uuid primary key default gen_random_uuid(),
  coupon_id   uuid not null references public.coupons(id),
  org_id      uuid not null references public.organizations(id),
  redeemed_by uuid not null references auth.users(id),
  redeemed_at timestamptz not null default now(),
  unique (coupon_id, org_id)  -- one redemption per org per coupon
);

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;
-- coupons: readable/writable only by a global-admin role (mirror whatever
-- gate protects existing admin-only tables, e.g. profiles.is_global_admin)
-- coupon_redemptions: org members can see their own org's redemptions
```

## 2. RPC — `redeem_coupon(p_org_id uuid, p_code text)`

`security definer`, mirrors `increment_import_count`'s membership check:

- `raise exception` if caller is not an active owner/admin of `p_org_id`
  (reuse `is_org_member` / role check pattern from existing RPCs).
- Look up coupon by `code`; fail if missing, `expires_at` passed, or
  `max_redemptions` reached.
- Fail if `(coupon_id, org_id)` already in `coupon_redemptions` (no repeat
  redemption of the same code by the same org).
- On success, in one transaction:
  - insert into `coupon_redemptions`
  - increment `coupons.redeemed_count`
  - update `organizations`: `plan_tier = coupon.tier`,
    `plan_expires_at = greatest(coalesce(plan_expires_at, now()), now()) + (coupon.duration_days || ' days')::interval`
    — stacks onto remaining time rather than overwriting, so redeeming
    a second code doesn't shorten an active grant.
- `grant execute ... to authenticated`.

## 3. Frontend — `BillingTab.tsx`

- "Have a coupon code?" text input + button near the tier cards (visible to
  owner/admin only, same gate as the upgrade buttons).
- On submit: `supabase.rpc('redeem_coupon', { p_org_id: orgId, p_code: code })`.
- Success → toast + refetch org membership (same refetch path the
  Stripe checkout success redirect relies on) so `planTier`/`planExpiresAt`
  update immediately.
- Error → surface the RPC's exception message via toast (invalid code,
  already redeemed, expired, max redemptions reached).

## 4. Admin coupon management (minimal)

- No dedicated UI needed initially — create/inspect coupons via SQL or
  Supabase Studio table editor.
- If self-serve admin UI is wanted later: a simple table view + "create
  coupon" form gated behind the same global-admin check used elsewhere
  (`profiles.is_global_admin` or equivalent), listing `code`, `tier`,
  `duration_days`, `redeemed_count`/`max_redemptions`, `expires_at`.

## Interaction with Stripe (Option A)

Independent of the Stripe coupon path — this never touches
`stripe_customer_id`/`stripe_subscription_id`/`plan_status`. An org can be
on an app-side coupon grant and later start a real Stripe subscription;
the webhook sync (`stripe-webhook/index.ts`) will overwrite `plan_tier`/
`plan_expires_at` from the subscription at that point, which is the
correct behavior (paid subscription supersedes a promo grant).

## Out of scope / open questions for later

- Whether redemption should be one-per-org-ever vs. one-per-org-per-coupon
  (current design: per-coupon, via the unique constraint above).
- Whether to notify `created_by` when a coupon is redeemed.
- Whether coupons should be restricted to orgs currently on `free` (block
  using a coupon to "top up" an already-paying org) — not enforced above,
  add a check in the RPC if desired.
