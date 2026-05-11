#!/usr/bin/env python3
"""Quick inspection of mc_distributions in a dashboard_data.json."""
import json, sys

path = sys.argv[1] if len(sys.argv) > 1 else "/app/server/runs/9053f2b5-5e5b-4e87-aa78-0b85e544fb1d/83cc6425-ea27-4e04-a404-c35f20b86aec/outputs/dashboard_data.json"
with open(path) as f:
    d = json.load(f)

mc = d.get("mc_distributions", {})
print("=== mc_distributions ===")
print("keys:", list(mc.keys()))
print("n_paths:", mc.get("n_paths"))
for k in ["moic", "irr", "net_recovery", "duration"]:
    dist = mc.get(k, {})
    if isinstance(dist, dict) and "counts" in dist:
        counts = dist["counts"]
        total = sum(counts)
        nonzero = sum(1 for c in counts if c > 0)
        print(f"  {k}: {len(counts)} bins, total_count={total}, nonzero_bins={nonzero}")
        if counts:
            print(f"         counts sample: {counts[:10]}...")
    elif isinstance(dist, list):
        total = sum(e.get("count", 0) for e in dist)
        nonzero = sum(1 for e in dist if e.get("count", 0) > 0)
        print(f"  {k}: {len(dist)} entries (list fmt), total={total}, nonzero={nonzero}")
    else:
        print(f"  {k}: missing or unknown format")

sp = d.get("stochastic_pricing", {})
grid = sp.get("grid", {})
print("\n=== stochastic_pricing.grid ===")
print("keys:", list(grid.keys())[:8])
if "10_20" in grid:
    combo = grid["10_20"]
    for h in ["moic_hist", "irr_hist", "net_recovery_hist", "duration_hist"]:
        hist = combo.get(h, [])
        total = sum(e.get("count", 0) for e in hist)
        nonzero = sum(1 for e in hist if e.get("count", 0) > 0)
        print(f"  {h}: {len(hist)} entries, total_count={total}, nonzero_bins={nonzero}")
        if hist:
            edges = [e["edge"] for e in hist[:4]]
            cnts = [e["count"] for e in hist[:4]]
            print(f"         first 4: edges={edges}, counts={cnts}")
else:
    print("  No '10_20' key found")

print("\n=== simulation_meta ===")
meta = d.get("simulation_meta", {})
print("n_paths:", meta.get("n_paths"))
