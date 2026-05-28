# Multi-Tenant Foundation — Phase 1 Migration Notes

**File:** `20260528000000_multi_tenant_foundation.sql`
**Date:** 2026-05-28
**Phase:** Structural only — no tenant isolation enforced

---

## New Tables

### `organizations`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | `gen_random_uuid()` |
| `name` | text NOT NULL | Display name |
| `slug` | text NOT NULL UNIQUE | URL-safe identifier; indexed |
| `created_by` | uuid → profiles | ON DELETE SET NULL |
| `metadata` | jsonb DEFAULT '{}' | Reserved for billing/config |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | Must be updated by app on write |

RLS: SELECT/INSERT/UPDATE = any auth user; DELETE = `is_admin()` (Phase 1 permissive).

### `org_members`
| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid PK | |
| `org_id` | uuid NOT NULL → organizations | ON DELETE CASCADE |
| `user_id` | uuid NOT NULL → profiles | ON DELETE CASCADE |
| `role` | text | `admin` / `accountant` / `viewer` |
| `joined_at` | timestamptz | |
| `invited_by` | uuid → profiles | ON DELETE SET NULL |
| `status` | text | `active` / `invited` / `suspended` |
| UNIQUE | `(org_id, user_id)` | One membership per user per org |

RLS: SELECT/INSERT/UPDATE = any auth user; DELETE = `is_admin()` (Phase 1 permissive).

---

## New Indexes

| Index | Table | Column(s) |
|-------|-------|-----------|
| `idx_organizations_slug` | organizations | slug |
| `idx_organizations_created_by` | organizations | created_by |
| `idx_org_members_org_id` | org_members | org_id |
| `idx_org_members_user_id` | org_members | user_id |
| `idx_inflow_org` | inflow_transactions | org_id |
| `idx_outflow_org` | outflow_transactions | org_id |
| `idx_intra_flows_org` | intra_flows | org_id |
| `idx_banks_org` | banks | org_id |
| `idx_categories_org` | categories | org_id |
| `idx_alloc_configs_org` | allocation_configs | org_id |
| `idx_fx_org` | fx_transactions | org_id |
| `idx_bank_deposits_org` | bank_deposits | org_id |

---

## `org_id` Added (nullable) To

All columns: `uuid REFERENCES organizations(id) ON DELETE SET NULL`, nullable.

| Table | Notes |
|-------|-------|
| `category_groups` | |
| `categories` | |
| `banks` | |
| `allocation_configs` | |
| `income_types` | |
| `income_type_rules` | |
| `inflow_transactions` | |
| `outflow_transactions` | |
| `intra_flows` | |
| `bank_deposits` | |
| `intrabank_transfers` | |
| `accounts` | |
| `ledger_entries` | |
| `fx_transactions` | |
| `special_projects` | |
| `project_entries` | |
| `receipts` | |
| `invitations` | Org-scoped invites for Phase 2 |
| `report_templates` | |
| `special_config_groups` | |
| `transaction_allocation_snapshots` | |
| `recalculation_logs` | |
| `dynamic_reports` | `dynamic_report_blocks` and `dynamic_report_snapshots` omitted — they inherit org context via parent FK |
| `outflow_types` | |
| `category_outflow_type_map` | |
| `category_opening_balances` | |

## Tables Skipped (no `org_id`)

| Table | Reason |
|-------|--------|
| `profiles` | User identity — not org-scoped |
| `audit_log` | Immutable audit trail; org context inherited from the row being audited |
| `field_changes` | Same as above |
| `dynamic_report_blocks` | Child of `dynamic_reports`; org context via parent |
| `dynamic_report_snapshots` | Child of `dynamic_reports`; org context via parent |

---

## New Helper Functions

| Function | Returns | Notes |
|----------|---------|-------|
| `get_current_org_id()` | uuid | Phase 1 stub — returns NULL. Phase 2 will resolve from session variable or single-org shortcut |
| `is_org_admin(p_org_id)` | boolean | Checks `org_members.role = 'admin'` — forward-compatible with multi-org |
| `is_org_finance_user(p_org_id)` | boolean | Checks `org_members.role IN ('admin','accountant')` |

All functions: `SECURITY DEFINER STABLE`. They do NOT replace `is_admin()` / `is_finance_user()` yet.

---

## Backward Compatibility

- All `org_id` columns are nullable → existing rows unaffected, existing queries unaffected.
- Existing RLS policies unchanged.
- Existing hooks/stores/mutations unchanged.
- `profiles.role` preserved.
- No `profiles.role` removal.
- No query rewrites.

---

## Risky Relationships

- `category_outflow_type_map.org_id` — this join table links two org-scoped tables. In Phase 2, ensure both sides belong to the same org before insert.
- `transaction_allocation_snapshots.org_id` — snapshot is child of `inflow_transactions`; their `org_id` values must be consistent when Phase 2 enforces isolation.
- `intra_flows` has `from_category_id` / `to_category_id` FKs; both categories must belong to the same org in Phase 2.

---

## Future Blockers / Phase 2 Notes

1. `get_current_org_id()` must be replaced with session-variable resolution (e.g. `current_setting('app.org_id', true)::uuid`) before RLS enforcement begins.
2. RLS policies on all business tables will need an `org_id = get_current_org_id()` predicate — this is a breaking change for existing single-tenant users until a default org is created and back-filled.
3. Back-fill script required: create a default org per existing tenant, set `org_id` on all existing rows, then add `NOT NULL` constraint.
4. `backupRestore.ts` `MANAGED_TABLES` registry will need `organizations` and `org_members` entries added.
5. `invitations.org_id` — `accept_invitation` RPC must be updated to assign membership to the correct org.
6. `updated_at` on `organizations` must be maintained by the app (no DB trigger exists yet).
