// Import-specific error translation. The end user sees plain, actionable
// language plus a short code; the raw Postgres/Supabase message (the thing
// support actually needs) is logged to the console and kept in a
// `technical` field for a collapsed "for support" panel — never shown
// directly in the main message.

export interface ImportErrorInfo {
  code:      string
  message:   string
  technical: string
}

export const MISSING_COLUMN_RE = /Could not find (?:the ')?(\w+)'? column/
const UUID_TYPE_RE       = /invalid input syntax for type uuid/i

const FIELD_LABELS: Record<string, string> = {
  income_type_id:       'income type',
  allocation_config_id: 'fund allocation',
  category_id:          'fund/category',
  bank_id:               'bank account',
  recorded_at:            'transaction date/time',
}

export function describeImportError(err: unknown): ImportErrorInfo {
  const raw =
    err && typeof err === 'object' && 'message' in err
      ? String((err as { message: unknown }).message)
      : String(err ?? '')

  if (raw) console.error('[import]', raw)

  const missingCol = raw.match(MISSING_COLUMN_RE)?.[1]
  if (missingCol) {
    const label = FIELD_LABELS[missingCol] ?? missingCol
    return {
      code: 'CFA-IMP-001',
      message:
        `Your app isn't fully set up to save ${label} on transactions yet. ` +
        `Nothing was changed — no transactions from this file were imported. ` +
        `Contact support with error code CFA-IMP-001 to get this fixed, then try importing again.`,
      technical: raw,
    }
  }

  if (UUID_TYPE_RE.test(raw)) {
    return {
      code: 'CFA-IMP-002',
      message:
        `One of the reference numbers in this file is in a format your app doesn't accept yet. ` +
        `Contact support with error code CFA-IMP-002 — they can widen the field so these rows go through.`,
      technical: raw,
    }
  }

  return {
    code: 'CFA-IMP-000',
    message:
      `Some rows in this file could not be saved. Contact support with error code CFA-IMP-000 ` +
      `if this keeps happening.`,
    technical: raw,
  }
}
