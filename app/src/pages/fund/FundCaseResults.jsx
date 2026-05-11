import { useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useFundStore } from '../../store/fundStore'
import { Loader2, ArrowLeft } from 'lucide-react'
import FundSummaryMetrics from '../../components/fund/FundSummaryMetrics'
import FundJCurveChart from '../../components/fund/FundJCurveChart'
import FundCashflowChart from '../../components/fund/FundCashflowChart'

export default function FundCaseResults() {
  const { id } = useParams()
  const { activeSimulation, fetchSimulation, loading, error } = useFundStore()

  useEffect(() => {
    if (id) fetchSimulation(id)
  }, [id, fetchSimulation])

  if (loading) return <div className="py-16 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Loading results…</div>
  if (error) return <div className="py-16 text-center text-red-400">{error}</div>
  if (!activeSimulation) return <div className="py-16 text-center text-slate-400">Case simulation not found</div>

  const dashboard = activeSimulation.dashboard_data || activeSimulation.results_summary || {}
  const jCurveData = dashboard.j_curve || dashboard.J_CURVE_DATA || []
  const cashflowData = dashboard.cashflows || dashboard.ALPHA_CASHFLOW_DATA || []
  const summaryStats = dashboard.summary_metrics || dashboard.SIM_STATS_DATA || null

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center gap-4">
        <Link to="/fund-analytics/case/history" className="p-2 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
            {activeSimulation.name || `Case ${activeSimulation.id?.slice(0, 8)}`}
          </h1>
          <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">Case simulation results</p>
        </div>
      </div>

      <FundSummaryMetrics data={summaryStats} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <FundJCurveChart data={jCurveData} />
        <FundCashflowChart data={cashflowData} />
      </div>
    </div>
  )
}
