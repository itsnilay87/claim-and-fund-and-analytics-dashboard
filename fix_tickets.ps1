# Comprehensive ticket update script
# Handles: overview table Story Points removal, Dashboard Tab Verification updates for CAP-004/005/006, velocity notes cleanup

$filePath = Join-Path $PSScriptRoot 'DEV_SPRINT_1_JIRA_TICKETS.md'
$content = [System.IO.File]::ReadAllText($filePath, [System.Text.Encoding]::UTF8)
$lines = New-Object System.Collections.Generic.List[string]
$lines.AddRange(($content -split '\r?\n'))
Write-Host "Lines loaded: $($lines.Count)"

# ============================================================
# HELPER: Remove last table column from a markdown table row
# ============================================================
function Remove-LastColumn($line) {
    # Find the last " | xxx |" pattern and remove it
    if ($line -match '^(\|.+)\|[^|]+\|$') {
        return $matches[1] + '|'
    }
    return $line
}

# ============================================================
# 1. FIX OVERVIEW TABLE (lines 11-33 area, 0-indexed: 10-32)
# ============================================================
# Line 11 (idx 10): header - remove Story Points column
# Line 12 (idx 11): separator
# Lines 13-32 (idx 12-31): data rows
# Line 33 (idx 32): total row
Write-Host "`n=== Fixing Overview Table ==="

for ($i = 10; $i -lt 33 -and $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\|') {
        $lines[$i] = Remove-LastColumn $lines[$i]
    }
}
Write-Host "Overview table: Story Points column removed"

# ============================================================
# 2. REPLACE CAP-004 DASHBOARD TAB VERIFICATION (Staged Milestone)
# Lines 270-276 (0-indexed: 269-275), keep line 277 (blank) and 278+ (Data Binding)
# ============================================================
Write-Host "`n=== Updating CAP-004 (Staged Milestone) ==="

$cap004Tabs = @(
'2. **Dashboard Tab Verification - MONETISATION: STAGED MILESTONE PAYMENTS (11 Tabs)**'
''
'   **Tab 1 - Executive Summary**'
'   | Output | Description |'
'   |--------|-------------|'
'   | Portfolio Overview | Structure type, number of claims, jurisdiction breakdown |'
'   | Headline KPIs | Expected Portfolio MOIC, Expected Portfolio IRR, Total Investment Required, Expected Weighted Award, Probability of Overall Profit |'
'   | Milestone Schedule Summary | Number of milestone stages, total committed capital, draw-down timeline |'
'   | Risk Summary | Probability of total loss, downside MOIC (5th percentile), upside MOIC (95th percentile) |'
''
'   **Tab 2 - Milestone Analysis** (`MilestoneAnalysis.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Milestone Payment Schedule | Table: milestone #, trigger event, payment amount, cumulative invested, expected timing |'
'   | Milestone Draw-Down Chart | Bar/area chart showing capital deployment over time per milestone |'
'   | Scenario Comparison | Expected / Base / Stress milestone outcomes with IRR and MOIC for each |'
'   | Milestone Risk Matrix | Probability of reaching each milestone stage, conditional returns |'
''
'   **Tab 3 - Probability Outcomes** (`ProbabilityOutcomes.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Probability Tree | Interactive tree showing jurisdiction-specific challenge paths with probabilities at each node |'
'   | Scenario Paths Table | All terminal scenarios with: path description, cumulative probability, expected award, MOIC, IRR |'
'   | Probability Sensitivity | Tornado chart showing which probability nodes have the greatest impact on portfolio MOIC |'
'   | Outcome Distribution | Histogram of MOIC outcomes across all Monte Carlo iterations |'
''
'   **Tab 4 - Quantum & Timeline** (`QuantumTimeline.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Quantum Band Distribution | Table/chart of quantum bands with probabilities and expected award values |'
'   | Timeline Distribution | Histogram of case duration outcomes (years) |'
'   | Expected Timeline by Scenario | Table: scenario path, expected duration, milestone timing impact |'
'   | Interest Accumulation | Pre-award and post-award interest rates applied, total interest impact on quantum |'
''
'   **Tab 5 - Investment Analysis** (`InvestmentSOC.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Investment Grid | Sensitivity grid: milestone schedule configurations vs. expected MOIC/IRR |'
'   | Breakeven Analysis | Minimum win probability required for breakeven at each milestone configuration |'
'   | Capital Deployment Timeline | Chart showing staged capital deployment vs. cumulative exposure |'
'   | Return Waterfall | Waterfall chart: invested capital, milestone payments, award recovery, net return |'
''
'   **Tab 6 - Per-Claim Analysis** (`PerClaimContribution.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Claim Contribution Table | Each claim: name, jurisdiction, claim value, expected award, contribution to portfolio MOIC, weight |'
'   | Per-Claim Milestone Breakdown | How each claim milestone schedule contributes to overall draw-down |'
'   | Claim Risk Ranking | Claims ranked by risk-adjusted return contribution |'
''
'   **Tab 7 - Legal Costs** (`LegalCosts.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Legal Cost Breakdown | Table: cost stage, amount, timing, cumulative legal spend |'
'   | Cost vs. Award Ratio | Legal costs as percentage of expected award per claim |'
'   | Cost Sensitivity | Impact of legal cost overruns on portfolio IRR and MOIC |'
''
'   **Tab 8 - Cashflow & Waterfall** (`ClaimCashflow.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Cashflow Timeline | Time-series chart: milestone outflows, legal cost outflows, award inflows |'
'   | J-Curve Visualisation | Cumulative cashflow chart showing capital deployment trough and recovery |'
'   | Net Cashflow Table | Period-by-period breakdown: outflows, inflows, net, cumulative |'
'   | Waterfall Chart | Priority of payments: milestone recovery, legal cost recovery, profit split |'
''
'   **Tab 9 - Stochastic Pricing** (`StochasticPricing.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Monte Carlo Distribution | Histogram of portfolio returns across n iterations |'
'   | Confidence Intervals | Table: 5th, 25th, 50th, 75th, 95th percentile MOIC and IRR |'
'   | VaR Analysis | Value at Risk at 95% and 99% confidence levels |'
'   | Pricing Range | Suggested milestone pricing range based on target return thresholds |'
''
'   **Tab 10 - Pricing Surface** (`PricingSurface.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | 3D/Heatmap Surface | Milestone schedule (x-axis) vs. win probability (y-axis) vs. expected MOIC (z-axis/colour) |'
'   | Breakeven Contour | Contour line showing MOIC = 1.0x boundary |'
'   | Optimal Pricing Point | Highlighted optimal milestone configuration for target MOIC |'
''
'   **Tab 11 - Report Charts** (`ReportCharts.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Exportable Chart Pack | All key charts formatted for PDF/presentation export |'
'   | Summary Dashboard | Compact single-page view with headline KPIs and key charts |'
)

# Remove old lines 270-276 (0-indexed 269-275) and insert new content
$lines.RemoveRange(269, 7)
$lines.InsertRange(269, $cap004Tabs)
$cap004Shift = $cap004Tabs.Count - 7
Write-Host "CAP-004: Replaced 7 lines with $($cap004Tabs.Count) lines (shift: +$cap004Shift)"

# Update CAP-004 Acceptance Criteria (was at line 289, now shifted)
$acIdx004 = 289 - 1 + $cap004Shift
# Find the acceptance criteria block and update it
for ($i = $acIdx004; $i -lt $acIdx004 + 15 -and $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'All dashboard tabs render correctly') {
        $lines[$i] = '- [ ] All 11 dashboard tabs render correctly for staged structure'
        Write-Host "  Updated acceptance criteria: all 11 tabs"
    }
    if ($lines[$i] -match 'Screenshot evidence of all tabs') {
        $lines[$i] = '- [ ] Screenshot evidence of all 11 tabs for QA'
        Write-Host "  Updated acceptance criteria: screenshot 11 tabs"
    }
}

# ============================================================
# 3. REPLACE CAP-005 DASHBOARD TAB VERIFICATION (Full Purchase)
# Original line 327, now shifted by $cap004Shift
# Lines to replace: 327-332 (0-indexed: 326-331 + shift)
# ============================================================
Write-Host "`n=== Updating CAP-005 (Full Purchase) ==="

$cap005Start = 327 - 1 + $cap004Shift

# Verify we're at the right line
Write-Host "  Checking line $($cap005Start + 1): $($lines[$cap005Start].Substring(0, [Math]::Min(60, $lines[$cap005Start].Length)))"

$cap005Tabs = @(
'2. **Dashboard Tab Verification - MONETISATION: FULL UPFRONT PURCHASE (10 Tabs)**'
''
'   **Tab 1 - Executive Summary**'
'   | Output | Description |'
'   |--------|-------------|'
'   | Portfolio Overview | Structure type, number of claims, jurisdiction breakdown |'
'   | Headline KPIs | Expected Portfolio MOIC, Expected Portfolio IRR, Purchase Price, Breakeven Probability, Expected Net Return |'
'   | Purchase Structure Summary | Full upfront purchase price, implied discount to claim value, funding deployment |'
'   | Risk Summary | Probability of total loss, downside MOIC (5th percentile), upside MOIC (95th percentile) |'
''
'   **Tab 2 - Probability Outcomes** (`ProbabilityOutcomes.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Probability Tree | Interactive tree showing jurisdiction-specific challenge paths with probabilities at each node |'
'   | Scenario Paths Table | All terminal scenarios with: path description, cumulative probability, expected award, MOIC, IRR |'
'   | Probability Sensitivity | Tornado chart showing which probability nodes have the greatest impact on portfolio MOIC |'
'   | Outcome Distribution | Histogram of MOIC outcomes across all Monte Carlo iterations |'
''
'   **Tab 3 - Quantum & Timeline** (`QuantumTimeline.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Quantum Band Distribution | Table/chart of quantum bands with probabilities and expected award values |'
'   | Timeline Distribution | Histogram of case duration outcomes (years) |'
'   | Expected Timeline by Scenario | Table: scenario path, expected duration, recovery timing |'
'   | Interest Accumulation | Pre-award and post-award interest rates applied, total interest impact on quantum |'
''
'   **Tab 4 - Investment Analysis** (`InvestmentSOC.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Purchase Price Sensitivity Grid | Purchase price vs. expected MOIC/IRR matrix |'
'   | Breakeven Analysis | Minimum win probability required for breakeven at each purchase price level |'
'   | Capital Efficiency | Single upfront deployment vs. expected recovery timeline |'
'   | Return Waterfall | Waterfall chart: purchase price paid, award recovered, fees/costs, net return |'
''
'   **Tab 5 - Per-Claim Analysis** (`PerClaimContribution.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Claim Contribution Table | Each claim: name, jurisdiction, claim value, purchase price, expected award, contribution to portfolio MOIC, weight |'
'   | Per-Claim Purchase Pricing | Individual claim purchase price vs. expected value analysis |'
'   | Claim Risk Ranking | Claims ranked by risk-adjusted return contribution |'
''
'   **Tab 6 - Legal Costs** (`LegalCosts.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Legal Cost Breakdown | Table: cost stage, amount, timing, cumulative legal spend |'
'   | Cost vs. Purchase Price | Legal costs as percentage of purchase price and expected award per claim |'
'   | Cost Sensitivity | Impact of legal cost overruns on portfolio IRR and MOIC |'
''
'   **Tab 7 - Cashflow & Waterfall** (`ClaimCashflow.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Cashflow Timeline | Time-series chart: single upfront purchase outflow, legal cost outflows, award inflows |'
'   | J-Curve Visualisation | Cumulative cashflow chart showing upfront capital deployment and recovery |'
'   | Net Cashflow Table | Period-by-period breakdown: outflows, inflows, net, cumulative |'
'   | Waterfall Chart | Priority of payments: purchase price recovery, legal cost recovery, profit |'
''
'   **Tab 8 - Stochastic Pricing** (`StochasticPricing.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Monte Carlo Distribution | Histogram of portfolio returns across n iterations |'
'   | Confidence Intervals | Table: 5th, 25th, 50th, 75th, 95th percentile MOIC and IRR |'
'   | VaR Analysis | Value at Risk at 95% and 99% confidence levels |'
'   | Optimal Purchase Price | Suggested purchase price range based on target return thresholds |'
''
'   **Tab 9 - Pricing Surface** (`PricingSurface.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | 3D/Heatmap Surface | Purchase price (x-axis) vs. win probability (y-axis) vs. expected MOIC (z-axis/colour) |'
'   | Breakeven Contour | Contour line showing MOIC = 1.0x boundary across purchase price levels |'
'   | Optimal Pricing Point | Highlighted optimal purchase price for target MOIC |'
''
'   **Tab 10 - Report Charts** (`ReportCharts.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Exportable Chart Pack | All key charts formatted for PDF/presentation export |'
'   | Summary Dashboard | Compact single-page view with headline KPIs and key charts |'
)

# Count old lines (327-332, that's lines with the old simple bullet list)
# Need to find exact range: from "2. **Dashboard Tab Verification**" to the blank line before "3. **Hardcoded..."
$cap005End = $cap005Start
while ($cap005End -lt $lines.Count -and -not ($lines[$cap005End] -match '^\s*$' -and $cap005End -gt $cap005Start -and $lines[$cap005End + 1] -match '3\. \*\*Hardcoded')) {
    $cap005End++
}
$cap005OldCount = $cap005End - $cap005Start
Write-Host "  Removing lines $($cap005Start+1) to $($cap005End) ($cap005OldCount lines)"

$lines.RemoveRange($cap005Start, $cap005OldCount)
$lines.InsertRange($cap005Start, $cap005Tabs)
$cap005Shift = $cap005Tabs.Count - $cap005OldCount
Write-Host "CAP-005: Replaced $cap005OldCount lines with $($cap005Tabs.Count) lines (shift: +$cap005Shift)"

# Update CAP-005 Acceptance Criteria
$totalShift = $cap004Shift + $cap005Shift
$acIdx005 = 344 - 1 + $totalShift
for ($i = $acIdx005; $i -lt $acIdx005 + 15 -and $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'All dashboard tabs render correctly') {
        $lines[$i] = '- [ ] All 10 dashboard tabs render correctly for full_purchase structure'
        Write-Host "  Updated acceptance criteria: all 10 tabs"
    }
    if ($lines[$i] -match 'Screenshot evidence of all tabs') {
        $lines[$i] = '- [ ] Screenshot evidence of all 10 tabs for QA'
        Write-Host "  Updated acceptance criteria: screenshot 10 tabs"
    }
}

# ============================================================
# 4. REPLACE CAP-006 DASHBOARD TAB VERIFICATION (Litigation Funding)
# Original line 383, shifted by totalShift
# ============================================================
Write-Host "`n=== Updating CAP-006 (Litigation Funding) ==="

$cap006Start = 383 - 1 + $totalShift

Write-Host "  Checking line $($cap006Start + 1): $($lines[$cap006Start].Substring(0, [Math]::Min(60, $lines[$cap006Start].Length)))"

$cap006Tabs = @(
'2. **Dashboard Tab Verification - LITIGATION FUNDING PORTFOLIO (10 Tabs)**'
''
'   **Tab 1 - Executive Summary**'
'   | Output | Description |'
'   |--------|-------------|'
'   | Portfolio Overview | Structure type, number of claims, jurisdiction breakdown |'
'   | Headline KPIs | Expected Portfolio MOIC, Expected Portfolio IRR, Total Funding Deployed, Cost Multiple, Expected Return, Deployment Period |'
'   | Funding Structure Summary | Cost multiple cap, award ratio cap, waterfall type (standard/min), total funding commitment |'
'   | Risk Summary | Probability of total loss, downside MOIC (5th percentile), upside MOIC (95th percentile) |'
''
'   **Tab 2 - Probability Outcomes** (`ProbabilityOutcomes.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Probability Tree | Interactive tree showing jurisdiction-specific challenge paths with probabilities at each node |'
'   | Scenario Paths Table | All terminal scenarios with: path description, cumulative probability, expected award, funder return, MOIC, IRR |'
'   | Probability Sensitivity | Tornado chart showing which probability nodes have the greatest impact on funder MOIC |'
'   | Outcome Distribution | Histogram of funder MOIC outcomes across all Monte Carlo iterations |'
''
'   **Tab 3 - Quantum & Timeline** (`QuantumTimeline.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Quantum Band Distribution | Table/chart of quantum bands with probabilities and expected award values |'
'   | Timeline Distribution | Histogram of case duration outcomes (years) |'
'   | Expected Timeline by Scenario | Table: scenario path, expected duration, funding deployment period |'
'   | Interest Accumulation | Pre-award and post-award interest rates applied, total interest impact on quantum |'
''
'   **Tab 4 - Investment & Waterfall Analysis** (`LitFundingWaterfall.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Funding Waterfall | Visual waterfall showing priority of payments: invested capital, cost multiple return, remaining to claimant |'
'   | Cost Multiple Sensitivity Grid | Cost multiple vs. award ratio vs. expected funder MOIC/IRR matrix |'
'   | Breakeven Analysis | Minimum win probability required for breakeven at each cost multiple level |'
'   | Waterfall Type Comparison | Side-by-side standard vs. min waterfall type outcomes |'
''
'   **Tab 5 - Per-Claim Analysis** (`PerClaimContribution.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Claim Contribution Table | Each claim: name, jurisdiction, claim value, funding deployed, expected funder return, contribution to portfolio MOIC, weight |'
'   | Per-Claim Funding Breakdown | Individual claim funding cost multiple and expected recovery |'
'   | Claim Risk Ranking | Claims ranked by risk-adjusted return contribution to funder |'
''
'   **Tab 6 - Legal Costs** (`LegalCosts.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Legal Cost Breakdown | Table: cost stage, amount, timing, cumulative legal spend |'
'   | Cost vs. Funding Ratio | Legal costs as percentage of total funding deployed per claim |'
'   | Cost Sensitivity | Impact of legal cost overruns on funder IRR and MOIC |'
''
'   **Tab 7 - Cashflow & J-Curve** (`ClaimCashflow.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Cashflow Timeline | Time-series chart: funding deployment outflows, legal cost outflows, award/recovery inflows |'
'   | J-Curve Visualisation | Cumulative cashflow chart showing funding deployment trough and recovery |'
'   | Funder vs. Claimant Split | Period-by-period breakdown of funder share vs. claimant share |'
'   | Net Cashflow Table | Period-by-period breakdown: outflows, inflows, net, cumulative |'
''
'   **Tab 8 - Arb-Win Sensitivity** (`ArbWinSensitivity.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Arbitration Win Rate Sensitivity | Chart: win probability (x-axis) vs. expected funder MOIC (y-axis) at various cost multiples |'
'   | Cost Multiple vs. Win Rate Grid | Heatmap: cost multiple vs. win probability vs. expected return |'
'   | Breakeven Win Rate | Minimum arbitration win probability for funder breakeven at each cost multiple |'
'   | Scenario Table | Table showing funder returns at key win probability thresholds (50%, 60%, 70%, 80%, 90%) |'
''
'   **Tab 9 - Pricing Surface** (`PricingSurface.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | 3D/Heatmap Surface | Cost multiple (x-axis) vs. award ratio (y-axis) vs. expected funder MOIC (z-axis/colour) |'
'   | Breakeven Contour | Contour line showing MOIC = 1.0x boundary across cost multiple and award ratio combinations |'
'   | Optimal Pricing Point | Highlighted optimal cost multiple and award ratio for target funder MOIC |'
''
'   **Tab 10 - Report Charts** (`ReportCharts.jsx`)'
'   | Output | Description |'
'   |--------|-------------|'
'   | Exportable Chart Pack | All key charts formatted for PDF/presentation export |'
'   | Summary Dashboard | Compact single-page view with headline KPIs and key charts |'
)

# Find exact range
$cap006End = $cap006Start
while ($cap006End -lt $lines.Count -and -not ($lines[$cap006End] -match '^\s*$' -and $cap006End -gt $cap006Start -and $lines[$cap006End + 1] -match '3\. \*\*Hardcoded')) {
    $cap006End++
}
$cap006OldCount = $cap006End - $cap006Start
Write-Host "  Removing lines $($cap006Start+1) to $($cap006End) ($cap006OldCount lines)"

$lines.RemoveRange($cap006Start, $cap006OldCount)
$lines.InsertRange($cap006Start, $cap006Tabs)
$cap006Shift = $cap006Tabs.Count - $cap006OldCount
Write-Host "CAP-006: Replaced $cap006OldCount lines with $($cap006Tabs.Count) lines (shift: +$cap006Shift)"
$totalShift += $cap006Shift

# Update CAP-006 Acceptance Criteria
$acIdx006 = 401 - 1 + $totalShift
for ($i = $acIdx006; $i -lt $acIdx006 + 15 -and $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'All dashboard tabs render correctly') {
        $lines[$i] = '- [ ] All 10 dashboard tabs render correctly for litigation_funding structure'
        Write-Host "  Updated acceptance criteria: all 10 tabs"
    }
    if ($lines[$i] -match 'Screenshot evidence of all tabs') {
        $lines[$i] = '- [ ] Screenshot evidence of all 10 tabs for QA'
        Write-Host "  Updated acceptance criteria: screenshot 10 tabs"
    }
}

# ============================================================
# 5. UPDATE VELOCITY NOTES (remove story points reference)
# ============================================================
Write-Host "`n=== Updating Velocity Notes ==="

for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match 'Total Story Points') {
        $lines[$i] = '- **Sprint Scope:** 20 tickets across infrastructure, validation, security, and quality'
        Write-Host "  Replaced Total Story Points line"
    }
    if ($lines[$i] -match 'Recommended with AI agent') {
        $lines[$i] = '- **Recommended with AI agent (Opus 4.6):** Highly parallelizable tasks enable concurrent execution of audit + implementation tracks'
        Write-Host "  Updated AI agent recommendation"
    }
}

# ============================================================
# SAVE
# ============================================================
$output = $lines -join "`r`n"
[System.IO.File]::WriteAllText($filePath, $output, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "`nTotal lines after update: $($lines.Count)"
Write-Host "File saved successfully!"
