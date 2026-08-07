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

/**
 * Ceiling on the upstream call. Comfortably inside the edge runtime's own
 * execution window so that a slow model response is reported as an error rather
 * than taking the whole function down with it.
 */
const UPSTREAM_TIMEOUT_MS = 55_000

/**
 * Hard ceiling on the base64 image field, before any model call.
 *
 * Each call is a billed request at up to 8,000 tokens, so an uncapped
 * payload is an uncapped bill. 8 MB of base64 is ~6 MB of PNG — far above
 * anything renderPageToBase64 produces for a statement page at the model's
 * resolution cap, and below Anthropic's own 5 MB-per-image decode limit
 * closely enough that oversized input fails here, cheaply, rather than
 * upstream after the request has been paid for.
 */
const MAX_IMAGE_B64_BYTES = 8 * 1024 * 1024

// Browser calls via supabase.functions.invoke send a CORS preflight (OPTIONS)
// because of the custom Authorization/Content-Type headers. Without these
// headers on every response, the preflight fails and the browser never gets
// to send the real POST — surfacing as "Failed to send a request to the
// Edge Function" with no further detail.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

  // Bound the upstream call so it always loses the race against the platform's
  // own execution limit. Being killed mid-request gives the browser a bare
  // "failed to send a request" with no status and no body; failing here instead
  // produces an error the caller can actually show.
  const abort = AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: abort,
      headers: {
        'x-api-key':         ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        // Effort is deliberately low. This is transcription, not reasoning: the
        // table is right there on the page. High effort turned a ~15s call into
        // one long enough for the platform to kill the whole function, which the
        // browser sees only as an unexplained transport failure. Sonnet at low
        // effort still comfortably outperforms the Haiku call this replaced.
        thinking:      { type: 'adaptive' },
        output_config: { effort: 'low' },
        // Caps thinking AND response text together. A page of transactions plus
        // its per-cell confidence array needs headroom over the original 4096,
        // but 16000 invited generations long enough to blow the time budget.
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
            { type: 'text',  text: EXTRACTION_PROMPT },
          ],
        }],
      }),
    })
  } catch (e) {
    // An abort here means the model was still working when the budget ran out.
    // Say so plainly — the caller surfaces this text, and "took too long" points
    // at a different fix than "the request was rejected".
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new Error(
        `Extraction timed out after ${Math.round(UPSTREAM_TIMEOUT_MS / 1000)}s on this page. ` +
        'Retry, or reduce the page image size.',
      )
    }
    throw e
  }

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
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: CORS_HEADERS })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })
  const { data: { user }, error: authErr } = await service.auth.getUser(authHeader.slice(7))
  if (authErr || !user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { image?: string; mimeType?: string; pageNumber?: number; orgId?: string }
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON body' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  const { image, mimeType = 'image/png', pageNumber = 1, orgId } = body
  if (!image) {
    return new Response(JSON.stringify({ ok: false, error: 'image is required' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
  if (!orgId) {
    return new Response(JSON.stringify({ ok: false, error: 'orgId is required' }), {
      status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // ── Size cap ──────────────────────────────────────────────────────────────
  // Before authorisation, because it costs nothing and a malformed client is
  // more likely than a hostile one.
  if (image.length > MAX_IMAGE_B64_BYTES) {
    return new Response(JSON.stringify({
      ok: false, pageNumber,
      error: `Page image is too large (${Math.round(image.length / 1024 / 1024)} MB). ` +
             'Reduce the page image size and retry.',
    }), { status: 413, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }

  // ── Authorise and meter ───────────────────────────────────────────────────
  // orgId comes from the client but is never trusted: consume_ocr_page
  // re-checks membership, role and plan against p_user_id server-side, then
  // increments the org's daily page count under a row lock. It is the only
  // thing standing between a valid JWT and a billed model call, so a failure
  // to reach it must deny — never fall through to the extraction below.
  const { data: verdict, error: quotaErr } = await service.rpc('consume_ocr_page', {
    p_org_id:  orgId,
    p_user_id: user.id,
    p_pages:   1,
  })

  if (quotaErr) {
    console.error(`[pdf-ocr] quota check failed for org ${orgId}:`, quotaErr.message)
    return new Response(JSON.stringify({
      ok: false, pageNumber, error: 'Could not verify OCR entitlement. Please retry.',
    }), { status: 503, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
  }

  if (!verdict?.allowed) {
    const reason = verdict?.reason ?? 'not_authorised'
    const message =
      reason === 'daily_quota_exceeded'
        ? `Daily OCR limit reached (${verdict.used}/${verdict.limit} pages). Try again tomorrow.`
      : reason === 'plan_too_low'
        ? 'OCR import of scanned PDFs is available on the Clariva Impact plan.'
      : reason === 'role_not_permitted'
        ? 'Your role cannot import transactions.'
        : 'You do not have access to OCR for this organisation.'

    return new Response(JSON.stringify({ ok: false, pageNumber, error: message, reason }), {
      status: 403, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  // ── Extract ───────────────────────────────────────────────────────────────
  try {
    const result = await getProvider()(image, mimeType)
    return new Response(JSON.stringify({ ok: true, pageNumber, ...result }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(`[pdf-ocr] page ${pageNumber}:`, msg)
    return new Response(JSON.stringify({ ok: false, error: msg, pageNumber }), {
      status: 200, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
})
