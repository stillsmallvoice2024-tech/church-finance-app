// Edge Function: purge-deleted-orgs
// Runs on a schedule (e.g. daily via Supabase CRON or external trigger).
// Finds all organisations whose purge_at has passed and permanently deletes them.
//
// Deploy: supabase functions deploy purge-deleted-orgs
// Schedule via Supabase dashboard → Database → Extensions → pg_cron, or
// call via an external scheduler with the service-role key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const MAX_RETRIES          = 3
const RETRY_BASE_MS        = 2000

interface PurgeResult {
  org_id:    string
  org_name?: string
  result:    { ok: boolean; purged_at?: string; error?: string; step?: string }
  attempts:  number
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

Deno.serve(async (req) => {
  // Allow GET (for cron pings) and POST
  if (req.method !== 'GET' && req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const results: PurgeResult[] = []
  const errors:  string[]      = []

  try {
    // Find all orgs ready to purge
    const { data: orgs, error: fetchError } = await supabase
      .from('organizations')
      .select('id, name, purge_at')
      .eq('status', 'pending_deletion')
      .lte('purge_at', new Date().toISOString())

    if (fetchError) {
      console.error('[purge-job] Failed to fetch orgs:', fetchError.message)
      return new Response(
        JSON.stringify({ ok: false, error: fetchError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      )
    }

    console.log(`[purge-job] Found ${orgs?.length ?? 0} org(s) ready to purge`)

    for (const org of orgs ?? []) {
      const pr: PurgeResult = { org_id: org.id, org_name: org.name, result: { ok: false }, attempts: 0 }

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        pr.attempts = attempt
        try {
          const { data, error } = await supabase.rpc('purge_org', { p_org_id: org.id })

          if (error) throw new Error(error.message)

          const res = data as { ok: boolean; purged_at?: string; error?: string; step?: string }
          pr.result = res

          if (res.ok) {
            console.log(`[purge-job] Purged org ${org.id} (${org.name}) on attempt ${attempt}`)

            // Best-effort: clean up storage backup file
            if (org.deletion_backup_path) {
              const { error: storageErr } = await supabase.storage
                .from('deletion-backups')
                .remove([org.deletion_backup_path as string])
              if (storageErr) {
                console.warn(`[purge-job] Storage cleanup failed for ${org.id}:`, storageErr.message)
              }
            }
            break
          }

          console.warn(`[purge-job] purge_org returned ok=false for ${org.id}:`, res.error, `step=${res.step}`)

          if (attempt < MAX_RETRIES) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e)
          pr.result = { ok: false, error: msg }
          console.error(`[purge-job] Attempt ${attempt} failed for org ${org.id}:`, msg)
          if (attempt < MAX_RETRIES) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1))
        }
      }

      results.push(pr)
      if (!pr.result.ok) errors.push(`${org.id} (${org.name}): ${pr.result.error}`)
    }

    const summary = {
      ok:          errors.length === 0,
      processed:   results.length,
      succeeded:   results.filter(r => r.result.ok).length,
      failed:      errors.length,
      errors,
      results,
      ran_at:      new Date().toISOString(),
    }

    console.log('[purge-job] Summary:', JSON.stringify(summary))
    return new Response(JSON.stringify(summary), {
      status: errors.length > 0 ? 207 : 200,
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[purge-job] Unhandled error:', msg)
    return new Response(
      JSON.stringify({ ok: false, error: msg, ran_at: new Date().toISOString() }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
