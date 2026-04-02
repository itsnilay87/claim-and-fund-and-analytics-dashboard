"""
TATA_code_v2/v2_monte_carlo.py — Monte Carlo Simulation Engine.
================================================================

Orchestrates all upstream layers:
  Layer 1 (timeline)     → v2_timeline_model.draw_pipeline_duration
  Layer 2 (arb outcome)  → RNG draw against ARB_WIN_PROBABILITY
  Layer 3 (quantum)      → v2_quantum_model.draw_quantum
  Layer 4 (challenge)    → v2_probability_tree.simulate_{domestic,siac}_challenge
  Layer 5 (legal costs)  → v2_legal_cost_model.build_monthly_legal_burn
  Layer 6 (cashflow)     → v2_cashflow_builder.build_cashflow
  Metrics                → v2_metrics.compute_xirr, compute_moic

All monetary values in ₹ Crore. Never calls np.random.seed().
Each path gets its own RNG: seed = base_seed + path_idx.
"""

from __future__ import annotations

from datetime import datetime, date
from typing import Optional

import numpy as np

from . import v2_master_inputs as MI
from .v2_config import (
    ChallengeResult,
    ClaimConfig,
    PathResult,
    SimulationResults,
    QuantumResult,
)
from .v2_timeline_model import draw_pipeline_duration
from .v2_quantum_model import draw_quantum, compute_expected_quantum, compute_interest_on_quantum
from .v2_probability_tree import (
    simulate_domestic_challenge,
    simulate_siac_challenge,
    simulate_hkiac_challenge,
)
from .v2_legal_cost_model import (
    build_monthly_legal_burn,
    load_legal_costs,
)
from .v2_cashflow_builder import build_cashflow
from .v2_metrics import compute_xirr, compute_moic, compute_net_return


# ===================================================================
# Single-Path Simulation
# ===================================================================

def simulate_one_path(
    path_idx: int,
    claims: list[ClaimConfig],
    base_seed: int,
    cost_table: Optional[dict] = None,
) -> list[PathResult]:
    """Simulate ONE Monte Carlo path across all 6 claims.

    Uses seed = base_seed + path_idx for exact reproducibility.
    Returns list of PathResult objects (one per claim).

    Steps per claim (EXACT sequence from spec):
      1. Draw pre-arbitration timeline
      2. Draw arbitration outcome (WIN/LOSE)
      3. If WIN → draw quantum; if LOSE → quantum = 0
      4. Traverse jurisdiction-appropriate challenge tree
      5. Handle outcome (TRUE_WIN / RESTART / LOSE)
      6. Build monthly legal burn
      7. Store PathResult
    """
    rng = np.random.default_rng(base_seed + path_idx)
    results: list[PathResult] = []

    if cost_table is None:
        cost_table = load_legal_costs()

    for claim in claims:
        result = _simulate_claim_path(claim, path_idx, rng, cost_table)
        results.append(result)

    return results


def _simulate_claim_path(
    claim: ClaimConfig,
    path_idx: int,
    rng: np.random.Generator,
    cost_table: dict,
) -> PathResult:
    """Simulate one claim through the full pipeline for one MC path."""

    # ── Step 1: Draw pre-arbitration timeline ──
    timeline = draw_pipeline_duration(claim, rng)

    # ── Step 2: Draw arbitration outcome ──
    ko = getattr(MI, 'KNOWN_OUTCOMES', None)
    if ko is not None and ko.arb_outcome is not None:
        arb_won = (ko.arb_outcome == "won")
        _ = rng.random()  # consume draw for reproducibility
    else:
        arb_won = rng.random() < MI.ARB_WIN_PROBABILITY

    # ── Step 3: Draw quantum (conditional on arb outcome) ──
    if arb_won:
        # Check for known quantum amount
        if ko is not None and ko.known_quantum_pct is not None:
            raw = rng.normal(ko.known_quantum_pct, 0.10)
            known_pct = float(np.clip(raw, 0.0, 1.0))
            quantum = QuantumResult(
                band_idx=-2, quantum_pct=known_pct,
                quantum_cr=claim.soc_value_cr * known_pct,
                expected_quantum_cr=claim.soc_value_cr * ko.known_quantum_pct,
            )
        elif ko is not None and ko.known_quantum_cr is not None:
            kp = ko.known_quantum_cr / claim.soc_value_cr if claim.soc_value_cr > 0 else 0.0
            raw = rng.normal(kp, 0.10)
            known_pct = float(np.clip(raw, 0.0, 1.0))
            quantum = QuantumResult(
                band_idx=-2, quantum_pct=known_pct,
                quantum_cr=claim.soc_value_cr * known_pct,
                expected_quantum_cr=ko.known_quantum_cr,
            )
        else:
            quantum = draw_quantum(claim.soc_value_cr, rng)
    else:
        # LOSE: quantum = 0, but carry expected quantum for reference
        eq_cr = compute_expected_quantum(claim.soc_value_cr)
        quantum = QuantumResult(
            band_idx=-1, quantum_pct=0.0, quantum_cr=0.0,
            expected_quantum_cr=eq_cr,
        )

    # ── Step 4: Traverse challenge tree ──
    if claim.jurisdiction == "domestic":
        challenge = simulate_domestic_challenge(arb_won, rng)
    elif claim.jurisdiction == "hkiac_hongkong":
        challenge = simulate_hkiac_challenge(arb_won, rng)
    else:
        challenge = simulate_siac_challenge(arb_won, rng)

    # ── Step 5: Handle outcome ──
    if claim.jurisdiction == "domestic":
        payment_delay = MI.DOMESTIC_PAYMENT_DELAY
    elif claim.jurisdiction == "hkiac_hongkong":
        payment_delay = MI.HKIAC_PAYMENT_DELAY
    else:
        payment_delay = MI.SIAC_PAYMENT_DELAY

    # ── NO_RESTART_MODE: remap RESTART → LOSE at MC level ──
    if MI.NO_RESTART_MODE and challenge.outcome == "RESTART":
        challenge = ChallengeResult(
            scenario=challenge.scenario,
            path_id=challenge.path_id,
            outcome="LOSE",
            timeline_months=challenge.timeline_months,
            stages_detail=challenge.stages_detail,
        )

    # Default values
    final_outcome = challenge.outcome
    quantum_received_cr = 0.0
    re_arb_won = None
    re_arb_quantum = None
    re_arb_duration_months = 0.0
    re_arb_challenge = None

    if challenge.outcome == "TRUE_WIN":
        # Direct win — collect full quantum
        total_duration = (
            timeline.total_months
            + challenge.timeline_months
            + payment_delay
        )
        quantum_received_cr = quantum.quantum_cr
        final_outcome = "TRUE_WIN"

    elif challenge.outcome == "RESTART":
        # Re-arbitration path
        timeline_so_far = timeline.total_months + challenge.timeline_months

        # Draw re-arb duration from Uniform(ARB_DURATION)
        re_arb_dur = float(rng.uniform(
            MI.ARB_DURATION["low"], MI.ARB_DURATION["high"]
        ))
        re_arb_payment_delay = MI.RE_ARB_PAYMENT_DELAY

        # Estimate post-re-arb challenge duration for 96m cap check.
        # Domestic: ~22.5m (S34+S37+SLP average), SIAC: 12m (HC+COA fixed)
        # HKIAC: ~22.0m (CFI avg 9 + CA avg 7.5 + CFA avg ~5.5)
        if claim.jurisdiction == "siac":
            est_post_challenge = 12.0
        elif claim.jurisdiction == "hkiac_hongkong":
            est_post_challenge = 22.0
        else:
            est_post_challenge = 22.5
        projected_total = (
            timeline_so_far + re_arb_dur
            + est_post_challenge + re_arb_payment_delay
        )

        if projected_total > MI.MAX_TIMELINE_MONTHS:
            # Exceeds 96-month cap → full loss
            total_duration = float(MI.MAX_TIMELINE_MONTHS)
            final_outcome = "LOSE"
            quantum_received_cr = 0.0
            re_arb_duration_months = re_arb_dur
        else:
            # Re-arbitration proceeds
            re_arb_won_draw = rng.random() < MI.RE_ARB_WIN_PROBABILITY
            re_arb_won = re_arb_won_draw
            re_arb_duration_months = re_arb_dur

            if re_arb_won_draw:
                # Win re-arb: draw fresh quantum
                re_arb_q = draw_quantum(claim.soc_value_cr, rng)
                re_arb_quantum = re_arb_q

                # ── Post-re-arb court challenge ──
                # The new award must survive the full Scenario A
                # challenge tree (same jurisdiction as original claim).
                if claim.jurisdiction == "domestic":
                    post_challenge = simulate_domestic_challenge(True, rng)
                elif claim.jurisdiction == "hkiac_hongkong":
                    post_challenge = simulate_hkiac_challenge(True, rng)
                else:
                    post_challenge = simulate_siac_challenge(True, rng)
                re_arb_challenge = post_challenge

                # Check post-challenge 96m cap with actual durations
                actual_total = (
                    timeline_so_far + re_arb_dur
                    + post_challenge.timeline_months + re_arb_payment_delay
                )
                if actual_total > MI.MAX_TIMELINE_MONTHS:
                    # Post-re-arb challenge pushes past cap
                    total_duration = float(MI.MAX_TIMELINE_MONTHS)
                    final_outcome = "LOSE"
                    quantum_received_cr = 0.0
                elif post_challenge.outcome == "TRUE_WIN":
                    # Re-arb award survived challenge → collect
                    quantum_received_cr = re_arb_q.quantum_cr
                    total_duration = actual_total
                    final_outcome = "TRUE_WIN"
                else:
                    # Re-arb award did not survive challenge (LOSE or
                    # second RESTART — terminal, no further re-arb)
                    total_duration = (
                        timeline_so_far + re_arb_dur
                        + post_challenge.timeline_months
                    )
                    final_outcome = "LOSE"
                    quantum_received_cr = 0.0
            else:
                # Lose re-arb: game over
                total_duration = timeline_so_far + re_arb_dur
                final_outcome = "LOSE"
                quantum_received_cr = 0.0

    else:  # "LOSE"
        total_duration = (
            timeline.total_months
            + challenge.timeline_months
        )
        final_outcome = "LOSE"
        quantum_received_cr = 0.0

    # ── Step 5b: Interest accumulation on awarded quantum ──
    interest_earned_cr = 0.0
    if MI.INTEREST_ENABLED and quantum_received_cr > 0.0:
        # ── Draw rate & type from stochastic band distribution ──
        if claim.jurisdiction == "domestic":
            bands = MI.INTEREST_RATE_BANDS_DOMESTIC
        elif claim.jurisdiction == "hkiac_hongkong":
            bands = MI.INTEREST_RATE_BANDS_HKIAC
        else:
            bands = MI.INTEREST_RATE_BANDS_SIAC

        if len(bands) == 1:
            int_rate = bands[0]["rate"]
            int_type = bands[0].get("type", "simple")
        else:
            probs = [b["probability"] for b in bands]
            band_idx = rng.choice(len(bands), p=probs)
            int_rate = bands[band_idx]["rate"]
            int_type = bands[band_idx].get("type", "simple")

        # ── Compute interest accrual duration ──
        if MI.INTEREST_START_BASIS == "dab_commencement":
            # From DAB commencement date to payment receipt
            # total_duration already includes all pipeline + challenge + payment delay
            # We need: DAB commencement → START_DATE (already elapsed) + total_duration (months forward)
            dab_date_str = claim.dab_commencement_date or ""
            if dab_date_str:
                try:
                    dab_date = datetime.strptime(dab_date_str, "%Y-%m-%d").date()
                    start_date = datetime.strptime(MI.START_DATE, "%Y-%m-%d").date()
                    # Months from DAB commencement to investment start date
                    pre_investment_months = (
                        (start_date.year - dab_date.year) * 12
                        + (start_date.month - dab_date.month)
                        + (start_date.day - dab_date.day) / 30.0
                    )
                    if pre_investment_months < 0:
                        pre_investment_months = 0.0
                    # Total interest duration = pre-investment elapsed + post-investment to payment
                    interest_duration = pre_investment_months + total_duration
                except (ValueError, TypeError):
                    # Fallback to award-date basis if date parsing fails
                    if re_arb_challenge is not None and re_arb_won:
                        interest_duration = re_arb_challenge.timeline_months + MI.RE_ARB_PAYMENT_DELAY
                    else:
                        interest_duration = challenge.timeline_months + payment_delay
            else:
                # No DAB date for this claim — fall back to award_date basis
                if re_arb_challenge is not None and re_arb_won:
                    interest_duration = re_arb_challenge.timeline_months + MI.RE_ARB_PAYMENT_DELAY
                else:
                    interest_duration = challenge.timeline_months + payment_delay
        else:
            # award_date basis (original behaviour)
            # Interest accrual period: from arbitration award to payment receipt
            if re_arb_challenge is not None and re_arb_won:
                interest_duration = re_arb_challenge.timeline_months + MI.RE_ARB_PAYMENT_DELAY
            else:
                interest_duration = challenge.timeline_months + payment_delay

        interest_earned_cr = compute_interest_on_quantum(
            quantum_cr=quantum_received_cr,
            duration_months=interest_duration,
            annual_rate=int_rate,
            interest_type=int_type,
        )
        quantum_received_cr += interest_earned_cr

    # ── Step 6: Build monthly legal burn ──
    # Combine all stage durations: pipeline + challenge tree stages
    all_stage_durations = dict(timeline.stage_durations)
    # Add challenge tree stages (from ChallengeResult.stages_detail)
    for stage_name, stage_dur in challenge.stages_detail.items():
        all_stage_durations[stage_name] = stage_dur
    # Add re-arb if applicable
    if re_arb_duration_months > 0:
        all_stage_durations["re_arbitration"] = re_arb_duration_months
    # Add post-re-arb challenge stages (re-arb award faces Scenario A tree)
    if re_arb_challenge is not None:
        for stage_name, stage_dur in re_arb_challenge.stages_detail.items():
            # Prefix with "post_rearb_" to avoid collision with first challenge
            all_stage_durations[f"post_rearb_{stage_name}"] = stage_dur

    # Extract SLP admission status for legal cost model
    # (domestic claims only — SIAC claims don't have SLP stage)
    slp_admitted_flag = None
    if claim.jurisdiction == "domestic":
        # SLP admission is determined by the challenge tree path
        slp_dur = challenge.stages_detail.get("slp", 0.0)
        if slp_dur > 0:
            # SLP admitted if duration == SLP_ADMITTED_DURATION (24 months)
            # SLP dismissed if duration == SLP_DISMISSED_DURATION (4 months)
            slp_admitted_flag = (slp_dur >= MI.SLP_ADMITTED_DURATION)

    monthly_burn = build_monthly_legal_burn(
        claim.claim_id, all_stage_durations, rng, cost_table,
        slp_admitted=slp_admitted_flag,
    )
    legal_cost_total = float(np.sum(monthly_burn))

    # ── Step 7: Build PathResult ──
    return PathResult(
        claim_id=claim.claim_id,
        path_idx=path_idx,
        timeline=timeline,
        challenge=challenge,
        arb_won=arb_won,
        quantum=quantum if arb_won else None,
        final_outcome=final_outcome,
        total_duration_months=total_duration,
        monthly_legal_burn=monthly_burn,
        legal_cost_total_cr=legal_cost_total,
        collected_cr=quantum_received_cr,
        interest_earned_cr=interest_earned_cr,
        slp_admitted=slp_admitted_flag,
        re_arb_won=re_arb_won,
        re_arb_quantum=re_arb_quantum,
        re_arb_duration_months=re_arb_duration_months,
        re_arb_challenge=re_arb_challenge,
    )


# ===================================================================
# Full Simulation
# ===================================================================

def run_simulation(
    n: int,
    seed: int,
    claims: list[ClaimConfig],
) -> SimulationResults:
    """Run full Monte Carlo simulation.

    Parameters
    ----------
    n : int
        Number of MC paths.
    seed : int
        Base seed for reproducibility.
    claims : list[ClaimConfig]
        Pre-built claim configs from build_claim_configs().

    Returns
    -------
    SimulationResults with per-claim lists of N PathResult.
    """
    # Pre-load legal cost table once (avoids file I/O per path)
    cost_table = load_legal_costs()

    # Pre-compute analytical E[Q] per claim
    expected_quantum_map = {
        c.claim_id: compute_expected_quantum(c.soc_value_cr)
        for c in claims
    }

    # Sequential MC loop
    all_paths: list[list[PathResult]] = []
    for i in range(n):
        all_paths.append(simulate_one_path(i, claims, seed, cost_table))

    # Reshape: per-path list-of-6 → per-claim list-of-N
    results_by_claim: dict[str, list[PathResult]] = {
        c.claim_id: [] for c in claims
    }
    for path in all_paths:
        for result in path:
            results_by_claim[result.claim_id].append(result)

    # Verify counts
    for cid, paths in results_by_claim.items():
        assert len(paths) == n, (
            f"{cid}: expected {n} results, got {len(paths)}"
        )

    # Build SimulationResults
    sim = SimulationResults(
        n_paths=n,
        seed=seed,
        claim_ids=[c.claim_id for c in claims],
    )
    sim.results = results_by_claim
    sim.expected_quantum_map = expected_quantum_map

    # Compute per-claim summary stats
    for cid, paths in results_by_claim.items():
        durations = np.array([p.total_duration_months for p in paths])
        sim.mean_duration_map[cid] = float(durations.mean())

        n_win = sum(1 for p in paths if p.final_outcome == "TRUE_WIN")
        sim.win_rate_map[cid] = n_win / n

    return sim


# ===================================================================
# Numerical Audit
# ===================================================================

def print_numerical_audit(sim: SimulationResults) -> bool:
    """Print audit table with MC results per claim.

    Returns True if basic sanity checks pass.

    Reports:
      - P(arb_win), P(true_win pre/post re-arb), P(restart), P(lose)
      - E[Q|WIN] as % of SOC
      - E[duration], E[legal costs]
      - Expected values from probability tree structure
    """
    all_pass = True

    print("\n" + "=" * 120)
    print("NUMERICAL AUDIT — v2 Monte Carlo Results")
    print(f"N = {sim.n_paths:,}  |  seed = {sim.seed}")
    print("=" * 120)

    # --- Part 1: Core metrics table ---
    print(
        f"{'Claim':<15} {'SOC ₹Cr':>10} {'P(arb_win)':>11} "
        f"{'P(TW pre)':>10} {'P(TW post)':>11} {'P(RESTART)':>11} "
        f"{'P(LOSE)':>9} {'E[dur mo]':>10} {'E[legal ₹Cr]':>13}"
    )
    print("-" * 120)

    from .v2_config import build_claim_configs
    claim_cfgs = {c.claim_id: c for c in build_claim_configs()}
    tau_means: dict[str, float] = {}

    domestic_tw_pre = []
    domestic_tw_post = []
    siac_tw_pre = []
    siac_tw_post = []
    hkiac_tw_pre = []
    hkiac_tw_post = []

    for cid in sim.claim_ids:
        paths = sim.results[cid]
        claim = claim_cfgs[cid]
        n_paths = len(paths)

        n_arb_win = sum(1 for p in paths if p.arb_won)
        # TRUE_WIN before re-arb = challenge.outcome was TRUE_WIN (no re-arb needed)
        n_tw_pre = sum(1 for p in paths if p.challenge.outcome == "TRUE_WIN")
        # TRUE_WIN after re-arb = final outcome
        n_tw_post = sum(1 for p in paths if p.final_outcome == "TRUE_WIN")
        n_restart = sum(1 for p in paths if p.challenge.outcome == "RESTART")
        n_lose_final = sum(1 for p in paths if p.final_outcome == "LOSE")

        # Re-arb stats
        n_96m_breach = sum(
            1 for p in paths
            if p.challenge.outcome == "RESTART"
            and p.re_arb_won is None  # 96m breach → no re-arb draw
        )
        n_re_arb_triggered = sum(
            1 for p in paths if p.re_arb_won is not None
        )

        durations = [p.total_duration_months for p in paths]
        e_dur = float(np.mean(durations))
        tau_means[cid] = e_dur

        legal_costs = [p.legal_cost_total_cr for p in paths]
        e_legal = float(np.mean(legal_costs))

        p_arb = n_arb_win / n_paths
        p_tw_pre = n_tw_pre / n_paths
        p_tw_post = n_tw_post / n_paths
        p_restart = n_restart / n_paths
        p_lose = n_lose_final / n_paths

        # Track for summary verification
        if claim.jurisdiction == "domestic":
            domestic_tw_pre.append(p_tw_pre)
            domestic_tw_post.append(p_tw_post)
        elif claim.jurisdiction == "hkiac_hongkong":
            hkiac_tw_pre.append(p_tw_pre)
            hkiac_tw_post.append(p_tw_post)
        else:
            siac_tw_pre.append(p_tw_pre)
            siac_tw_post.append(p_tw_post)

        flag = ""
        if abs(p_arb - MI.ARB_WIN_PROBABILITY) > 0.04:
            flag += " ⚠ARB"
            all_pass = False

        print(
            f"{cid:<15} {claim.soc_value_cr:>10.2f} "
            f"{p_arb:>11.1%} {p_tw_pre:>10.1%} {p_tw_post:>11.1%} "
            f"{p_restart:>11.1%} {p_lose:>9.1%} "
            f"{e_dur:>10.1f} {e_legal:>13.2f}{flag}"
        )

    print("-" * 120)

    # --- Part 2: E[Q|WIN] check ---
    print("\n  E[Q|WIN] verification (should be ≈ 72.00% of SOC):")
    for cid in sim.claim_ids:
        paths = sim.results[cid]
        claim = claim_cfgs[cid]
        quanta_win = []
        for p in paths:
            if p.arb_won and p.quantum is not None:
                quanta_win.append(p.quantum.quantum_cr)
            # Also include re-arb quantum if applicable
            if p.re_arb_quantum is not None:
                quanta_win.append(p.re_arb_quantum.quantum_cr)

        if quanta_win:
            e_q_pct = float(np.mean(quanta_win)) / claim.soc_value_cr
            print(f"    {cid}: E[Q|WIN] = {e_q_pct:.2%} of SOC "
                  f"(analytical: {sim.expected_quantum_map[cid]/claim.soc_value_cr:.2%})")

    # --- Part 2b: Interest accumulation summary ---
    if MI.INTEREST_ENABLED:
        print(f"\n  Interest accumulation: ENABLED")
        print(f"    Start basis: {MI.INTEREST_START_BASIS}")
        # Domestic rate bands
        if len(MI.INTEREST_RATE_BANDS_DOMESTIC) == 1:
            b = MI.INTEREST_RATE_BANDS_DOMESTIC[0]
            print(f"    Domestic: {b['rate']:.1%} p.a. ({b.get('type', 'simple')})")
        else:
            print(f"    Domestic rate bands ({len(MI.INTEREST_RATE_BANDS_DOMESTIC)}):")
            for b in MI.INTEREST_RATE_BANDS_DOMESTIC:
                print(f"      {b['rate']:.1%} ({b.get('type', 'simple')}) — P={b['probability']:.0%}")
        # SIAC rate bands
        if len(MI.INTEREST_RATE_BANDS_SIAC) == 1:
            b = MI.INTEREST_RATE_BANDS_SIAC[0]
            print(f"    SIAC:     {b['rate']:.1%} p.a. ({b.get('type', 'simple')})")
        else:
            print(f"    SIAC rate bands ({len(MI.INTEREST_RATE_BANDS_SIAC)}):")
            for b in MI.INTEREST_RATE_BANDS_SIAC:
                print(f"      {b['rate']:.1%} ({b.get('type', 'simple')}) — P={b['probability']:.0%}")
        # HKIAC rate bands
        if len(MI.INTEREST_RATE_BANDS_HKIAC) == 1:
            b = MI.INTEREST_RATE_BANDS_HKIAC[0]
            print(f"    HKIAC:    {b['rate']:.1%} p.a. ({b.get('type', 'simple')})")
        else:
            print(f"    HKIAC rate bands ({len(MI.INTEREST_RATE_BANDS_HKIAC)}):")
            for b in MI.INTEREST_RATE_BANDS_HKIAC:
                print(f"      {b['rate']:.1%} ({b.get('type', 'simple')}) — P={b['probability']:.0%}")
        for cid in sim.claim_ids:
            paths = sim.results[cid]
            interest_vals = [p.interest_earned_cr for p in paths if p.interest_earned_cr > 0]
            if interest_vals:
                mean_int = float(np.mean(interest_vals))
                mean_col = float(np.mean([p.collected_cr for p in paths if p.collected_cr > 0]))
                pct_of_col = mean_int / mean_col * 100 if mean_col > 0 else 0
                print(f"    {cid}: E[interest|WIN] = ₹{mean_int:.2f} Cr "
                      f"({pct_of_col:.1f}% of E[collected|WIN])")
    else:
        print(f"\n  Interest accumulation: DISABLED (base run)")

    # --- Part 3: Aggregate win rate checks ---
    if domestic_tw_pre:
        avg_dom_pre = np.mean(domestic_tw_pre)
        avg_dom_post = np.mean(domestic_tw_post)
        print(f"\n  Domestic avg P(TW pre-reArb) = {avg_dom_pre:.1%} (expected ≈ 52%)")
        print(f"  Domestic avg P(TW post-reArb) = {avg_dom_post:.1%} (expected ≈ 53-57%)")
    if siac_tw_pre:
        avg_siac_pre = np.mean(siac_tw_pre)
        avg_siac_post = np.mean(siac_tw_post)
        print(f"  SIAC avg P(TW pre-reArb) = {avg_siac_pre:.1%} (expected ≈ 53%)")
        print(f"  SIAC avg P(TW post-reArb) = {avg_siac_post:.1%} (expected ≈ 62-67%)")
    if hkiac_tw_pre:
        avg_hk_pre = np.mean(hkiac_tw_pre)
        avg_hk_post = np.mean(hkiac_tw_post)
        print(f"  HKIAC avg P(TW pre-reArb) = {avg_hk_pre:.1%} (expected ≈ 56%)")
        print(f"  HKIAC avg P(TW post-reArb) = {avg_hk_post:.1%}")

    # --- Part 4: Timeline ordering ---
    if tau_means:
        shortest = min(tau_means, key=tau_means.get)  # type: ignore
        longest = max(tau_means, key=tau_means.get)  # type: ignore
        print(f"\n  Shortest E[τ]: {shortest} ({tau_means[shortest]:.1f} mo)")
        print(f"  Longest E[τ]:  {longest} ({tau_means[longest]:.1f} mo)")
        print("  Note: SIAC claims tend shorter than domestic due to "
              "fixed 12-month challenge vs 19-54 months")

    print("\n" + "=" * 120)
    status = " ALL AUDIT CHECKS PASSED" if all_pass else " AUDIT WARNINGS (see flags above)"
    print(f"{status}\n")
    return all_pass
