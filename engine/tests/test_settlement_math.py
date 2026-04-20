"""
engine/tests/test_settlement_math.py — Settlement Mathematics Verification Tests
=================================================================================

Phase 1, Session 1A: Mathematical verification of settlement module before
any bug fixes in Phase 2. Tests verify CURRENT behavior (including known bugs).

Modules under test:
  - engine.adapter.compute_settlement_discount_ramp
  - engine.v2_core.v2_settlement (continuation values, game-theoretic discounts)
  - engine.v2_core.v2_monte_carlo._attempt_settlement (settlement hazard process)

Mathematical properties verified:
  1. Discount ramp linear interpolation (δ_i formula)
  2. Reference quantum computation (3 regimes)
  3. Backward induction continuation values (per-stage survival approximation)
  4. Nash Bargaining discount factors (δ* = V_C/Q_ref when symmetric)
  5. Hazard process distributional correctness (Bernoulli draws)
  6. End-to-end settlement amount = δ × Q_ref
"""

from __future__ import annotations

import numpy as np
import pytest

from engine.adapter import (
    compute_settlement_discount_ramp,
    save_and_restore_mi,
)
from engine.v2_core import v2_master_inputs as MI
from engine.v2_core.v2_settlement import (
    _expected_quantum_fraction,
    _get_stages,
    _get_paths,
    _survival_prob_from_paths,
    compute_continuation_values,
    compute_game_theoretic_discounts,
)
from engine.v2_core.v2_monte_carlo import _attempt_settlement
from engine.v2_core.v2_config import SettlementResult


# ============================================================================
# TestDiscountRamp — Settlement discount ramp linear interpolation
# ============================================================================

class TestDiscountRamp:
    """Verify compute_settlement_discount_ramp() produces correct linear interpolation.

    Mathematical identity:
        δ_i = δ_min + (δ_max - δ_min) × i/(N-1)  for N ≥ 2
        δ_0 = (δ_min + δ_max)/2                    for N = 1
        {}                                          for N = 0
    """

    def test_domestic_5stage_ramp_without_overrides(self):
        """Domestic pipeline: 5 stages, δ_min=0.30, δ_max=0.85 → linear ramp."""
        stages = ["dab", "arbitration", "s34", "s37", "slp"]
        ramp = compute_settlement_discount_ramp(stages, 0.30, 0.85, {})

        # δ_i = 0.30 + 0.55 × i/4
        expected = {
            "dab": 0.30,              # i=0: 0.30 + 0.55×0/4 = 0.300
            "arbitration": 0.4375,    # i=1: 0.30 + 0.55×1/4 = 0.4375
            "s34": 0.575,             # i=2: 0.30 + 0.55×2/4 = 0.575
            "s37": 0.7125,            # i=3: 0.30 + 0.55×3/4 = 0.7125
            "slp": 0.85,             # i=4: 0.30 + 0.55×4/4 = 0.850
        }
        for stage, exp_val in expected.items():
            # ±0.0001: analytical exact, float rounding only
            assert abs(ramp[stage] - exp_val) < 0.0001, (
                f"{stage} discount expected {exp_val}, got {ramp[stage]}"
            )

    def test_siac_4stage_ramp_without_overrides(self):
        """SIAC pipeline: 4 stages, δ_min=0.30, δ_max=0.85 → linear ramp."""
        stages = ["dab", "arbitration", "hc", "coa"]
        ramp = compute_settlement_discount_ramp(stages, 0.30, 0.85, {})

        # δ_i = 0.30 + 0.55 × i/3
        expected = {
            "dab": 0.30,                       # i=0
            "arbitration": 0.30 + 0.55 / 3,    # i=1: ≈0.4833
            "hc": 0.30 + 2 * 0.55 / 3,         # i=2: ≈0.6667
            "coa": 0.85,                        # i=3
        }
        for stage, exp_val in expected.items():
            # ±0.0001: analytical exact, float rounding only
            assert abs(ramp[stage] - exp_val) < 0.0001, (
                f"{stage} discount expected {exp_val:.4f}, got {ramp[stage]:.4f}"
            )

    def test_hkiac_5stage_ramp_without_overrides(self):
        """HKIAC pipeline: 5 stages, δ_min=0.30, δ_max=0.85."""
        stages = ["dab", "arbitration", "cfi", "ca", "cfa"]
        ramp = compute_settlement_discount_ramp(stages, 0.30, 0.85, {})

        expected = {
            "dab": 0.30,
            "arbitration": 0.4375,
            "cfi": 0.575,
            "ca": 0.7125,
            "cfa": 0.85,
        }
        for stage, exp_val in expected.items():
            assert abs(ramp[stage] - exp_val) < 0.0001, (
                f"{stage} discount expected {exp_val}, got {ramp[stage]}"
            )

    def test_single_stage_midpoint(self):
        """Single stage: δ = (δ_min + δ_max) / 2."""
        stages = ["arbitration"]
        ramp = compute_settlement_discount_ramp(stages, 0.30, 0.85, {})

        expected = (0.30 + 0.85) / 2.0  # = 0.575
        # ±0.0001: analytical exact
        assert abs(ramp["arbitration"] - expected) < 0.0001, (
            f"Single stage expected {expected}, got {ramp['arbitration']}"
        )

    def test_empty_stages_returns_empty(self):
        """Empty stage list → empty dict."""
        ramp = compute_settlement_discount_ramp([], 0.30, 0.85, {})
        assert ramp == {}, f"Expected empty dict, got {ramp}"

    def test_with_single_override(self):
        """Override one stage; others use ramp interpolation."""
        stages = ["dab", "arbitration", "s34", "s37", "slp"]
        overrides = {"s34": 0.60}
        ramp = compute_settlement_discount_ramp(stages, 0.30, 0.85, overrides)

        # Overridden stages use override value
        assert abs(ramp["s34"] - 0.60) < 0.0001, (
            f"s34 override expected 0.60, got {ramp['s34']}"
        )
        # Non-overridden stages still use ramp
        assert abs(ramp["dab"] - 0.30) < 0.0001
        assert abs(ramp["arbitration"] - 0.4375) < 0.0001
        assert abs(ramp["s37"] - 0.7125) < 0.0001
        assert abs(ramp["slp"] - 0.85) < 0.0001

    def test_all_overrides(self):
        """All stages overridden → all override values used, ramp ignored."""
        stages = ["dab", "arbitration", "s34", "s37", "slp"]
        overrides = {
            "dab": 0.10, "arbitration": 0.25, "s34": 0.50,
            "s37": 0.75, "slp": 0.95,
        }
        ramp = compute_settlement_discount_ramp(stages, 0.30, 0.85, overrides)

        for stage, val in overrides.items():
            assert abs(ramp[stage] - val) < 0.0001, (
                f"{stage} override expected {val}, got {ramp[stage]}"
            )

    def test_ramp_monotonically_increasing(self):
        """All ramp values monotonically increase from early to late stages."""
        stages = ["dab", "arbitration", "s34", "s37", "slp"]
        ramp = compute_settlement_discount_ramp(stages, 0.30, 0.85, {})
        values = [ramp[s] for s in stages]
        for i in range(len(values) - 1):
            assert values[i] <= values[i + 1], (
                f"Ramp not monotonic: {stages[i]}={values[i]} > {stages[i+1]}={values[i+1]}"
            )

    @pytest.mark.parametrize("n_stages", [2, 3, 5, 7, 10])
    def test_ramp_endpoints_always_exact(self, n_stages):
        """First stage = δ_min, last stage = δ_max for any N ≥ 2."""
        stages = [f"stage_{i}" for i in range(n_stages)]
        ramp = compute_settlement_discount_ramp(stages, 0.30, 0.85, {})

        # ±1e-10: float arithmetic identity
        assert abs(ramp[stages[0]] - 0.30) < 1e-10, (
            f"First stage expected 0.30, got {ramp[stages[0]]}"
        )
        assert abs(ramp[stages[-1]] - 0.85) < 1e-10, (
            f"Last stage expected 0.85, got {ramp[stages[-1]]}"
        )

    def test_equal_min_max_all_same(self):
        """When δ_min == δ_max, all stages get the same discount."""
        stages = ["a", "b", "c"]
        ramp = compute_settlement_discount_ramp(stages, 0.50, 0.50, {})
        for stage in stages:
            assert abs(ramp[stage] - 0.50) < 1e-10, (
                f"{stage} expected 0.50, got {ramp[stage]}"
            )


# ============================================================================
# TestReferenceQuantum — Q_ref computation in _attempt_settlement
# ============================================================================

class TestReferenceQuantum:
    """Verify reference quantum Q_ref computation in _attempt_settlement().

    Three regimes:
      1. Pre-award: Q_ref = SOC × E[q%|win] × P(win)
      2. Post-award claimant won: Q_ref = quantum_cr (drawn quantum)
      3. Post-award claimant lost: Q_ref = SOC × E[q%|win] × P(re-arb) × 0.50

    KNOWN BUG (Phase 2 fix): Regime 3 uses hardcoded post_challenge_survival=0.50
    instead of actual jurisdiction-specific P(RESTART) values:
      Domestic Scenario B: P(RESTART) = 0.2966
      SIAC Scenario B: P(RESTART) = 0.4200
    """

    def test_expected_quantum_fraction_from_bands(self):
        """E[q%|win] = Σ prob_i × midpoint_i = 0.72 from default bands."""
        # Default bands:
        #   [0.00-0.20, p=0.15], [0.20-0.40, p=0.05], [0.40-0.60, p=0.05],
        #   [0.60-0.80, p=0.05], [0.80-1.00, p=0.70]
        # E = 0.15×0.10 + 0.05×0.30 + 0.05×0.50 + 0.05×0.70 + 0.70×0.90
        #   = 0.015 + 0.015 + 0.025 + 0.035 + 0.630 = 0.720
        eq = _expected_quantum_fraction()
        # ±0.0001: analytical exact from discrete distribution
        assert abs(eq - 0.72) < 0.0001, (
            f"E[q%|win] expected 0.72, got {eq}"
        )

    def test_pre_award_qref(self, default_settlement_mi):
        """Pre-award: Q_ref = SOC × 0.72 × 0.70 = SOC × 0.504."""
        soc = 1000.0
        # Force settlement by using λ=1.0, and stage discount = 0.50
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 1.0
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"dab": 0.50}

        rng = np.random.default_rng(42)
        result = _attempt_settlement(
            stage_name="dab",
            elapsed_months=6.0,
            arb_won=None,
            quantum_cr=None,
            soc_value_cr=soc,
            rng=rng,
        )

        assert result is not None, "Settlement should occur with λ=1.0"
        expected_qref = soc * 0.72 * 0.70  # = 504.0
        # ±0.01: analytical exact, float rounding only
        assert abs(result.reference_quantum_cr - expected_qref) < 0.01, (
            f"Pre-award Q_ref expected {expected_qref}, got {result.reference_quantum_cr}"
        )
        # Settlement amount = δ × Q_ref = 0.50 × 504.0 = 252.0
        expected_amount = 0.50 * expected_qref
        assert abs(result.settlement_amount_cr - expected_amount) < 0.01, (
            f"Settlement amount expected {expected_amount}, got {result.settlement_amount_cr}"
        )

    def test_post_award_won_qref(self, default_settlement_mi):
        """Post-award, claimant won: Q_ref = quantum_cr (drawn quantum)."""
        soc = 1000.0
        quantum_cr = 720.0  # e.g., 72% of SOC
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 1.0
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"s34": 0.60}

        rng = np.random.default_rng(42)
        result = _attempt_settlement(
            stage_name="s34",
            elapsed_months=24.0,
            arb_won=True,
            quantum_cr=quantum_cr,
            soc_value_cr=soc,
            rng=rng,
        )

        assert result is not None, "Settlement should occur with λ=1.0"
        # ±0.01: Q_ref should exactly equal the drawn quantum
        assert abs(result.reference_quantum_cr - quantum_cr) < 0.01, (
            f"Post-award (won) Q_ref expected {quantum_cr}, got {result.reference_quantum_cr}"
        )

    def test_post_award_lost_qref_hardcoded_survival(self, default_settlement_mi):
        """Post-award, claimant lost: Q_ref = SOC × E[q%] × P(re-arb) × 0.50.

        KNOWN BUG (Phase 2 fix): Uses hardcoded post_challenge_survival=0.50
        instead of actual Domestic P(RESTART)=0.2966 or SIAC P(RESTART)=0.42.
        """
        soc = 1000.0
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 1.0
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"s34": 0.60}

        rng = np.random.default_rng(42)
        result = _attempt_settlement(
            stage_name="s34",
            elapsed_months=24.0,
            arb_won=False,
            quantum_cr=None,
            soc_value_cr=soc,
            rng=rng,
        )

        assert result is not None, "Settlement should occur with λ=1.0"
        # KNOWN BUG (Phase 2 fix): post_challenge_survival is hardcoded at 0.50
        # Actual Domestic Scenario B P(RESTART) = 0.2966
        # Actual SIAC Scenario B P(RESTART) = 0.4200
        expected_qref = soc * 0.72 * 0.70 * 0.50  # = 252.0
        # ±0.01: analytical exact with hardcoded 0.50
        assert abs(result.reference_quantum_cr - expected_qref) < 0.01, (
            f"Post-award (lost) Q_ref expected {expected_qref}, "
            f"got {result.reference_quantum_cr}. "
            "Note: uses hardcoded survival=0.50, not actual tree P(RESTART)."
        )

    def test_settlement_timing_includes_delay(self, default_settlement_mi):
        """Settlement timing = elapsed_months + SETTLEMENT_DELAY_MONTHS."""
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 1.0
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"dab": 0.50}

        rng = np.random.default_rng(42)
        elapsed = 12.0
        result = _attempt_settlement(
            stage_name="dab",
            elapsed_months=elapsed,
            arb_won=None,
            quantum_cr=None,
            soc_value_cr=500.0,
            rng=rng,
        )

        assert result is not None
        expected_timing = elapsed + MI.SETTLEMENT_DELAY_MONTHS
        # ±0.001: analytical exact
        assert abs(result.settlement_timing_months - expected_timing) < 0.001, (
            f"Timing expected {expected_timing}, got {result.settlement_timing_months}"
        )

    def test_settlement_disabled_returns_none(self):
        """When SETTLEMENT_ENABLED=False, _attempt_settlement returns None."""
        with save_and_restore_mi():
            MI.SETTLEMENT_ENABLED = False
            rng = np.random.default_rng(42)
            result = _attempt_settlement(
                stage_name="dab",
                elapsed_months=6.0,
                arb_won=None,
                quantum_cr=None,
                soc_value_cr=500.0,
                rng=rng,
            )
            assert result is None, "Settlement should be None when disabled"


# ============================================================================
# TestContinuationValues — Backward induction verification
# ============================================================================

class TestContinuationValues:
    """Verify compute_continuation_values() backward induction.

    Mathematical identity:
        per_stage_survival = P(win)^(1/N)
        V_C(stage_i) = per_stage_survival^(N-i) × Q_ref

    where i is the 0-based index into the ordered stages list and
    N is the total number of post-award stages.

    KNOWN BUG (Phase 3 fix): The per-stage survival approximation diverges from
    actual tree probabilities. Actual S.34 survival = 0.70 (not 0.9019),
    S.37 varies by branch (0.50–0.80), SLP varies (0.10–0.50).
    """

    def test_domestic_scenario_a_continuation_values(self):
        """Domestic arb_won=True: 3 stages (s34, s37, slp), P(TRUE_WIN)=0.7360."""
        soc = 1000.0
        q_ref = 720.0  # expected quantum = 72% of SOC

        vals = compute_continuation_values(
            jurisdiction="domestic",
            arb_won=True,
            expected_quantum_cr=q_ref,
            soc_value_cr=soc,
        )

        # P(TRUE_WIN) from DOMESTIC_PATHS_A
        p_win = sum(
            p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A
            if p["outcome"] == "TRUE_WIN"
        )
        # ±0.001: verified from path table totals
        assert abs(p_win - 0.7360) < 0.001, f"P(TRUE_WIN) expected 0.7360, got {p_win}"

        n_stages = 3
        per_stage_surv = p_win ** (1.0 / n_stages)  # ≈ 0.9019

        # Verify per_stage_survival intermediate value
        # ±0.001: float pow rounding
        assert abs(per_stage_surv - 0.9019) < 0.001, (
            f"per_stage_survival expected ~0.9019, got {per_stage_surv:.4f}"
        )

        stages = ["s34", "s37", "slp"]
        assert set(vals.keys()) == set(stages), (
            f"Expected stages {stages}, got {list(vals.keys())}"
        )

        # V_C computation: per_stage_survival^(N-i) × q_ref
        # i=0 (s34): per_stage_surv^3 × q_ref = p_win × q_ref
        # i=1 (s37): per_stage_surv^2 × q_ref
        # i=2 (slp): per_stage_surv^1 × q_ref
        expected_vc = {
            "s34": per_stage_surv ** 3 * q_ref,   # ≈ 0.7360 × 720 = 529.92
            "s37": per_stage_surv ** 2 * q_ref,   # ≈ 0.8134 × 720 = 585.65
            "slp": per_stage_surv ** 1 * q_ref,   # ≈ 0.9019 × 720 = 649.37
        }

        for stage in stages:
            actual_vc = vals[stage]["v_claimant"]
            exp_vc = expected_vc[stage]
            # ±0.1: float pow propagation over 3 operations
            assert abs(actual_vc - exp_vc) < 0.1, (
                f"V_C({stage}) expected {exp_vc:.2f}, got {actual_vc:.2f}"
            )

    def test_domestic_scenario_a_v_respondent_equals_v_claimant(self):
        """KNOWN BUG (Phase 3 fix): V_R = V_C (symmetric model).

        In real NBS, V_R should include respondent's avoided legal costs.
        """
        vals = compute_continuation_values(
            jurisdiction="domestic",
            arb_won=True,
            expected_quantum_cr=720.0,
            soc_value_cr=1000.0,
        )

        for stage, v in vals.items():
            # V_R should exactly equal V_C in current implementation
            assert v["v_respondent"] == v["v_claimant"], (
                f"{stage}: V_R ({v['v_respondent']}) != V_C ({v['v_claimant']}). "
                "KNOWN BUG: V_R = V_C (symmetric respondent model)"
            )

    def test_siac_scenario_a_continuation_values(self):
        """SIAC arb_won=True: 2 stages (hc, coa), P(TRUE_WIN)=0.8200."""
        soc = 484.0
        q_ref = soc * 0.72  # 348.48 (expected quantum)

        vals = compute_continuation_values(
            jurisdiction="siac",
            arb_won=True,
            expected_quantum_cr=q_ref,
            soc_value_cr=soc,
        )

        p_win = sum(
            p["conditional_prob"] for p in MI.SIAC_PATHS_A
            if p["outcome"] == "TRUE_WIN"
        )
        assert abs(p_win - 0.8200) < 0.001, f"SIAC P(TRUE_WIN) expected 0.82, got {p_win}"

        n_stages = 2
        per_stage_surv = p_win ** (1.0 / n_stages)  # √0.82 ≈ 0.9055

        stages = ["hc", "coa"]
        assert set(vals.keys()) == set(stages)

        # i=0 (hc): per_stage_surv^2 × q_ref = p_win × q_ref
        # i=1 (coa): per_stage_surv^1 × q_ref
        expected_vc = {
            "hc": per_stage_surv ** 2 * q_ref,
            "coa": per_stage_surv ** 1 * q_ref,
        }

        for stage in stages:
            actual_vc = vals[stage]["v_claimant"]
            exp_vc = expected_vc[stage]
            # ±0.1: float arithmetic
            assert abs(actual_vc - exp_vc) < 0.1, (
                f"V_C({stage}) expected {exp_vc:.2f}, got {actual_vc:.2f}"
            )

    def test_pre_award_single_stage(self):
        """Pre-award (arb_won=None): single 'arbitration' stage with EV formula."""
        soc = 1000.0
        vals = compute_continuation_values(
            jurisdiction="domestic",
            arb_won=None,
            expected_quantum_cr=0.0,  # not used for pre-award
            soc_value_cr=soc,
        )

        assert "arbitration" in vals, "Pre-award should have 'arbitration' stage"
        assert len(vals) == 1, "Pre-award should have exactly 1 stage"

        eq_frac = _expected_quantum_fraction()  # 0.72
        expected_vc = soc * eq_frac * MI.ARB_WIN_PROBABILITY  # 1000 × 0.72 × 0.70 = 504.0
        actual_vc = vals["arbitration"]["v_claimant"]

        # ±0.01: analytical exact
        assert abs(actual_vc - expected_vc) < 0.01, (
            f"Pre-award V_C expected {expected_vc:.2f}, got {actual_vc:.2f}"
        )

    def test_scenario_b_uses_re_arb_probability(self):
        """Scenario B (arb_won=False): Q_ref uses RE_ARB_WIN_PROBABILITY."""
        soc = 1000.0
        vals = compute_continuation_values(
            jurisdiction="domestic",
            arb_won=False,
            expected_quantum_cr=0.0,  # not used for scenario B
            soc_value_cr=soc,
        )

        # Q_ref = SOC × E[q%|win] × RE_ARB_WIN_PROBABILITY
        eq_frac = _expected_quantum_fraction()  # 0.72
        q_ref = soc * eq_frac * MI.RE_ARB_WIN_PROBABILITY  # 1000 × 0.72 × 0.70 = 504.0

        stages = ["s34", "s37", "slp"]
        assert set(vals.keys()) == set(stages)

        # P(RESTART) from DOMESTIC_PATHS_B (used as p_win in continuation)
        # Wait — actually the code uses _survival_prob_from_paths which checks "TRUE_WIN"
        # For Scenario B, there are no TRUE_WIN paths — all good outcomes are RESTART.
        # So p_win from _survival_prob_from_paths = 0 for Scenario B.
        p_win = _survival_prob_from_paths(MI.DOMESTIC_PATHS_B)  # Only TRUE_WIN, should be 0

        if p_win == 0:
            # All continuation values should be 0
            for stage in stages:
                assert vals[stage]["v_claimant"] == 0.0, (
                    f"V_C({stage}) should be 0 when P(TRUE_WIN)=0 in Scenario B. "
                    "KNOWN BUG: _survival_prob_from_paths only counts TRUE_WIN, not RESTART."
                )
        else:
            # If somehow p_win > 0, verify the formula is applied correctly
            n = len(stages)
            per_stage_surv = p_win ** (1.0 / n)
            for i, stage in enumerate(stages):
                expected = per_stage_surv ** (n - i) * q_ref
                assert abs(vals[stage]["v_claimant"] - expected) < 0.1

    def test_continuation_values_increase_toward_later_stages(self):
        """V_C(earlier stage) < V_C(later stage) — monotonic increase.

        KNOWN BUG (Phase 3 fix): This approximation is smooth/monotonic,
        but real tree probabilities are NOT monotonic across stages.
        """
        vals = compute_continuation_values(
            jurisdiction="domestic",
            arb_won=True,
            expected_quantum_cr=720.0,
            soc_value_cr=1000.0,
        )

        stages = ["s34", "s37", "slp"]
        vcs = [vals[s]["v_claimant"] for s in stages]
        for i in range(len(vcs) - 1):
            assert vcs[i] < vcs[i + 1], (
                f"V_C not monotonically increasing: {stages[i]}={vcs[i]:.2f} "
                f">= {stages[i+1]}={vcs[i+1]:.2f}"
            )

    def test_empty_paths_returns_empty(self):
        """If path table is empty for a jurisdiction, return empty dict."""
        with save_and_restore_mi():
            MI.DOMESTIC_PATHS_A = []
            vals = compute_continuation_values(
                jurisdiction="domestic",
                arb_won=True,
                expected_quantum_cr=720.0,
                soc_value_cr=1000.0,
            )
            assert vals == {}, f"Expected empty dict for empty paths, got {vals}"


# ============================================================================
# TestNashBargaining — Game-theoretic δ* verification
# ============================================================================

class TestNashBargaining:
    """Verify compute_game_theoretic_discounts() Nash Bargaining discount factors.

    Mathematical identity:
        δ*_s = (α × V_C(s) + (1-α) × V_R(s)) / Q_ref

    Currently V_R(s) = V_C(s) (symmetric model), so:
        δ*_s = V_C(s) / Q_ref regardless of α

    KNOWN BUG (Phase 3 fix): V_R ≠ V_C in real NBS — respondent's value
    should include their avoided legal costs and independent EV computation.
    """

    def test_domestic_arb_won_discount_factors(self):
        """Domestic arb_won=True: δ* per stage from continuation values."""
        soc = 1000.0
        q_ref = 720.0  # expected quantum

        discounts = compute_game_theoretic_discounts(
            jurisdiction="domestic",
            arb_won=True,
            expected_quantum_cr=q_ref,
            soc_value_cr=soc,
            bargaining_power=0.5,
        )

        # P(TRUE_WIN) in Scenario A
        p_win = _survival_prob_from_paths(MI.DOMESTIC_PATHS_A)
        n_stages = 3
        per_stage_surv = p_win ** (1.0 / n_stages)

        # Since V_R = V_C, δ*_s = V_C(s) / Q_ref = per_stage_surv^(N-i)
        expected_discounts = {
            "s34": per_stage_surv ** 3,  # ≈ 0.7360
            "s37": per_stage_surv ** 2,  # ≈ 0.8134
            "slp": per_stage_surv ** 1,  # ≈ 0.9019
        }

        for stage, exp_delta in expected_discounts.items():
            actual_delta = discounts[stage]
            # ±0.001: float pow propagation
            assert abs(actual_delta - exp_delta) < 0.001, (
                f"δ*({stage}) expected {exp_delta:.4f}, got {actual_delta:.4f}"
            )

    def test_discount_factors_in_unit_interval(self):
        """All δ* ∈ [0, 1]."""
        for jurisdiction in ["domestic", "siac", "hkiac"]:
            discounts = compute_game_theoretic_discounts(
                jurisdiction=jurisdiction,
                arb_won=True,
                expected_quantum_cr=720.0,
                soc_value_cr=1000.0,
                bargaining_power=0.5,
            )
            for stage, delta in discounts.items():
                assert 0.0 <= delta <= 1.0, (
                    f"{jurisdiction}/{stage}: δ*={delta} not in [0,1]"
                )

    def test_discount_factors_monotonically_increase(self):
        """δ* increases from early to late stages (later stage = more value survived)."""
        discounts = compute_game_theoretic_discounts(
            jurisdiction="domestic",
            arb_won=True,
            expected_quantum_cr=720.0,
            soc_value_cr=1000.0,
        )

        stages = ["s34", "s37", "slp"]
        deltas = [discounts[s] for s in stages]
        for i in range(len(deltas) - 1):
            assert deltas[i] < deltas[i + 1], (
                f"δ* not monotonic: {stages[i]}={deltas[i]:.4f} >= {stages[i+1]}={deltas[i+1]:.4f}"
            )

    def test_bargaining_power_irrelevant_symmetric_model(self):
        """KNOWN BUG: Since V_R = V_C, α has no effect on δ*.

        Test that α=0.3 and α=0.7 produce the same δ* (to within float precision).
        """
        discounts_03 = compute_game_theoretic_discounts(
            jurisdiction="domestic", arb_won=True,
            expected_quantum_cr=720.0, soc_value_cr=1000.0,
            bargaining_power=0.3,
        )
        discounts_07 = compute_game_theoretic_discounts(
            jurisdiction="domestic", arb_won=True,
            expected_quantum_cr=720.0, soc_value_cr=1000.0,
            bargaining_power=0.7,
        )

        for stage in ["s34", "s37", "slp"]:
            # ±1e-10: should be identical since V_R = V_C
            assert abs(discounts_03[stage] - discounts_07[stage]) < 1e-10, (
                f"δ*({stage}) differs for α=0.3 vs α=0.7: "
                f"{discounts_03[stage]} vs {discounts_07[stage]}. "
                "KNOWN BUG: V_R = V_C makes α irrelevant."
            )

    def test_siac_arb_won_discount_factors(self):
        """SIAC arb_won=True: 2 stages, P(TRUE_WIN)=0.82."""
        q_ref = 348.48  # 484 × 0.72
        discounts = compute_game_theoretic_discounts(
            jurisdiction="siac",
            arb_won=True,
            expected_quantum_cr=q_ref,
            soc_value_cr=484.0,
        )

        p_win = _survival_prob_from_paths(MI.SIAC_PATHS_A)
        per_stage_surv = p_win ** 0.5  # √0.82

        expected = {
            "hc": per_stage_surv ** 2,   # = p_win ≈ 0.82
            "coa": per_stage_surv ** 1,  # ≈ 0.9055
        }

        for stage, exp_delta in expected.items():
            actual = discounts[stage]
            # ±0.001: float arithmetic
            assert abs(actual - exp_delta) < 0.001, (
                f"SIAC δ*({stage}) expected {exp_delta:.4f}, got {actual:.4f}"
            )

    def test_pre_award_discount_factor(self):
        """Pre-award: single 'arbitration' stage with δ* = V_C / Q_ref.

        For pre-award, Q_ref used for normalisation = SOC × E[q%] × P(win) = V_C,
        so δ* = V_C / V_C = 1.0 (clamped to 1.0).
        Actually: δ* = (α × V_C + (1-α) × V_R) / Q_ref = V_C / Q_ref = 1.0
        since V_R = V_C and Q_ref = V_C in the pre-award regime.
        """
        discounts = compute_game_theoretic_discounts(
            jurisdiction="domestic",
            arb_won=None,
            expected_quantum_cr=0.0,
            soc_value_cr=1000.0,
        )

        assert "arbitration" in discounts
        # δ* should be exactly 1.0 (or clamped to 1.0)
        # ±0.001: analytical exact
        assert abs(discounts["arbitration"] - 1.0) < 0.001, (
            f"Pre-award δ* expected 1.0, got {discounts['arbitration']}"
        )

    @pytest.mark.parametrize(
        "jurisdiction,arb_won",
        [
            ("domestic", True),
            ("domestic", False),
            ("siac", True),
            ("siac", False),
            ("hkiac", True),
            ("hkiac", False),
        ],
    )
    def test_discount_factors_bounded_all_jurisdictions(self, jurisdiction, arb_won):
        """δ* ∈ [0, 1] for all jurisdiction × scenario combinations."""
        discounts = compute_game_theoretic_discounts(
            jurisdiction=jurisdiction,
            arb_won=arb_won,
            expected_quantum_cr=720.0,
            soc_value_cr=1000.0,
        )

        for stage, delta in discounts.items():
            assert 0.0 <= delta <= 1.0, (
                f"{jurisdiction}/{arb_won}/{stage}: δ*={delta} out of [0,1]"
            )


# ============================================================================
# TestHazardProcess — Stochastic settlement draw verification
# ============================================================================

class TestHazardProcess:
    """Verify the Bernoulli hazard process in _attempt_settlement().

    Mathematical identity:
        P(settle at stage s) = λ_s (Bernoulli trial U < λ_s)
        P(no settle) = 1 - λ_s
        For N sequential stages: P(settle before end) = 1 - Π(1-λ_s)
    """

    @pytest.mark.slow
    def test_hazard_rate_convergence_lambda_015(self, default_settlement_mi):
        """For λ=0.15, settlement frequency should converge to 15% over 100K draws.

        ±1%: CLT bound for binomial at N=100,000, 99% CI width ≈ 3×σ/√N ≈ 0.34%
        We use 1% tolerance (more generous) for robustness.
        """
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 0.15
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"test_stage": 0.50}

        n_trials = 100_000
        settle_count = 0
        for i in range(n_trials):
            rng = np.random.default_rng(1000 + i)
            result = _attempt_settlement(
                stage_name="test_stage",
                elapsed_months=12.0,
                arb_won=None,
                quantum_cr=None,
                soc_value_cr=500.0,
                rng=rng,
            )
            if result is not None:
                settle_count += 1

        settle_rate = settle_count / n_trials
        # ±1%: conservative CLT bound for N=100K
        assert abs(settle_rate - 0.15) < 0.01, (
            f"Settlement rate expected ~0.15, got {settle_rate:.4f} over {n_trials} draws"
        )

    def test_hazard_rate_zero_never_settles(self, default_settlement_mi):
        """For λ=0, settlement never occurs."""
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 0.0

        for i in range(1000):
            rng = np.random.default_rng(i)
            result = _attempt_settlement(
                stage_name="dab",
                elapsed_months=6.0,
                arb_won=None,
                quantum_cr=None,
                soc_value_cr=500.0,
                rng=rng,
            )
            assert result is None, f"Trial {i}: settlement should never occur with λ=0"

    def test_hazard_rate_one_always_settles(self, default_settlement_mi):
        """For λ=1, settlement always occurs."""
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 1.0
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"dab": 0.50}

        for i in range(1000):
            rng = np.random.default_rng(i)
            result = _attempt_settlement(
                stage_name="dab",
                elapsed_months=6.0,
                arb_won=None,
                quantum_cr=None,
                soc_value_cr=500.0,
                rng=rng,
            )
            assert result is not None, f"Trial {i}: settlement should always occur with λ=1"

    @pytest.mark.slow
    def test_multi_stage_survival_probability(self, default_settlement_mi):
        """For N sequential stages with λ=0.15: P(survive all) = (1-0.15)^N.

        With N=5 stages: P(no settle) = 0.85^5 ≈ 0.4437
                         P(settle before end) = 1 - 0.4437 ≈ 0.5563
        """
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 0.15
        stages = ["s1", "s2", "s3", "s4", "s5"]
        # Provide discount factors for all stages so settlement amount is non-zero
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {s: 0.50 for s in stages}

        n_trials = 100_000
        settled_before_end = 0

        for i in range(n_trials):
            rng = np.random.default_rng(2000 + i)
            any_settled = False
            for stage in stages:
                result = _attempt_settlement(
                    stage_name=stage,
                    elapsed_months=12.0,
                    arb_won=None,
                    quantum_cr=None,
                    soc_value_cr=500.0,
                    rng=rng,
                )
                if result is not None:
                    any_settled = True
                    break
            if any_settled:
                settled_before_end += 1

        actual_rate = settled_before_end / n_trials
        expected_rate = 1 - (1 - 0.15) ** 5  # ≈ 0.5563
        # ±1.5%: CLT for N=100K, generous tolerance for multi-stage compound
        assert abs(actual_rate - expected_rate) < 0.015, (
            f"Multi-stage settle rate expected ~{expected_rate:.4f}, "
            f"got {actual_rate:.4f} over {n_trials} draws"
        )

    def test_per_stage_hazard_override(self, default_settlement_mi):
        """Per-stage hazard rates override global default."""
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 0.15
        MI.SETTLEMENT_STAGE_HAZARD_RATES = {"special_stage": 0.90}
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"special_stage": 0.50}

        # With λ=0.90, most draws should settle
        n_trials = 1000
        settle_count = 0
        for i in range(n_trials):
            rng = np.random.default_rng(3000 + i)
            result = _attempt_settlement(
                stage_name="special_stage",
                elapsed_months=12.0,
                arb_won=None,
                quantum_cr=None,
                soc_value_cr=500.0,
                rng=rng,
            )
            if result is not None:
                settle_count += 1

        settle_rate = settle_count / n_trials
        # ±3%: CLT at N=1000, for λ=0.90 the 99% CI is narrower
        assert abs(settle_rate - 0.90) < 0.03, (
            f"Per-stage λ=0.90 settle rate expected ~0.90, got {settle_rate:.3f}"
        )


# ============================================================================
# TestSettlementAmount — End-to-end settlement amount = δ × Q_ref
# ============================================================================

class TestSettlementAmount:
    """Verify settlement amount = δ_s × Q_ref end-to-end.

    Tests the full _attempt_settlement pipeline: Q_ref computation,
    discount factor lookup, and final amount calculation.
    """

    def test_pre_award_settlement_amount_formula(self, default_settlement_mi):
        """Pre-award: amount = δ × SOC × E[q%|win] × P(win)."""
        soc = 1532.0  # TP-301-6
        delta = 0.40
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 1.0
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"dab": delta}

        rng = np.random.default_rng(42)
        result = _attempt_settlement(
            stage_name="dab",
            elapsed_months=6.0,
            arb_won=None,
            quantum_cr=None,
            soc_value_cr=soc,
            rng=rng,
        )

        assert result is not None
        q_ref = soc * 0.72 * 0.70  # = 772.128
        expected_amount = delta * q_ref  # = 308.8512
        # ±0.01: analytical exact
        assert abs(result.settlement_amount_cr - expected_amount) < 0.01, (
            f"Settlement amount expected {expected_amount:.4f}, "
            f"got {result.settlement_amount_cr:.4f}"
        )

    def test_post_award_won_settlement_amount(self, default_settlement_mi):
        """Post-award (won): amount = δ × quantum_cr."""
        quantum_cr = 1103.04  # 72% of 1532
        delta = 0.70
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 1.0
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"s37": delta}

        rng = np.random.default_rng(42)
        result = _attempt_settlement(
            stage_name="s37",
            elapsed_months=36.0,
            arb_won=True,
            quantum_cr=quantum_cr,
            soc_value_cr=1532.0,
            rng=rng,
        )

        assert result is not None
        expected_amount = delta * quantum_cr  # = 772.128
        # ±0.01: analytical exact
        assert abs(result.settlement_amount_cr - expected_amount) < 0.01, (
            f"Post-award (won) amount expected {expected_amount:.4f}, "
            f"got {result.settlement_amount_cr:.4f}"
        )

    def test_post_award_lost_settlement_amount(self, default_settlement_mi):
        """Post-award (lost): amount = δ × SOC × E[q%] × P(re-arb) × 0.50.

        KNOWN BUG (Phase 2 fix): hardcoded survival=0.50.
        """
        soc = 1532.0
        delta = 0.55
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 1.0
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"s34": delta}

        rng = np.random.default_rng(42)
        result = _attempt_settlement(
            stage_name="s34",
            elapsed_months=24.0,
            arb_won=False,
            quantum_cr=None,
            soc_value_cr=soc,
            rng=rng,
        )

        assert result is not None
        # KNOWN BUG (Phase 2 fix): post_challenge_survival is hardcoded at 0.50
        q_ref = soc * 0.72 * 0.70 * 0.50  # = 386.064
        expected_amount = delta * q_ref     # = 212.3352
        # ±0.01: analytical exact with hardcoded values
        assert abs(result.settlement_amount_cr - expected_amount) < 0.01, (
            f"Post-award (lost) amount expected {expected_amount:.4f}, "
            f"got {result.settlement_amount_cr:.4f}"
        )

    def test_discount_fallback_to_min(self, default_settlement_mi):
        """When stage not in SETTLEMENT_STAGE_DISCOUNT_FACTORS, falls back to δ_min."""
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 1.0
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {}  # no per-stage discounts
        MI.SETTLEMENT_DISCOUNT_MIN = 0.30

        rng = np.random.default_rng(42)
        result = _attempt_settlement(
            stage_name="unknown_stage",
            elapsed_months=6.0,
            arb_won=None,
            quantum_cr=None,
            soc_value_cr=1000.0,
            rng=rng,
        )

        assert result is not None
        # δ falls back to SETTLEMENT_DISCOUNT_MIN = 0.30
        assert abs(result.settlement_discount_used - 0.30) < 0.001, (
            f"Fallback discount expected 0.30, got {result.settlement_discount_used}"
        )

    def test_settlement_result_fields_populated(self, default_settlement_mi):
        """Verify all SettlementResult fields are correctly populated."""
        MI.SETTLEMENT_GLOBAL_HAZARD_RATE = 1.0
        MI.SETTLEMENT_STAGE_DISCOUNT_FACTORS = {"dab": 0.40}
        MI.SETTLEMENT_MODE = "user_specified"
        MI.SETTLEMENT_DELAY_MONTHS = 3.0

        rng = np.random.default_rng(42)
        result = _attempt_settlement(
            stage_name="dab",
            elapsed_months=8.0,
            arb_won=None,
            quantum_cr=None,
            soc_value_cr=1000.0,
            rng=rng,
        )

        assert result is not None
        assert result.settled is True
        assert result.settlement_stage == "dab"
        assert result.settlement_discount_used == 0.40
        assert result.settlement_timing_months == 8.0 + 3.0  # elapsed + delay
        assert result.settlement_mode == "user_specified"
        assert result.reference_quantum_cr > 0
        assert result.settlement_amount_cr > 0
        assert abs(result.settlement_amount_cr - 0.40 * result.reference_quantum_cr) < 0.01


# ============================================================================
# TestPathTableInvariants — Verify path table mathematical invariants
# ============================================================================

class TestPathTableInvariants:
    """Verify mathematical invariants of the probability path tables.

    These tables are read by the settlement module for P(TRUE_WIN) computation.
    Verifying their invariants here ensures settlement computations have
    correct inputs.
    """

    @pytest.mark.parametrize(
        "paths_attr,expected_total",
        [
            ("DOMESTIC_PATHS_A", 1.0),
            ("DOMESTIC_PATHS_B", 1.0),
            ("SIAC_PATHS_A", 1.0),
            ("SIAC_PATHS_B", 1.0),
            ("HKIAC_PATHS_A", 1.0),
            ("HKIAC_PATHS_B", 1.0),
        ],
    )
    def test_path_probabilities_sum_to_one(self, paths_attr, expected_total):
        """Conditional probabilities within each scenario must sum to 1.0."""
        paths = getattr(MI, paths_attr)
        total = sum(p["conditional_prob"] for p in paths)
        # ±0.005: rounding in manually specified probabilities
        assert abs(total - expected_total) < 0.005, (
            f"{paths_attr}: conditional_prob sum = {total:.6f}, expected {expected_total}"
        )

    @pytest.mark.parametrize(
        "paths_attr,expected_pwin",
        [
            ("DOMESTIC_PATHS_A", 0.7360),
            ("SIAC_PATHS_A", 0.8200),
        ],
    )
    def test_survival_prob_from_paths(self, paths_attr, expected_pwin):
        """P(TRUE_WIN) matches documented values."""
        paths = getattr(MI, paths_attr)
        p_win = _survival_prob_from_paths(paths)
        # ±0.001: sum of documented probabilities
        assert abs(p_win - expected_pwin) < 0.001, (
            f"{paths_attr}: P(TRUE_WIN) = {p_win:.4f}, expected {expected_pwin}"
        )

    @pytest.mark.parametrize(
        "paths_attr,expected_restart",
        [
            ("DOMESTIC_PATHS_B", 0.2966),
            ("SIAC_PATHS_B", 0.4200),
        ],
    )
    def test_restart_probability_from_paths(self, paths_attr, expected_restart):
        """P(RESTART) in Scenario B matches documented values."""
        paths = getattr(MI, paths_attr)
        p_restart = sum(
            p["conditional_prob"] for p in paths if p["outcome"] == "RESTART"
        )
        # ±0.005: rounding in manually specified probabilities
        assert abs(p_restart - expected_restart) < 0.005, (
            f"{paths_attr}: P(RESTART) = {p_restart:.4f}, expected {expected_restart}"
        )

    def test_scenario_a_no_restart_paths(self):
        """Scenario A (arb won) should have zero RESTART paths."""
        for attr in ("DOMESTIC_PATHS_A", "SIAC_PATHS_A"):
            paths = getattr(MI, attr)
            restart_count = sum(1 for p in paths if p["outcome"] == "RESTART")
            assert restart_count == 0, (
                f"{attr} has {restart_count} RESTART paths (expected 0)"
            )

    def test_scenario_b_no_true_win_paths(self):
        """Scenario B (arb lost) should have zero TRUE_WIN paths."""
        for attr in ("DOMESTIC_PATHS_B", "SIAC_PATHS_B"):
            paths = getattr(MI, attr)
            tw_count = sum(1 for p in paths if p["outcome"] == "TRUE_WIN")
            assert tw_count == 0, (
                f"{attr} has {tw_count} TRUE_WIN paths (expected 0)"
            )

    def test_quantum_bands_sum_to_one(self):
        """QUANTUM_BANDS probabilities must sum to 1.0."""
        total = sum(b["probability"] for b in MI.QUANTUM_BANDS)
        # ±0.001: analytical exact
        assert abs(total - 1.0) < 0.001, (
            f"QUANTUM_BANDS probability sum = {total}, expected 1.0"
        )

    def test_quantum_bands_ordered_and_bounded(self):
        """Every quantum band has 0 ≤ low < high ≤ 1 and probability > 0."""
        for i, band in enumerate(MI.QUANTUM_BANDS):
            assert 0.0 <= band["low"] < band["high"] <= 1.0, (
                f"Band {i}: [{band['low']}, {band['high']}] violates bounds"
            )
            assert band["probability"] > 0.0, f"Band {i}: zero probability"
