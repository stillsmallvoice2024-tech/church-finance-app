# Memory Maintenance Rules

> Load when making decisions about where to store new information, or when auditing memory files.

---

## Core Rules

- `CLAUDE.md` must remain minimal, high-signal, and globally relevant only
- Store information in the **narrowest** relevant file
- Never load `miscellaneous.md` unless explicitly necessary
- Compress before storing — bullets over prose, conclusions over history

---

## Routing Table

| Information Type | Target File |
|---|---|
| Financial logic, ledger balances, allocations, FX, propagation, debit/credit, reversals | `ledger-rules.md` |
| UI, components, styling, tables, modals, forms, frontend state patterns | `ui-rules.md` |
| CSV/Excel/PDF import pipeline, parsing, deduplication, normalization | `import-rules.md` |
| Auth flows, login, invites, roles, RLS policies, password reset, protected routes | `auth-rules.md` |
| DB schema, table structure, columns, migration SQL, audit trail, Supabase setup | `db-rules.md` |
| Debugging history, edge cases, workarounds, TODOs, implementation history, experimental logic | `miscellaneous.md` |

---

## CLAUDE.md Threshold

Store in `CLAUDE.md` **only** if ALL of these are true:
- Globally relevant across the entire app (not subsystem-specific)
- Required in nearly every session
- Architectural and permanent
- Not already captured in a domain file

**When in doubt: do NOT store in CLAUDE.md.**

---

## Information Classification

### Belongs in CLAUDE.md
- Tech stack
- Build commands
- Universal architecture principles (applies project-wide)
- Global coding standards
- Permanent cross-cutting constraints

### Belongs in a domain file
- Subsystem-specific rules, patterns, constraints
- Component conventions (ui-rules.md)
- Financial propagation logic (ledger-rules.md)
- Import pipeline behavior (import-rules.md)
- Auth implementation details (auth-rules.md)
- Schema and migration details (db-rules.md)

### Belongs in miscellaneous.md
- Debugging sessions and resolutions
- Temporary workarounds
- Implementation history ("why we changed X")
- Edge cases not yet resolved
- TODOs
- Verbose explanations
- Experimental logic

### Do not store
- Temporary conversational reasoning
- Dead debugging paths
- Duplicated information already captured elsewhere
- Large code snippets (unless permanently critical)
- Obvious facts derivable from the code

---

## Compression Rules

- Dense bullets preferred over paragraphs
- Preserve conclusions, not the reasoning trail
- Store principles, not conversations
- One bullet per distinct fact
- Remove verbose examples unless they prevent misuse

---

## Growth Control

- If `CLAUDE.md` exceeds ~800 words: audit and move domain-specific content into supporting files
- Deduplicate aggressively across all files before adding new content
- Never place large code examples in `CLAUDE.md`

---

## Maintenance Behavior

When updating memory after any task:
1. Classify new information using the routing table above
2. Store in the narrowest relevant file
3. Compress before writing
4. Check for duplicates across files before adding
5. Keep `CLAUDE.md` as the last place you add content
