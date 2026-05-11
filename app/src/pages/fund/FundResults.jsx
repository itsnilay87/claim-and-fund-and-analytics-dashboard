import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useFundStore } from '../../store/fundStore'
import { Loader2, ArrowLeft, Download } from 'lucide-react'
import FundSummaryMetrics from '../../components/fund/FundSummaryMetrics'
import FundJCurveChart from '../../components/fund/FundJCurveChart'
import FundIRRDistribution from '../../components/fund/FundIRRDistribution'
import FundSensitivityChart from '../../components/fund/FundSensitivityChart'
import FundNAVChart from '../../components/fund/FundNAVChart'
import FundCashflowChart from '../../components/fund/FundCashflowChart'
import FundScenarioSelector from '../../components/fund/FundScenarioSelector'

export default function FundResults() {
  const { id } = useParams()
  const { activeSimulation, fetchSimulation, loading, error } = useFundStore()
  const [activeScenario, setActiveScenario] = useState(null)

  useEffect(() => {
    if (id) fetchSimulation(id)
  }, [id, fetchSimulation])

  useEffect(() => {
    if (activeSimulation?.scenarios?.length > 0 && !activeScenario) {
      setActiveScenario(activeSimulation.scenarios[0])
    }
  }, [activeSimulation, activeScenario])

  if (loading) return <div className="py-16 text-center text-slate-400"><Loader2 size={24} className="animate-spin mx-auto mb-2" />Loading results…</div>
  if (error) return <div className="py-16 text-center text-red-400">{error}</div>
  if (!activeSimulation) return <div className="py-16 text-center text-slate-400">Simulation not found</div>

  const dashboard = activeSimulation.dashboard_data || activeSimulation.results_summary || {}
  const scenarioData = activeScenario && dashboard[activeScenario] ? dashboard[activeScenario] : dashboard

  const jCurveData = scenarioData.j_curve || scenarioData.J_CURVE_DATA || []
  const irrData = scenarioData.irr_distribution || scenarioData.IRR_DATA || []
  const sensitivityData = scenarioData.sensitivity_data || scenarioData.SENSITIVITY_DATA || []
  const navData = scenarioData.nav || scenarioData.NAV_DATA || []
  const cashflowData = scenarioData.cashflows || scenarioData.ALPHA_CASHFLOW_DATA || []
  const summaryStats = scenarioData.summary_metrics || scenarioData.SIM_STATS_DATA || scenarioData.sim_stats || null
  const distributions = scenarioData.distributions || scenarioData.SIM_DISTRIBUTIONS_DATA || null

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/fund-analytics/history" className="p-2 rounded-lg text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5">
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
              {activeSimulation.name || `Simulation ${activeSimulation.id?.slice(0, 8)}`}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 text-sm mt-0.5">
              {activeSimulation.num_simulations?.toLocaleString() || '—'} simulations
              {activeSimulation.funding_profile ? ` · ${activeSimulation.funding_profile}` : ''}
              {activeSimulation.sensitivity ? ' · Sensitivity' : ''}
            </p>
          </div>
        </div>
        <FundScenarioSelector scenarios={activeSimulation.scenarios} active={activeScenario} onChange={setActiveScenario} />
      </div>

      <FundSummaryMetrics data={summaryStats} />

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <FundJCurveChart data={jCurveData} />
        <FundIRRDistribution data={irrData} distributions={distributions} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <FundNAVChart data={navData} />
        <FundCashflowChart data={cashflowData} />
      </div>

      {sensitivityData.length > 0 && (
        <FundSensitivityChart data={sensitivityData} />
      )}
    </div>
  )
}
