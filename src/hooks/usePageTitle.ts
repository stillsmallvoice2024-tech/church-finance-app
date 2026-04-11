import { useEffect } from 'react'

const BASE = 'Church Finance 2024'

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} | ${BASE}` : BASE
    return () => { document.title = BASE }
  }, [title])
}
