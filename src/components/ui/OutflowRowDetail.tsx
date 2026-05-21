import { memo } from 'react'
import { type OutflowTransaction } from '../../hooks/useTransactions'
import { formatDate, formatCurrency } from '../../utils/formatters'

const TXN_TYPE_LABELS: Record<string, string> = {
  refund:             'Refund',
  reversal:           'Reversal',
  bank_deposit:       'Bank Deposit',
  intrabank_transfer: 'Intrabank Transfer',
}

function DetailField({ label, value, mono = false, valueCls = '' }: { label: string; value: React.ReactNode; mono?: boolean; valueCls?: string }) {
  if (value === null || value === undefined || value === '' || value === false) return null
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">{label}</p>
      <p className={`text-xs text-gray-700 break-words select-text${mono ? ' font-mono' : ''}${valueCls ? ' ' + valueCls : ''}`}>{value}</p>
    </div>
  )
}

interface OutflowRowDetailProps {
  row: OutflowTransaction
  colSpan: number
}

export const OutflowRowDetail = memo(function OutflowRowDetail({ row, colSpan }: OutflowRowDetailProps) {
  const net = Number(row.amount_disbursed) - Number(row.amount_refunded) - Number(row.transfer_charge)

  return (
    <tr className="bg-gray-50/70 border-b border-gray-100">
      <td colSpan={colSpan} className="px-6 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-8 gap-y-3">

          {/* Txn ID — wraps to 2 lines instead of truncating */}
          {row.transaction_id && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">Txn ID</p>
              <p className="text-xs font-mono text-gray-700 break-all whitespace-normal select-text">{row.transaction_id}</p>
            </div>
          )}

          <DetailField label="Recorded" value={row.recorded_at ? formatDate(row.recorded_at.slice(0, 10)) : null} />
          {row.display_description && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">Display Description</p>
              <p className="text-xs text-gray-700 break-all whitespace-normal select-text">{row.display_description}</p>
            </div>
          )}
          {row.bank_description && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">Raw Bank Narration</p>
              <p className="text-xs text-gray-700 break-all whitespace-normal select-text">{row.bank_description}</p>
            </div>
          )}
          <DetailField label="Remarks" value={row.remarks} valueCls="break-all whitespace-normal" />

          {Number(row.amount_refunded) > 0 && (
            <DetailField label="Refunded (₦)" value={formatCurrency(Number(row.amount_refunded))} mono />
          )}
          {Number(row.transfer_charge) > 0 && (
            <DetailField label="Transfer Charge (₦)" value={formatCurrency(Number(row.transfer_charge))} mono />
          )}
          {net !== Number(row.amount_disbursed) && (
            <DetailField label="Net (₦)" value={formatCurrency(net)} mono />
          )}

          <DetailField label="Stage Code 1" value={row.stage_code_1} />
          <DetailField label="Stage Code 2" value={row.stage_code_2} />

          {row.fx_currency && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">FX</p>
              <p className="text-xs font-mono text-gray-700">
                {row.fx_currency} {row.fx_amount != null ? formatCurrency(Number(row.fx_amount)) : ''}
                {row.fx_rate != null ? ` @ ${row.fx_rate}` : ''}
              </p>
            </div>
          )}

          {row.transaction_type && (
            <DetailField label="Type" value={TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type} />
          )}
          {row.original_transaction_id && (
            <DetailField label="Original Txn ID" value={row.original_transaction_id} mono />
          )}

          {row.is_pending_deduction && (
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-wide font-semibold text-gray-400 mb-0.5">Status</p>
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-700">
                Pending Deduction
              </span>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
})
