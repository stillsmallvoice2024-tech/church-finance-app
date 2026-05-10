# Project Context System — Operating Manual

> **Reusable across projects.** This document describes the AI memory architecture used in this repository. Adapt the domain files to match your project's subsystems.

---

## System Purpose

A modular AI context architecture that:
- Keeps startup token cost minimal
- Loads domain knowledge only when needed
- Separates permanent rules from archive/debugging content
- Scales cleanly with project growth
- Preserves reasoning precision across long sessions

---

## File Map

| File | Role | Load Trigger |
|---|---|---|
| `CLAUDE.md` | Always-loaded startup context | Automatic (every session) |
| `determine-domain.md` | Context routing skill | When scoping task domain |
| `m-maintenance.md` | Memory governance skill | When updating project memory |
| `ledger-rules.md` | Financial/ledger domain | Ledger, transactions, allocations, FX |
| `ui-rules.md` | Frontend/UI domain | UI, components, styling, forms |
| `import-rules.md` | Import pipeline domain | CSV/Excel/PDF import |
| `auth-rules.md` | Auth & roles domain | Auth flows, roles, RLS, invites |
| `db-rules.md` | Database & migration domain | Schema, migrations, audit trail |
| `miscellaneous.md` | Archive / reference only | Debugging, history, edge cases only |

---

## Design Principles

### 1. CLAUDE.md is the only always-loaded file
Contains only: tech stack, build commands, project structure, global architecture principles.
Everything subsystem-specific moves to a domain file.
**Target: under 800 words.**

### 2. Domain files are loaded on demand
Each domain file contains the permanent, reusable rules for one architectural subsystem.
They are never loaded speculatively — only when the task matches.

### 3. miscellaneous.md is archive, not context
Debugging history, workarounds, implementation history, and TODOs go here.
It is explicitly excluded from active reasoning unless the user requests it.

### 4. m-maintenance.md governs memory updates
All new information is classified and routed before storage.
Prevents CLAUDE.md bloat. Enforces deduplication and compression.

### 5. determine-domain.md governs context loading
Provides a trigger table and protocol for loading the minimum required domain files.
Prevents over-loading context for narrow tasks.

---

## Workflow

### Starting a task
1. Read the task description
2. Use `determine-domain.md` to identify required domain files
3. Load only those files
4. Complete the task

### After a task
1. Identify any new architectural knowledge gained
2. Use `m-maintenance.md` routing table to classify it
3. Store in the correct domain file
4. Compress before writing — bullets, not prose
5. Never add implementation noise to CLAUDE.md

---

## Domain File Template

Use this structure for any new domain file:

```markdown
# [Domain Name] Rules

> Load when tasks involve: [comma-separated trigger keywords].

---

## [Section 1]
- bullet
- bullet

## [Section 2]
- bullet
- bullet
```

---

## Adapting to a New Project

1. **Copy these governance files as-is:**
   - `project-context-system.md` (this file)
   - `m-maintenance.md`
   - `determine-domain.md`
   - `miscellaneous.md`

2. **Write a project-specific `CLAUDE.md`** with:
   - Tech stack
   - Build commands
   - Project structure
   - 6–10 global architecture principles

3. **Analyze the codebase for major subsystems.** For each one that has meaningful, stable rules:
   - Create a `[subsystem]-rules.md` domain file
   - Add it to the routing table in `determine-domain.md`
   - Add it to the routing table in `m-maintenance.md`
   - Add the load trigger to the `CLAUDE.md` Context Loading Rules

4. **Only create domain files for real subsystems** — avoid files for trivial features.

---

## Estimated Token Budget

| File | Approx. Tokens | Load Frequency |
|---|---|---|
| `CLAUDE.md` | ~450 | Every session |
| `ledger-rules.md` | ~650 | Financial tasks |
| `ui-rules.md` | ~550 | UI tasks |
| `import-rules.md` | ~450 | Import tasks |
| `auth-rules.md` | ~400 | Auth tasks |
| `db-rules.md` | ~500 | Schema/migration tasks |
| `determine-domain.md` | ~300 | Domain scoping |
| `m-maintenance.md` | ~350 | Memory updates |
| `miscellaneous.md` | ~650 | Debugging only |

**Typical session cost:** ~450 (CLAUDE.md) + 1–2 domain files (~500–1,000) = **~1,000–1,500 tokens of context**
vs. loading everything: ~4,300 tokens

**Estimated reduction: ~65–75% of context tokens per session** vs. a monolithic CLAUDE.md.

---

## Growth Rules

- If any domain file exceeds ~1,000 tokens: consider splitting it
- If CLAUDE.md exceeds ~800 words: audit and move domain content out
- If miscellaneous.md exceeds ~1,500 tokens: archive old entries or delete resolved items
- Review domain file routing quarterly as the project evolves

---

## Recommended Workflow Going Forward

1. **Always start from `determine-domain.md`** — don't load files speculatively
2. **Always end with `m-maintenance.md`** — classify and store new knowledge
3. **Never write prose in domain files** — dense bullets only
4. **Never add debugging history to CLAUDE.md** — that's what miscellaneous.md is for
5. **Add new domains when a subsystem reaches ~5+ distinct permanent rules**
