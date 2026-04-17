import { useAccountingYearStore } from '../store/accountingYearStore'

export function useYearRange() {
  const year = useAccountingYearStore(s => s.year)
  return {
    year,
    dateFrom: `${year}-01-01`,
    dateTo:   `${year}-12-31`,
  }
}
