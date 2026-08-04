# AI-Powered PDF Extraction — How It Works & How to Set It Up

> **Important discovery first:** this app *already has* the generic AI layer you're thinking of.
> It lives in `supabase/functions/pdf-ocr/index.ts` and is wired into the import flow via
> `src/components/modals/PdfConverterOverlay.tsx`. It currently uses **Anthropic (Claude)**
> as the vision provider, with a pluggable design so **OpenAI can be added as a provider**
> without touching any frontend code. This document explains the whole system, what API
> keys are, how to get one (OpenAI or Anthropic), and how to enable/extend the AI layer.

---

## 1. The Problem: Why Local PDF Parsing Doesn't Scale

PDF parsing today happens in two tiers:

**Tier 1 — Native text extraction (`src/utils/pdfParser.ts` + `src/utils/pdfTableExtract.ts`)**

- Uses the `pdfjs-dist` package (Mozilla's PDF.js) to read the raw text runs inside the PDF,
  each with its x/y coordinates on the page.
- `pdfTableExtract.ts` then reconstructs the transaction table using **geometry + regex
  heuristics**: it looks for rows of text at the same vertical position, detects the header
  row by matching words like "Date", "Debit", "Credit", "Balance", classifies cells as
  date-like or amount-like with regular expressions, and filters out boilerplate
  ("customer care", "page 1 of 3", disclaimers…).

**Why this isn't scalable:**

1. **Every bank formats statements differently.** The heuristics encode assumptions
   (header words, date formats, column alignment). A new bank with an unusual layout means
   editing regexes and shipping a new build — forever playing whack-a-mole.
2. **Scanned PDFs contain no text at all.** Many statements are just photographs/scans of
   paper. `pdfjs-dist` finds zero text runs, so the geometric approach gets nothing.
3. **Merged/wrapped cells, multi-line narrations, and multi-page tables** break positional
   logic in subtle ways that regexes can't anticipate.
4. **No understanding, only pattern-matching.** The parser can't reason "this column is
   obviously the balance because it always equals previous balance ± amount."

**Tier 2 — the AI (OCR) fallback** solves all four problems and is already implemented.
When the native parser fails or produces a low-confidence guess, the app sends a
*picture* of each page to a vision-capable AI model that reads it like a human would.

---

## 2. What Is an API Key?

An **API key** is a secret token (a long random string, e.g. `sk-proj-AbC123…`) that
identifies and authenticates your account when your code calls a third-party service over
the internet. Think of it as a password for programs instead of people:

- When the app calls the AI provider's API, it sends the key in a request header.
- The provider checks the key, knows it's *your* account, processes the request, and
  **bills your account** for the usage (these APIs are pay-per-use, priced per "token" —
  roughly per word/image-chunk processed).
- Anyone who has your key can spend your money — so keys must be kept **secret**:
  - ✅ Stored as a **Supabase Edge Function secret** (server-side, invisible to users).
  - ❌ Never in frontend code, never committed to git, never in `VITE_*` env vars
    (anything prefixed `VITE_` is bundled into the public JavaScript!).

This is exactly why the AI call lives in a **Supabase Edge Function** rather than in the
React app: the browser never sees the key.

### How to get an OpenAI API key

1. Go to <https://platform.openai.com> and sign up / log in.
2. Add a payment method under **Settings → Billing** (a few dollars of credit is plenty —
   extracting a statement page costs fractions of a cent).
3. Go to **Settings → API keys** (or <https://platform.openai.com/api-keys>) →
   **Create new secret key**. Give it a name like `church-finance-pdf-ocr`.
4. Copy the key immediately — it is shown **only once**. It looks like `sk-proj-…`.
5. Store it as a Supabase secret (see §5). Never paste it into the repo.

### How to get an Anthropic API key (the provider currently wired in)

1. Go to <https://console.anthropic.com> and sign up / log in.
2. Add billing under **Settings → Billing**.
3. **Settings → API Keys → Create Key**. It looks like `sk-ant-…`.
4. Same secrecy rules apply.

You only need **one** provider's key to make the AI layer work.

---

## 3. How the Solution Works, End to End

```
User drops a PDF on the Import page
        │
        ▼
PdfConverterOverlay.tsx
        │
        ├─ 1. Try native extraction:  parsePDF(file)          [pdfjs-dist, free, instant]
        │       └─ pdfTableExtract finds header + rows geometrically
        │
        ├─ 2. Good result? (real table detected, or ≥ 5 rows)
        │       └─ YES → done. Method badge shows "native".
        │
        └─ 3. NO (scanned PDF / weird layout) → AI pipeline:
                │
                ├─ renderPageToBase64()  (pdfPageRenderer.ts)
                │     renders each page to a PNG image at 2× scale
                │     using pdfjs + an offscreen <canvas>
                │
                ├─ for each page:  supabase.functions.invoke('pdf-ocr', { image, pageNumber })
                │
                │         Edge Function (supabase/functions/pdf-ocr/index.ts)
                │         ├─ verifies the caller is a logged-in user (JWT check)
                │         ├─ sends the image + extraction prompt to the AI provider
                │         │     "You are a financial document parser. Extract ALL tabular
                │         │      data… return ONLY JSON: { headers, rows, confidence, warnings }"
                │         └─ parses the model's JSON reply and returns it
                │
                └─ pages are merged; rows land in the same review grid the
                   native path uses. Method badge shows "OCR".
                   Per-cell confidence scores (0.0–1.0) let the UI flag
                   uncertain values for human review before import.
```

Key properties of the design:

- **AI is a fallback, not the default.** Clean digital PDFs are parsed locally for free in
  milliseconds; the AI is only paid for when heuristics fail. Users can also force it with
  the **"Re-extract with OCR"** button.
- **Vision, not text.** The model receives a *screenshot* of the page, so it handles
  scanned statements, any bank's layout, wrapped cells, stamps, and handwriting — no
  per-bank rules needed. This is what makes it scalable.
- **Structured output contract.** The prompt demands strict JSON
  (`headers / rows / confidence / warnings`) with "preserve values EXACTLY, no
  inferences", so the AI acts as a transcriber, not an author — important for financial
  data integrity.
- **Human in the loop.** Extracted rows always pass through the import review grid; low
  confidence cells carry warnings. Nothing enters the ledger unreviewed.
- **Provider-agnostic.** The edge function selects its provider from the `OCR_PROVIDER`
  env var via a small factory (`getProvider()`), so swapping AI vendors is a
  server-side config change with zero frontend changes.

---

## 4. Where OpenAI Fits In

**The OpenAI provider is implemented** in `supabase/functions/pdf-ocr/index.ts` as
`openaiProvider`, alongside the existing `anthropicProvider`. It calls OpenAI's
Chat Completions API with the vision-capable **`gpt-4o-mini`** model (cheap and accurate;
change one line to `gpt-4o` for maximum accuracy), passes the page screenshot as a
`data:` image URL, and uses `response_format: { type: 'json_object' }` so the model is
forced to return valid JSON.

Which provider actually runs is decided at runtime by the **`OCR_PROVIDER`** secret:

| `OCR_PROVIDER` value | Provider used | Key it needs |
|---|---|---|
| `openai` | OpenAI `gpt-4o-mini` | `OPENAI_API_KEY` |
| `anthropic` *(default when unset)* | Claude Haiku | `ANTHROPIC_API_KEY` |

Both providers share the same `EXTRACTION_PROMPT` and return the same
`{ headers, rows, confidence, warnings }` shape, so `PdfConverterOverlay.tsx`,
`pdfPageRenderer.ts`, and the import grid need **zero changes** when switching.

---

## 5. Where to Set the API Key (Setup / Deployment)

The key is **never** put in the code, the repo, or `.env.local`. It lives in your
Supabase project's **Edge Function secrets**, which only the server-side function can
read. There are two equivalent ways to set it — pick one:

### Option A — Supabase Dashboard (no terminal needed)

1. Open <https://supabase.com/dashboard> and select this project.
2. In the left sidebar go to **Edge Functions → Secrets**
   (on some dashboard versions: **Project Settings → Edge Functions → Secrets**).
3. Click **Add new secret** and create:
   - Name: `OPENAI_API_KEY` — Value: your `sk-proj-…` key from §2
   - Name: `OCR_PROVIDER` — Value: `openai`
4. Save. Secrets take effect on the next function invocation — no redeploy needed
   just for changing a secret.

### Option B — Supabase CLI

```bash
# 1. Store the secret key server-side
supabase secrets set OPENAI_API_KEY=sk-proj-...
supabase secrets set OCR_PROVIDER=openai

# (To use Anthropic instead: set ANTHROPIC_API_KEY and either
#  set OCR_PROVIDER=anthropic or leave OCR_PROVIDER unset — it's the default.)

# 2. Deploy the edge function (needed once after the code change)
supabase functions deploy pdf-ocr
```

> ⚠️ The one-time **deploy** step above is required after the provider code change,
> regardless of whether you set secrets via dashboard or CLI.

That's it. The frontend already:
- detects when native parsing fails and calls the function automatically,
- shows per-page progress ("OCR: page 2 of 5…"),
- offers manual "Re-extract with OCR",
- surfaces model warnings + confidence in the review grid.

---

## 6. Costs, Limits & Practical Notes

- **Cost scale:** a statement page image sent to `gpt-4o-mini` or Claude Haiku costs on
  the order of **$0.001–0.01 per page**. Even heavy monthly imports are pennies.
- **Rate limits:** new API accounts have modest requests-per-minute limits; the pipeline
  processes pages sequentially, which stays comfortably inside them.
- **Privacy:** page images (which contain real transactions) are sent to the AI provider.
  Both OpenAI and Anthropic contractually do **not** train on API traffic, but this should
  be understood/accepted by the organisation. The JWT check in the edge function ensures
  only logged-in app users can trigger calls (i.e., nobody can burn your credits from
  outside the app).
- **Failure behaviour:** if the key is missing/invalid or the provider is down, the edge
  function returns `{ ok: false, error }`; the overlay surfaces the error and the user
  still has the native-extraction result or CSV/Excel import as fallback.
- **Encrypted PDFs:** unsupported encryption is caught *before* any AI call
  (`throwAsPdfError` in `pdfParser.ts`) with user-facing remediation steps.

---

## 7. File Map

| File | Role |
|---|---|
| `src/utils/pdfParser.ts` | Native text extraction via `pdfjs-dist`; password/encryption errors |
| `src/utils/pdfTableExtract.ts` | Heuristic (geometry + regex) table reconstruction — the non-scalable part the AI layer backstops |
| `src/utils/pdfPageRenderer.ts` | Renders PDF pages → base64 PNG for the AI |
| `src/components/modals/PdfConverterOverlay.tsx` | Orchestrates native → AI fallback, progress UI, review grid |
| `supabase/functions/pdf-ocr/index.ts` | **The AI layer**: auth, provider factory, prompt, JSON parsing |
