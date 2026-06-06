import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export type DbStatus = 'checking' | 'online' | 'offline'

export function useDbStatus() {
  const [status,  setStatus]  = useState<DbStatus>('checking')
  const [latency, setLatency] = useState<number | null>(null)

  const check = useCallback(async () => {
    setStatus('checking')
    const t0 = Date.now()
    try {
      const { error } = await supabase.from('profiles').select('id').limit(1)
      if (error) throw error
      setLatency(Date.now() - t0)
      setStatus('online')
    } catch {
      setStatus('offline')
      setLatency(null)
    }
  }, [])

  useEffect(() => { check() }, [check])

  // Re-check automatically when the browser regains connectivity
  useEffect(() => {
    const handleOnline = () => check()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [check])

  return { status, latency, recheck: check }
}
