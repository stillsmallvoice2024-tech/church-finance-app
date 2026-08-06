import Reports from './Reports'
import FinancialReport from './FinancialReport'
import DynamicReports from './DynamicReports'
import { CentreTabs, useCentreTab, type CentreTabDef } from '../components/ui/CentreTabs'
import { PlanGate } from '../components/auth/PlanGates'
import { usePlan, TIER_SHORT_NAME, FEATURE_TIERS } from '../hooks/usePlan'

// Single entry point for all reporting. Each tab renders the existing page
// component unchanged; old routes (/financial-report, /dynamic-reports)
// redirect here with the matching ?tab= param. Standard Reports is available
// to any org that can reach Report Centre at all (Growth+, enforced by the
// /reports route guard in App.tsx); Board Report and Custom Reports are
// Impact-only — tabs stay visible (not hidden) with a lock + tier chip so a
// Growth org can see what they're missing, per the "grey out, don't hide"
// pattern used everywhere else in the app.
export default function ReportCentre() {
  const { hasFeature } = usePlan()
  const boardLocked  = !hasFeature('boardReport')
  const customLocked = !hasFeature('dynamicReports')

  const TABS: CentreTabDef[] = [
    { id: 'standard',  label: 'Standard Reports' },
    { id: 'financial', label: 'Board Report', locked: boardLocked, lockedTierLabel: TIER_SHORT_NAME[FEATURE_TIERS.boardReport] },
    { id: 'custom',    label: 'Custom Reports', locked: customLocked, lockedTierLabel: TIER_SHORT_NAME[FEATURE_TIERS.dynamicReports] },
  ]

  const { active, setActive, visible } = useCentreTab(TABS, 'standard')
  return (
    <div className="space-y-5">
      <CentreTabs tabs={visible} active={active} onChange={setActive} />
      {active === 'standard'  && <Reports />}
      {active === 'financial' && <PlanGate feature="boardReport"><FinancialReport /></PlanGate>}
      {active === 'custom'    && <PlanGate feature="dynamicReports"><DynamicReports /></PlanGate>}
    </div>
  )
}
