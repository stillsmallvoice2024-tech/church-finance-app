// Edge Function: pdf-ocr
// Accepts a base64-encoded PDF page image and extracts financial table data.
// Swap OCR_PROVIDER env var to change providers without touching frontend code.
//
// Deploy: supabase functions deploy pdf-ocr
// Required env vars: ANTHROPIC_API_KEY
// Optional:          OCR_PROVIDER (default: 'anthropic')

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const OCR_PROVIDER         = Deno.env.get('OCR_PROVIDER') ?? 'anthropic'
const ANTHROPIC_API_KEY    = Deno.env.get('ANTHROPIC_API_KEY')

// ── Types ─────────────────────────────────────────────────────────────────────

interface OcrResult {
  headers: string[]
  rows: string[][]
  confidence: number[][]
  warnings: string[]
}

type OcrProviderFn = (image: string, mimeType: string) => Promise<OcrResult>

// ── Anthropic provider ────────────────────────────────────────────────────────

const EXTRACTION_PROMPT = `You are a financial document parser. Extract ALL tabular data from this bank statement or financial document image.

Return ONLY valid JSON — no explanation, no markdown fences — in this exact structure:
{
  "headers": ["Date", "Description", "Credit", "Debit", "Balance", "Reference"],
  "rows": [["2024-01-15", "Payment received", "5000.00", "", "25000.00", "TXN123"]],
  "confidence": [[1.0, 0.95, 1.0, 1.0, 1.0, 0.85]],
  "warnings": ["Row 3 reference number partially obscured"]
}

Rules:
- Extract column headers directly from the document; if none are visible use descriptive names
- Preserve ALL cell values EXACTLY as they appear — no corrections, no inferences, no reformatting
- Preserve currency symbols, date formats, reference numbers and account numbers exactly
- confidence is 0.0–1.0 per cell: 1.0 = clearly readable, 0.0 = completely illegible
- Empty cells must be ""
- Set confidence < 0.7 for uncertain cells and add a warning entry for each such cell
- Do NOT include the header row in the rows array
- If no table is found, return empty arrays and add a descriptive warning

Page furniture — extract the table ONLY:
- Everything outside the table's ruled body is page furniture: page numbers
  ("Page 1 of 8"), support phone numbers, e-mail addresses, website URLs,
  bank addresses, straplines, logos, and legal disclaimers
- NEVER merge page furniture into a transaction row, even when it sits directly
  beneath, above or beside the last row on the page
- NEVER emit a row that consists of page furniture
- A transaction row's cells come from that row's columns only. If the last row
  on the page looks like it also contains a footer, the footer is NOT part of it
- A cell may legitimately span several lines when its text wraps inside the
  column — keep those wrapped lines together. Wrapped text stays within the
  column's horizontal bounds; footers do not`

async function anthropicProvider(image: string, mimeType: string): Promise<OcrResult> {
  if (!ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not configured')

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':          ANTHROPIC_API_KEY,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      // Adaptive thinking is the default on this model; stated explicitly because
      // reading a statement table off a page image is exactly the kind of work it
      // helps with — deciding which column a right-aligned figure belongs to, and
      // whether a block below the last row is a transaction or a footer.
      thinking:      { type: 'adaptive' },
      output_config: { effort: 'high' },
      // max_tokens caps thinking AND response text together. A full page of
      // transactions plus its per-cell confidence array is already sizeable, so
      // the previous 4096 would now truncate mid-JSON and fail the parse.
      max_tokens: 16000,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
          { type: 'text',  text: EXTRACTION_PROMPT },
        ],
      }],
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Anthropic API error ${res.status}: ${body.slice(0, 200)}`)
  }

  const json = await res.json() as { content: Array<{ type: string; text: string }> }
  const text  = json.content.find(c => c.type === 'text')?.text ?? ''

  // Strip optional markdown fences that Claude sometimes adds
  const stripped   = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  const jsonMatch  = stripped.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('OCR response contained no valid JSON')

  return JSON.parse(jsonMatch[0]) as OcrResult
}

// ── Provider factory ──────────────────────────────────────────────────────────
// To add a new provider: implement an async function matching OcrProviderFn,
// then add a case here and set OCR_PROVIDER in your Supabase project secrets.

function getProvider(): OcrProviderFn {
  switch (OCR_PROVIDER) {
    case 'anthropic': return anthropicProvider
    // case 'mistral':   return mistralProvider
    default: throw new Error(`Unknown OCR_PROVIDER: "${OCR_PROVIDER}"`)
  }
}

// ── Request handler ───────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  const { data: { user }, error: authErr } = await service.auth.getUser(authHeader.slice(7))
  if (authErr || !user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { image?: string; mimeType?: string; pageNumber?: number }
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { image, mimeType = 'image/png', pageNumber = 1 } = body
  if (!image) {
    return new Response(JSON.stringify({ ok: false, error: 'image is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Extract ───────────────────────────────────────────────────────────────
  try {
    const result = await getProvider()(image, mimeType)
    return new Response(JSON.stringify({ ok: true, pageNumber, ...result }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[pdf-ocr] page ${pageNumber}:`, msg)
    return new Response(JSON.stringify({ ok: false, error: msg, pageNumber }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }
})
