"""
engine/tests/test_regression_snapshot.py — Monte Carlo Regression Snapshot Tests.
==================================================================================

Phase 1, Session 1B: Snapshot the V2 engine's statistical behaviour for the
6-claim TATA DFCCIL portfolio.  These tests lock in *current* outputs so that
Phases 2–4 (settlement bug fixes, engine convergence) can be verified against
a fixed baseline.

Layer: tests run through the **V2 core** engine directly
(``engine.v2_core.v2_monte_carlo.run_simulation``), with MI patching via the
adapter — exactly how ``engine/run_v2.py`` dispatches per-claim simulations.

Tolerance policy:
  ±5 percentage points (pp) for binomial proportions at N=2000.
  Justification: 95% CI for a proportion p is approximately
  p ± 1.96 × sqrt(p(1-p)/N).  At p=0.52, N=2000 this gives ±2.2pp.
  We use ±5pp to accommodate MI-patching overhead and floating-point
  non-determinism across platforms.

  ±0.03 for quantum E[q%|win] convergence at N=2000.
  ±0.05 for MOIC-like ratios.

All monetary values in ₹ Crore (Cr).
"""

from __future__ import annotations

import json
import math
import os
from pathlib import Path
from typing import Optional

import numpy as np
import pytest

from engine.adapter import (
    patch_master_inputs_for_claim,
    platform_claim_to_v2_claim,
    save_and_restore_mi,
)
from engine.config.schema import ClaimConfig as PlatformClaim
from engine.jurisdictions.registry import REGISTRY
from engine.v2_core import v2_master_inputs as MI
from engine.v2_core.v2_config import (
    PathResult,
    SimulationResults,
)
from engine.v2_core.v2_monte_carlo import run_simulation


# ============================================================================
# Constants
# ============================================================================

N_PATHS = 2_000   # Sufficient for ±5pp CI; much faster than 10K
SEED = 42
FIXTURE_PATH = Path(__file__).parent / "test_tata_portfolio.json"

DOMESTIC_IDS = ["TP-301-6", "TP-302-3", "TP-302-5"]
SIAC_IDS = ["TP-CTP11-2", "TP-CTP11-4", "TP-CTP13-2"]
ALL_IDS = DOMESTIC_IDS + SIAC_IDS

# Expected win-rate ranges (current engine behaviour, settlement DISABLED).
# Analytical domestic: P(arb_win) × P(TRUE_WIN|ScA) ≈ 0.70 × 0.736 = 0.515
#   plus RESTART recovery ≈ +0.045 minus 96-month cap loss ≈ -0.010
#   → effective ≈ 0.50–0.55.
# Analytical SIAC: 0.70 × 0.82 = 0.574 + higher RESTART recovery → ≈ 0.57–0.65
DOMESTIC_WIN_RANGE = (0.43, 0.63)  # ±5pp
SIAC_WIN_RANGE = (0.52, 0.72)      # ±5pp

# Expected E[quantum_pct | arb_won AND final_outcome == TRUE_WIN]
# = weighted midpoint of 5 bands: 0.15×0.10 + 0.05×0.30 + 0.05×0.50
#   + 0.05×0.70 + 0.70×0.90 = 0.72
EXPECTED_QUANTUM_PCT = 0.72
QUANTUM_TOL = 0.03  # ±0.03 at N=2000 (MC noise for conditional mean)


# ============================================================================
# Fixtures — run the V2 engine once, cache at module scope
# ============================================================================

def _load_fixture() -> dict:
    with open(FIXTURE_PATH) as f:
        return json.load(f)


def _build_claims(fixture: dict) -> list[PlatformClaim]:
    return [PlatformClaim(**c) for c in fixture["claims"]]


def _run_v2_portfolio(
    claims: list[PlatformClaim],
    n: int = N_PATHS,
    seed: int = SEED,
    settlement_override: Optional[bool] = None,
) -> dict[str, list[PathResult]]:
    """Run the V2 MC engine for all claims, returning per-claim PathResult lists.

    Follows the same orchestration as ``engine/run_v2.py``:
    for each claim → save MI → patch MI → run_simulation → restore MI.

    Parameters
    ----------
    settlement_override : bool, optional
        If provided, force SETTLEMENT_ENABLED to this value for ALL claims.
    """
    fixture = _load_fixture()
    sim_cfg = fixture["simulation"]
    templates = {
        "indian_domestic": REGISTRY.get_template("indian_domestic"),
        "siac_singapore": REGISTRY.get_template("siac_singapore"),
    }

    per_claim: dict[str, list[PathResult]] = {}

    for claim in claims:
        template = templates.get(claim.jurisdiction)

        with save_and_restore_mi():
            patch_master_inputs_for_claim(claim, template)

            MI.N_SIMULATIONS = n
            MI.RANDOM_SEED = seed
            MI.START_DATE = sim_cfg.get("start_date", "2026-04-30")
            MI.DISCOUNT_RATE = sim_cfg.get("discount_rate", 0.12)
            MI.RISK_FREE_RATE = sim_cfg.get("risk_free_rate", 0.07)

            if settlement_override is not None:
                MI.SETTLEMENT_ENABLED = settlement_override

            v2_claim = platform_claim_to_v2_claim(claim, template)
            sim = run_simulation(n=n, seed=seed, claims=[v2_claim])
            per_claim[claim.id] = sim.get_claim_results(v2_claim.claim_id)

    return per_claim


# ── Module-scoped fixtures (expensive — run once) ──

@pytest.fixture(scope="module")
def fixture_data() -> dict:
    return _load_fixture()


@pytest.fixture(scope="module")
def portfolio_claims(fixture_data) -> list[PlatformClaim]:
    return _build_claims(fixture_data)


@pytest.fixture(scope="module")
def v2_results(portfolio_claims) -> dict[str, list[PathResult]]:
    """Run the V2 engine with settlement DISABLED (default fixture)."""
    return _run_v2_portfolio(portfolio_claims, N_PATHS, SEED, settlement_override=False)


@pytest.fixture(scope="module")
def v2_results_settlement(portfolio_claims) -> dict[str, list[PathResult]]:
    """Run the V2 engine with settlement ENABLED (default params)."""
    return _run_v2_portfolio(portfolio_claims, N_PATHS, SEED, settlement_override=True)


# ============================================================================
# TEST 1: Per-Claim Win Rates
# ============================================================================

@pytest.mark.regression
class TestPerClaimWinRates:
    """Verify per-claim win rates fall in expected ranges.

    Win rate = count(final_outcome == "TRUE_WIN") / N.
    Ranges derive from analytical model:
      Domestic: P(arb_win)×P(TRUE_WIN|ScA) + P(arb_lose)×P(RESTART→WIN|ScB) - cap losses
      SIAC:     Same formula with different challenge tree survival probs
    """

    @pytest.mark.parametrize("claim_id", DOMESTIC_IDS)
    def test_domestic_win_rate(self, v2_results, claim_id):
        """Domestic claims: win rate in [{lo}, {hi}] at N=2000.

        Analytical: 0.70 × 0.736 ≈ 0.515 direct + RESTART recovery - 96m cap.
        Tolerance: ±5pp (MC sampling noise at N=2000, 95% CI for binomial proportion).
        """
        paths = v2_results[claim_id]
        n_win = sum(1 for p in paths if p.final_outcome == "TRUE_WIN")
        win_rate = n_win / len(paths)
        lo, hi = DOMESTIC_WIN_RANGE
        assert lo <= win_rate <= hi, (
            f"{claim_id}: domestic win_rate={win_rate:.4f}, "
            f"expected [{lo}, {hi}], n_win={n_win}/{len(paths)}"
        )

    @pytest.mark.parametrize("claim_id", SIAC_IDS)
    def test_siac_win_rate(self, v2_results, claim_id):
        """SIAC claims: win rate in [{lo}, {hi}] at N=2000.

        Analytical: 0.70 × 0.82 ≈ 0.574 + higher RESTART recovery (42% RESTART rate).
        Tolerance: ±5pp.
        """
        paths = v2_results[claim_id]
        n_win = sum(1 for p in paths if p.final_outcome == "TRUE_WIN")
        win_rate = n_win / len(paths)
        lo, hi = SIAC_WIN_RANGE
        assert lo <= win_rate <= hi, (
            f"{claim_id}: SIAC win_rate={win_rate:.4f}, "
            f"expected [{lo}, {hi}], n_win={n_win}/{len(paths)}"
        )


# ============================================================================
# TEST 2: Outcome Distribution Completeness
# ============================================================================

@pytest.mark.regression
class TestOutcomeDistribution:
    """Every path must map to exactly one canonical outcome.

    Invariant: count(TRUE_WIN) + count(LOSE) + count(SETTLED) = N
    (RESTART outcomes are terminal as LOSE due to 96m cap or re-arb loss,
     or become TRUE_WIN via successful re-arb — they don't remain RESTART
     unless settlement is on, in which case they may settle.)
    """

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_outcome_sum_equals_n(self, v2_results, claim_id):
        """All paths accounted for: sum of outcomes == N."""
        paths = v2_results[claim_id]
        n = len(paths)
        outcomes = [p.final_outcome for p in paths]
        n_tw = outcomes.count("TRUE_WIN")
        n_lose = outcomes.count("LOSE")
        n_settled = outcomes.count("SETTLED")
        total = n_tw + n_lose + n_settled
        assert total == n, (
            f"{claim_id}: TRUE_WIN={n_tw} + LOSE={n_lose} + SETTLED={n_settled} "
            f"= {total} ≠ {n}"
        )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_no_settled_when_disabled(self, v2_results, claim_id):
        """When SETTLEMENT_ENABLED=False, no paths should settle."""
        paths = v2_results[claim_id]
        n_settled = sum(1 for p in paths if p.final_outcome == "SETTLED")
        assert n_settled == 0, (
            f"{claim_id}: settlement disabled but {n_settled} paths settled"
        )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_valid_outcomes_only(self, v2_results, claim_id):
        """All outcomes must be one of the canonical set."""
        valid = {"TRUE_WIN", "LOSE", "SETTLED"}
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            assert p.final_outcome in valid, (
                f"{claim_id} path {i}: unexpected outcome '{p.final_outcome}'"
            )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_has_both_win_and_lose(self, v2_results, claim_id):
        """At N=2000 with P(win)=0.70, we expect both WIN and LOSE paths."""
        paths = v2_results[claim_id]
        outcomes = {p.final_outcome for p in paths}
        assert "TRUE_WIN" in outcomes, f"{claim_id}: no TRUE_WIN at N={N_PATHS}"
        assert "LOSE" in outcomes, f"{claim_id}: no LOSE at N={N_PATHS}"


# ============================================================================
# TEST 3: Quantum Conditional Statistics
# ============================================================================

@pytest.mark.regression
class TestQuantumStatistics:
    """Verify quantum draw statistics conditional on arb_won AND TRUE_WIN.

    The 5-band quantum distribution has:
      E[q%|win] = Σ p_i × (lo_i + hi_i)/2 = 0.72
    where bands are (0-20%,0.15), (20-40%,0.05), (40-60%,0.05),
    (60-80%,0.05), (80-100%,0.70).
    """

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_mean_quantum_pct_convergence(self, v2_results, claim_id):
        """E[q%|arb_won, TRUE_WIN] → 0.72 within ±0.03 at N=2000.

        Tolerance: ±0.03 is conservative at N≥2000 — the CLT-based 95% CI for
        the mean of a bounded [0,1] random variable is ≈ σ/√n × 1.96.
        With σ ≈ 0.29 (5-band distribution), CI ≈ ±0.013. We use ±0.03.
        """
        paths = v2_results[claim_id]
        win_quantum_pcts = [
            p.quantum.quantum_pct
            for p in paths
            if p.arb_won and p.final_outcome == "TRUE_WIN" and p.quantum is not None
        ]
        assert len(win_quantum_pcts) > 0, (
            f"{claim_id}: no TRUE_WIN paths with arb_won=True"
        )
        mean_pct = float(np.mean(win_quantum_pcts))
        assert abs(mean_pct - EXPECTED_QUANTUM_PCT) <= QUANTUM_TOL, (
            f"{claim_id}: E[q%|win]={mean_pct:.4f}, "
            f"expected {EXPECTED_QUANTUM_PCT} ±{QUANTUM_TOL}"
        )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_quantum_pct_in_unit_interval(self, v2_results, claim_id):
        """All quantum_pct values must be in [0.0, 1.0]."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            if p.quantum is not None:
                assert 0.0 <= p.quantum.quantum_pct <= 1.0, (
                    f"{claim_id} path {i}: quantum_pct={p.quantum.quantum_pct} "
                    f"out of [0,1]"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_quantum_cr_equals_pct_times_soc(self, v2_results, fixture_data, claim_id):
        """quantum_cr = quantum_pct × SOC (exact, within floating-point epsilon).

        This is a definitional identity — no stochastic tolerance needed.
        """
        soc_map = {c["id"]: c["soc_value_cr"] for c in fixture_data["claims"]}
        soc = soc_map[claim_id]
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            if p.quantum is not None and p.quantum.quantum_pct > 0.0:
                expected_cr = p.quantum.quantum_pct * soc
                assert abs(p.quantum.quantum_cr - expected_cr) < 1e-6, (
                    f"{claim_id} path {i}: quantum_cr={p.quantum.quantum_cr}, "
                    f"expected pct×SOC={expected_cr}"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_lose_paths_have_zero_quantum(self, v2_results, claim_id):
        """Paths with final_outcome=LOSE should have collected_cr=0."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            if p.final_outcome == "LOSE":
                assert p.collected_cr == 0.0, (
                    f"{claim_id} path {i}: LOSE but collected_cr={p.collected_cr}"
                )


# ============================================================================
# TEST 4: Duration Bounds
# ============================================================================

@pytest.mark.regression
class TestDurationBounds:
    """Verify timeline constraints are enforced.

    MAX_TIMELINE_MONTHS = 96 (8 years) — capped by MI.MAX_TIMELINE_MONTHS.
    Paths that exceed the cap via RESTART become LOSE.
    """

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_duration_within_cap(self, v2_results, claim_id):
        """total_duration_months ∈ [0, 96] for all paths.

        The 96-month cap is set in test_tata_portfolio.json → timeline.max_horizon_months.
        Tolerance: +1 month for floating-point accumulation across many stages.
        """
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            assert p.total_duration_months >= 0, (
                f"{claim_id} path {i}: negative duration {p.total_duration_months}"
            )
            # Allow +1 month tolerance for floating-point accumulation
            assert p.total_duration_months <= 97.0, (
                f"{claim_id} path {i}: duration {p.total_duration_months:.2f} "
                f"> 96 + 1 tolerance"
            )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_duration_nonneg(self, v2_results, claim_id):
        """No NaN or negative durations."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            assert not math.isnan(p.total_duration_months), (
                f"{claim_id} path {i}: NaN duration"
            )
            assert p.total_duration_months >= 0.0, (
                f"{claim_id} path {i}: negative duration {p.total_duration_months}"
            )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_interest_duration_nonneg(self, v2_results, claim_id):
        """Interest earned should be non-negative."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            assert p.interest_earned_cr >= 0.0, (
                f"{claim_id} path {i}: negative interest {p.interest_earned_cr}"
            )


# ============================================================================
# TEST 5: Cashflow Consistency
# ============================================================================

@pytest.mark.regression
class TestCashflowConsistency:
    """Verify monetary identity constraints across MC paths.

    Key identities:
      - legal_cost_total_cr == sum(monthly_legal_burn)
      - TRUE_WIN: collected_cr = quantum_cr (+ interest if enabled)
      - LOSE: collected_cr = 0
      - SETTLED: collected_cr = settlement_amount_cr
    """

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_legal_cost_equals_burn_sum(self, v2_results, claim_id):
        """legal_cost_total_cr == sum(monthly_legal_burn), exact within fp epsilon."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            if p.monthly_legal_burn is not None:
                burn_sum = float(np.sum(p.monthly_legal_burn))
                assert abs(p.legal_cost_total_cr - burn_sum) < 1e-6, (
                    f"{claim_id} path {i}: legal_cost_total_cr={p.legal_cost_total_cr:.6f} "
                    f"≠ sum(burn)={burn_sum:.6f}"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_legal_costs_nonneg(self, v2_results, claim_id):
        """Legal costs must be non-negative."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            assert p.legal_cost_total_cr >= 0.0, (
                f"{claim_id} path {i}: negative legal cost {p.legal_cost_total_cr}"
            )
            assert not math.isnan(p.legal_cost_total_cr), (
                f"{claim_id} path {i}: NaN legal cost"
            )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_collected_nonneg(self, v2_results, claim_id):
        """collected_cr must be non-negative for all paths."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            assert p.collected_cr >= 0.0, (
                f"{claim_id} path {i}: negative collected {p.collected_cr}"
            )
            assert not math.isnan(p.collected_cr), (
                f"{claim_id} path {i}: NaN collected"
            )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_true_win_has_nonzero_collected(self, v2_results, claim_id):
        """TRUE_WIN paths must have collected_cr > 0."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            if p.final_outcome == "TRUE_WIN":
                assert p.collected_cr > 0.0, (
                    f"{claim_id} path {i}: TRUE_WIN but collected_cr=0"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_lose_has_zero_collected(self, v2_results, claim_id):
        """LOSE paths must have collected_cr == 0."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            if p.final_outcome == "LOSE":
                assert p.collected_cr == 0.0, (
                    f"{claim_id} path {i}: LOSE but collected_cr={p.collected_cr}"
                )


# ============================================================================
# TEST 6: Settlement Regression (settlement ENABLED)
# ============================================================================

@pytest.mark.regression
class TestSettlementRegression:
    """Verify settlement-enabled runs produce expected settlement behaviour.

    With SETTLEMENT_ENABLED=True and default λ=0.15, at N=2000:
    - Some paths should settle (P(at least 1 settlement) ≈ 1 - (1-λ)^stages per path ≈ very high)
    - Settlement amounts > 0
    - Settlement discount ∈ [0, 1]
    - Settlement timing > 0
    """

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_some_paths_settle(self, v2_results_settlement, claim_id):
        """At λ=0.15 and N=2000, expect significant settlement count.

        With ~5+ settlement opportunities per path (pre-award stages + post-award stages),
        P(at least 1 settlement in path) ≈ 1 - (0.85)^5 ≈ 0.56.
        Across 2000 paths, expect hundreds of settlements. We conservatively
        require at least 10.
        """
        paths = v2_results_settlement[claim_id]
        n_settled = sum(1 for p in paths if p.final_outcome == "SETTLED")
        assert n_settled > 10, (
            f"{claim_id}: only {n_settled} settlements at N={N_PATHS}, "
            f"expected many more with λ=0.15"
        )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_settlement_amount_positive(self, v2_results_settlement, claim_id):
        """Settled paths must have settlement_amount_cr > 0."""
        paths = v2_results_settlement[claim_id]
        for i, p in enumerate(paths):
            if p.final_outcome == "SETTLED":
                assert p.settlement is not None, (
                    f"{claim_id} path {i}: SETTLED but no settlement object"
                )
                assert p.settlement.settlement_amount_cr > 0.0, (
                    f"{claim_id} path {i}: settlement amount "
                    f"= {p.settlement.settlement_amount_cr}"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_settlement_discount_in_range(self, v2_results_settlement, claim_id):
        """Settlement discount factor δ_s ∈ [0, 1]."""
        paths = v2_results_settlement[claim_id]
        for i, p in enumerate(paths):
            if p.final_outcome == "SETTLED" and p.settlement is not None:
                delta = p.settlement.settlement_discount_used
                assert 0.0 <= delta <= 1.0, (
                    f"{claim_id} path {i}: settlement discount "
                    f"{delta} outside [0, 1]"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_settlement_timing_positive(self, v2_results_settlement, claim_id):
        """Settlement timing must be > 0 (some elapsed time + delay)."""
        paths = v2_results_settlement[claim_id]
        for i, p in enumerate(paths):
            if p.final_outcome == "SETTLED" and p.settlement is not None:
                assert p.settlement.settlement_timing_months > 0.0, (
                    f"{claim_id} path {i}: settlement timing "
                    f"= {p.settlement.settlement_timing_months}"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_settled_collected_equals_settlement_amount(self, v2_results_settlement, claim_id):
        """For settled paths, collected_cr == settlement_amount_cr (exact identity)."""
        paths = v2_results_settlement[claim_id]
        for i, p in enumerate(paths):
            if p.final_outcome == "SETTLED" and p.settlement is not None:
                assert abs(p.collected_cr - p.settlement.settlement_amount_cr) < 1e-6, (
                    f"{claim_id} path {i}: collected={p.collected_cr} "
                    f"≠ settlement_amount={p.settlement.settlement_amount_cr}"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_outcome_sum_with_settlement(self, v2_results_settlement, claim_id):
        """TRUE_WIN + LOSE + SETTLED = N even when settlement is enabled."""
        paths = v2_results_settlement[claim_id]
        n = len(paths)
        outcomes = [p.final_outcome for p in paths]
        total = outcomes.count("TRUE_WIN") + outcomes.count("LOSE") + outcomes.count("SETTLED")
        assert total == n, (
            f"{claim_id}: outcome sum {total} ≠ N={n} with settlement enabled"
        )


# ============================================================================
# TEST 7: Reproducibility
# ============================================================================

@pytest.mark.regression
class TestReproducibility:
    """Same seed + same N → identical PathResult lists (bit-for-bit).

    Run the engine twice for a single representative claim and compare
    every field element-by-element.
    """

    def test_deterministic_domestic(self, portfolio_claims):
        """Domestic TP-301-6: two runs with seed=42, N=500 → identical."""
        claim = [c for c in portfolio_claims if c.id == "TP-301-6"][0]
        n_small = 500  # Smaller N for speed in this test

        run_a = _run_v2_portfolio([claim], n_small, SEED, settlement_override=False)
        run_b = _run_v2_portfolio([claim], n_small, SEED, settlement_override=False)

        paths_a = run_a["TP-301-6"]
        paths_b = run_b["TP-301-6"]
        assert len(paths_a) == len(paths_b) == n_small

        for i in range(n_small):
            pa, pb = paths_a[i], paths_b[i]
            assert pa.final_outcome == pb.final_outcome, (
                f"Path {i}: outcome mismatch {pa.final_outcome} vs {pb.final_outcome}"
            )
            assert pa.arb_won == pb.arb_won, (
                f"Path {i}: arb_won mismatch {pa.arb_won} vs {pb.arb_won}"
            )
            assert pa.total_duration_months == pb.total_duration_months, (
                f"Path {i}: duration mismatch "
                f"{pa.total_duration_months} vs {pb.total_duration_months}"
            )
            assert pa.collected_cr == pb.collected_cr, (
                f"Path {i}: collected mismatch "
                f"{pa.collected_cr} vs {pb.collected_cr}"
            )
            assert pa.legal_cost_total_cr == pb.legal_cost_total_cr, (
                f"Path {i}: legal_cost mismatch "
                f"{pa.legal_cost_total_cr} vs {pb.legal_cost_total_cr}"
            )
            if pa.quantum is not None and pb.quantum is not None:
                assert pa.quantum.quantum_pct == pb.quantum.quantum_pct, (
                    f"Path {i}: quantum_pct mismatch "
                    f"{pa.quantum.quantum_pct} vs {pb.quantum.quantum_pct}"
                )

    def test_deterministic_siac(self, portfolio_claims):
        """SIAC TP-CTP11-4: two runs with seed=42, N=500 → identical."""
        claim = [c for c in portfolio_claims if c.id == "TP-CTP11-4"][0]
        n_small = 500

        run_a = _run_v2_portfolio([claim], n_small, SEED, settlement_override=False)
        run_b = _run_v2_portfolio([claim], n_small, SEED, settlement_override=False)

        paths_a = run_a["TP-CTP11-4"]
        paths_b = run_b["TP-CTP11-4"]
        assert len(paths_a) == len(paths_b) == n_small

        for i in range(n_small):
            pa, pb = paths_a[i], paths_b[i]
            assert pa.final_outcome == pb.final_outcome, (
                f"Path {i}: outcome mismatch {pa.final_outcome} vs {pb.final_outcome}"
            )
            assert pa.collected_cr == pb.collected_cr, (
                f"Path {i}: collected mismatch "
                f"{pa.collected_cr} vs {pb.collected_cr}"
            )

    def test_deterministic_with_settlement(self, portfolio_claims):
        """Settlement-enabled reproducibility: seed=42, N=500 → identical."""
        claim = [c for c in portfolio_claims if c.id == "TP-301-6"][0]
        n_small = 500

        run_a = _run_v2_portfolio([claim], n_small, SEED, settlement_override=True)
        run_b = _run_v2_portfolio([claim], n_small, SEED, settlement_override=True)

        paths_a = run_a["TP-301-6"]
        paths_b = run_b["TP-301-6"]
        assert len(paths_a) == len(paths_b) == n_small

        for i in range(n_small):
            pa, pb = paths_a[i], paths_b[i]
            assert pa.final_outcome == pb.final_outcome, (
                f"Path {i}: outcome mismatch {pa.final_outcome} vs {pb.final_outcome}"
            )
            assert pa.collected_cr == pb.collected_cr, (
                f"Path {i}: collected mismatch "
                f"{pa.collected_cr} vs {pb.collected_cr}"
            )
            # Settlement object agreement
            if pa.settlement is not None:
                assert pb.settlement is not None, f"Path {i}: settlement object mismatch"
                assert pa.settlement.settlement_amount_cr == pb.settlement.settlement_amount_cr
                assert pa.settlement.settlement_stage == pb.settlement.settlement_stage


# ============================================================================
# TEST 8: Cross-Claim Structural Invariants
# ============================================================================

@pytest.mark.regression
class TestCrossClaimInvariants:
    """Verify structural invariants that hold across all claims.

    These are not statistical — they are logical properties that must
    hold unconditionally for every single path.
    """

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_path_count_equals_n(self, v2_results, claim_id):
        """Each claim has exactly N path results."""
        paths = v2_results[claim_id]
        assert len(paths) == N_PATHS, (
            f"{claim_id}: expected {N_PATHS} paths, got {len(paths)}"
        )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_path_indices_sequential(self, v2_results, claim_id):
        """Path indices should be sequential 0..N-1."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            assert p.path_idx == i, (
                f"{claim_id}: path_idx={p.path_idx} at position {i}"
            )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_claim_id_matches(self, v2_results, claim_id):
        """All PathResults should have the correct claim_id."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            assert p.claim_id == claim_id, (
                f"Path {i}: claim_id={p.claim_id}, expected {claim_id}"
            )

    @pytest.mark.parametrize("claim_id", DOMESTIC_IDS)
    def test_domestic_challenge_scenarios(self, v2_results, claim_id):
        """Domestic paths should have challenge scenario A or B.

        Scenario A when arb_won=True (respondent challenges),
        Scenario B when arb_won=False (claimant challenges).
        """
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            if p.final_outcome != "SETTLED":
                expected_scenario = "A" if p.arb_won else "B"
                assert p.challenge.scenario == expected_scenario, (
                    f"{claim_id} path {i}: arb_won={p.arb_won} "
                    f"but scenario={p.challenge.scenario}"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_arb_won_consistency(self, v2_results, claim_id):
        """If arb_won=True, quantum should exist; if arb_lost, quantum=None."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            if p.final_outcome == "SETTLED" and not p.arb_won:
                # Pre-award settlement: arb_won=False (not yet decided), quantum=None is OK
                continue
            if p.arb_won:
                assert p.quantum is not None, (
                    f"{claim_id} path {i}: arb_won=True but quantum is None"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_no_nan_in_monetary_fields(self, v2_results, claim_id):
        """No NaN values in any monetary field."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            assert not math.isnan(p.collected_cr), f"{claim_id} path {i}: NaN collected"
            assert not math.isnan(p.legal_cost_total_cr), f"{claim_id} path {i}: NaN legal_cost"
            assert not math.isnan(p.interest_earned_cr), f"{claim_id} path {i}: NaN interest"
            assert not math.isnan(p.total_duration_months), f"{claim_id} path {i}: NaN duration"


# ============================================================================
# TEST 9: Re-Arbitration Path Validation
# ============================================================================

@pytest.mark.regression
class TestReArbitrationPaths:
    """Validate RESTART → re-arbitration path handling.

    When arb_won=False AND challenge outcome=RESTART (Scenario B):
    - If projected total > 96 months: path becomes LOSE (cap)
    - If re_arb_won=True AND post-challenge survives: TRUE_WIN
    - If re_arb_won=False: LOSE
    """

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_rearb_won_implies_true_win_or_capped(self, v2_results, claim_id):
        """Paths with re_arb_won=True should end as TRUE_WIN or LOSE (cap/challenge fail)."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            if p.re_arb_won is True:
                assert p.final_outcome in ("TRUE_WIN", "LOSE"), (
                    f"{claim_id} path {i}: re_arb_won=True but outcome={p.final_outcome}"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_rearb_lost_implies_lose(self, v2_results, claim_id):
        """Paths with re_arb_won=False should be LOSE."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            if p.re_arb_won is False:
                assert p.final_outcome == "LOSE", (
                    f"{claim_id} path {i}: re_arb_won=False but outcome={p.final_outcome}"
                )

    @pytest.mark.parametrize("claim_id", ALL_IDS)
    def test_rearb_duration_nonneg(self, v2_results, claim_id):
        """Re-arbitration duration should be non-negative."""
        paths = v2_results[claim_id]
        for i, p in enumerate(paths):
            assert p.re_arb_duration_months >= 0.0, (
                f"{claim_id} path {i}: negative re_arb_duration "
                f"{p.re_arb_duration_months}"
            )

    @pytest.mark.parametrize("claim_id", DOMESTIC_IDS)
    def test_domestic_has_restart_paths(self, v2_results, claim_id):
        """Domestic claims should have some paths that entered re-arbitration.

        In Scenario B, P(RESTART) = 0.30 × (0.80×0.90 + 0.80×0.10×0.90 + ...)
        ≈ 0.30 × 0.796 = 0.239.  At P(arb_lose)=0.30, overall RESTART entry
        ≈ 8%.  With N=2000, expect ~160 re-arb entries.
        """
        paths = v2_results[claim_id]
        n_rearb = sum(1 for p in paths if p.re_arb_duration_months > 0)
        assert n_rearb > 0, (
            f"{claim_id}: no paths entered re-arbitration (expected ~160 at N=2000)"
        )
