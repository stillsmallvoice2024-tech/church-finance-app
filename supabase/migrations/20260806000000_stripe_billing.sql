-- ================================================================
-- Stripe Billing — Phase 2
-- Adds the columns stripe-webhook / create-checkout-session /
-- create-portal-session read and write to keep organizations.plan_tier
-- in sync with Stripe subscriptions.
--
-- Idempotent: safe to re-run.
-- ================================================================

alter table public.organizations
  add column if not exists stripe_customer_id     text,
  add column if not exists stripe_subscription_id  text,
  add column if not exists plan_status             text        not null default 'active'
                            check (plan_status in ('active', 'trialing', 'past_due', 'canceled')),
  add column if not exists trial_ends_at           timestamptz;

create unique index if not exists organizations_stripe_customer_id_key
  on public.organizations (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists organizations_stripe_subscription_id_key
  on public.organizations (stripe_subscription_id)
  where stripe_subscription_id is not null;

notify pgrst, 'reload schema';
