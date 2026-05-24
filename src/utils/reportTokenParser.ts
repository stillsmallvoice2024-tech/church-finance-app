import {
  getCategoryBalance,
  getCategoryInflows,
  getCategoryOutflows,
  getNetMovement,
  type DateRange,
  type QueryResult,
} from './reportQueryEngine'

// Supported token syntax:
//   {{BALANCE:category}}
//   {{BALANCE:category:2026-01-01:2026-12-31}}
//   {{INFLOWS:category}}
//   {{INFLOWS:category:dateFrom:dateTo}}
//   {{OUTFLOWS:category}}
//   {{OUTFLOWS:category:dateFrom:dateTo}}
//   {{NET}}
//   {{NET:dateFrom:dateTo}}

export type TokenFn = 'BALANCE' | 'INFLOWS' | 'OUTFLOWS' | 'NET'

export interface ParsedToken {
  raw: string
  fn: TokenFn
  category: string
  dateFrom: string | undefined
  dateTo: string | undefined
}

// Matches {{FN}}, {{FN:cat}}, {{FN:cat:from:to}}, {{NET:from:to}}
const TOKEN_RE =
  /\{\{(BALANCE|INFLOWS|OUTFLOWS|NET)(?::([^:{}]*))?(?::([^:{}]*))?(?::([^:{}]*))?\}\}/g

export function parseTokens(text: string): ParsedToken[] {
  const tokens: ParsedToken[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const fn = m[1] as TokenFn
    tokens.push({
      raw:      m[0],
      fn,
      category: m[2]?.trim() ?? '',
      dateFrom: m[3]?.trim() || undefined,
      dateTo:   m[4]?.trim() || undefined,
    })
  }
  return tokens
}

export function buildTokenString(
  fn: TokenFn,
  category: string,
  dateFrom?: string,
  dateTo?: string,
): string {
  if (fn === 'NET') {
    return dateFrom && dateTo
      ? `{{NET:${dateFrom}:${dateTo}}}`
      : `{{NET}}`
  }
  const cat = category.trim()
  return dateFrom && dateTo
    ? `{{${fn}:${cat}:${dateFrom}:${dateTo}}}`
    : `{{${fn}:${cat}}}`
}

export async function resolveTokens(
  tokens: ParsedToken[],
): Promise<Map<string, QueryResult>> {
  const unique = new Map<string, ParsedToken>()
  for (const t of tokens) unique.set(t.raw, t)

  const results = new Map<string, QueryResult>()

  await Promise.all(
    Array.from(unique.values()).map(async t => {
      if (t.fn !== 'NET' && !t.category) {
        results.set(t.raw, { value: 0, error: 'Missing category' })
        return
      }
      const dr: DateRange | undefined =
        t.dateFrom && t.dateTo ? { from: t.dateFrom, to: t.dateTo } : undefined

      let result: QueryResult
      try {
        switch (t.fn) {
          case 'BALANCE':  result = await getCategoryBalance(t.category, dr);  break
          case 'INFLOWS':  result = await getCategoryInflows(t.category, dr);  break
          case 'OUTFLOWS': result = await getCategoryOutflows(t.category, dr); break
          case 'NET':      result = await getNetMovement(dr);                  break
          default:         result = { value: 0, error: 'Unknown function' }
        }
      } catch (e) {
        result = { value: 0, error: String(e) }
      }
      results.set(t.raw, result)
    }),
  )

  return results
}

// Split text into alternating [string, ParsedToken] segments for rendering
export function splitByTokens(text: string): Array<string | ParsedToken> {
  const segments: Array<string | ParsedToken> = []
  let last = 0
  for (const m of text.matchAll(TOKEN_RE)) {
    const idx = m.index ?? 0
    if (idx > last) segments.push(text.slice(last, idx))
    const fn = m[1] as TokenFn
    segments.push({
      raw:      m[0],
      fn,
      category: m[2]?.trim() ?? '',
      dateFrom: m[3]?.trim() || undefined,
      dateTo:   m[4]?.trim() || undefined,
    })
    last = idx + m[0].length
  }
  if (last < text.length) segments.push(text.slice(last))
  return segments
}
