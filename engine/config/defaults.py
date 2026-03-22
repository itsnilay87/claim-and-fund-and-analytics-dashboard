"""
engine/config/defaults.py — Default parameter values for simulation configuration.
==================================================================================

Provides pre-calibrated defaults drawn from the TATA v2 master inputs.

Exports:
  DEFAULT_QUANTUM_BANDS      — 5-band quantum distribution (E[Q|WIN] = 0.72)
  DEFAULT_ARBITRATION_CONFIG  — 70% win probability
  DEFAULT_DOMESTIC_TREE       — Indian domestic challenge tree (S.34→S.37→SLP)
  DEFAULT_SIAC_TREE           — SIAC challenge tree (HC→COA)
  get_default_claim_config()  — Return a fully populated ClaimConfig for a jurisdiction
"""

from __future__ import annotations

from .schema import (
    ArbitrationConfig,
    ChallengeTreeConfig,
    ClaimConfig,
    InterestConfig,
    LegalCostConfig,
    QuantumBand,
    QuantumConfig,
    ScenarioTree,
    SimulationConfig,
    StageConfig,
    TimelineConfig,
    TreeNode,
)


# ============================================================================
# Quantum — 5 bands, E[Q|WIN] = 0.72
# ============================================================================

DEFAULT_QUANTUM_BANDS: list[QuantumBand] = [
    QuantumBand(low=0.00, high=0.20, probability=0.15),
    QuantumBand(low=0.20, high=0.40, probability=0.05),
    QuantumBand(low=0.40, high=0.60, probability=0.05),
    QuantumBand(low=0.60, high=0.80, probability=0.05),
    QuantumBand(low=0.80, high=1.00, probability=0.70),
]

DEFAULT_QUANTUM_CONFIG = QuantumConfig(bands=DEFAULT_QUANTUM_BANDS)


# ============================================================================
# Arbitration — 70% win, 70% re-arb win
# ============================================================================

DEFAULT_ARBITRATION_CONFIG = ArbitrationConfig(
    win_probability=0.70,
    re_arb_win_probability=0.70,
)


# ============================================================================
# Indian Domestic Challenge Tree — S.34 → S.37 → SLP (24 terminal paths)
# ============================================================================

def _build_domestic_scenario_a() -> ScenarioTree:
    """Scenario A: Claimant WON arbitration — respondent challenges.

    4 levels: S.34 → S.37 → SLP-gate → SLP-merits.
    12 terminal paths.  Outcomes ∈ {TRUE_WIN, LOSE}.

    Probabilities transcribed from v2_master_inputs.DOMESTIC_TREE_SCENARIO_A.
    """
    return ScenarioTree(
        description="Claimant WON arbitration — respondent (DFCCIL) challenges through Indian courts",
        root=TreeNode(
            name="S.34",
            probability=1.0,
            children=[
                # ── S.34: DFCCIL fails (70%) — award upheld ──
                TreeNode(
                    name="S.34 DFCCIL dismissed",
                    probability=0.70,
                    duration_distribution={"type": "uniform", "low": 9.0, "high": 18.0},
                    children=[
                        # S.37: DFCCIL fails (80%)
                        TreeNode(
                            name="S.37 DFCCIL dismissed",
                            probability=0.80,
                            duration_distribution={"type": "uniform", "low": 6.0, "high": 12.0},
                            children=[
                                TreeNode(
                                    name="SLP dismissed",
                                    probability=0.90,
                                    outcome="TRUE_WIN",
                                    duration_distribution={"type": "fixed", "value": 4.0},
                                    legal_cost={"low": 0.50, "high": 1.0},
                                ),
                                TreeNode(
                                    name="SLP admitted",
                                    probability=0.10,
                                    children=[
                                        TreeNode(
                                            name="SLP DFCCIL wins merits",
                                            probability=0.10,
                                            outcome="LOSE",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                        TreeNode(
                                            name="SLP TATA wins merits",
                                            probability=0.90,
                                            outcome="TRUE_WIN",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                    ],
                                ),
                            ],
                        ),
                        # S.37: DFCCIL wins (20%) — award set aside
                        TreeNode(
                            name="S.37 DFCCIL wins",
                            probability=0.20,
                            duration_distribution={"type": "uniform", "low": 6.0, "high": 12.0},
                            children=[
                                TreeNode(
                                    name="TATA SLP dismissed",
                                    probability=0.50,
                                    outcome="LOSE",
                                    duration_distribution={"type": "fixed", "value": 4.0},
                                    legal_cost={"low": 0.50, "high": 1.0},
                                ),
                                TreeNode(
                                    name="TATA SLP admitted",
                                    probability=0.50,
                                    children=[
                                        TreeNode(
                                            name="TATA wins SLP merits",
                                            probability=0.50,
                                            outcome="TRUE_WIN",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                        TreeNode(
                                            name="TATA loses SLP merits",
                                            probability=0.50,
                                            outcome="LOSE",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                    ],
                                ),
                            ],
                        ),
                    ],
                ),
                # ── S.34: DFCCIL wins (30%) — award set aside ──
                TreeNode(
                    name="S.34 DFCCIL wins",
                    probability=0.30,
                    duration_distribution={"type": "uniform", "low": 9.0, "high": 18.0},
                    children=[
                        # S.37: TATA wins (50%) — award restored
                        TreeNode(
                            name="S.37 TATA wins",
                            probability=0.50,
                            duration_distribution={"type": "uniform", "low": 6.0, "high": 12.0},
                            children=[
                                TreeNode(
                                    name="DFCCIL SLP dismissed",
                                    probability=0.75,
                                    outcome="TRUE_WIN",
                                    duration_distribution={"type": "fixed", "value": 4.0},
                                    legal_cost={"low": 0.50, "high": 1.0},
                                ),
                                TreeNode(
                                    name="DFCCIL SLP admitted",
                                    probability=0.25,
                                    children=[
                                        TreeNode(
                                            name="DFCCIL wins SLP merits",
                                            probability=0.25,
                                            outcome="LOSE",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                        TreeNode(
                                            name="TATA wins SLP merits",
                                            probability=0.75,
                                            outcome="TRUE_WIN",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                    ],
                                ),
                            ],
                        ),
                        # S.37: TATA loses (50%) — award stays set aside
                        TreeNode(
                            name="S.37 TATA loses",
                            probability=0.50,
                            duration_distribution={"type": "uniform", "low": 6.0, "high": 12.0},
                            children=[
                                TreeNode(
                                    name="TATA SLP dismissed",
                                    probability=0.80,
                                    outcome="LOSE",
                                    duration_distribution={"type": "fixed", "value": 4.0},
                                    legal_cost={"low": 0.50, "high": 1.0},
                                ),
                                TreeNode(
                                    name="TATA SLP admitted",
                                    probability=0.20,
                                    children=[
                                        TreeNode(
                                            name="TATA wins SLP merits",
                                            probability=0.20,
                                            outcome="TRUE_WIN",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                        TreeNode(
                                            name="TATA loses SLP merits",
                                            probability=0.80,
                                            outcome="LOSE",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                    ],
                                ),
                            ],
                        ),
                    ],
                ),
            ],
        ),
    )


def _build_domestic_scenario_b() -> ScenarioTree:
    """Scenario B: Claimant LOST arbitration — claimant challenges.

    Mirror of Scenario A with inverted probabilities.
    12 terminal paths.  Outcomes ∈ {RESTART, LOSE}.
    """
    return ScenarioTree(
        description="Claimant LOST arbitration — claimant (TATA) challenges through Indian courts",
        root=TreeNode(
            name="S.34",
            probability=1.0,
            children=[
                # ── S.34: TATA wins (30%) — adverse award vacated ──
                TreeNode(
                    name="S.34 TATA wins",
                    probability=0.30,
                    duration_distribution={"type": "uniform", "low": 9.0, "high": 18.0},
                    children=[
                        # S.37: DFCCIL wins (50%) — adverse award restored
                        TreeNode(
                            name="S.37 DFCCIL wins",
                            probability=0.50,
                            duration_distribution={"type": "uniform", "low": 6.0, "high": 12.0},
                            children=[
                                TreeNode(
                                    name="TATA SLP dismissed",
                                    probability=0.75,
                                    outcome="LOSE",
                                    duration_distribution={"type": "fixed", "value": 4.0},
                                    legal_cost={"low": 0.50, "high": 1.0},
                                ),
                                TreeNode(
                                    name="TATA SLP admitted",
                                    probability=0.25,
                                    children=[
                                        TreeNode(
                                            name="TATA wins SLP merits",
                                            probability=0.75,
                                            outcome="RESTART",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                        TreeNode(
                                            name="TATA loses SLP merits",
                                            probability=0.25,
                                            outcome="LOSE",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                    ],
                                ),
                            ],
                        ),
                        # S.37: TATA wins (50%) — setting aside upheld
                        TreeNode(
                            name="S.37 TATA wins",
                            probability=0.50,
                            duration_distribution={"type": "uniform", "low": 6.0, "high": 12.0},
                            children=[
                                TreeNode(
                                    name="DFCCIL SLP dismissed",
                                    probability=0.80,
                                    outcome="RESTART",
                                    duration_distribution={"type": "fixed", "value": 4.0},
                                    legal_cost={"low": 0.50, "high": 1.0},
                                ),
                                TreeNode(
                                    name="DFCCIL SLP admitted",
                                    probability=0.20,
                                    children=[
                                        TreeNode(
                                            name="DFCCIL wins SLP merits",
                                            probability=0.80,
                                            outcome="LOSE",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                        TreeNode(
                                            name="DFCCIL loses SLP merits",
                                            probability=0.20,
                                            outcome="RESTART",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                    ],
                                ),
                            ],
                        ),
                    ],
                ),
                # ── S.34: TATA fails (70%) — adverse award upheld ──
                TreeNode(
                    name="S.34 TATA fails",
                    probability=0.70,
                    duration_distribution={"type": "uniform", "low": 9.0, "high": 18.0},
                    children=[
                        # S.37: TATA loses (80%)
                        TreeNode(
                            name="S.37 TATA loses",
                            probability=0.80,
                            duration_distribution={"type": "uniform", "low": 6.0, "high": 12.0},
                            children=[
                                TreeNode(
                                    name="TATA SLP dismissed",
                                    probability=0.90,
                                    outcome="LOSE",
                                    duration_distribution={"type": "fixed", "value": 4.0},
                                    legal_cost={"low": 0.50, "high": 1.0},
                                ),
                                TreeNode(
                                    name="TATA SLP admitted",
                                    probability=0.10,
                                    children=[
                                        TreeNode(
                                            name="TATA wins SLP merits",
                                            probability=0.20,
                                            outcome="RESTART",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                        TreeNode(
                                            name="TATA loses SLP merits",
                                            probability=0.80,
                                            outcome="LOSE",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                    ],
                                ),
                            ],
                        ),
                        # S.37: TATA wins (20%) — adverse award vacated
                        TreeNode(
                            name="S.37 TATA wins",
                            probability=0.20,
                            duration_distribution={"type": "uniform", "low": 6.0, "high": 12.0},
                            children=[
                                TreeNode(
                                    name="DFCCIL SLP dismissed",
                                    probability=0.75,
                                    outcome="RESTART",
                                    duration_distribution={"type": "fixed", "value": 4.0},
                                    legal_cost={"low": 0.50, "high": 1.0},
                                ),
                                TreeNode(
                                    name="DFCCIL SLP admitted",
                                    probability=0.25,
                                    children=[
                                        TreeNode(
                                            name="DFCCIL wins SLP merits",
                                            probability=0.25,
                                            outcome="LOSE",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                        TreeNode(
                                            name="DFCCIL loses SLP merits",
                                            probability=0.75,
                                            outcome="RESTART",
                                            duration_distribution={"type": "fixed", "value": 24.0},
                                            legal_cost={"low": 2.0, "high": 3.0},
                                        ),
                                    ],
                                ),
                            ],
                        ),
                    ],
                ),
            ],
        ),
    )


def _build_siac_scenario_a() -> ScenarioTree:
    """SIAC Scenario A: Claimant WON arbitration — counterparty challenges.

    2 levels: HC → COA.  4 terminal paths.  Outcomes ∈ {TRUE_WIN, LOSE}.
    """
    return ScenarioTree(
        description="Claimant WON SIAC arbitration — counterparty challenges in Singapore courts",
        root=TreeNode(
            name="High Court",
            probability=1.0,
            children=[
                # HC: TATA wins (80%)
                TreeNode(
                    name="HC award upheld",
                    probability=0.80,
                    duration_distribution={"type": "fixed", "value": 6.0},
                    children=[
                        TreeNode(
                            name="COA award upheld",
                            probability=0.90,
                            outcome="TRUE_WIN",
                            duration_distribution={"type": "fixed", "value": 6.0},
                            legal_cost={"low": 2.0, "high": 2.0},
                        ),
                        TreeNode(
                            name="COA award set aside",
                            probability=0.10,
                            outcome="LOSE",
                            duration_distribution={"type": "fixed", "value": 6.0},
                            legal_cost={"low": 2.0, "high": 2.0},
                        ),
                    ],
                ),
                # HC: TATA loses (20%)
                TreeNode(
                    name="HC award set aside",
                    probability=0.20,
                    duration_distribution={"type": "fixed", "value": 6.0},
                    children=[
                        TreeNode(
                            name="COA restores award",
                            probability=0.50,
                            outcome="TRUE_WIN",
                            duration_distribution={"type": "fixed", "value": 6.0},
                            legal_cost={"low": 2.0, "high": 2.0},
                        ),
                        TreeNode(
                            name="COA upholds setting aside",
                            probability=0.50,
                            outcome="LOSE",
                            duration_distribution={"type": "fixed", "value": 6.0},
                            legal_cost={"low": 2.0, "high": 2.0},
                        ),
                    ],
                ),
            ],
        ),
    )


def _build_siac_scenario_b() -> ScenarioTree:
    """SIAC Scenario B: Claimant LOST arbitration — claimant challenges.

    Inverted probabilities.  4 terminal paths.  Outcomes ∈ {RESTART, LOSE}.
    Note: SIAC setting aside is final under Singapore IAA — no further
    appeal, but RESTART allows fresh arbitration.
    """
    return ScenarioTree(
        description="Claimant LOST SIAC arbitration — claimant challenges in Singapore courts",
        root=TreeNode(
            name="High Court",
            probability=1.0,
            children=[
                # HC: TATA wins (20%) — claimant is the challenger, harder
                TreeNode(
                    name="HC overturns adverse award",
                    probability=0.20,
                    duration_distribution={"type": "fixed", "value": 6.0},
                    children=[
                        TreeNode(
                            name="COA upholds overturn",
                            probability=0.10,
                            outcome="RESTART",
                            duration_distribution={"type": "fixed", "value": 6.0},
                            legal_cost={"low": 2.0, "high": 2.0},
                        ),
                        TreeNode(
                            name="COA restores adverse award",
                            probability=0.90,
                            outcome="LOSE",
                            duration_distribution={"type": "fixed", "value": 6.0},
                            legal_cost={"low": 2.0, "high": 2.0},
                        ),
                    ],
                ),
                # HC: TATA loses (80%)
                TreeNode(
                    name="HC upholds adverse award",
                    probability=0.80,
                    duration_distribution={"type": "fixed", "value": 6.0},
                    children=[
                        TreeNode(
                            name="COA overturns adverse",
                            probability=0.50,
                            outcome="RESTART",
                            duration_distribution={"type": "fixed", "value": 6.0},
                            legal_cost={"low": 2.0, "high": 2.0},
                        ),
                        TreeNode(
                            name="COA upholds adverse",
                            probability=0.50,
                            outcome="LOSE",
                            duration_distribution={"type": "fixed", "value": 6.0},
                            legal_cost={"low": 2.0, "high": 2.0},
                        ),
                    ],
                ),
            ],
        ),
    )


# ============================================================================
# Pre-built challenge tree instances
# ============================================================================

DEFAULT_DOMESTIC_TREE = ChallengeTreeConfig(
    scenario_a=_build_domestic_scenario_a(),
    scenario_b=_build_domestic_scenario_b(),
)

DEFAULT_SIAC_TREE = ChallengeTreeConfig(
    scenario_a=_build_siac_scenario_a(),
    scenario_b=_build_siac_scenario_b(),
)


# ============================================================================
# Default timeline stages
# ============================================================================

DEFAULT_DOMESTIC_TIMELINE = TimelineConfig(
    pre_arb_stages=[
        StageConfig(name="dab", duration_low=4.8, duration_high=13.1,
                    legal_cost_low=0.50, legal_cost_high=1.0),
        StageConfig(name="arbitration", duration_low=20.3, duration_high=23.4,
                    legal_cost_low=8.0, legal_cost_high=8.0),
    ],
    payment_delay_months=6.0,
    max_horizon_months=96,
)

DEFAULT_SIAC_TIMELINE = TimelineConfig(
    pre_arb_stages=[
        StageConfig(name="dab", duration_low=4.8, duration_high=13.1,
                    legal_cost_low=0.50, legal_cost_high=1.0),
        StageConfig(name="arbitration", duration_low=20.3, duration_high=23.4,
                    legal_cost_low=8.0, legal_cost_high=8.0),
    ],
    payment_delay_months=4.0,
    max_horizon_months=96,
)


# ============================================================================
# Default legal costs
# ============================================================================

DEFAULT_LEGAL_COSTS = LegalCostConfig(
    one_time_tribunal_cr=6.0,
    one_time_expert_cr=2.0,
    per_stage_costs={
        "dab": StageConfig(name="dab", duration_low=4.8, duration_high=13.1,
                           legal_cost_low=0.50, legal_cost_high=1.0),
        "arb_counsel": StageConfig(name="arb_counsel", duration_low=20.3, duration_high=23.4,
                                   legal_cost_low=8.0, legal_cost_high=8.0),
        "s34": StageConfig(name="s34", duration_low=9.0, duration_high=18.0,
                           legal_cost_low=2.0, legal_cost_high=3.0),
        "s37": StageConfig(name="s37", duration_low=6.0, duration_high=12.0,
                           legal_cost_low=1.0, legal_cost_high=2.0),
        "slp_dismissed": StageConfig(name="slp_dismissed", duration_low=4.0, duration_high=4.0,
                                     legal_cost_low=0.50, legal_cost_high=1.0),
        "slp_admitted": StageConfig(name="slp_admitted", duration_low=24.0, duration_high=24.0,
                                    legal_cost_low=2.0, legal_cost_high=3.0),
        "siac_hc": StageConfig(name="siac_hc", duration_low=6.0, duration_high=6.0,
                               legal_cost_low=3.0, legal_cost_high=4.0),
        "siac_coa": StageConfig(name="siac_coa", duration_low=6.0, duration_high=6.0,
                                legal_cost_low=2.0, legal_cost_high=2.0),
    },
    overrun_alpha=2.0,
    overrun_beta=5.0,
    overrun_low=-0.10,
    overrun_high=0.60,
)


# ============================================================================
# Default interest config
# ============================================================================

DEFAULT_INTEREST_DOMESTIC = InterestConfig(
    enabled=False,
    rate=0.09,
    compounding="simple",
)

DEFAULT_INTEREST_SIAC = InterestConfig(
    enabled=False,
    rate=0.09,
    compounding="simple",
)


# ============================================================================
# Default simulation config
# ============================================================================

DEFAULT_SIMULATION_CONFIG = SimulationConfig(
    n_paths=10_000,
    seed=42,
    discount_rate=0.12,
    risk_free_rate=0.07,
    start_date="2026-04-30",
)


# ============================================================================
# Factory: get_default_claim_config()
# ============================================================================

def get_default_claim_config(
    jurisdiction: str = "indian_domestic",
    *,
    claim_id: str = "DEFAULT",
    name: str = "Default Claim",
    soc_value_cr: float = 1000.0,
) -> ClaimConfig:
    """Return a fully populated ``ClaimConfig`` with calibrated defaults.

    Parameters
    ----------
    jurisdiction : str
        ``'indian_domestic'`` or ``'siac_singapore'``.
    claim_id : str
        Unique claim identifier.
    name : str
        Human-readable claim name.
    soc_value_cr : float
        Statement of Claim value in ₹ Crore.

    Returns
    -------
    ClaimConfig
        Complete claim config with jurisdiction-appropriate challenge tree,
        timeline, legal costs, and interest parameters.

    Raises
    ------
    ValueError
        If *jurisdiction* is not one of the supported values.
    """
    if jurisdiction == "indian_domestic":
        return ClaimConfig(
            id=claim_id,
            name=name,
            jurisdiction="indian_domestic",
            claim_type="prolongation",
            soc_value_cr=soc_value_cr,
            currency="INR",
            arbitration=DEFAULT_ARBITRATION_CONFIG,
            quantum=DEFAULT_QUANTUM_CONFIG,
            challenge_tree=DEFAULT_DOMESTIC_TREE,
            timeline=DEFAULT_DOMESTIC_TIMELINE,
            legal_costs=DEFAULT_LEGAL_COSTS,
            interest=DEFAULT_INTEREST_DOMESTIC,
        )
    elif jurisdiction == "siac_singapore":
        return ClaimConfig(
            id=claim_id,
            name=name,
            jurisdiction="siac_singapore",
            claim_type="prolongation",
            soc_value_cr=soc_value_cr,
            currency="INR",
            arbitration=DEFAULT_ARBITRATION_CONFIG,
            quantum=DEFAULT_QUANTUM_CONFIG,
            challenge_tree=DEFAULT_SIAC_TREE,
            timeline=DEFAULT_SIAC_TIMELINE,
            legal_costs=DEFAULT_LEGAL_COSTS,
            interest=DEFAULT_INTEREST_SIAC,
        )
    else:
        raise ValueError(
            f"Unsupported jurisdiction '{jurisdiction}'. "
            f"Use 'indian_domestic' or 'siac_singapore'."
        )
