# Project Context System

> **Executable skill.** When called on any project, follow the procedure below to analyze the codebase and generate a complete, project-specific context architecture.
> This project's instantiation is recorded in the **Current Project File Map** section at the bottom.

---

## Purpose

Generate a modular AI memory architecture for any software project that:
- Minimizes startup token cost (lean `CLAUDE.md` only)
- Loads domain knowledge on demand
- Separates permanent rules from debugging archive
- Scales cleanly as the project grows
- Preserves reasoning precision across long sessions

---

## Initialization Procedure

When called on a new project, execute these steps in order.

### Step 1 — Analyze the Codebase

Read the following to understand the project architecture:
- Root directory listing
- `package.json` / `pyproject.toml` / `Cargo.toml` (or equivalent) — stack, scripts, dependencies
- `README.md` if present
- Source directory structure (2–3 levels deep)
- Any existing `CLAUDE.md` or context files
- Key entry points (router, main app file, server entrypoint)
- Database schema file if present
- CI/build config if present

### Step 2 — Identify the Tech Stack

Extract and record:
- Language and version
- UI framework (if any)
- Backend framework or runtime
- Database / storage layer
- Build tool
- Key libraries (state management, forms, auth, etc.)
- Deployment platform

### Step 3 — Identify Major Subsystems

A subsystem qualifies for its own domain file if it meets **at least 3** of these:
- Has distinct architectural rules not obvious from the code
- Has non-trivial constraints that would surprise a new contributor
- Has its own data flow, lifecycle, or propagation behavior
- Has permanent conventions (naming, patterns, restrictions)
- Has error-prone edge cases worth preserving
- Spans multiple files and requires coordinated knowledge

**Common subsystem candidates:**
| Candidate | Create file if... |
|---|---|
| Authentication / Auth | Has roles, gating patterns, flows, session handling |
| Database / Migrations | Has migration strategy, schema conventions, RLS/policy patterns |
| Financial / Ledger | Has propagation logic, balance rules, audit requirements |
| Import / Ingestion | Has parsing logic, deduplication, normalization rules |
| UI / Frontend | Has component conventions, styling system, shared patterns |
| Reporting / Analytics | Has aggregation logic, filter conventions, data shaping |
| Notifications | Has delivery channels, trigger rules, deduplication |
| Billing / Payments | Has provider integration, lifecycle, webhook handling |
| API / Integrations | Has auth patterns, rate limits, error handling conventions |
| Background Jobs | Has queue patterns, retry logic, idempotency rules |

Do **not** create a domain file for:
- Simple CRUD with no special logic
- Features fully described by one or two obvious code patterns
- Anything covered adequately in `CLAUDE.md` global principles

### Step 4 — Generate `CLAUDE.md`

Write a lean `CLAUDE.md` containing **only**:
1. One-line app description + repo/deploy info
2. Context Loading Rules — list each domain file with its load trigger
3. Tech stack table
4. Build/run commands
5. Env variables (names only, not values)
6. Project directory structure (condensed tree)
7. Global architecture principles (6–10 universal bullets only)

**Exclude from CLAUDE.md:** subsystem-specific logic, DB schema tables, auth flow details, migration instructions, debugging history, large examples, implementation walkthroughs.

**Target: under 800 words.**

### Step 5 — Generate Domain Files

For each identified subsystem, create `[subsystem]-rules.md` containing:
- Load trigger line (top of file, italicized blockquote)
- Subsystem-specific architecture rules
- Permanent conventions and constraints
- Critical relationships to other subsystems
- Error-prone patterns worth flagging

Use the domain file template below. Write dense bullets — no prose paragraphs.

### Step 6 — Generate `determine-domain.md`

Write a domain trigger table mapping keywords → domain files specific to this project. Include:
- One row per domain file
- Keywords drawn from actual project terminology
- Multi-domain examples using real task descriptions from this codebase
- Ambiguity protocol

### Step 7 — Generate `m-maintenance.md`

Write the memory governance skill with a routing table specific to this project's domain files. Include:
- Full routing table (all domain files + miscellaneous)
- CLAUDE.md threshold rules
- Compression and deduplication rules
- Maintenance behavior checklist

### Step 8 — Generate `miscellaneous.md`

Create a minimal `miscellaneous.md` with:
- Header warning (archive only, do not load as startup context)
- Reference to all active domain files
- Any edge cases or workarounds already discovered during analysis

### Step 9 — Update This File

Add this project's generated file map to the **Current Project File Map** section below.

---

## Domain File Template

```markdown
# [Domain Name] Rules

> Load when tasks involve: [comma-separated trigger keywords].

---

## [Section Title]
- rule
- rule

## [Section Title]
- rule
- rule
```

---

## Design Principles (Apply to Every Project)

- **CLAUDE.md** is the only always-loaded file — keep it global and lean
- **Domain files** load on demand — never speculatively
- **miscellaneous.md** is archive only — never active reasoning context
- **m-maintenance.md** governs all memory writes — classify before storing
- **determine-domain.md** governs all context loads — load minimum required
- One domain file per subsystem — avoid overlap
- Dense bullets over prose in all files
- Conclusions over reasoning history

---

## Session Workflow (Apply to Every Project)

**Starting any task:**
1. Read task description
2. Use `determine-domain.md` to identify required domain files
3. Load only those files
4. Complete the task

**After any task:**
1. Identify new architectural knowledge gained
2. Use `m-maintenance.md` routing table to classify it
3. Write to the correct domain file — compressed, deduplicated
4. Never add to `CLAUDE.md` unless it is truly global

---

## Growth Rules (Apply to Every Project)

- Domain file exceeds ~1,000 tokens → consider splitting
- `CLAUDE.md` exceeds ~800 words → audit and push content to domain files
- `miscellaneous.md` exceeds ~1,500 tokens → delete resolved items
- New subsystem reaches 5+ distinct permanent rules → create a domain file

---

## Current Project File Map — Church Finance App

| File | Role | Load Trigger |
|---|---|---|
| `CLAUDE.md` | Always-loaded startup context | Automatic (every session) |
| `determine-domain.md` | Context routing skill | When scoping task domain |
| `m-maintenance.md` | Memory governance skill | When updating project memory |
| `ledger-rules.md` | Financial/ledger domain | Ledger, transactions, allocations, FX, propagation |
| `ui-rules.md` | Frontend/UI domain | UI, components, styling, forms, modals |
| `import-rules.md` | Import pipeline domain | CSV/Excel/PDF import, parsing, deduplication |
| `auth-rules.md` | Auth & roles domain | Auth flows, roles, RLS, invites, password reset |
| `db-rules.md` | Database & migration domain | Schema, migrations, audit trail, Supabase setup |
| `miscellaneous.md` | Archive / reference only | Debugging, history, edge cases — explicit request only |
