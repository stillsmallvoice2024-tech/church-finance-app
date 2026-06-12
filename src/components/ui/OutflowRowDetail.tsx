import { memo } from 'react'
import { type OutflowTransaction } from '../../hooks/useTransactions'
import { RowDetailPanel } from './RowDetailPanel'
import { TransactionStory } from './TransactionStory'
import { outflowDetailItems } from '../../utils/rowDetailItems'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'

interface OutflowRowDetailProps {
  row:     OutflowTransaction
  colSpan: number
}

export const OutflowRowDetail = memo(function OutflowRowDetail({ row, colSpan }: OutflowRowDetailProps) {
  const { baseCurrencyCode } = useOrgCurrency()
  return (
    <RowDetailPanel
      items={outflowDetailItems(row, baseCurrencyCode)}
      colSpan={colSpan}
      footer={
        <TransactionStory
          table="outflow_transactions"
          recordId={row.id}
          createdAt={row.created_at}
        />
      }
    />
  )
})
