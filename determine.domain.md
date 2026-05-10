# Determine Domain Skill

**Purpose:** Determine the minimum necessary domain context required for the active task.

**Goal:** Load only the smallest relevant set of memory/domain files needed for accurate reasoning.

---

## Core Principles

- Minimize active context usage
- Avoid unnecessary cross-domain loading
- Preserve reasoning precision
- Prevent project-wide context pollution
- Prefer narrow scoped reasoning

---

## Domain Classification Rules

### Load `ledger-rules.md` when tasks involve:

- transactions
- propagation
- balances
- debit/credit behavior
- ledgers
- reconciliation
- reversals
- financial calculations
- account/category balance changes

---

### Load `ui-rules.md` when tasks involve:

- frontend
- UI
- styling
- tables
- dialogs
- forms
- components
- layout
- responsiveness
- frontend state behavior

---

### Load `import-rules.md` when tasks involve:

- CSV import
- ingestion
- normalization
- duplicate detection
- import validation
- transaction parsing
- imported transaction propagation

---

## Multi-Domain Rules

Load multiple domain files ONLY if:

- the task clearly crosses subsystem boundaries
- one subsystem directly affects another

**Example:** "Imported transactions are not propagating to category ledgers"

Requires:
- `import-rules.md`
- `ledger-rules.md`

---

## Exclusion Rules

Do NOT load:

- `miscellaneous.md` unless explicitly requested
- Unrelated domain files
- Project-wide architectural context unless necessary

Avoid:

- Broad repository scans
- Unrelated subsystem reasoning
- Historical debugging context

---

## Ambiguity Handling

If task scope is unclear:

1. Start with the smallest likely domain
2. Expand context only if reasoning requires it
3. Prefer incremental retrieval over broad loading

---

## Output Behavior

Before solving:

1. Identify relevant subsystem(s)
2. Load only required domain files
3. Keep reasoning scoped to the active task
