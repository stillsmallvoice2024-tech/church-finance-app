import { useAuthStore } from '../store/useAuthStore'
import { supabase } from '../lib/supabase'

export default function DashboardPage() {
  const user = useAuthStore((state) => state.user)

  const handleSignOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm px-6 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-800">Church Finance</h1>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-600">{user?.email}</span>
          <button
            onClick={handleSignOut}
            className="text-sm text-red-600 hover:text-red-800 font-medium"
          >
            Sign out
          </button>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <h2 className="text-2xl font-semibold text-gray-700">Dashboard</h2>
        <p className="mt-2 text-gray-500">Welcome! Your finance dashboard will appear here.</p>
      </main>
    </div>
  )
}
