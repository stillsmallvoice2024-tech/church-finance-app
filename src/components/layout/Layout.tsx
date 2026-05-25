import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { BottomTabBar } from './BottomTabBar'
import { ToastContainer } from '../ui/Toast'
import { FloatingCalculator } from '../ui/FloatingCalculator'

export function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="flex h-screen bg-background">
      {/* Skip to main content — visible on keyboard focus only */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-primary focus:text-white focus:rounded-lg focus:text-sm focus:font-medium focus:shadow-lg"
      >
        Skip to main content
      </a>

      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Main content: offset by sidebar width on desktop */}
      <div className="flex flex-col flex-1 min-w-0 lg:ml-64">
        <TopBar onMenuClick={() => setSidebarOpen(true)} />
        {/* pb-16 provides clearance for bottom tab bar on mobile */}
        <main id="main-content" className="flex-1 overflow-y-auto overflow-x-hidden p-4 pb-20 lg:p-6 lg:pb-6 dark:bg-gray-900">
          <Outlet />
        </main>
      </div>

      <BottomTabBar />
      <ToastContainer />
      <FloatingCalculator />
    </div>
  )
}
