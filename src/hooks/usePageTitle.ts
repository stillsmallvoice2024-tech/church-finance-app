import { useEffect } from 'react'

const BASE = 'Church Finance'

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} — ${BASE}` : BASE
    return () => { document.title = BASE }
  }, [title])
}
