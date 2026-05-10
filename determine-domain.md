# Determine Domain

**Purpose:** Identify the minimum required domain files for any active task.
**Goal:** Load the smallest relevant context set — never more than needed.

---

## Domain Trigger Table

| Keywords / Task Type | Load |
|---|---|
| transactions, balances, ledger, allocations, FX conversion, propagation, debit/credit, reconciliation, category balances, bank balances, reversals, special configs | `ledger-rules.md` |
| UI, frontend, components, modals, tables, forms, styling, Tailwind, layout, mobile, responsive, toast, sidebar, dark mode | `ui-rules.md` |
| CSV, Excel, PDF, import, parse, duplicate detection, normalization, header detection, bank statement | `import-rules.md` |
| auth, login, logout, invite, password reset, roles, permissions, RLS, AuthGuard, protected route, user management | `auth-rules.md` |
| schema, migration SQL, new column, new table, Supabase setup, audit trail, RLS policy, field_changes, audit_log | `db-rules.md` |
| debug, history, workaround, edge case, why did we, background tab, stage code, propagation gap | `miscellaneous.md` |

---

## Loading Protocol

1. Match task keywords to the trigger table
2. Load only matched domain files
3. If no clear match: start with the **smallest** likely domain, expand only if reasoning stalls
4. Expand to multiple files only when the task clearly crosses subsystem boundaries
5. Never speculatively load — load only what reasoning requires

---

## Multi-Domain Examples

| Task Description | Load |
|---|---|
| "Imported transactions not showing in BankLedger" | `import-rules.md` + `ledger-rules.md` |
| "Add new column to inflow table and wire it to UI" | `db-rules.md` + `ledger-rules.md` + `ui-rules.md` |
| "Login button disappears after profile fetch fails" | `auth-rules.md` |
| "FX conversion modal validation error" | `ledger-rules.md` + `ui-rules.md` |
| "Migration SQL for new RLS policy" | `db-rules.md` + `auth-rules.md` |
| "Import deduplication logic is broken" | `import-rules.md` |
| "Category ledger summary cards are wrong" | `ledger-rules.md` |

---

## Exclusion Rules

- **Never** speculatively load `miscellaneous.md` — only when the user asks for historical context or debugging history
- Do not load domain files unrelated to the active task
- Do not perform project-wide reasoning when a single domain file suffices

---

## Ambiguity Protocol

When task scope is unclear:
1. Pick the single most likely domain
2. Attempt to reason within it
3. Expand to additional domains only if a specific gap is hit
4. Never load all domains as a "safety net"
