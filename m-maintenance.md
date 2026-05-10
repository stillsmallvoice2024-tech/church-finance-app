# Memory Maintenance Rules

> This file governs how project memory is maintained across all context files.
> Load when making decisions about where to store new information.

---

## Core Rules

* CLAUDE.md must remain minimal, high-signal, and globally relevant only.
* Do not allow CLAUDE.md to become a documentation dump.
* Load only files relevant to the active task.
* Avoid loading `miscellaneous.md` unless explicitly necessary.

---

## Routing Rules

* Financial and ledger rules → `ledger-rules.md`
* UI/component conventions → `ui-rules.md`
* Import pipeline behavior → `import-rules.md`
* Debugging history, edge cases, temporary notes, experimental ideas → `miscellaneous.md`

---

## Information Classification Rules

When updating project memory, classify information BEFORE storing it.

### Store in CLAUDE.md ONLY if the information is:

- Globally relevant across the entire application
- Required in nearly every session
- Architectural and permanent
- Unlikely to change frequently
- Essential for startup reasoning

Examples: stack, naming conventions, universal architecture principles, global coding standards, permanent business constraints.

**If uncertain, do NOT store in CLAUDE.md.**

---

### Store in `ledger-rules.md` if the information relates to:

- Financial propagation
- Debit/credit behavior
- Ledger balancing
- Reversals
- Transaction integrity
- Financial calculations
- Category/bank ledger relationships

---

### Store in `ui-rules.md` if the information relates to:

- Frontend architecture
- Component conventions
- Dialogs/tables/forms
- Styling systems
- Reusable UI behavior
- Frontend state patterns

---

### Store in `import-rules.md` if the information relates to:

- CSV/Excel/PDF ingestion
- Transaction importing
- Deduplication
- Normalization
- Import validation
- Import propagation behavior

---

### Store in `miscellaneous.md` if the information is:

- Debugging history
- Temporary workaround
- Unresolved edge case
- Implementation history
- Feature explanation
- Exploratory reasoning
- TODO
- Verbose explanation
- Unstable architecture
- Experimental logic

---

## Exclusion Rules

Do NOT store:

- Temporary conversational reasoning
- Dead debugging paths
- Duplicated information
- Implementation noise
- Obvious code-derived details
- Large code snippets unless permanently important

---

## Compression Rules

- Prefer dense bullets
- Compress long explanations
- Preserve conclusions over reasoning history
- Store principles, not conversations
- Minimize token footprint aggressively

---

## Growth Control

- If CLAUDE.md exceeds ~800 words, audit and move domain-specific content into supporting files
- Deduplicate aggressively across all memory files
- Never place large code examples in CLAUDE.md — keep implementation examples inside relevant domain files

---

## Maintenance Behavior

Whenever updating project memory:

1. Classify information before saving
2. Store information in the narrowest relevant file
3. Keep startup context lightweight
4. Preserve information while minimizing active token usage
