import CategoryLedger from './CategoryLedger'
import PercentageAllocation from './PercentageAllocation'
import SpecificGivings from './SpecificGivings'
import SavingsPortions from './SavingsPortions'
import { CentreTabs, useCentreTab, type CentreTabDef } from '../components/ui/CentreTabs'

const TABS: CentreTabDef[] = [
  { id: 'accounts',   label: 'Category Accounts' },
  { id: 'regular',    label: 'Regular Funds' },
  { id: 'designated', label: 'Designated Gifts' },
  { id: 'savings',    label: 'Savings Funds' },
]

// Single entry point for fund balances. The four former pages are views over
// the same allocation data; each tab renders the existing page component
// unchanged. Old routes redirect here with the matching ?tab= param.
export default function Funds() {
  const { active, setActive, visible } = useCentreTab(TABS, 'accounts')
  return (
    <div className="space-y-5">
      <CentreTabs tabs={visible} active={active} onChange={setActive} />
      {active === 'accounts'   && <CategoryLedger />}
      {active === 'regular'    && <PercentageAllocation />}
      {active === 'designated' && <SpecificGivings />}
      {active === 'savings'    && <SavingsPortions />}
    </div>
  )
}
