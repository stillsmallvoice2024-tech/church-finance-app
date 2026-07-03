import Settings from './Settings'
import Setup from './Setup'
import { useRole } from '../hooks/useRole'
import { CentreTabs, useCentreTab, type CentreTabDef } from '../components/ui/CentreTabs'

// Single configuration destination. General Settings is the former /settings
// page; Finance Setup is the former /setup page (banks, distribution rules,
// income/outflow types, departments, currencies) and stays hidden for
// viewers, matching the old CanWriteGuard on /setup. The old /setup route
// redirects here with ?tab=setup; useCentreTab falls back to General when a
// viewer follows such a link.
export default function SettingsCentre() {
  const { canWrite } = useRole()
  const TABS: CentreTabDef[] = [
    { id: 'general', label: 'General Settings' },
    { id: 'setup',   label: 'Finance Setup', hidden: !canWrite() },
  ]
  const { active, setActive, visible } = useCentreTab(TABS, 'general')
  return (
    <div className="space-y-5">
      <CentreTabs tabs={visible} active={active} onChange={setActive} />
      {active === 'general' && <Settings />}
      {active === 'setup'   && <Setup />}
    </div>
  )
}
