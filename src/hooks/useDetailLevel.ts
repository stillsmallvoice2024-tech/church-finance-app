import { useState, useCallback } from 'react'

// Progressive disclosure: each page opens 'simple' by default and can reveal
// its 'full' (current dense) view. The choice is remembered per page in
// localStorage (mirrors the ViewToggle persistence pattern) so a user who
// prefers Full sees it by default next time.

export type DetailLevel = 'simple' | 'full'

const key = (pageId: string) => `detail-level-${pageId}`

function getDefault(pageId: string): DetailLevel {
  try {
    const stored = localStorage.getItem(key(pageId))
    if (stored === 'simple' || stored === 'full') return stored
  } catch { /* ignore */ }
  return 'simple'
}

export function useDetailLevel(pageId: string) {
  const [level, setLevelState] = useState<DetailLevel>(() => getDefault(pageId))

  const setLevel = useCallback((next: DetailLevel) => {
    setLevelState(next)
    try { localStorage.setItem(key(pageId), next) } catch { /* ignore */ }
  }, [pageId])

  return { level, setLevel, isSimple: level === 'simple', isFull: level === 'full' }
}
