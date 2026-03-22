#!/usr/bin/env python3
"""Quick validation script for all v2 modules."""
import sys
sys.stdout.reconfigure(encoding='utf-8')
import numpy as np

print("=" * 60)
print("VALIDATION: Import all v2 modules")
print("=" * 60)

# 1. Master inputs
print("\n1. Importing v2_master_inputs...")
from . import v2_master_inputs as MI
print(f"   Claims: {len(MI.CLAIMS)}")
total_soc = sum(c["soc_value_cr"] for c in MI.CLAIMS)
print(f"   Total SOC: {total_soc:.2f} Cr")
qb_sum = sum(b["probability"] for b in MI.QUANTUM_BANDS)
print(f"   Quantum bands: {len(MI.QUANTUM_BANDS)} bands, sum={qb_sum:.4f}")
da_sum = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_A)
db_sum = sum(p["conditional_prob"] for p in MI.DOMESTIC_PATHS_B)
sa_sum = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_A)
sb_sum = sum(p["conditional_prob"] for p in MI.SIAC_PATHS_B)
print(f"   Domestic A: {len(MI.DOMESTIC_PATHS_A)} paths, sum={da_sum:.4f}")
print(f"   Domestic B: {len(MI.DOMESTIC_PATHS_B)} paths, sum={db_sum:.4f}")
print(f"   SIAC A: {len(MI.SIAC_PATHS_A)} paths, sum={sa_sum:.4f}")
print(f"   SIAC B: {len(MI.SIAC_PATHS_B)} paths, sum={sb_sum:.4f}")
print("   OK")

# 2. Config
print("\n2. Importing v2_config...")
from .v2_config import build_claim_configs
claims = build_claim_configs()
for c in claims:
    print(f"   {c}")
print("   OK")

# 3. Probability tree (validate_tree runs on import)
print("\n3. Importing v2_probability_tree (validate_tree on import)...")
from .v2_probability_tree import (
    simulate_domestic_challenge, simulate_siac_challenge
)
print("   Probability trees validated OK")

# 4. Quantum model (validate_quantum_bands on import)
print("\n4. Importing v2_quantum_model...")
from .v2_quantum_model import (
    draw_quantum, compute_expected_quantum, expected_quantum_pct
)
eq_pct = expected_quantum_pct()
print(f"   E[Q|WIN] = {eq_pct:.4f} = {eq_pct*100:.2f}% of SOC")
for c in claims:
    eq = compute_expected_quantum(c.soc_value_cr)
    print(f"   {c.claim_id}: E[Q] = {eq:.2f} Cr")
print("   OK")

# 5. Timeline model
print("\n5. Importing v2_timeline_model...")
from .v2_timeline_model import draw_pipeline_duration
print("   OK")

# 6. Legal cost model (validate_legal_costs on import)
print("\n6. Importing v2_legal_cost_model...")
from .v2_legal_cost_model import (
    load_legal_costs, compute_stage_cost, build_monthly_legal_burn,
    get_onetime_costs, build_monthly_legal_costs,
)
cost_table = load_legal_costs()
onetime = get_onetime_costs()
print(f"   One-time costs per claim: {onetime:.2f} Cr")
print(f"   Cost model: new structure (one-time + duration-based)")
print("   OK")

# ── Quick MC: 1000 paths for TP-301-6 ──
print("\n" + "=" * 60)
print("QUICK MC: 1000 paths for TP-301-6")
print("=" * 60)

rng = np.random.default_rng(42)
claim = claims[0]  # TP-301-6

n_paths = 1000
outcomes = {"TRUE_WIN": 0, "RESTART": 0, "LOSE": 0}
durations = []
quantums = []
legal_costs = []

for i in range(n_paths):
    # 1. Draw pipeline duration
    timeline = draw_pipeline_duration(claim, rng)

    # 2. Draw arbitration outcome
    arb_won = rng.random() < MI.ARB_WIN_PROBABILITY

    # 3. Traverse challenge tree (domestic for TP-301-6)
    challenge = simulate_domestic_challenge(arb_won, rng)

    # Determine final outcome
    final_outcome = challenge.outcome

    # If RESTART, try re-arbitration
    if final_outcome == "RESTART":
        re_arb_won = rng.random() < MI.RE_ARB_WIN_PROBABILITY
        if re_arb_won:
            final_outcome = "TRUE_WIN"
        else:
            final_outcome = "LOSE"

    outcomes[final_outcome] += 1

    # Total duration
    total_dur = timeline.total_months + challenge.timeline_months
    if final_outcome == "TRUE_WIN":
        total_dur += MI.DOMESTIC_PAYMENT_DELAY
    durations.append(total_dur)

    # Quantum (only if WIN)
    if final_outcome == "TRUE_WIN":
        q = draw_quantum(claim.soc_value_cr, rng)
        quantums.append(q.quantum_cr)
    else:
        quantums.append(0.0)

    # Legal costs (simplified: just pipeline + challenge stages)
    all_stages = dict(timeline.stage_durations)
    all_stages.update(challenge.stages_detail)

    # Determine SLP admission for domestic claims
    slp_admitted_flag = None
    if claim.jurisdiction == "domestic":
        slp_dur = challenge.stages_detail.get("slp", 0.0)
        if slp_dur > 0:
            slp_admitted_flag = (slp_dur >= MI.SLP_ADMITTED_DURATION)

    burn = build_monthly_legal_burn(
        claim.claim_id, all_stages, rng, cost_table,
        slp_admitted=slp_admitted_flag,
    )
    legal_costs.append(float(burn.sum()))

durations = np.array(durations)
quantums = np.array(quantums)
legal_costs_arr = np.array(legal_costs)

print(f"\n  Outcomes:")
for k, v in outcomes.items():
    print(f"    {k}: {v} ({v/n_paths*100:.1f}%)")

print(f"\n  Duration (months):")
print(f"    Mean:   {durations.mean():.1f}")
print(f"    Median: {np.median(durations):.1f}")
print(f"    P5/P95: {np.percentile(durations, 5):.1f} / {np.percentile(durations, 95):.1f}")

print(f"\n  Quantum (Rs Cr, incl zeros for losses):")
print(f"    Mean:   {quantums.mean():.2f}")
print(f"    Median: {np.median(quantums):.2f}")
win_q = quantums[quantums > 0]
if len(win_q) > 0:
    print(f"    Mean|WIN: {win_q.mean():.2f}")
    print(f"    P5/P95|WIN: {np.percentile(win_q, 5):.2f} / {np.percentile(win_q, 95):.2f}")

print(f"\n  Legal Costs (Rs Cr):")
print(f"    Mean:   {legal_costs_arr.mean():.2f}")
print(f"    Median: {np.median(legal_costs_arr):.2f}")
print(f"    P5/P95: {np.percentile(legal_costs_arr, 5):.2f} / {np.percentile(legal_costs_arr, 95):.2f}")

print("\n" + "=" * 60)
print("ALL VALIDATIONS PASSED")
print("=" * 60)
