import { formatDate, formatCurrency, getCurrencySymbol } from './formatters'
import type { InflowTransaction, OutflowTransaction } from '../hooks/useTransactions'
import type { DetailItem } from '../components/ui/RowDetailPanel'

const TXN_TYPE_LABELS: Record<string, string> = {
  refund:                  'Refund',
  reversal:                'Reversal',
  bank_deposit:            'Bank Deposit',
  intrabank_transfer:      'Intrabank Transfer',
  balance_brought_forward: 'Balance Brought Forward',
}

export function inflowDetailItems(row: InflowTransaction, _currency: string): DetailItem[] {
  return [
    { label: 'Txn Ref',         value: row.transaction_ref,          mono: true, breakAll: true },
    { label: 'Recorded',        value: row.recorded_at ? formatDate(row.recorded_at.slice(0, 10)) : null },
    { label: 'Raw Description', value: row.description,              breakAll: true },
    { label: 'Remark',          value: row.remark,                   breakAll: true },
    { label: 'Stage Code 1',    value: row.stage_code_1 },
    { label: 'Stage Code 2',    value: row.stage_code_2 },
    { label: 'Stage Code 3',    value: row.stage_code_3 },
    { label: 'Specific Seed',   value: row.specific_seed_description },
    {
      label: 'FX',
      value: row.fx_currency
        ? `${row.fx_currency} ${row.fx_amount != null ? formatCurrency(Number(row.fx_amount), row.fx_currency) : ''}${row.fx_rate != null ? ` @ ${row.fx_rate}` : ''}`
        : null,
      mono: true,
    },
    {
      label: 'Type',
      value: row.transaction_type
        ? (TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type)
        : null,
    },
    {
      label: 'Offset Role',
      value: row.offset_role === 'root' ? 'Root' : row.offset_role === 'offset' ? 'Offset' : null,
      badge: row.offset_role === 'root' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
    },
    { label: 'Root / Orig Txn ID', value: row.original_transaction_id, mono: true, breakAll: true },
  ]
}

export function outflowDetailItems(row: OutflowTransaction, currency: string): DetailItem[] {
  const sym = getCurrencySymbol(currency)
  const net = Number(row.amount_disbursed) - Number(row.amount_refunded) - Number(row.transfer_charge)
  return [
    { label: 'Txn ID',                   value: row.transaction_id,           mono: true, breakAll: true },
    { label: 'Recorded',                 value: row.recorded_at ? formatDate(row.recorded_at.slice(0, 10)) : null },
    { label: 'Raw Bank Narration',       value: row.description,              breakAll: true },
    { label: 'Remarks',                  value: row.remarks,                  breakAll: true },
    { label: `Refunded (${sym})`,        value: Number(row.amount_refunded) > 0 ? formatCurrency(Number(row.amount_refunded), currency) : null, mono: true },
    { label: `Transfer Charge (${sym})`, value: Number(row.transfer_charge) > 0 ? formatCurrency(Number(row.transfer_charge), currency) : null, mono: true },
    { label: `Net (${sym})`,             value: net !== Number(row.amount_disbursed) ? formatCurrency(net, currency) : null, mono: true },
    { label: 'Stage Code 1',        value: row.stage_code_1 },
    { label: 'Stage Code 2',        value: row.stage_code_2 },
    { label: 'Outflow Type',        value: row.outflow_type_name },
    {
      label: 'FX',
      value: row.fx_currency
        ? `${row.fx_currency} ${row.fx_amount != null ? formatCurrency(Number(row.fx_amount), row.fx_currency) : ''}${row.fx_rate != null ? ` @ ${row.fx_rate}` : ''}`
        : null,
      mono: true,
    },
    {
      label: 'Type',
      value: row.transaction_type
        ? (TXN_TYPE_LABELS[row.transaction_type] ?? row.transaction_type)
        : null,
    },
    { label: 'Status', value: row.is_pending_deduction ? 'Pending Deduction' : null, badge: 'bg-amber-100 text-amber-700' },
    {
      label: 'Offset Role',
      value: row.offset_role === 'root' ? 'Root' : row.offset_role === 'offset' ? 'Offset' : null,
      badge: row.offset_role === 'root' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700',
    },
    { label: 'Root / Orig Txn ID', value: row.original_transaction_id, mono: true, breakAll: true },
  ]
}
