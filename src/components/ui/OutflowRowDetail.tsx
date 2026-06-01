import { memo } from 'react'
import { type OutflowTransaction } from '../../hooks/useTransactions'
import { RowDetailPanel } from './RowDetailPanel'
import { outflowDetailItems } from '../../utils/rowDetailItems'
import { useOrgCurrency } from '../../hooks/useOrgCurrency'

interface OutflowRowDetailProps {
  row:     OutflowTransaction
  colSpan: number
}

export const OutflowRowDetail = memo(function OutflowRowDetail({ row, colSpan }: OutflowRowDetailProps) {
  const { baseCurrencySymbol } = useOrgCurrency()
  return <RowDetailPanel items={outflowDetailItems(row, baseCurrencySymbol)} colSpan={colSpan} />
})
