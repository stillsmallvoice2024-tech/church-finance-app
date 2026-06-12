import { useState, useEffect, useCallback } from 'react'
import { X, Shield, Copy, CheckCircle2, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../../lib/supabase'

interface Props {
  open:    boolean
  onClose: () => void
  onDone:  () => void
}

type Step = 'init' | 'scan' | 'verify' | 'done'

const inputCls =
  'w-full px-3 py-2.5 text-sm border border-gray-300 dark:border-gray-600 rounded-lg outline-none ' +
  'bg-white dark:bg-gray-800 text-gray-900 dark:text-white ' +
  'focus:ring-2 focus:ring-primary/30 focus:border-primary transition-colors'

export function MFAEnrollModal({ open, onClose, onDone }: Props) {
  const [step,       setStep]       = useState<Step>('init')
  const [factorId,   setFactorId]   = useState<string | null>(null)
  const [qrUri,      setQrUri]      = useState<string | null>(null)
  const [secret,     setSecret]     = useState<string | null>(null)
  const [code,       setCode]       = useState('')
  const [copied,     setCopied]     = useState(false)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)

  const reset = useCallback(() => {
    setStep('init'); setFactorId(null); setQrUri(null); setSecret(null)
    setCode(''); setCopied(false); setLoading(false); setError(null)
  }, [])

  useEffect(() => { if (open) reset() }, [open, reset])

  const handleBegin = async () => {
    setLoading(true); setError(null)
    try {
      const { data, error: err } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
      if (err) throw err
      setFactorId(data.id)
      setQrUri(data.totp.qr_code)
      setSecret(data.totp.secret)
      setStep('scan')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleVerify = async () => {
    if (!factorId || code.length < 6) return
    setLoading(true); setError(null)
    try {
      const { data: challengeData, error: challengeErr } = await supabase.auth.mfa.challenge({ factorId })
      if (challengeErr) throw challengeErr
      const { error: verifyErr } = await supabase.auth.mfa.verify({
        factorId,
        challengeId: challengeData.id,
        code:        code.trim(),
      })
      if (verifyErr) throw verifyErr
      setStep('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!secret) return
    try {
      await navigator.clipboard.writeText(secret)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-sm">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
          <div className="flex items-center gap-2">
            <Shield className="w-5 h-5 text-primary" aria-hidden="true" />
            <h2 className="text-base font-semibold text-gray-900 dark:text-white">
              Set up Two-Factor Authentication
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2.5 text-sm text-red-700 dark:text-red-300">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              {error}
            </div>
          )}

          {step === 'init' && (
            <>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Add an extra layer of security. After enabling 2FA you will need your authenticator app every time you sign in.
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500">
                Compatible with Google Authenticator, Authy, 1Password, and any TOTP app.
              </p>
              <button
                type="button"
                onClick={handleBegin}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Generating…' : 'Begin setup'}
              </button>
            </>
          )}

          {step === 'scan' && qrUri && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Scan this QR code with your authenticator app, then enter the 6-digit code below.
              </p>
              <div className="flex justify-center">
                <img
                  src={qrUri}
                  alt="TOTP QR code — scan with your authenticator app"
                  className="w-40 h-40 border border-gray-200 dark:border-gray-700 rounded-lg"
                />
              </div>
              {secret && (
                <div className="space-y-1">
                  <p className="text-xs text-gray-500">Or enter the key manually:</p>
                  <div className="flex items-center gap-2 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                    <code className="flex-1 text-xs font-mono text-gray-700 dark:text-gray-300 break-all">
                      {secret}
                    </code>
                    <button
                      type="button"
                      onClick={handleCopy}
                      className="shrink-0 text-gray-400 hover:text-primary transition-colors"
                      aria-label="Copy secret key"
                    >
                      {copied
                        ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                        : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={() => setStep('verify')}
                className="w-full py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light transition-colors"
              >
                I've scanned it — continue
              </button>
            </>
          )}

          {step === 'verify' && (
            <>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Enter the 6-digit code from your authenticator app to confirm setup.
              </p>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">Verification code</label>
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={code}
                  onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="000000"
                  autoFocus
                  className={`${inputCls} text-center text-xl tracking-widest font-mono`}
                  onKeyDown={e => { if (e.key === 'Enter') handleVerify() }}
                />
              </div>
              <button
                type="button"
                onClick={handleVerify}
                disabled={loading || code.length < 6}
                className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light disabled:opacity-60 transition-colors"
              >
                {loading && <Loader2 className="w-4 h-4 animate-spin" />}
                {loading ? 'Verifying…' : 'Verify & enable 2FA'}
              </button>
            </>
          )}

          {step === 'done' && (
            <>
              <div className="flex flex-col items-center gap-3 py-2">
                <div className="w-14 h-14 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                  <CheckCircle2 className="w-7 h-7 text-green-600 dark:text-green-400" />
                </div>
                <p className="text-sm font-semibold text-gray-900 dark:text-white">2FA enabled!</p>
                <p className="text-xs text-gray-500 text-center">
                  Your account is now protected with two-factor authentication. You'll be asked for a code each time you sign in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { onDone(); onClose() }}
                className="w-full py-2.5 px-4 bg-primary text-white text-sm font-semibold rounded-lg hover:bg-primary-light transition-colors"
              >
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
