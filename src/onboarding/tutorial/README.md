# App Tutorial — Maintainer Guide

This folder holds the **full step-by-step user tutorial** shown in the app:

- In the **Help Center modal** → "Tutorial" tab
- On the **full page** at `/tutorial` and `/tutorial/:chapterId` (openable in a separate browser tab)

## Structure

```
src/onboarding/tutorial/
├── README.md            ← this file (not shipped to users)
├── index.ts             ← chapter manifest (order, titles, summaries, updatedAt)
└── chapters/*.md        ← one Markdown file per chapter, imported via Vite ?raw
```

## How to update

- **A feature changed?** Edit the matching `chapters/NN-*.md` file, then bump that
  chapter's `updatedAt` in `index.ts`.
- **New feature/page?** Add a new `chapters/NN-name.md` file and one entry in
  `TUTORIAL_CHAPTERS` in `index.ts` (id, number, title, summary, updatedAt, content import).
  Renumber later chapters only if ordering matters.
- **Removed feature?** Delete the `.md` file and its manifest entry.

## Writing rules

- Audience: a complete beginner (aim for an 8-year-old reading level).
  Short sentences. One action per step. Use the **exact button labels** from the UI in bold.
- Chapter skeleton: "What is this page?" → numbered steps per task →
  "What you'll see" → "If something goes wrong".
- Markdown support is limited to what `src/onboarding/help/markdown.tsx` renders:
  `##` / `###` headings, `**bold**`, `` `code` ``, `- ` bullets, `1. ` numbered lists,
  and `|` tables. **No links, images, blockquotes, or nested lists.**
- Numbered lists must be consecutive lines (no blank lines between items) —
  a blank line restarts the numbering.
