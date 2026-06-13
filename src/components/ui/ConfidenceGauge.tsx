import { Link } from 'react-router-dom'
import { ShieldCheck } from 'lucide-react'
import { Card } from './Card'
import { useRecordConfidence } from '../../hooks/useRecordConfidence'
import { useCountUp } from '../../hooks/useCountUp'

function tierColor(score: number) {
  if (score >= 85) return { stroke: '#16A34A', text: 'text-green-600',  label: 'Excellent' }
  if (score >= 60) return { stroke: '#D97706', text: 'text-amber-600',  label: 'Good — room to improve' }
  return             { stroke: '#DC2626', text: 'text-red-600',    label: 'Needs attention' }
}

function Arc({ score }: { score: number }) {
  const animated = useCountUp(score, 900)
  const { stroke, text } = tierColor(score)
  const R = 52
  const CIRC = 2 * Math.PI * R
  // 270° arc starting bottom-left
  const arcLen  = CIRC * 0.75
  const filled  = arcLen * (animated / 100)

  return (
    <div className="relative w-36 h-36">
      <svg viewBox="0 0 128 128" className="w-full h-full -rotate-[135deg]">
        <circle cx="64" cy="64" r={R} fill="none" stroke="currentColor"
          className="text-gray-100" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${arcLen} ${CIRC}`} />
        <circle cx="64" cy="64" r={R} fill="none" stroke={stroke}
          strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${filled} ${CIRC}`} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`text-3xl font-bold tabular-nums ${text}`}>{Math.round(animated)}</span>
        <span className="text-xs text-gray-500 font-medium">out of 100</span>
      </div>
    </div>
  )
}

/**
 * Record Confidence card — a display-only composite of reconciliation health,
 * bank completeness, and check recency. No financial logic.
 */
export function ConfidenceGauge() {
  const { score, bankCompleteness, suggestion, loading } = useRecordConfidence()

  return (
    <Card className="flex flex-col">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Record Confidence</h2>
      <p className="text-xs text-gray-500 mb-2">How complete and verified your records are</p>

      <div className="flex-1 flex flex-col items-center justify-center gap-2 py-2">
        {loading ? (
          <div className="w-36 h-36 rounded-full bg-gray-50 animate-pulse" />
        ) : score === null ? (
          <div className="flex flex-col items-center gap-3 text-center py-4">
            <div className="w-14 h-14 rounded-full bg-gray-50 flex items-center justify-center">
              <ShieldCheck className="w-7 h-7 text-gray-300" />
            </div>
            <p className="text-sm text-gray-500 max-w-[220px]">
              Run your first reconciliation check to see your confidence score.
            </p>
            <Link
              to="/reconciliation"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Run a check →
            </Link>
          </div>
        ) : (
          <>
            <Arc score={score} />
            <p className={`text-xs font-semibold ${tierColor(score).text}`}>{tierColor(score).label}</p>
          </>
        )}
      </div>

      {!loading && score !== null && (
        <div className="border-t border-gray-100 pt-3 mt-2 space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">Transactions with a bank assigned</span>
            <span className="font-semibold text-gray-700 tabular-nums">{bankCompleteness}%</span>
          </div>
          {suggestion && (
            <p className="text-xs text-gray-500 leading-relaxed">{suggestion}</p>
          )}
        </div>
      )}
    </Card>
  )
}
