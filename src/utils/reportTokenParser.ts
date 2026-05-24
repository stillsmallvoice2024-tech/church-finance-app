import {
  getCategoryBalance,
  getCategoryInflows,
  getCategoryOutflows,
  getNetMovement,
  type BudgetPortion,
  type DateRange,
  type QueryResult,
} from './reportQueryEngine'

// Supported token syntax:
//   {{BALANCE:category}}
//   {{BALANCE:category:portion}}                     portion = seed|savings|percentage|all
//   {{BALANCE:category:portion:dateFrom:dateTo}}
//   {{BALANCE:category:dateFrom:dateTo}}             backward-compat (no portion segment)
//   {{INFLOWS:category}} / {{OUTFLOWS:category}}
//   {{NET}} / {{NET:dateFrom:dateTo}}

export type TokenFn = 'BALANCE' | 'INFLOWS' | 'OUTFLOWS' | 'NET'

export interface ParsedToken {
  raw:      string
  fn:       TokenFn
  category: string
  portion:  BudgetPortion | undefined
  dateFrom: string | undefined
  dateTo:   string | undefined
}

const TOKEN_RE =
  /\{\{(BALANCE|INFLOWS|OUTFLOWS|NET)(?::([^:{}]*))?(?::([^:{}]*))?(?::([^:{}]*))?(?::([^:{}]*))?\}\}/g

const DATE_RE    = /^\d{4}-\d{2}-\d{2}$/
const PORTION_KEYS = new Set(['all', 'seed', 'savings', 'percentage'])

function parseParts(
  g2: string | undefined,
  g3: string | undefined,
  g4: string | undefined,
  g5: string | undefined,
): { category: string; portion: BudgetPortion | undefined; dateFrom: string | undefined; dateTo: string | undefined } {
  const category = g2?.trim() ?? ''
  const s3 = g3?.trim() || undefined
  const s4 = g4?.trim() || undefined
  const s5 = g5?.trim() || undefined

  // Backward-compat: if g3 is a date string → old {{FN:cat:dateFrom:dateTo}} format
  if (s3 && DATE_RE.test(s3)) {
    return { category, portion: undefined, dateFrom: s3, dateTo: s4 }
  }
  // New format: g3 is a portion key (or absent)
  const portion = (s3 && PORTION_KEYS.has(s3)) ? s3 as BudgetPortion : undefined
  return { category, portion, dateFrom: s4, dateTo: s5 }
}

export function parseTokens(text: string): ParsedToken[] {
  const tokens: ParsedToken[] = []
  for (const m of text.matchAll(TOKEN_RE)) {
    const fn = m[1] as TokenFn
    const { category, portion, dateFrom, dateTo } = parseParts(m[2], m[3], m[4], m[5])
    tokens.push({ raw: m[0], fn, category, portion, dateFrom, dateTo })
  }
  return tokens
}

export function buildTokenString(
  fn: TokenFn,
  category: string,
  portion?: BudgetPortion,
  dateFrom?: string,
  dateTo?: string,
): string {
  if (fn === 'NET') {
    return dateFrom && dateTo ? `{{NET:${dateFrom}:${dateTo}}}` : `{{NET}}`
  }
  const cat = category.trim()
  const portionPart = portion && portion !== 'all' ? `:${portion}` : ''
  if (dateFrom && dateTo) {
    return `{{${fn}:${cat}${portionPart}:${dateFrom}:${dateTo}}}`
  }
  if (portionPart) {
    return `{{${fn}:${cat}${portionPart}}}`
  }
  return `{{${fn}:${cat}}}`
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
          case 'BALANCE':  result = await getCategoryBalance(t.category, dr, t.portion);  break
          case 'INFLOWS':  result = await getCategoryInflows(t.category, dr, t.portion);  break
          case 'OUTFLOWS': result = await getCategoryOutflows(t.category, dr, t.portion); break
          case 'NET':      result = await getNetMovement(dr);                              break
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
    const { category, portion, dateFrom, dateTo } = parseParts(m[2], m[3], m[4], m[5])
    segments.push({ raw: m[0], fn, category, portion, dateFrom, dateTo })
    last = idx + m[0].length
  }
  if (last < text.length) segments.push(text.slice(last))
  return segments
}
