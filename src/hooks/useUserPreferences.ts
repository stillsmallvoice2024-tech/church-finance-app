import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { useAuthStore } from '../store/authStore'
import { useOrgStore } from '../store/orgStore'
import {
  DEFAULT_USER_PREFERENCES,
  type UserPreferences,
} from '../types/onboarding'
import { ALL_TOURS } from '../onboarding/tours'

const prefKey = (userId: string, orgId: string) =>
  `user-prefs-${userId}-${orgId}`

function readLocalPrefs(key: string): UserPreferences {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return { ...DEFAULT_USER_PREFERENCES }
    return { ...DEFAULT_USER_PREFERENCES, ...(JSON.parse(raw) as Partial<UserPreferences>) }
  } catch {
    return { ...DEFAULT_USER_PREFERENCES }
  }
}

function writeLocalPrefs(key: string, prefs: UserPreferences) {
  try { localStorage.setItem(key, JSON.stringify(prefs)) } catch { /* storage unavailable */ }
}

export function useUserPreferences() {
  const user  = useAuthStore(s => s.user)
  const orgId = useOrgStore(s => s.orgId)

  const key = user && orgId ? prefKey(user.id, orgId) : null

  const [prefs, setPrefs] = useState<UserPreferences>(() =>
    key ? readLocalPrefs(key) : { ...DEFAULT_USER_PREFERENCES },
  )
  const [loading, setLoading] = useState(true)

  // Avoid stale closures when calling updatePrefs inside effects
  const prefsRef = useRef(prefs)
  prefsRef.current = prefs

  useEffect(() => {
    if (!user || !orgId) {
      setLoading(false)
      return
    }

    let cancelled = false

    async function load() {
      // Seed from localStorage immediately for a fast first paint
      const localPrefs = readLocalPrefs(key!)
      if (!cancelled) setPrefs(localPrefs)

      const { data, error } = await supabase
        .from('user_preferences')
        .select('preferences')
        .eq('user_id', user!.id)
        .eq('org_id', orgId!)
        .maybeSingle()

      if (cancelled) return

      if (!error && data?.preferences) {
        const raw = data.preferences as Partial<UserPreferences>

        // Legacy DB rows predate the first_visit_pages field — the key is simply
        // absent from the stored JSONB. Pre-populate with all tour page IDs so
        // returning users are never shown tours they've already encountered.
        const isLegacyRow = !('first_visit_pages' in raw)
        const merged: UserPreferences = {
          ...DEFAULT_USER_PREFERENCES,
          ...raw,
          first_visit_pages: isLegacyRow
            ? ALL_TOURS.map(t => t.pageId)
            : (raw.first_visit_pages ?? []),
        }
        setPrefs(merged)
        writeLocalPrefs(key!, merged)

        if (isLegacyRow) {
          supabase
            .from('user_preferences')
            .upsert(
              { user_id: user!.id, org_id: orgId!, preferences: merged, updated_at: new Date().toISOString() },
              { onConflict: 'user_id,org_id' },
            )
            .then(({ error: e }) => {
              if (e) console.error('[useUserPreferences] legacy migration failed:', e)
            })
        }
      }

      setLoading(false)
    }

    load()
    return () => { cancelled = true }
  }, [user?.id, orgId]) // eslint-disable-line react-hooks/exhaustive-deps

  const updatePrefs = useCallback(
    async (partial: Partial<UserPreferences>) => {
      if (!user || !orgId || !key) return

      const next: UserPreferences = { ...prefsRef.current, ...partial }
      setPrefs(next)
      writeLocalPrefs(key, next)

      // Fire-and-forget upsert — localStorage is the fallback if this fails
      supabase
        .from('user_preferences')
        .upsert(
          {
            user_id:     user.id,
            org_id:      orgId,
            preferences: next,
            updated_at:  new Date().toISOString(),
          },
          { onConflict: 'user_id,org_id' },
        )
        .then(({ error }) => {
          if (error) console.error('[useUserPreferences] updatePrefs failed:', error)
        })
    },
    [user?.id, orgId, key], // eslint-disable-line react-hooks/exhaustive-deps
  )

  return { prefs, loading, updatePrefs }
}
