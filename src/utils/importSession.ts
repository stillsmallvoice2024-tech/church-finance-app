// ── Interrupted-import session ────────────────────────────────────────────────
//
// The import wizard autosaves configuration so an accidental close does not
// throw away the work. "Accidental" covers more than clicking X: a swipe-back
// gesture, a tab crash, a laptop lid, a stray browser Back.
//
// Deliberate discard is the one case we honour by deleting the session — the
// user said throw this away, and resurrecting it would be ignoring them.
// A completed import clears it too, since there is nothing left to resume.
//
// Storage is `sessionStorage`, so it dies with the tab. That is intentional:
// resuming an import in a different tab days later, against a database that has
// moved on, would be worse than starting over.

export const IMPORT_SESSION_KEY = 'church-import-session'

/** Shape of the saved payload. `v` guards against reading an older layout. */
export interface SavedImportSession {
  v: 2
  step: number
  fileName: string
  rowCount: number
  savedAt: string
  [key: string]: unknown
}

/**
 * Read the saved session, if one is worth resuming.
 *
 * Returns null for an empty import — a session that never got past choosing a
 * file has nothing to restore, and prompting to "continue" it would be noise.
 */
export function readImportSession(): SavedImportSession | null {
  try {
    const raw = sessionStorage.getItem(IMPORT_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SavedImportSession
    if (parsed?.v !== 2) return null
    if (!parsed.fileName || (parsed.step ?? 0) < 2) return null
    return parsed
  } catch {
    return null
  }
}

export function clearImportSession(): void {
  try { sessionStorage.removeItem(IMPORT_SESSION_KEY) } catch { /* ignore */ }
}

/** "3 minutes ago" — enough to tell a stale session from a fresh one. */
export function describeSavedAt(savedAt: string | null | undefined): string {
  if (!savedAt) return ''
  const then = new Date(savedAt).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1)  return 'just now'
  if (mins === 1) return '1 minute ago'
  if (mins < 60) return `${mins} minutes ago`
  const hrs = Math.round(mins / 60)
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`
}
