import Reports from './Reports'
import FinancialReport from './FinancialReport'
import DynamicReports from './DynamicReports'
import { CentreTabs, useCentreTab, type CentreTabDef } from '../components/ui/CentreTabs'

const TABS: CentreTabDef[] = [
  { id: 'standard',  label: 'Standard Reports' },
  { id: 'financial', label: 'Board Report' },
  { id: 'custom',    label: 'Custom Reports' },
]

// Single entry point for all reporting. Each tab renders the existing page
// component unchanged; old routes (/financial-report, /dynamic-reports)
// redirect here with the matching ?tab= param.
export default function ReportCentre() {
  const { active, setActive, visible } = useCentreTab(TABS, 'standard')
  return (
    <div className="space-y-5">
      <CentreTabs tabs={visible} active={active} onChange={setActive} />
      {active === 'standard'  && <Reports />}
      {active === 'financial' && <FinancialReport />}
      {active === 'custom'    && <DynamicReports />}
    </div>
  )
}
