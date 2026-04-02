"""
engine/simulation/monte_carlo.py — Core Monte Carlo Simulation Engine.
======================================================================

Heart of the Claim Analytics Platform — simulates N stochastic paths
through the full litigation pipeline for each claim.

Orchestrates all upstream model layers:
  Layer 1 (timeline)     → engine.models.timeline_model.draw_pipeline_duration
  Layer 2 (arb outcome)  → RNG draw against claim.arbitration.win_probability
  Layer 3 (quantum)      → engine.models.quantum_model.draw_quantum
  Layer 4 (challenge)    → engine.models.probability_tree.simulate_challenge_tree
  Layer 5 (legal costs)  → engine.models.legal_cost_model.build_monthly_legal_costs
  Layer 6 (interest)     → engine.models.quantum_model.compute_interest_on_quantum

Jurisdiction-agnostic: uses the generic tree walker for all challenge
tree traversals.  Works with Pydantic schema objects.

All monetary values in native currency (default ₹ Crore).
All durations in months.  Never calls np.random.seed().
Each path gets its own RNG: np.random.default_rng(seed + path_idx).
"""

from __future__ import annotations

from typing import Any, Optional

import numpy as np

from engine.config.schema import (
    ClaimConfig,
    JurisdictionTemplate,
    PathResult,
    ScenarioTree,
    TreeNode,
)
from engine.models.probability_tree import (
    ChallengeResult,
    simulate_challenge_tree,
    simulate_challenge_tree_with_known_outcomes,
)
from engine.models.quantum_model import (
    QuantumResult,
    compute_interest_on_quantum,
    draw_known_quantum,
    draw_quantum,
)
from engine.models.timeline_model import draw_pipeline_duration
from engine.models.legal_cost_model import build_monthly_legal_costs

# Jurisdiction code mapping for challenge tree known-outcome traversal
_JUR_MAP: dict[str, str] = {
    "domestic": "domestic", "siac": "siac", "hkiac": "hkiac",
    "indian_domestic": "domestic", "siac_singapore": "siac", "hkiac_hongkong": "hkiac",
}


# ============================================================================
# Internal helpers
# ============================================================================

def _get_arb_stage_params(claim: ClaimConfig) -> tuple[float, float]:
    """Find arbitration stage duration bounds from claim timeline.

    Scans ``pre_arb_stages`` for a stage whose name contains 'arb'
    (case-insensitive) and returns (duration_low, duration_high).
    Falls back to (20.3, 23.4) if no match.
    """
    for stage in claim.timeline.pre_arb_stages:
        if "arb" in stage.name.lower():
            return stage.duration_low, stage.duration_high
    return 20.3, 23.4


def _expected_duration_from_dist(dist: Optional[dict[str, Any]]) -> float:
    """Compute expected value from a duration_distribution dict."""
    if dist is None:
        return 0.0
    dtype = dist.get("type", "fixed")
    if dtype == "fixed":
        return float(dist.get("value", 0.0))
    elif dtype == "uniform":
        return (float(dist.get("low", 0.0)) + float(dist.get("high", 0.0))) / 2.0
    return 0.0


def _expected_tree_duration(node: TreeNode) -> float:
    """Recursively compute expected total duration from a node to a leaf.

    At each internal node, the expected duration is the probability-weighted
    sum of: (child's own duration) + (expected duration below that child).
    Leaf duration is counted at the parent level, so leaves return 0.
    """
    if not node.children:
        return 0.0  # Duration already counted when selected by parent

    expected = 0.0
    for child in node.children:
        child_own = _expected_duration_from_dist(child.duration_distribution)
        child_below = _expected_tree_duration(child)
        expected += child.probability * (child_own + child_below)
    return expected


def _min_duration_from_dist(dist: Optional[dict[str, Any]]) -> float:
    """Compute minimum possible duration from a duration_distribution dict."""
    if dist is None:
        return 0.0
    dtype = dist.get("type", "fixed")
    if dtype == "fixed":
        return float(dist.get("value", 0.0))
    elif dtype == "uniform":
        return float(dist.get("low", 0.0))
    return 0.0


def _min_tree_duration(node: TreeNode) -> float:
    """Compute the minimum possible total duration from node to any leaf.

    Takes the shortest path through the tree — used for lenient
    pre-screening (actual check after simulation catches overages).
    Leaf duration is counted at the parent level, so leaves return 0.
    """
    if not node.children:
        return 0.0  # Duration already counted when selected by parent

    min_dur = float("inf")
    for child in node.children:
        child_own = _min_duration_from_dist(child.duration_distribution)
        child_below = _min_tree_duration(child)
        path_dur = child_own + child_below
        min_dur = min(min_dur, path_dur)
    return min_dur


def _estimate_challenge_duration(tree: ScenarioTree) -> float:
    """Estimate post-challenge duration for 96-month pre-screening.

    Uses the MINIMUM possible path through the tree — this is a lenient
    pre-screen.  The actual max-horizon check after simulation will catch
    paths that truly exceed the cap.  This avoids false negatives from
    overly conservative estimates.
    """
    return _min_tree_duration(tree.root)


# ============================================================================
# 1. simulate_one_path — per-claim per-path simulation
# ============================================================================

def simulate_one_path(
    claim: ClaimConfig,
    jurisdiction_template: JurisdictionTemplate,
    path_index: int,
    seed: int,
    rng: np.random.Generator,
) -> PathResult:
    """Simulate ONE stochastic path through the full litigation pipeline.

    RNG draw order is critical for reproducibility — see step comments.

    Parameters
    ----------
    claim : ClaimConfig
        Full claim configuration with tree, quantum, timeline, etc.
    jurisdiction_template : JurisdictionTemplate
        Jurisdiction template (used for metadata; tree is on the claim).
    path_index : int
        MC path index (0..N-1).
    seed : int
        Seed used for this path's RNG.
    rng : np.random.Generator
        Random number generator for this path.

    Returns
    -------
    PathResult (Pydantic model).
    """
    max_horizon = claim.timeline.max_horizon_months
    payment_delay = claim.timeline.payment_delay_months
    ko = claim.known_outcomes  # KnownOutcomes (all None if not set)

    # ── Special case: enforcement stage ──
    # All legal proceedings complete — just compute collection.
    if claim.current_stage == 'enforcement':
        arb_won = (ko.arb_outcome == 'won') if ko.arb_outcome else True
        if arb_won:
            if ko.known_quantum_pct is not None:
                quantum_pct = ko.known_quantum_pct
            elif ko.known_quantum_cr is not None:
                quantum_pct = ko.known_quantum_cr / claim.soc_value_cr if claim.soc_value_cr > 0 else 0.0
            else:
                quantum_pct = claim.quantum.expected_quantum_pct
            quantum_cr = claim.soc_value_cr * quantum_pct
            collected = quantum_cr * claim.claimant_share_pct
        else:
            quantum_pct = 0.0
            quantum_cr = 0.0
            collected = 0.0

        return PathResult(
            outcome="TRUE_WIN" if arb_won else "LOSE",
            quantum_cr=quantum_cr,
            quantum_pct=min(quantum_pct, 1.0),
            timeline_months=payment_delay,
            legal_costs_cr=0.0,
            collected_cr=collected,
            challenge_path_id="ENFORCEMENT",
            stages_traversed=["enforcement"],
            band_idx=-3,
            interest_cr=0.0,
        )

    # ── Step 1: Draw pre-arbitration pipeline durations ──
    timeline_months, stage_durations = draw_pipeline_duration(claim, rng)

    # ── Step 2: Draw arbitration outcome ──
    if ko.arb_outcome is not None:
        # FORCED: arb outcome is already known
        arb_won = (ko.arb_outcome == "won")
        # Still consume an RNG draw to maintain reproducibility
        _ = rng.random()
    else:
        arb_won = rng.random() < claim.arbitration.win_probability

    # ── Step 3: Draw quantum (conditional on arb outcome) ──
    quantum_result: Optional[QuantumResult] = None
    if arb_won:
        if ko.known_quantum_pct is not None:
            quantum_result = draw_known_quantum(
                claim.soc_value_cr, ko.known_quantum_pct, rng,
            )
        elif ko.known_quantum_cr is not None:
            known_pct = ko.known_quantum_cr / claim.soc_value_cr if claim.soc_value_cr > 0 else 0.0
            quantum_result = draw_known_quantum(
                claim.soc_value_cr, known_pct, rng,
            )
        else:
            quantum_result = draw_quantum(claim.soc_value_cr, claim.quantum, rng)

    # ── Step 4: Simulate post-award challenge tree ──
    if arb_won:
        tree = claim.challenge_tree.scenario_a
        scenario_label = "A"
    else:
        tree = claim.challenge_tree.scenario_b
        scenario_label = "B"

    # Use partial traversal if any challenge outcomes are known
    _has_known_challenge = any([
        ko.s34_outcome, ko.s37_outcome, ko.slp_gate_outcome, ko.slp_merits_outcome,
        ko.hc_outcome, ko.coa_outcome,
        ko.cfi_outcome, ko.ca_outcome, ko.cfa_gate_outcome, ko.cfa_merits_outcome,
    ])

    if _has_known_challenge:
        engine_jur = _JUR_MAP.get(claim.jurisdiction, "domestic")
        challenge_result = simulate_challenge_tree_with_known_outcomes(
            tree, ko, engine_jur, rng, scenario_label=scenario_label,
        )
    else:
        challenge_result = simulate_challenge_tree(
            tree, rng, scenario_label=scenario_label,
        )

    # ── NO_RESTART_MODE: remap RESTART → LOSE ──
    if claim.no_restart_mode and challenge_result.outcome == "RESTART":
        challenge_result = ChallengeResult(
            scenario=challenge_result.scenario,
            outcome="LOSE",
            path_description=challenge_result.path_description,
            challenge_duration_months=challenge_result.challenge_duration_months,
            stages_traversed=challenge_result.stages_traversed,
            slp_admitted=challenge_result.slp_admitted,
        )

    # ── Step 5: Handle outcome ──
    final_outcome = challenge_result.outcome
    collected_cr = 0.0
    total_duration = 0.0
    interest_cr = 0.0
    re_arb_quantum: Optional[QuantumResult] = None

    if challenge_result.outcome == "TRUE_WIN":
        # Direct win — collect quantum × claimant share
        collected_cr = quantum_result.quantum_cr * claim.claimant_share_pct
        total_duration = (
            timeline_months
            + challenge_result.challenge_duration_months
            + payment_delay
        )

    elif challenge_result.outcome == "RESTART":
        # Re-arbitration path
        timeline_so_far = (
            timeline_months + challenge_result.challenge_duration_months
        )

        # Draw re-arb duration from arbitration stage params
        arb_low, arb_high = _get_arb_stage_params(claim)
        re_arb_dur = float(rng.uniform(arb_low, arb_high))

        # Pre-screen: project total duration with estimated post-challenge
        est_post_challenge = _estimate_challenge_duration(
            claim.challenge_tree.scenario_a,
        )
        projected_total = (
            timeline_so_far + re_arb_dur
            + est_post_challenge + payment_delay
        )

        if projected_total > max_horizon:
            # Exceeds 96-month cap → force LOSE
            final_outcome = "LOSE"
            total_duration = float(max_horizon)
            collected_cr = 0.0
        else:
            # Re-arbitration proceeds
            re_arb_won = rng.random() < claim.arbitration.re_arb_win_probability

            if re_arb_won:
                # Win re-arb: draw fresh quantum
                re_arb_quantum = draw_quantum(
                    claim.soc_value_cr, claim.quantum, rng,
                )

                # Post-re-arb challenge tree (Scenario A — re-arb was won)
                post_tree = claim.challenge_tree.scenario_a
                post_challenge = simulate_challenge_tree(
                    post_tree, rng, scenario_label="A",
                )

                actual_total = (
                    timeline_so_far + re_arb_dur
                    + post_challenge.challenge_duration_months + payment_delay
                )

                if actual_total > max_horizon:
                    # Post-re-arb challenge pushes past cap
                    final_outcome = "LOSE"
                    total_duration = float(max_horizon)
                    collected_cr = 0.0
                elif post_challenge.outcome == "TRUE_WIN":
                    # Re-arb award survived challenge → collect
                    final_outcome = "TRUE_WIN"
                    collected_cr = (
                        re_arb_quantum.quantum_cr * claim.claimant_share_pct
                    )
                    total_duration = actual_total
                else:
                    # Re-arb award did not survive (LOSE or second RESTART
                    # — terminal, no further re-arb)
                    final_outcome = "LOSE"
                    total_duration = (
                        timeline_so_far + re_arb_dur
                        + post_challenge.challenge_duration_months
                    )
                    collected_cr = 0.0
            else:
                # Lose re-arb: game over
                final_outcome = "LOSE"
                total_duration = timeline_so_far + re_arb_dur
                collected_cr = 0.0

    else:  # LOSE
        total_duration = (
            timeline_months + challenge_result.challenge_duration_months
        )
        collected_cr = 0.0

    # ── Step 6: Apply max horizon cap ──
    if total_duration > max_horizon:
        total_duration = float(max_horizon)
        final_outcome = "LOSE"
        collected_cr = 0.0

    # ── Step 7: Handle interest on quantum ──
    if claim.interest.enabled and collected_cr > 0.0:
        interest_cr = compute_interest_on_quantum(
            quantum_cr=collected_cr,
            duration_months=total_duration,
            interest_config=claim.interest,
        )
        collected_cr += interest_cr

    # ── Step 8: Build monthly legal cost vector ──
    monthly_burn, total_legal = build_monthly_legal_costs(
        claim, stage_durations, challenge_result.stages_traversed, rng,
    )

    # ── Determine quantum values for PathResult ──
    q_cr = 0.0
    q_pct = 0.0
    b_idx = -1
    if quantum_result is not None:
        q_cr = quantum_result.quantum_cr
        q_pct = quantum_result.quantum_pct
        b_idx = quantum_result.band_idx
    # If re-arb quantum was used for the final outcome, report that instead
    if re_arb_quantum is not None and final_outcome == "TRUE_WIN":
        q_cr = re_arb_quantum.quantum_cr
        q_pct = re_arb_quantum.quantum_pct
        b_idx = re_arb_quantum.band_idx

    return PathResult(
        outcome=final_outcome,
        quantum_cr=q_cr,
        quantum_pct=q_pct,
        timeline_months=total_duration,
        legal_costs_cr=total_legal,
        collected_cr=collected_cr,
        challenge_path_id=challenge_result.path_description,
        stages_traversed=[
            s["stage"] for s in challenge_result.stages_traversed
        ],
        band_idx=b_idx,
        interest_cr=interest_cr,
    )


# ============================================================================
# 2. run_claim_simulation — N paths for one claim
# ============================================================================

def run_claim_simulation(
    claim: ClaimConfig,
    jurisdiction_template: JurisdictionTemplate,
    n_paths: int,
    seed: int,
) -> list[PathResult]:
    """Run N Monte Carlo paths for a single claim.

    Each path gets its own RNG: ``np.random.default_rng(seed + i)``.

    Parameters
    ----------
    claim : ClaimConfig
    jurisdiction_template : JurisdictionTemplate
    n_paths : int
        Number of MC paths.
    seed : int
        Base seed for reproducibility.

    Returns
    -------
    list of N PathResult objects.
    """
    results: list[PathResult] = []
    for i in range(n_paths):
        rng = np.random.default_rng(seed + i)
        result = simulate_one_path(
            claim, jurisdiction_template, i, seed + i, rng,
        )
        results.append(result)
    return results


# ============================================================================
# 3. run_portfolio_simulation — N paths for all claims
# ============================================================================

def run_portfolio_simulation(
    claims: list[ClaimConfig],
    templates: dict[str, JurisdictionTemplate],
    n_paths: int,
    seed: int,
) -> dict[str, list[PathResult]]:
    """Run N paths for ALL claims in a portfolio.

    CRITICAL: all claims use the SAME seed progression — path i for all
    claims uses ``base_seed + i``.  This ensures path alignment for
    portfolio-level aggregation (e.g. computing portfolio MOIC on path i
    by summing across claims).

    Parameters
    ----------
    claims : list[ClaimConfig]
    templates : dict[str, JurisdictionTemplate]
        Map of jurisdiction_id → JurisdictionTemplate.
    n_paths : int
    seed : int

    Returns
    -------
    {claim_id: [PathResult_0, ..., PathResult_N-1]}
    """
    results: dict[str, list[PathResult]] = {c.id: [] for c in claims}

    for i in range(n_paths):
        path_seed = seed + i
        for claim in claims:
            rng = np.random.default_rng(path_seed)
            template = templates.get(claim.jurisdiction)
            result = simulate_one_path(
                claim, template, i, path_seed, rng,
            )
            results[claim.id].append(result)

    return results


# ============================================================================
# 4. compute_claim_summary — aggregate N path results
# ============================================================================

def compute_claim_summary(
    claim: ClaimConfig,
    path_results: list[PathResult],
) -> dict:
    """Aggregate N path results into summary statistics.

    Parameters
    ----------
    claim : ClaimConfig
    path_results : list[PathResult]

    Returns
    -------
    dict with keys: win_rate, effective_win_rate, mean_quantum_cr,
    median_quantum_cr, mean_duration_months, median_duration_months,
    mean_legal_costs_cr, mean_collected_cr, outcome_distribution,
    quantum_percentiles, duration_percentiles, legal_cost_percentiles.
    """
    n = len(path_results)
    if n == 0:
        return {}

    outcomes = [r.outcome for r in path_results]
    n_tw = sum(1 for o in outcomes if o == "TRUE_WIN")
    n_restart = sum(1 for o in outcomes if o == "RESTART")
    n_lose = sum(1 for o in outcomes if o == "LOSE")

    effective_wins = sum(1 for r in path_results if r.collected_cr > 0)

    all_durations = np.array([r.timeline_months for r in path_results])
    all_legal = np.array([r.legal_costs_cr for r in path_results])
    all_collected = np.array([r.collected_cr for r in path_results])

    # Quantum distribution — conditional on TRUE_WIN with nonzero quantum
    win_quantums = np.array([
        r.quantum_cr for r in path_results
        if r.outcome == "TRUE_WIN" and r.quantum_cr > 0
    ])

    return {
        "n_paths": n,
        "win_rate": n_tw / n,
        "effective_win_rate": effective_wins / n,
        "mean_quantum_cr": (
            float(win_quantums.mean()) if len(win_quantums) > 0 else 0.0
        ),
        "median_quantum_cr": (
            float(np.median(win_quantums)) if len(win_quantums) > 0 else 0.0
        ),
        "mean_duration_months": float(all_durations.mean()),
        "median_duration_months": float(np.median(all_durations)),
        "mean_legal_costs_cr": float(all_legal.mean()),
        "mean_collected_cr": float(all_collected.mean()),
        "outcome_distribution": {
            "TRUE_WIN": n_tw,
            "RESTART": n_restart,
            "LOSE": n_lose,
        },
        "quantum_percentiles": (
            _percentiles(win_quantums) if len(win_quantums) > 0 else {}
        ),
        "duration_percentiles": _percentiles(all_durations),
        "legal_cost_percentiles": _percentiles(all_legal),
    }


def _percentiles(arr: np.ndarray) -> dict[str, float]:
    """Compute standard percentiles (p5, p25, p50, p75, p95)."""
    if len(arr) == 0:
        return {}
    return {
        "p5": float(np.percentile(arr, 5)),
        "p25": float(np.percentile(arr, 25)),
        "p50": float(np.percentile(arr, 50)),
        "p75": float(np.percentile(arr, 75)),
        "p95": float(np.percentile(arr, 95)),
    }
