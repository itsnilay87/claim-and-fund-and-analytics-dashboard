"""
TATA_code_v2/v2_config.py — Dataclasses and type definitions for v2 model.
==========================================================================

Clean dataclass definitions for all structured results that flow through
the Monte Carlo simulation pipeline.

All monetary values in ₹ Crore. All durations in months.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Optional

import numpy as np


# ---------------------------------------------------------------------------
# 1. ClaimConfig — per-claim configuration container
# ---------------------------------------------------------------------------

@dataclass
class ClaimConfig:
    """Per-claim configuration, constructed from v2_master_inputs.CLAIMS."""

    claim_id: str
    archetype: str          # "prolongation" | "change_of_law" | "scope_variation"
    soc_value_cr: float     # Statement of Claim value (₹ Crore)
    jurisdiction: str       # "domestic" | "siac"
    current_gate: str       # Current pipeline position
    tpl_share: float        # TPL's share (1.0 = 100%)
    pipeline: list[str]     # Remaining stages from current_gate
    name: str = ""          # Human-readable claim name
    dab_commencement_date: str = ""  # ISO date (YYYY-MM-DD) of DAB commencement for interest calc

    def validate(self) -> None:
        """Raise ValueError if any invariant is violated."""
        if self.soc_value_cr <= 0:
            raise ValueError(
                f"{self.claim_id}: soc_value_cr must be > 0, got {self.soc_value_cr}"
            )
        if not (0.0 < self.tpl_share <= 1.0):
            raise ValueError(
                f"{self.claim_id}: tpl_share must be in (0, 1], got {self.tpl_share}"
            )
        if self.jurisdiction not in ("domestic", "siac", "hkiac_hongkong"):
            raise ValueError(
                f"{self.claim_id}: jurisdiction must be 'domestic', 'siac', "
                f"or 'hkiac_hongkong', got '{self.jurisdiction}'"
            )
        if not self.pipeline:
            raise ValueError(f"{self.claim_id}: pipeline must not be empty")

    def __repr__(self) -> str:
        return (
            f"ClaimConfig(id={self.claim_id!r}, archetype={self.archetype!r}, "
            f"SOC={self.soc_value_cr:.2f} Cr, {self.jurisdiction})"
        )


# ---------------------------------------------------------------------------
# 2. ProbTreePath — a single terminal path in the probability tree
# ---------------------------------------------------------------------------

@dataclass
class ProbTreePath:
    """One terminal path in the domestic (4-level) or SIAC (2-level) tree."""

    path_id: str            # e.g. "A1", "B7", "SA2", "SB4"
    outcome: str            # "TRUE_WIN" | "RESTART" | "LOSE"
    conditional_prob: float # probability conditional on scenario (A or B)
    slp_duration_months: float  # total court challenge duration for this path
    stages_detail: dict[str, float] = field(default_factory=dict)
    """Per-stage duration breakdown, e.g. {"s34": 12.5, "s37": 8.3, "slp": 4.0}"""

    def __repr__(self) -> str:
        return (
            f"ProbTreePath({self.path_id}, {self.outcome}, "
            f"p={self.conditional_prob:.4f}, dur={self.slp_duration_months:.1f}m)"
        )


# ---------------------------------------------------------------------------
# 3. TimelineResult — aggregated pipeline durations
# ---------------------------------------------------------------------------

@dataclass
class TimelineResult:
    """Per-stage durations and total pre-challenge months for one MC path."""

    stage_durations: dict[str, float]
    """Duration per pipeline stage, e.g. {"dab": 10.2, "arbitration": 21.5}."""

    total_months: float
    """Sum of all pre-challenge stage durations."""

    def __repr__(self) -> str:
        return f"TimelineResult(total={self.total_months:.1f}m, stages={self.stage_durations})"


# ---------------------------------------------------------------------------
# 4. QuantumResult — quantum draw output
# ---------------------------------------------------------------------------

@dataclass
class QuantumResult:
    """Result of a quantum band draw for one MC path."""

    band_idx: int             # which band was selected (0-based)
    quantum_pct: float        # quantum as fraction of SOC (0.0–1.0)
    quantum_cr: float         # quantum in ₹ Crore
    expected_quantum_cr: float  # deterministic E[Q] = SOC × E[Q|WIN] (₹ Cr)

    def __repr__(self) -> str:
        return (
            f"QuantumResult(band={self.band_idx}, "
            f"pct={self.quantum_pct:.4f}, "
            f"Q={self.quantum_cr:.2f} Cr, E[Q]={self.expected_quantum_cr:.2f} Cr)"
        )


# ---------------------------------------------------------------------------
# 5. ChallengeResult — court challenge tree traversal output
# ---------------------------------------------------------------------------

@dataclass
class ChallengeResult:
    """Result of traversing the domestic or SIAC probability tree."""

    scenario: str           # "A" (arb won) or "B" (arb lost)
    path_id: str            # terminal path id, e.g. "A3", "SB2"
    outcome: str            # "TRUE_WIN" | "RESTART" | "LOSE"
    timeline_months: float  # total duration of court challenge stages
    stages_detail: dict[str, float] = field(default_factory=dict)
    """Per-stage breakdown: {"s34": 14.2, "s37": 9.1, "slp": 24.0} or
    {"hc": 6.0, "coa": 6.0} for SIAC."""

    def __repr__(self) -> str:
        return (
            f"ChallengeResult(scenario={self.scenario}, path={self.path_id}, "
            f"{self.outcome}, {self.timeline_months:.1f}m)"
        )


# ---------------------------------------------------------------------------
# 5a. SettlementResult — settlement process output
# ---------------------------------------------------------------------------

@dataclass
class SettlementResult:
    """Result of settlement process for a single MC path."""
    settled: bool                          # Whether settlement occurred
    settlement_stage: Optional[str] = None  # Stage where settlement happened (e.g., "s34", "arbitration")
    settlement_amount_cr: float = 0.0      # Amount received via settlement (\u20b9 Crore)
    settlement_discount_used: float = 0.0  # \u03b4_s that was applied
    settlement_timing_months: float = 0.0  # Total months from start to settlement payment
    settlement_mode: str = "none"          # "user_specified", "game_theoretic", or "none"
    reference_quantum_cr: float = 0.0      # Q_ref used for computing settlement amount


# ---------------------------------------------------------------------------
# 6. PathResult — full per-claim per-path MC result
# ---------------------------------------------------------------------------

@dataclass
class PathResult:
    """Complete result for one claim in one Monte Carlo path."""

    claim_id: str
    path_idx: int               # MC path index (0..N-1)

    # Timeline
    timeline: TimelineResult
    challenge: ChallengeResult

    # Arbitration outcome
    arb_won: bool               # did TATA win arbitration?

    # Quantum (only meaningful if final outcome != LOSE)
    quantum: Optional[QuantumResult]

    # Final outcome after all stages
    final_outcome: str          # "TRUE_WIN" | "RESTART" | "LOSE" | "SETTLED"
    total_duration_months: float  # pipeline + challenge + payment delay

    # Legal costs and cashflow (populated by MC engine)
    monthly_legal_burn: Optional[np.ndarray] = field(default=None, repr=False)
    legal_cost_total_cr: float = 0.0
    collected_cr: float = 0.0
    interest_earned_cr: float = 0.0  # Interest portion of collected_cr (0 if interest disabled)

    # Investment metrics (populated by investment analysis layer)
    cashflow_vector: Optional[np.ndarray] = field(default=None, repr=False)
    net_return_cr: float = 0.0
    irr: Optional[float] = None
    moic: Optional[float] = None

    # Settlement (None when settlement is disabled or path didn't settle)
    settlement: Optional[SettlementResult] = None

    # SLP admission (domestic claims only, None for SIAC or no SLP stage)
    slp_admitted: Optional[bool] = None

    # Re-arbitration fields (for RESTART outcomes)
    re_arb_won: Optional[bool] = None
    re_arb_quantum: Optional[QuantumResult] = None
    re_arb_duration_months: float = 0.0

    # Post-re-arb court challenge (re-arb award must survive Scenario A challenge)
    re_arb_challenge: Optional[ChallengeResult] = None

    def __repr__(self) -> str:
        return (
            f"PathResult({self.claim_id}, path={self.path_idx}, "
            f"outcome={self.final_outcome}, dur={self.total_duration_months:.1f}m, "
            f"collected={self.collected_cr:.2f} Cr)"
        )


# ---------------------------------------------------------------------------
# 7. SimulationResults — container for all N paths across all claims
# ---------------------------------------------------------------------------

@dataclass
class SimulationResults:
    """Complete simulation output for the entire portfolio."""

    n_paths: int
    seed: int
    claim_ids: list[str]

    # Per-claim, per-path results: dict[claim_id → list[PathResult]]
    results: dict[str, list[PathResult]] = field(default_factory=dict, repr=False)

    # Per-claim aggregated metrics (populated after simulation)
    expected_quantum_map: dict[str, float] = field(default_factory=dict)
    """claim_id → deterministic E[Q] in ₹ Cr."""

    mean_duration_map: dict[str, float] = field(default_factory=dict)
    """claim_id → mean total duration in months."""

    win_rate_map: dict[str, float] = field(default_factory=dict)
    """claim_id → fraction of paths with final_outcome != 'LOSE'."""

    # Portfolio context metadata (populated after simulation)
    portfolio_mode: str = "all"
    portfolio_label: str = "Full Portfolio (6 Claims)"
    portfolio_soc_cr: float = 0.0
    jurisdiction_mix: dict = field(default_factory=dict)
    """e.g. {'domestic': 3, 'siac': 3} for full portfolio."""

    def add_claim_results(self, claim_id: str, paths: list[PathResult]) -> None:
        """Add all path results for one claim."""
        self.results[claim_id] = paths

    def get_claim_results(self, claim_id: str) -> list[PathResult]:
        """Retrieve path results for one claim."""
        return self.results.get(claim_id, [])

    def all_path_results(self) -> list[PathResult]:
        """Flat list of all path results across all claims."""
        out = []
        for paths in self.results.values():
            out.extend(paths)
        return out

    def __repr__(self) -> str:
        claims = list(self.results.keys())
        return (
            f"SimulationResults(n={self.n_paths}, seed={self.seed}, "
            f"claims={claims})"
        )


# ---------------------------------------------------------------------------
# Helper: Build ClaimConfig objects from master_inputs
# ---------------------------------------------------------------------------

def build_claim_configs(jurisdiction_filter: Optional[str] = None) -> list[ClaimConfig]:
    """Construct ClaimConfig objects from v2_master_inputs.CLAIMS.

    Parameters
    ----------
    jurisdiction_filter : str, optional
        If set, only return claims matching this jurisdiction
        ("domestic" or "siac"). None = all claims.

    Returns
    -------
    list[ClaimConfig] — validated claim configs.
    """
    from .v2_master_inputs import CLAIMS

    configs = []
    for c in CLAIMS:
        if jurisdiction_filter and c["jurisdiction"] != jurisdiction_filter:
            continue
        cfg = ClaimConfig(
            claim_id=c["claim_id"],
            archetype=c["archetype"],
            soc_value_cr=c["soc_value_cr"],
            jurisdiction=c["jurisdiction"],
            current_gate=c["current_gate"],
            tpl_share=c["tpl_share"],
            pipeline=list(c["pipeline"]),
            dab_commencement_date=c.get("dab_commencement_date", ""),
        )
        cfg.validate()
        configs.append(cfg)
    return configs


# ---------------------------------------------------------------------------
# PortfolioContext — encapsulates everything for one portfolio mode
# ---------------------------------------------------------------------------

@dataclass
class PortfolioContext:
    """Configuration context for one portfolio analysis run.

    Carries the filtered claims, grid dimensions, output paths, and
    display settings for a single portfolio mode (all / siac / domestic).
    """

    mode: str                      # "all" | "siac" | "domestic"
    label: str                     # "Full Portfolio (6 Claims)" etc.
    claims: list[ClaimConfig]
    portfolio_soc_cr: float
    upfront_pcts: list[float]      # decimal, e.g. [0.05, 0.075, ...]
    tata_tail_pcts: list[float]    # decimal, e.g. [0.05, 0.10, ...]
    award_share_pcts: list[float]  # derived: [1-t for t in tata_tail_pcts]
    stochastic_grid: dict          # MI.STOCHASTIC_GRID_* dict
    output_dir: str
    output_prefix: str             # "" | "_SIAC" | "_Domestic"
    theme_color: str               # hex for Excel headers, e.g. "1B5E20"

    @property
    def claim_ids(self) -> list[str]:
        return [c.claim_id for c in self.claims]

    @property
    def n_claims(self) -> int:
        return len(self.claims)

    @property
    def jurisdiction_mix(self) -> dict[str, int]:
        mix: dict[str, int] = {}
        for c in self.claims:
            mix[c.jurisdiction] = mix.get(c.jurisdiction, 0) + 1
        return mix

    def has_domestic(self) -> bool:
        return any(c.jurisdiction == "domestic" for c in self.claims)

    def has_siac(self) -> bool:
        return any(c.jurisdiction == "siac" for c in self.claims)

    def __repr__(self) -> str:
        return (
            f"PortfolioContext(mode={self.mode!r}, {self.n_claims} claims, "
            f"SOC={self.portfolio_soc_cr:.2f} Cr)"
        )


def build_portfolio_context(mode: str = "all") -> PortfolioContext:
    """Build a fully-configured PortfolioContext for the given mode.

    Parameters
    ----------
    mode : str
        One of "all", "siac", "domestic".

    Returns
    -------
    PortfolioContext with filtered claims, appropriate grid, and output paths.
    """
    from . import v2_master_inputs as MI

    if mode not in MI.PORTFOLIO_MODES:
        raise ValueError(f"Unknown portfolio mode: {mode!r}. "
                         f"Choose from {list(MI.PORTFOLIO_MODES.keys())}")

    pm = MI.PORTFOLIO_MODES[mode]
    claims = build_claim_configs(jurisdiction_filter=pm["filter"])
    soc = sum(c.soc_value_cr for c in claims)

    # Select jurisdiction-specific grid
    grid_map = {
        "all": MI.INVESTMENT_GRID_ALL,
        "siac": MI.INVESTMENT_GRID_SIAC,
        "domestic": MI.INVESTMENT_GRID_DOMESTIC,
    }
    inv_grid = grid_map[mode]
    upfront_pcts = inv_grid["upfront_pcts"]
    tata_tail_pcts = inv_grid["tata_tail_pcts"]
    award_share_pcts = [round(1.0 - t, 2) for t in tata_tail_pcts]

    # Select jurisdiction-specific stochastic grid
    stoch_map = {
        "all": MI.STOCHASTIC_GRID_ALL,
        "siac": MI.STOCHASTIC_GRID_SIAC,
        "domestic": MI.STOCHASTIC_GRID_DOMESTIC,
    }
    stochastic_grid = stoch_map[mode]

    return PortfolioContext(
        mode=mode,
        label=pm["label"],
        claims=claims,
        portfolio_soc_cr=soc,
        upfront_pcts=upfront_pcts,
        tata_tail_pcts=tata_tail_pcts,
        award_share_pcts=award_share_pcts,
        stochastic_grid=stochastic_grid,
        output_dir=pm["output_dir"],
        output_prefix=pm["output_prefix"],
        theme_color=pm["theme_color"],
    )
