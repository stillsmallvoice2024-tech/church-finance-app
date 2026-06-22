import { useState, useEffect, useRef } from 'react'

const POLL_INTERVAL = 5 * 60 * 1000 // 5 minutes

let _initialVersion: string | null = null
let _dismissed = false

export function useVersionCheck() {
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function checkVersion() {
    if (_dismissed) return
    try {
      const res = await fetch('/version.json', { cache: 'no-store' })
      if (!res.ok) return
      const { v } = await res.json() as { v: string }
      if (_initialVersion === null) {
        _initialVersion = v
      } else if (v !== _initialVersion) {
        setUpdateAvailable(true)
      }
    } catch {
      // network error — skip silently
    }
  }

  useEffect(() => {
    checkVersion()
    intervalRef.current = setInterval(checkVersion, POLL_INTERVAL)

    const onVisible = () => { if (document.visibilityState === 'visible') checkVersion() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function dismiss() {
    _dismissed = true
    setUpdateAvailable(false)
  }

  return { updateAvailable, dismiss }
}
