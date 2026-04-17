import { COLORS, useUISettings } from '../../theme';

/**
 * Shared hook for extracting KPI data from dashboard_data.json.
 * Used by all per-structure KPI components.
 */
export default function useKPIData(data) {
  const { ui } = useUISettings();
  const meta = data.simulation_meta || {};
  const ig = data.investment_grid || {};
  const ca = data.cashflow_analysis || {};
  const risk = data.risk || {};
  const moicDist = risk.moic_distribution || {};
  const irrDist = risk.irr_distribution || {};

  const refKey = ig['10_20'] ? '10_20' : ig['10_10'] ? '10_10' : Object.keys(ig)[0];
  const ref = ig[refKey] || {};
  const totalSOC = meta.total_soc_cr || 0;
  const ps = ca.portfolio_summary || {};
  const totalCollected = ps.total_e_collected_cr || 0;
  const totalLegal = ps.total_e_legal_cr || 0;
  const totalNet = ps.total_e_net_cr || 0;

  const eMoic = ref.mean_moic || moicDist.p50 || 0;
  const eIrr = ref.expected_xirr ?? ref.mean_xirr ?? irrDist.p50 ?? 0;
  const irrLabel = ref.expected_xirr != null ? 'E[IRR]' : 'Mean IRR';
  const pLoss = ref.p_loss ?? 0;
  const pHurdle = ref.p_hurdle ?? 0;

  const favorColor = (v, good, bad) =>
    v >= good ? '#34D399' : v >= bad ? COLORS.accent3 : COLORS.accent5;

  return {
    ui, meta, ig, ca, risk, moicDist, irrDist,
    refKey, ref, totalSOC, totalCollected, totalLegal, totalNet,
    eMoic, eIrr, irrLabel, pLoss, pHurdle, favorColor,
  };
}
