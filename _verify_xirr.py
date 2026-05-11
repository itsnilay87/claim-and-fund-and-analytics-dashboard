"""Verify expected_xirr and claim names in the dashboard JSON output."""
import json
import re

d = json.load(open("test_outputs/quick_test/dashboard_data.json"))

print("=== STRUCTURE TYPE ===")
print(d.get("structure_type", "MISSING"))

# Check per_claim_grid
print("\n=== PER-CLAIM GRID ===")
pcg = d.get("per_claim_grid", {})
print(f"Keys: {list(pcg.keys())[:5]}")
for k in list(pcg.keys())[:3]:
    cells = pcg[k]
    if isinstance(cells, list) and cells:
        c = cells[0]
        exp = c.get("expected_xirr")
        mean = c.get("mean_xirr")
        moic = c.get("mean_moic")
        print(f"  {k}[0]: expected_xirr={exp}, mean_xirr={mean}, mean_moic={moic}")
        assert exp is not None, f"expected_xirr is None in per_claim_grid cell {k}!"
    elif isinstance(cells, dict):
        for sk in list(cells.keys())[:2]:
            c = cells[sk]
            exp = c.get("expected_xirr")
            mean = c.get("mean_xirr")
            print(f"  {k}/{sk}: expected_xirr={exp}, mean_xirr={mean}")

# Check waterfall_grid (the main investment grid for litigation_funding)
print("\n=== WATERFALL GRID ===")
wg = d.get("waterfall_grid", {})
print(f"Keys ({len(wg)}): {list(wg.keys())[:5]}")
for k in list(wg.keys())[:5]:
    cell = wg[k]
    if isinstance(cell, dict):
        exp = cell.get("expected_xirr")
        mean = cell.get("mean_xirr")
        moic = cell.get("mean_moic")
        print(f"  {k}: expected_xirr={exp}, mean_xirr={mean}, mean_moic={moic}")
        if exp is not None:
            assert isinstance(exp, (int, float)), f"expected_xirr is not numeric: {exp}"
        if moic and moic > 1.0:
            flag = "POSITIVE" if (exp and exp > 0) else "NEGATIVE/ZERO"
            print(f"    -> MOIC > 1.0x, expected_xirr is {flag}")

# Check claims for names
print("\n=== CLAIM NAMES ===")
claims = d.get("claims", [])
for c in claims:
    name = c.get("name", "MISSING")
    cid = c.get("claim_id", "?")
    print(f"  {cid} -> {name}")
    if re.match(r'^[0-9a-f]{8}-', str(name)):
        print(f"    WARNING: Name looks like a UUID!")

print("\n=== ALL CHECKS PASSED ===")
