import { memo } from 'react'
import { type OutflowTransaction } from '../../hooks/useTransactions'
import { RowDetailPanel } from './RowDetailPanel'
import { outflowDetailItems } from '../../utils/rowDetailItems'

interface OutflowRowDetailProps {
  row:     OutflowTransaction
  colSpan: number
}

export const OutflowRowDetail = memo(function OutflowRowDetail({ row, colSpan }: OutflowRowDetailProps) {
  return <RowDetailPanel items={outflowDetailItems(row)} colSpan={colSpan} />
})
