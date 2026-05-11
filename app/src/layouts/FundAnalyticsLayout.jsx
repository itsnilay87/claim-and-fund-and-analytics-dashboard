import { Outlet } from 'react-router-dom'
import FundSidebar from '../components/layout/FundSidebar'
import TopBar from '../components/layout/TopBar'

export default function FundAnalyticsLayout() {
  return (
    <div className="flex h-screen bg-gray-50 dark:bg-slate-950 overflow-hidden transition-colors duration-300">
      <FundSidebar />
      <div className="flex-1 flex flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
