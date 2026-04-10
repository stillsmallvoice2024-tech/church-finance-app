import { useFinanceStore } from '../store/financeStore'
import type { TransactionType } from '../types'

export function useTransactions(type?: TransactionType) {
  const { transactions, isLoading } = useFinanceStore()

  const filtered = type ? transactions.filter((t) => t.type === type) : transactions

  const total = filtered.reduce((sum, t) => sum + t.amount, 0)

  return { transactions: filtered, total, isLoading }
}
