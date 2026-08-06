import { useState } from 'react'
import { Mail, ExternalLink, Copy, Check } from 'lucide-react'
import { Modal } from '../ui/Modal'

export interface EmailDraft {
  to:      string
  subject: string
  body:    string
}

export function mailtoHref({ to, subject, body }: EmailDraft): string {
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

// Opens Gmail's web compose UI prefilled — covers the common "no desktop
// mail client configured, but I use Gmail in the browser" case that a bare
// mailto: link can't reach (there's no click-time way to detect a missing
// mail handler, so we offer this alongside mailto rather than instead of it).
export function gmailComposeHref({ to, subject, body }: EmailDraft): string {
  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

interface Props {
  open:         boolean
  onClose:      () => void
  draft:        EmailDraft
  /** Short line explaining what this email is for, shown above the preview. */
  description?: string
}

export function ContactEmailModal({ open, onClose, draft, description }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(`To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal open={open} onClose={onClose} title="Email us" size="max-w-md">
      <div className="space-y-4">
        {description && (
          <p className="text-sm text-gray-500 dark:text-gray-400">{description}</p>
        )}

        <div className="space-y-1.5 text-sm">
          <div className="flex gap-2">
            <span className="font-medium text-gray-500 dark:text-gray-400 w-16 shrink-0">To</span>
            <span className="text-gray-800 dark:text-gray-200 break-all">{draft.to}</span>
          </div>
          <div className="flex gap-2">
            <span className="font-medium text-gray-500 dark:text-gray-400 w-16 shrink-0">Subject</span>
            <span className="text-gray-800 dark:text-gray-200">{draft.subject}</span>
          </div>
        </div>

        <textarea
          readOnly
          value={draft.body}
          rows={6}
          onFocus={e => e.target.select()}
          className="w-full text-sm px-3 py-2 border border-gray-200 dark:border-white/10 rounded-lg bg-gray-50 dark:bg-white/5 text-gray-700 dark:text-gray-300 resize-none outline-none focus:ring-2 focus:ring-primary/30"
        />

        <p className="text-xs text-gray-400 dark:text-gray-500">
          No email app set up on this device? Copy the message and paste it into whatever you use.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <a
            href={mailtoHref(draft)}
            className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold rounded-lg py-2 bg-primary text-white hover:opacity-90 transition-opacity"
          >
            <Mail className="w-3.5 h-3.5" />
            Email app
          </a>
          <a
            href={gmailComposeHref(draft)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold rounded-lg py-2 border border-gray-300 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Gmail
          </a>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold rounded-lg py-2 border border-gray-300 dark:border-white/15 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-white/5 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
