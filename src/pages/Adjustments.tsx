import PendingDeductions from './PendingDeductions'
import RefundTransactions from './RefundTransactions'
import ReversalTransactions from './ReversalTransactions'
import { CentreTabs, useCentreTab, type CentreTabDef } from '../components/ui/CentreTabs'

const TABS: CentreTabDef[] = [
  { id: 'upcoming',  label: 'Upcoming Deductions' },
  { id: 'refunds',   label: 'Refunds' },
  { id: 'reversals', label: 'Reversals' },
]

// Single entry point for transaction adjustments. Each tab renders the
// existing page component unchanged; old routes (/pending-deductions,
// /refunds, /reversals) redirect here with the matching ?tab= param.
export default function Adjustments() {
  const { active, setActive, visible } = useCentreTab(TABS, 'upcoming')
  return (
    <div className="space-y-5">
      <CentreTabs tabs={visible} active={active} onChange={setActive} />
      {active === 'upcoming'  && <PendingDeductions />}
      {active === 'refunds'   && <RefundTransactions />}
      {active === 'reversals' && <ReversalTransactions />}
    </div>
  )
}
