// Suspense fallback shown while a lazily-loaded route chunk is fetched.
// Mirrors the AuthGuard full-page spinner so lazy loading is visually seamless.
export function RouteFallback() {
  return (
    <div
      className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background"
      role="status"
      aria-label="Loading…"
    >
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-white shadow-md">
        <svg viewBox="0 0 64 64" className="h-9 w-9" fill="none" aria-hidden="true">
          <path d="M 43 51 A 22 22 0 1 0 21 51"
                stroke="currentColor" strokeWidth="5.5" strokeLinecap="round" />
          <path d="M 44 58 C 42 50 37 38 32 32 C 27 38 22 50 20 58 Z"
                fill="currentColor" opacity="0.75" />
        </svg>
      </div>
      <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  )
}
