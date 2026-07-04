// ── Basic error monitoring ───────────────────────────────────────────────────
// Dependency-free hook point for production error reporting. Captures uncaught
// errors and unhandled promise rejections, plus explicit reports from the
// React ErrorBoundary. Events are logged to the console and, if
// VITE_ERROR_MONITOR_URL is configured, POSTed to that collector endpoint
// (best-effort, fire-and-forget). No third-party SDK required; the endpoint
// can be a Supabase Edge Function, Sentry tunnel, or any HTTPS sink.

interface ReportContext {
  source?:         string
  componentStack?: string
  [key: string]:   unknown
}

const ENDPOINT = import.meta.env.VITE_ERROR_MONITOR_URL as string | undefined

// Guard against feedback loops (a failing report must not report itself).
let reporting = false

export function reportError(error: unknown, context: ReportContext = {}): void {
  const err = error instanceof Error ? error : new Error(String(error))

  console.error('[errorMonitor]', context.source ?? 'error', err, context)

  if (!ENDPOINT || reporting) return

  try {
    reporting = true
    const payload = JSON.stringify({
      message:   err.message,
      stack:     err.stack,
      context,
      url:       window.location.href,
      userAgent: navigator.userAgent,
      at:        new Date().toISOString(),
    })
    // keepalive lets the request survive a page unload/navigation.
    void fetch(ENDPOINT, {
      method:    'POST',
      headers:   { 'Content-Type': 'application/json' },
      body:      payload,
      keepalive: true,
    }).catch(() => { /* swallow — monitoring must never break the app */ })
  } catch {
    /* swallow */
  } finally {
    reporting = false
  }
}

let installed = false

export function initErrorMonitoring(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener('error', (event) => {
    reportError(event.error ?? event.message, { source: 'window.onerror' })
  })

  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { source: 'unhandledrejection' })
  })
}
