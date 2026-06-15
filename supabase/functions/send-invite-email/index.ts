// Edge Function: send-invite-email
// Called by org admins immediately after creating an invitation.
// Sends an email to the invited user via the Resend API and logs delivery.
//
// Deploy: supabase functions deploy send-invite-email
// Required env vars: RESEND_API_KEY, INVITE_FROM_ADDRESS (optional, defaults shown below)

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const RESEND_API_KEY       = Deno.env.get('RESEND_API_KEY')
const FROM_ADDRESS         = Deno.env.get('INVITE_FROM_ADDRESS') ?? 'Clariva <noreply@clariva.app>'
const APP_URL              = Deno.env.get('APP_URL') ?? 'https://clariva.app'

// Duplicate suppression window: skip re-send if a successful email was logged within this many ms
const DEDUP_WINDOW_MS = 60_000

interface InviteRow {
  id:           string
  email:        string
  role:         string
  token:        string
  expires_at:   string
  org_name:     string | null
  inviter_name: string | null
}

function buildHtml(params: {
  org_name:    string
  inviter_name: string
  role:        string
  invite_url:  string
  expires_at:  string
}): string {
  const { org_name, inviter_name, role, invite_url, expires_at } = params
  const expiryDate = new Date(expires_at).toLocaleDateString('en-GB', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })
  const roleLabel = role.charAt(0).toUpperCase() + role.slice(1)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>You're invited to join ${org_name}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">

        <!-- Header -->
        <tr><td style="background:#0D7377;padding:28px 40px;">
          <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">
            Clariva
          </h1>
          <p style="margin:6px 0 0;color:#C8E8E6;font-size:13px;">Financial Stewardship Platform</p>
        </td></tr>

        <!-- Body -->
        <tr><td style="padding:36px 40px 28px;">
          <h2 style="margin:0 0 12px;color:#111827;font-size:22px;font-weight:700;">
            You've been invited!
          </h2>
          <p style="margin:0 0 20px;color:#374151;font-size:15px;line-height:1.6;">
            <strong>${inviter_name}</strong> has invited you to join
            <strong>${org_name}</strong> as a <strong>${roleLabel}</strong>.
          </p>
          <p style="margin:0 0 28px;color:#6b7280;font-size:14px;line-height:1.6;">
            Click the button below to accept the invitation, set up your account, and start collaborating on Clariva.
          </p>

          <!-- CTA Button -->
          <table cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#0D7377;border-radius:8px;">
              <a href="${invite_url}"
                 style="display:block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;white-space:nowrap;">
                Accept Invitation →
              </a>
            </td></tr>
          </table>

          <!-- Link fallback -->
          <p style="margin:0 0 8px;color:#6b7280;font-size:12px;">Or copy and paste this link into your browser:</p>
          <p style="margin:0 0 28px;font-size:12px;word-break:break-all;">
            <a href="${invite_url}" style="color:#0D7377;">${invite_url}</a>
          </p>

          <!-- Expiry notice -->
          <div style="background:#fef9c3;border:1px solid #fde047;border-radius:8px;padding:12px 16px;">
            <p style="margin:0;color:#713f12;font-size:13px;">
              ⏰ This invitation expires on <strong>${expiryDate}</strong>.
              The link remains valid whether you use this email or a copied link.
            </p>
          </div>
        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#f9fafb;padding:20px 40px;border-top:1px solid #e4e4e7;">
          <p style="margin:0;color:#9ca3af;font-size:12px;line-height:1.6;">
            If you weren't expecting this invitation, you can safely ignore this email.
            This message was sent by Clariva on behalf of ${org_name}.
          </p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  const token   = authHeader.slice(7)
  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } })

  const { data: { user }, error: authErr } = await service.auth.getUser(token)
  if (authErr || !user) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: { invitation_id?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  const { invitation_id } = body
  if (!invitation_id) {
    return new Response(JSON.stringify({ ok: false, error: 'invitation_id is required' }), {
      status: 400, headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Fetch invitation details ──────────────────────────────────────────────
  const { data: invite, error: inviteErr } = await service
    .from('invitations')
    .select(`
      id,
      org_id,
      email,
      role,
      token,
      expires_at,
      organizations ( name ),
      profiles!invitations_invited_by_fkey ( full_name )
    `)
    .eq('id', invitation_id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (inviteErr || !invite) {
    console.error('[send-invite-email] Invite not found or expired:', inviteErr?.message)
    return new Response(JSON.stringify({ ok: false, error: 'Invitation not found or already expired' }), {
      status: 404, headers: { 'Content-Type': 'application/json' },
    })
  }

  // Verify caller is admin or owner of the invitation's specific org
  const { data: membership } = await service
    .from('org_members')
    .select('role')
    .eq('user_id', user.id)
    .eq('org_id', invite.org_id)
    .eq('status', 'active')
    .in('role', ['owner', 'admin'])
    .maybeSingle()

  if (!membership) {
    return new Response(JSON.stringify({ ok: false, error: 'Forbidden' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    })
  }

  type OrgJoin     = { name: string } | null
  type ProfileJoin = { full_name: string } | null
  const row: InviteRow = {
    id:           invite.id,
    email:        invite.email,
    role:         invite.role,
    token:        invite.token,
    expires_at:   invite.expires_at,
    org_name:     (invite.organizations as OrgJoin)?.name ?? null,
    inviter_name: (invite.profiles as ProfileJoin)?.full_name ?? null,
  }

  // ── Duplicate suppression ────────────────────────────────────────────────
  const dedupSince = new Date(Date.now() - DEDUP_WINDOW_MS).toISOString()
  const { data: recentSend } = await service
    .from('invitation_emails')
    .select('id')
    .eq('invitation_id', invitation_id)
    .eq('status', 'sent')
    .gte('sent_at', dedupSince)
    .maybeSingle()

  if (recentSend) {
    console.log(`[send-invite-email] Duplicate suppressed for invitation ${invitation_id}`)
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  // ── Email service check ───────────────────────────────────────────────────
  if (!RESEND_API_KEY) {
    console.warn('[send-invite-email] RESEND_API_KEY not configured')
    await service.from('invitation_emails').insert({
      invitation_id,
      email:     row.email,
      status:    'failed',
      error_msg: 'RESEND_API_KEY not configured',
    })
    return new Response(
      JSON.stringify({ ok: false, error: 'Email service not configured. Share the invite link manually.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // ── Build and send email ──────────────────────────────────────────────────
  const invite_url  = `${APP_URL}/invite/${row.token}`
  const org_name    = row.org_name    ?? 'your organisation'
  const inviter_name = row.inviter_name ?? 'An administrator'

  const emailHtml = buildHtml({ org_name, inviter_name, role: row.role, invite_url, expires_at: row.expires_at })

  let resendId:  string | null = null
  let sendError: string | null = null

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        from:    FROM_ADDRESS,
        to:      [row.email],
        subject: `You're invited to join ${org_name}`,
        html:    emailHtml,
      }),
    })

    if (!res.ok) {
      const errBody = await res.text()
      sendError = `Resend API error ${res.status}: ${errBody}`
      console.error('[send-invite-email]', sendError)
    } else {
      const json = await res.json() as { id?: string }
      resendId = json.id ?? null
      console.log(`[send-invite-email] Sent to ${row.email}, resend_id=${resendId}`)
    }
  } catch (e) {
    sendError = e instanceof Error ? e.message : String(e)
    console.error('[send-invite-email] Fetch error:', sendError)
  }

  // ── Log delivery attempt ──────────────────────────────────────────────────
  await service.from('invitation_emails').insert({
    invitation_id,
    email:     row.email,
    status:    sendError ? 'failed' : 'sent',
    error_msg: sendError ?? null,
    resend_id: resendId,
  })

  if (sendError) {
    return new Response(JSON.stringify({ ok: false, error: sendError }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true, resend_id: resendId }), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  })
})
