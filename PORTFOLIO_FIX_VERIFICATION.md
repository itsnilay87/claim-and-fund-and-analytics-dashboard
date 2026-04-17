# Portfolio Fix Verification Checklist

## Pre-Deployment Checks

### IRR Methodology (BUG-1)
- [ ] E[IRR] for ORIGO portfolio is positive (15-25% range) at 10/20 upfront/tail
- [ ] E[IRR] is consistent with E[MOIC]: if MOIC=2.3x, duration~5yr, IRR~18-22%
- [ ] mc_distributions.irr histogram shows realistic distribution (not dominated by -100%)
- [ ] Both mean_xirr and expected_xirr present in investment grid cells
- [ ] All metric tests pass (test_metrics.py, test_expected_irr.py)

### Concentration Data (BUG-2)
- [ ] Jurisdiction breakdown chart shows data (not "No jurisdiction data")
- [ ] Claim type chart shows data (not "No type data")
- [ ] Herfindahl indices are computed and in valid range [0, 1]
- [ ] Claims with missing jurisdiction default to "unknown" with warning log

### Claim Names (BUG-3)
- [ ] Executive Summary SOC chart shows claim names
- [ ] Per-Claim Contribution tab shows claim names
- [ ] Cashflow Waterfall tab shows claim names
- [ ] All other tabs show claim names where applicable
- [ ] No UUIDs visible anywhere in the dashboard

### Dynamic Config (BUG-4)
- [ ] mc_distributions correspond to user-selected upfront/tail, not 10/20
- [ ] KPI reference cell matches user-selected combo
- [ ] J-curve default_key matches user selection

### J-Curve (BUG-5)
- [ ] J-curve max_months derived from actual claim timelines
- [ ] Legal cost allocation configurable or derived from claim data
- [ ] User-selected combo is in available_combos
