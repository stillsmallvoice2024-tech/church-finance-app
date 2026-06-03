import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { BottomTabBar } from './BottomTabBar'
import { ToastContainer } from '../ui/Toast'
import { FloatingCalculator } from '../ui/FloatingCalculator'
import { TourEngine } from '../onboarding/TourEngine'
import { SetupWizard } from '../onboarding/SetupWizard'
import { HelpCenter } from '../onboarding/HelpCenter'

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Skip to main content — visible on keyboard focus only */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/*
        Safe zone — height is structurally constrained to (viewport - tab bar).
        The sibling spacer below reserves the tab bar height on mobile so this
        div never extends behind the BottomTabBar. HelpCenter portals into this
        element so it is geometrically bounded without any viewport arithmetic.
      */}
      <div id="layout-safe-zone" className="flex flex-1 min-h-0 relative overflow-hidden">
        <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="flex flex-col flex-1 min-w-0 lg:ml-64">
          <TopBar onMenuClick={() => setSidebarOpen(true)} />
          <main id="main-content" className="flex-1 overflow-y-auto overflow-x-hidden p-4 lg:p-6 dark:bg-gray-900">
            <Outlet />
          </main>
        </div>
      </div>

      {/*
        Tab bar height reservation — a non-visual spacer that takes up exactly
        the tab bar height on mobile. This pushes the safe zone up so the fixed
        BottomTabBar never overlaps it. Hidden on desktop (no tab bar).
      */}
      <div className="lg:hidden shrink-0" style={{ height: 'var(--tab-bar-height)' }} aria-hidden="true" />

      <BottomTabBar />
      <ToastContainer />
      <FloatingCalculator />
      <TourEngine />
      <SetupWizard />
      <HelpCenter />
    </div>
  )
}
