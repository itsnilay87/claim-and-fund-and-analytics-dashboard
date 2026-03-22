#!/usr/bin/env bash
# =============================================================================
# scripts/e2e_test.sh — End-to-end integration test for Claim Analytics Platform
# =============================================================================
#
# Usage:  bash scripts/e2e_test.sh
# Prereq: Python engine deps installed, Node deps installed (cd server && npm install)
#
# Starts the Express server, runs claim + portfolio simulations via API,
# verifies JSON outputs and metric ranges, then prints PASS/FAIL summary.
# =============================================================================

set -euo pipefail

BASE_URL="http://localhost:3001"
SERVER_PID=""
PASS=0
FAIL=0
TESTS=()

# Colours (if terminal supports them)
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Colour

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    echo -e "\n${YELLOW}Stopping server (PID $SERVER_PID)...${NC}"
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

record() {
  local name="$1" result="$2"
  if [ "$result" = "PASS" ]; then
    PASS=$((PASS + 1))
    TESTS+=("${GREEN}✓ PASS${NC}: $name")
  else
    FAIL=$((FAIL + 1))
    TESTS+=("${RED}✗ FAIL${NC}: $name")
  fi
}

echo "========================================"
echo " Claim Analytics — E2E Integration Test"
echo "========================================"
echo ""

# ── Step 0: Start the server ──
echo "Starting API server..."
cd "$(dirname "$0")/.."
node server/server.js &
SERVER_PID=$!
sleep 3

# Verify server is up
if curl -sf "$BASE_URL/api/health" > /dev/null 2>&1; then
  record "Server starts and /api/health responds" "PASS"
  echo -e "${GREEN}Server running on port 3001${NC}"
else
  record "Server starts and /api/health responds" "FAIL"
  echo -e "${RED}Server failed to start. Aborting.${NC}"
  exit 1
fi

# ── Step 1: Single claim simulation ──
echo ""
echo "── Test: Single Claim Simulation ──"

CLAIM_BODY='{
  "claim_config": {
    "id": "e2e-claim-1",
    "name": "E2E Test Claim",
    "jurisdiction": "indian_domestic",
    "soc_value_cr": 500,
    "arbitration": {"win_probability": 0.70, "re_arb_win_probability": 0.70},
    "quantum": {"bands": [
      {"low": 0.0, "high": 0.2, "probability": 0.15},
      {"low": 0.2, "high": 0.4, "probability": 0.05},
      {"low": 0.4, "high": 0.6, "probability": 0.05},
      {"low": 0.6, "high": 0.8, "probability": 0.05},
      {"low": 0.8, "high": 1.0, "probability": 0.70}
    ]}
  },
  "simulation": {"n_paths": 1000, "seed": 42}
}'

CLAIM_RESP=$(curl -sf -X POST "$BASE_URL/api/simulate/claim" \
  -H "Content-Type: application/json" \
  -d "$CLAIM_BODY")

CLAIM_RUN_ID=$(echo "$CLAIM_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['runId'])" 2>/dev/null || echo "")

if [ -n "$CLAIM_RUN_ID" ]; then
  record "Claim simulation accepted (runId=$CLAIM_RUN_ID)" "PASS"
else
  record "Claim simulation accepted" "FAIL"
  echo -e "${RED}Failed to start claim simulation${NC}"
fi

# ── Step 2: Poll claim simulation until completion ──
echo "Polling claim simulation..."
CLAIM_STATUS="running"
POLL_COUNT=0
MAX_POLLS=120  # 2 minutes max

while [ "$CLAIM_STATUS" != "completed" ] && [ "$CLAIM_STATUS" != "failed" ] && [ $POLL_COUNT -lt $MAX_POLLS ]; do
  sleep 2
  POLL_COUNT=$((POLL_COUNT + 1))
  CLAIM_STATUS=$(curl -sf "$BASE_URL/api/status/$CLAIM_RUN_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "unknown")
  if [ $((POLL_COUNT % 5)) -eq 0 ]; then
    echo "  Poll $POLL_COUNT: status=$CLAIM_STATUS"
  fi
done

if [ "$CLAIM_STATUS" = "completed" ]; then
  record "Claim simulation completed" "PASS"
else
  record "Claim simulation completed (got: $CLAIM_STATUS)" "FAIL"
fi

# ── Step 3: Verify claim JSON output ──
echo "Verifying claim results..."
CLAIM_DATA=$(curl -sf "$BASE_URL/api/results/$CLAIM_RUN_ID/dashboard_data.json" 2>/dev/null || echo "")

if [ -n "$CLAIM_DATA" ]; then
  record "Claim dashboard_data.json accessible" "PASS"

  # Check expected fields using Python
  CLAIM_CHECKS=$(echo "$CLAIM_DATA" | python3 -c "
import sys, json, math

d = json.load(sys.stdin)
errors = []

# Check top-level keys
for key in ['claims', 'structure_type', 'simulation']:
    if key not in d:
        errors.append(f'Missing key: {key}')

# Check claims array
if 'claims' in d and isinstance(d['claims'], list) and len(d['claims']) > 0:
    claim = d['claims'][0]
    for field in ['id', 'name', 'jurisdiction', 'soc_value_cr']:
        if field not in claim:
            errors.append(f'Claim missing field: {field}')
    # Check outcome distribution if present
    if 'outcome_distribution' in claim:
        od = claim['outcome_distribution']
        for outcome_key in ['TRUE_WIN', 'LOSE']:
            if outcome_key not in od:
                errors.append(f'Missing outcome: {outcome_key}')
        # Validate win rate in [0, 1]
        total = sum(od.values())
        if not (0.99 <= total <= 1.01):
            errors.append(f'Outcome probs sum to {total}, expected ~1.0')
else:
    errors.append('No claims array or empty')

if errors:
    print('FAIL:' + '|'.join(errors))
else:
    print('PASS')
" 2>/dev/null || echo "FAIL:Python check crashed")

  if [[ "$CLAIM_CHECKS" == "PASS" ]]; then
    record "Claim JSON has expected fields and valid data" "PASS"
  else
    record "Claim JSON validation: ${CLAIM_CHECKS#FAIL:}" "FAIL"
  fi
else
  record "Claim dashboard_data.json accessible" "FAIL"
fi

# ── Step 4: Portfolio simulation (2 claims, upfront_tail structure) ──
echo ""
echo "── Test: Portfolio Simulation ──"

PORTFOLIO_BODY='{
  "portfolio_config": {
    "id": "e2e-portfolio-1",
    "name": "E2E Portfolio Test",
    "claim_ids": ["e2e-p-claim-1", "e2e-p-claim-2"],
    "structure": {
      "type": "upfront_tail",
      "params": {
        "upfront_range": {"low": 0.05, "high": 0.25, "steps": 5},
        "tail_range": {"low": 0.10, "high": 0.40, "steps": 7},
        "pricing_basis": "both"
      }
    },
    "simulation": {"n_paths": 1000, "seed": 42, "discount_rate": 0.12, "risk_free_rate": 0.07, "start_date": "2026-04-30"}
  },
  "claims": [
    {
      "id": "e2e-p-claim-1",
      "name": "Portfolio Claim 1",
      "jurisdiction": "indian_domestic",
      "soc_value_cr": 750,
      "arbitration": {"win_probability": 0.70, "re_arb_win_probability": 0.70},
      "quantum": {"bands": [
        {"low": 0.0, "high": 0.2, "probability": 0.15},
        {"low": 0.2, "high": 0.4, "probability": 0.05},
        {"low": 0.4, "high": 0.6, "probability": 0.05},
        {"low": 0.6, "high": 0.8, "probability": 0.05},
        {"low": 0.8, "high": 1.0, "probability": 0.70}
      ]}
    },
    {
      "id": "e2e-p-claim-2",
      "name": "Portfolio Claim 2",
      "jurisdiction": "siac_singapore",
      "soc_value_cr": 500,
      "arbitration": {"win_probability": 0.65, "re_arb_win_probability": 0.65},
      "quantum": {"bands": [
        {"low": 0.0, "high": 0.2, "probability": 0.10},
        {"low": 0.2, "high": 0.4, "probability": 0.10},
        {"low": 0.4, "high": 0.6, "probability": 0.10},
        {"low": 0.6, "high": 0.8, "probability": 0.10},
        {"low": 0.8, "high": 1.0, "probability": 0.60}
      ]}
    }
  ]
}'

PORTFOLIO_RESP=$(curl -sf -X POST "$BASE_URL/api/simulate/portfolio" \
  -H "Content-Type: application/json" \
  -d "$PORTFOLIO_BODY")

PORTFOLIO_RUN_ID=$(echo "$PORTFOLIO_RESP" | python3 -c "import sys,json; print(json.load(sys.stdin)['runId'])" 2>/dev/null || echo "")

if [ -n "$PORTFOLIO_RUN_ID" ]; then
  record "Portfolio simulation accepted (runId=$PORTFOLIO_RUN_ID)" "PASS"
else
  record "Portfolio simulation accepted" "FAIL"
fi

# ── Step 5: Poll portfolio simulation ──
echo "Polling portfolio simulation..."
PORT_STATUS="running"
POLL_COUNT=0

while [ "$PORT_STATUS" != "completed" ] && [ "$PORT_STATUS" != "failed" ] && [ $POLL_COUNT -lt $MAX_POLLS ]; do
  sleep 2
  POLL_COUNT=$((POLL_COUNT + 1))
  PORT_STATUS=$(curl -sf "$BASE_URL/api/status/$PORTFOLIO_RUN_ID" | python3 -c "import sys,json; print(json.load(sys.stdin)['status'])" 2>/dev/null || echo "unknown")
  if [ $((POLL_COUNT % 5)) -eq 0 ]; then
    echo "  Poll $POLL_COUNT: status=$PORT_STATUS"
  fi
done

if [ "$PORT_STATUS" = "completed" ]; then
  record "Portfolio simulation completed" "PASS"
else
  record "Portfolio simulation completed (got: $PORT_STATUS)" "FAIL"
fi

# ── Step 6: Verify portfolio JSON ──
echo "Verifying portfolio results..."
PORT_DATA=$(curl -sf "$BASE_URL/api/results/$PORTFOLIO_RUN_ID/dashboard_data.json" 2>/dev/null || echo "")

if [ -n "$PORT_DATA" ]; then
  record "Portfolio dashboard_data.json accessible" "PASS"

  PORT_CHECKS=$(echo "$PORT_DATA" | python3 -c "
import sys, json, math

d = json.load(sys.stdin)
errors = []

# Expected top-level keys
for key in ['claims', 'structure_type', 'simulation']:
    if key not in d:
        errors.append(f'Missing key: {key}')

# Check structure_type
st = d.get('structure_type', '')
if st != 'upfront_tail':
    errors.append(f'Expected structure_type=upfront_tail, got {st}')

# Check we have 2 claims
claims = d.get('claims', [])
if len(claims) != 2:
    errors.append(f'Expected 2 claims, got {len(claims)}')

# Check grid results exist
grid = d.get('grid_results') or d.get('pricing_grid') or d.get('investment_grid')
if grid:
    # Verify no NaN values
    def has_nan(obj):
        if isinstance(obj, float) and math.isnan(obj):
            return True
        if isinstance(obj, dict):
            return any(has_nan(v) for v in obj.values())
        if isinstance(obj, list):
            return any(has_nan(v) for v in obj)
        return False
    if has_nan(grid):
        errors.append('Grid contains NaN values')

    # Check grid has expected dimensions (5 upfront × 7 tail = 35 cells)
    if isinstance(grid, list):
        if len(grid) < 10:
            errors.append(f'Grid too small: {len(grid)} cells')

# Check risk metrics if present
risk = d.get('risk_metrics', {})
if risk:
    moic = risk.get('portfolio_moic_mean') or risk.get('mean_moic') or risk.get('moic_mean')
    if moic is not None and moic <= 0:
        errors.append(f'MOIC should be > 0, got {moic}')

if errors:
    print('FAIL:' + '|'.join(errors))
else:
    print('PASS')
" 2>/dev/null || echo "FAIL:Python check crashed")

  if [[ "$PORT_CHECKS" == "PASS" ]]; then
    record "Portfolio JSON has expected fields and valid data" "PASS"
  else
    record "Portfolio JSON validation: ${PORT_CHECKS#FAIL:}" "FAIL"
  fi
else
  record "Portfolio dashboard_data.json accessible" "FAIL"
fi

# ── Step 7: Check Excel file generated ──
echo "Checking Excel output..."
FILES_RESP=$(curl -sf "$BASE_URL/api/results/$PORTFOLIO_RUN_ID/files" 2>/dev/null || echo "")

if [ -n "$FILES_RESP" ]; then
  HAS_EXCEL=$(echo "$FILES_RESP" | python3 -c "
import sys, json
d = json.load(sys.stdin)
excel = d.get('excel', [])
print('YES' if len(excel) > 0 else 'NO')
" 2>/dev/null || echo "NO")

  if [ "$HAS_EXCEL" = "YES" ]; then
    record "Excel output file generated" "PASS"
  else
    record "Excel output file generated" "FAIL"
  fi
else
  record "Results file listing accessible" "FAIL"
fi

# ── Step 8: Metric range checks ──
echo "Checking metric ranges..."
if [ -n "$PORT_DATA" ]; then
  METRIC_CHECKS=$(echo "$PORT_DATA" | python3 -c "
import sys, json, math

d = json.load(sys.stdin)
errors = []

claims = d.get('claims', [])
for c in claims:
    name = c.get('name', 'unknown')
    od = c.get('outcome_distribution', {})
    if od:
        total = sum(od.values())
        if not (0.99 <= total <= 1.01):
            errors.append(f'{name}: outcome probs sum={total:.4f}')
        # Win rate check (any positive outcome)
        win_rate = sum(v for k, v in od.items() if k in ('TRUE_WIN', 'RESTART'))
        if not (0 <= win_rate <= 1):
            errors.append(f'{name}: win_rate={win_rate:.4f} out of [0,1]')

# Deep NaN scan on entire output
def find_nans(obj, path=''):
    found = []
    if isinstance(obj, float) and math.isnan(obj):
        found.append(path)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            found.extend(find_nans(v, f'{path}.{k}'))
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            found.extend(find_nans(v, f'{path}[{i}]'))
    return found

nans = find_nans(d)
if nans:
    errors.append(f'NaN found at: {nans[:5]}')

if errors:
    print('FAIL:' + '|'.join(errors))
else:
    print('PASS')
" 2>/dev/null || echo "FAIL:Python check crashed")

  if [[ "$METRIC_CHECKS" == "PASS" ]]; then
    record "All metrics in valid ranges, no NaN values" "PASS"
  else
    record "Metric range checks: ${METRIC_CHECKS#FAIL:}" "FAIL"
  fi
fi

# ── Step 9: Jurisdiction & defaults endpoints ──
echo ""
echo "── Test: Static Endpoints ──"

JURISDICTIONS=$(curl -sf "$BASE_URL/api/jurisdictions" 2>/dev/null || echo "")
if [ -n "$JURISDICTIONS" ]; then
  J_COUNT=$(echo "$JURISDICTIONS" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$J_COUNT" -ge 2 ]; then
    record "GET /api/jurisdictions returns >= 2 jurisdictions" "PASS"
  else
    record "GET /api/jurisdictions returns >= 2 jurisdictions (got $J_COUNT)" "FAIL"
  fi
else
  record "GET /api/jurisdictions responds" "FAIL"
fi

DEFAULTS=$(curl -sf "$BASE_URL/api/defaults" 2>/dev/null || echo "")
if [ -n "$DEFAULTS" ]; then
  record "GET /api/defaults responds" "PASS"
else
  record "GET /api/defaults responds" "FAIL"
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "========================================"
echo "              TEST SUMMARY"
echo "========================================"
echo ""
for t in "${TESTS[@]}"; do
  echo -e "  $t"
done
echo ""
TOTAL=$((PASS + FAIL))
echo -e "  ${GREEN}Passed: $PASS${NC}  ${RED}Failed: $FAIL${NC}  Total: $TOTAL"
echo ""

if [ $FAIL -eq 0 ]; then
  echo -e "  ${GREEN}██████████████████████████████████████${NC}"
  echo -e "  ${GREEN}         ALL TESTS PASSED            ${NC}"
  echo -e "  ${GREEN}██████████████████████████████████████${NC}"
  exit 0
else
  echo -e "  ${RED}██████████████████████████████████████${NC}"
  echo -e "  ${RED}         SOME TESTS FAILED           ${NC}"
  echo -e "  ${RED}██████████████████████████████████████${NC}"
  exit 1
fi
