import { useEffect, useRef, useState } from 'react'

/**
 * Animates a number from 0 to `target` once on mount (ease-out).
 * Respects prefers-reduced-motion by snapping immediately.
 * Subsequent target changes snap without animation (refetch should not re-animate).
 */
export function useCountUp(target: number, durationMs = 800): number {
  const [value, setValue] = useState(0)
  const animated = useRef(false)

  useEffect(() => {
    if (animated.current) { setValue(target); return }
    animated.current = true

    const reduced = typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced || target === 0) { setValue(target); return }

    let frame: number
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / durationMs, 1)
      const eased = 1 - Math.pow(1 - t, 3) // cubic ease-out
      setValue(target * eased)
      if (t < 1) frame = requestAnimationFrame(tick)
      else setValue(target)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, durationMs])

  return value
}
