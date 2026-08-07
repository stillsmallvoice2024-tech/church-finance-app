# AI-Powered PDF Extraction — A Simple Guide

This app lets users upload a bank statement PDF and turns it into rows of
transactions. This guide explains how that works, why plain code alone can't do
it well, and how AI (OpenAI or Anthropic) fixes the problem.

**Good news:** the AI part is already built into the app. You only need to add
an API key to switch it on. This guide shows you where.

---

## 1. The Problem: Reading PDFs with Plain Code Is Fragile

When a user uploads a PDF, the app first tries to read it **without** AI:

1. `src/utils/pdfParser.ts` uses a package called **pdfjs-dist** to pull every
   piece of text out of the PDF, along with its position on the page
   (x/y coordinates).
2. `src/utils/pdfTableExtract.ts` then tries to rebuild the transaction table
   from those positions. It guesses which line is the header by searching for
   words like "Date", "Debit", "Credit", and uses pattern-matching rules
   (regular expressions) to decide if a cell looks like a date or an amount.

This works for clean, well-behaved PDFs. But it breaks easily:

- **Every bank designs statements differently.** Our rules assume certain
  header words and layouts. A new bank with a different design means writing
  new rules — again and again, forever.
- **Scanned PDFs contain no text at all.** If a statement is a photo or scan of
  paper, pdfjs-dist finds nothing to extract. The code gets zero rows.
- **Messy layouts confuse it.** Descriptions that wrap onto two lines, merged
  columns, or tables split across pages break the position-based guessing.
- **The code doesn't understand anything.** It only matches patterns. It can't
  think "this column must be the balance" the way a person can.

In short: rule-based parsing can't scale to every bank in the world.

---

## 2. The Solution: Let an AI *Look* at the Page

The fix is simple to describe: **take a screenshot of each PDF page and show it
to an AI model that can see images** (like OpenAI's GPT-4o or Anthropic's
Claude). The AI reads the page the same way a human would, so it doesn't care
which bank made the statement, whether it's scanned, or how weird the layout is.

We ask the AI one thing: "Extract the table from this image and give it back as
structured data." It replies with:

```json
{
  "headers": ["Date", "Description", "Credit", "Debit", "Balance"],
  "rows": [["2024-01-15", "Payment received", "5000.00", "", "25000.00"]],
  "confidence": [[1.0, 0.95, 1.0, 1.0, 1.0]],
  "warnings": ["Row 3 reference number partially obscured"]
}
```

Two safety rules keep the financial data trustworthy:

- The AI is told to copy values **exactly as they appear** — no guessing, no
  "fixing" numbers.
- Every cell comes with a **confidence score** (0.0 = unreadable, 1.0 = crystal
  clear). Low-confidence cells get flagged so a human can double-check them
  before anything is imported.

---

## 3. What Is an API Key?

To use OpenAI's (or Anthropic's) AI, our code sends requests over the internet
to their servers. An **API key** is how they know the request came from *our*
account. Think of it as a password for programs:

- It's a long random string, e.g. `sk-proj-AbC123...`
- Our server includes it with every AI request.
- The provider checks it, runs the request, and **charges our account** a tiny
  fee (these services are pay-as-you-go).

Because anyone holding the key can spend our money, it must stay **secret**:

- ✅ Store it in Supabase's secret storage (server-side — users can never see it).
- ❌ Never put it in the React code, never commit it to git, never put it in a
  `VITE_...` variable (everything starting with `VITE_` ends up in the public
  JavaScript that every visitor can read!).

That's exactly why the AI call happens inside a **Supabase Edge Function**
(a small piece of server code) instead of in the browser.

### Getting an OpenAI API key (step by step)

1. Go to <https://platform.openai.com> and create an account (or log in).
2. Add a payment card under **Settings → Billing**. A few dollars is plenty —
   one statement page costs a fraction of a cent.
3. Go to <https://platform.openai.com/api-keys> → **Create new secret key**.
   Name it something like `church-finance-pdf-ocr`.
4. **Copy the key right away** — OpenAI shows it only once.
5. Put it into Supabase (see section 6). Don't paste it anywhere else.

### Getting an Anthropic API key (the alternative provider)

Same idea: <https://console.anthropic.com> → add billing → **Settings →
API Keys → Create Key**. Anthropic keys start with `sk-ant-...`.

You only need **one** of the two keys.

---

## 4. How the Whole Flow Works

Here is the journey of an uploaded PDF, start to finish:

```
User uploads a PDF on the Import page
        │
        ▼
Step 1: Try the free, instant way first
        parsePDF() reads the text with pdfjs-dist and
        tries to rebuild the table with position rules.
        │
        ├── It worked (a real table was found)?
        │        → Done! No AI needed, nothing spent.
        │
        └── It failed (scanned PDF or strange layout)?
                 → Go to Step 2.

Step 2: The AI fallback
        a. pdfPageRenderer.ts draws each PDF page onto an
           invisible canvas and saves it as a PNG image.
        b. Each image is sent to our Supabase Edge Function
           ("pdf-ocr") — with a progress bar in the UI:
           "OCR: page 2 of 5…"
        c. The edge function checks the user is logged in,
           then sends the image + instructions to the AI
           (OpenAI or Anthropic, whichever is configured).
        d. The AI returns the JSON table shown in section 2.

Step 3: Human review
        All extracted rows (from either path) appear in the
        same review grid. Low-confidence cells are flagged.
        Nothing enters the ledger until a person approves it.
```

Why this design is good:

- **AI is a fallback, not the default.** Clean PDFs are parsed locally for
  free. You only pay for AI when the free way fails. (There's also a
  "Re-extract with OCR" button to force the AI path manually.)
- **The key never leaves the server.** The browser sends images to *our* edge
  function; only the edge function talks to the AI provider.
- **Swapping AI vendors is a settings change**, not a code rewrite (see next
  section).

---

## 5. Where OpenAI Fits in the Code

All the AI logic lives in **one file**:
`supabase/functions/pdf-ocr/index.ts`. It contains:

- `EXTRACTION_PROMPT` — the instructions we send to the AI.
- `anthropicProvider()` — sends the image to Anthropic (Claude Haiku).
- `openaiProvider()` — sends the image to OpenAI (`gpt-4o-mini`, a cheap
  vision model; change one line to `gpt-4o` if you want maximum accuracy).
- `getProvider()` — picks which one to use, based on a setting called
  `OCR_PROVIDER`.

| If `OCR_PROVIDER` is set to… | The AI used is… | The key you must set is… |
|---|---|---|
| `openai` | OpenAI gpt-4o-mini | `OPENAI_API_KEY` |
| `anthropic` (or not set at all) | Claude Haiku | `ANTHROPIC_API_KEY` |

Both providers receive the same instructions and return the same JSON shape,
so **nothing else in the app changes** when you switch between them.

---

## 6. Where to Set the API Key

The key goes into your **Supabase project's Edge Function secrets** — a safe
server-side storage that only your edge functions can read. Two ways to do it:

### Option A — Supabase website (easiest, no terminal)

1. Open <https://supabase.com/dashboard> and click this project.
2. In the left sidebar: **Edge Functions → Secrets**
   (on some versions: **Project Settings → Edge Functions → Secrets**).
3. Click **Add new secret** and add these two:

   | Name | Value |
   |---|---|
   | `OPENAI_API_KEY` | your `sk-proj-...` key from section 3 |
   | `OCR_PROVIDER` | `openai` |

4. Save. New secrets are picked up automatically on the next PDF upload.

### Option B — Terminal (Supabase CLI)

```bash
supabase secrets set OPENAI_API_KEY=sk-proj-...
supabase secrets set OCR_PROVIDER=openai
```

### One-time deploy

After the edge function's *code* changes (like adding the OpenAI provider),
it must be deployed once:

```bash
supabase functions deploy pdf-ocr
```

Changing only secrets never requires a redeploy.

---

## 7. Cost, Privacy & What Happens When Things Fail

- **Cost:** roughly **$0.001–$0.01 per page**. A month of heavy statement
  imports costs pennies.
- **Privacy:** the page images (which show real transactions) are sent to
  OpenAI/Anthropic. Both companies state they do **not** train their models on
  API data, but the organisation should be aware of and okay with this.
- **Security:** the edge function checks the caller's login token first, so
  only signed-in users of the app can trigger AI calls (strangers can't burn
  your credits).
- **If the AI fails** (bad key, provider outage): the user sees a clear error
  and can still fall back to the free parser's result, or import a CSV/Excel
  file instead. Nothing crashes.
- **Password-protected PDFs** are handled before any AI is involved — the app
  asks for the password, and explains what to do if the encryption can't be
  opened at all.

---

## 8. Quick File Map

| File | What it does |
|---|---|
| `src/utils/pdfParser.ts` | Free path: pulls text out of the PDF with pdfjs-dist |
| `src/utils/pdfTableExtract.ts` | Free path: rebuilds the table with position + pattern rules (the fragile part the AI backs up) |
| `src/utils/pdfPageRenderer.ts` | Turns PDF pages into PNG images for the AI |
| `src/components/modals/PdfConverterOverlay.tsx` | The UI: tries the free path, falls back to AI, shows progress and results |
| `supabase/functions/pdf-ocr/index.ts` | **The AI layer**: login check, the prompt, the OpenAI & Anthropic providers |
