import { useState, useEffect, useCallback } from 'react'
import { Shield, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface Props {
  open:    boolean
  onDone:  () => void
}

const inputCls =
  'w-full px-3 py-2.5 text-sm border border-gray-300 rounded-lg outline-none ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors'

export function MFAChallengeModal({ open, onDone }: Props) {
  const [code,    setCode]    = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const reset = useCallback(() => {
    setCode(''); setLoading(false); setError(null)
  }, [])

  useEffect(() => { if (open) reset() }, [open, reset])

  const handleVerify = async () => {
    if (code.length < 6) return
    setLoading(true); setError(null)
    try {
      const { data: factors, error: listErr } = await supabase.auth.mfa.listFactors()
      if (listErr) throw listErr

      const totp = factors.totp?.[0]
      if (!totp) throw new Error('No TOTP factor found on this account.')

      const { data: challenge, error: chalErr } = await supabase.auth.mfa.challenge({ factorId: totp.id })
      if (chalErr) throw chalErr

      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId:    totp.id,
        challengeId: challenge.id,
        code:        code.trim(),
      })
      if (verifyErr) throw verifyErr

      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 text-center space-y-2">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center">
            <Shield className="w-6 h-6 text-primary" aria-hidden="true" />
          </div>
          <h2 className="text-base font-semibold text-gray-900">Two-factor authentication</h2>
          <p className="text-xs text-gray-500">
            Enter the 6-digit code from your authenticator app to continue.
          </p>
        </div>

        <div className="px-6 pb-6 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              {error}
            </div>
          )}

          <div className="space-y-1">
            <label className="sr-only">Verification code</label>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              autoFocus
              className={`${inputCls} text-center text-2xl tracking-widest font-mono`}
              onKeyDown={e => { if (e.key === 'Enter') handleVerify() }}
              aria-label="6-digit authentication code"
            />
          </div>

          <button
            type="button"
            onClick={handleVerify}
            disabled={loading || code.length < 6}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {loading ? 'Verifying…' : 'Verify'}
          </button>

          <p className="text-xs text-center text-gray-400">
            Open your authenticator app to find the code for this account.
          </p>
        </div>
      </div>
    </div>
  )
}
