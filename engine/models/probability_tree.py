"""
engine/models/probability_tree.py — Generic probability tree walker.
====================================================================

Replaces the hardcoded ``simulate_domestic_challenge()`` and
``simulate_siac_challenge()`` from ``v2_probability_tree.py`` with a
**single** function that works for ANY jurisdiction's tree structure.

Exports:
  simulate_challenge_tree()   — stochastic MC traversal (1 draw per level)
  simulate_full_challenge()   — convenience: pick scenario + traverse
  compute_tree_probabilities()— analytical (exact) outcome probabilities
  validate_tree()             — structural validation returning error list

RNG contract:
  Exactly one ``rng.random()`` call per tree level (child selection).
  Exactly one ``rng.uniform()`` call per level that has a duration_distribution.
  Always root→leaf order.  Deterministic for a given tree + seed.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Optional

import numpy as np

from engine.config.schema import (
    ChallengeTreeConfig,
    JurisdictionTemplate,
    KnownOutcomes,
    ScenarioTree,
    TreeNode,
)


# ============================================================================
# ChallengeResult — returned by every tree traversal
# ============================================================================

@dataclass
class ChallengeResult:
    """Result of traversing a jurisdiction challenge tree.

    Compatible with the downstream MC engine and cashflow builder.
    """

    scenario: str
    """'A' (claimant won arbitration) or 'B' (claimant lost)."""

    outcome: str
    """Terminal outcome: 'TRUE_WIN', 'RESTART', or 'LOSE'."""

    path_description: str
    """Human-readable path taken through the tree, e.g.
    'Respondent Fails S.34 → Respondent Fails S.37 → SLP Dismissed (A1)'."""

    challenge_duration_months: float
    """Sum of drawn durations for all stages traversed."""

    stages_traversed: list[dict[str, Any]] = field(default_factory=list)
    """Per-stage detail: [{"stage": "S.34", "duration": 14.2, "draw": 0.35}, ...]."""

    slp_admitted: bool = False
    """Whether SLP was admitted (for legal cost model compatibility).
    True if any traversed node name contains 'SLP Admitted' (case-insensitive)."""

    def __repr__(self) -> str:
        return (
            f"ChallengeResult(scenario={self.scenario}, {self.outcome}, "
            f"{self.challenge_duration_months:.1f}m, "
            f"stages={len(self.stages_traversed)})"
        )


# ============================================================================
# 1. simulate_challenge_tree — stochastic MC traversal
# ============================================================================

def simulate_challenge_tree(
    tree: ScenarioTree,
    rng: np.random.Generator,
    *,
    scenario_label: str = "",
) -> ChallengeResult:
    """Traverse a ``ScenarioTree`` stochastically, one RNG draw per level.

    Starting at the root, at each internal node:
      1. Read children's probabilities.
      2. Draw ``u = rng.random()`` and select the child whose cumulative
         probability range contains ``u``.
      3. If the selected node has a ``duration_distribution``, draw a
         duration via ``rng.uniform(low, high)`` (or use a fixed value).
      4. Record the stage name and duration.
      5. Repeat until a leaf (terminal) node is reached.

    Parameters
    ----------
    tree : ScenarioTree
        The scenario tree to traverse.
    rng : np.random.Generator
        NumPy random generator for this path.
    scenario_label : str, optional
        Label for the result ('A' or 'B').

    Returns
    -------
    ChallengeResult
    """
    node = tree.root
    path_names: list[str] = []
    stages: list[dict[str, Any]] = []
    total_duration = 0.0
    slp_admitted = False

    while node.children:
        # ── Draw which child to follow ──
        u = rng.random()
        cumulative = 0.0
        selected: TreeNode | None = None
        for child in node.children:
            cumulative += child.probability
            if u < cumulative:
                selected = child
                break
        # Floating-point safety: if u >= cumulative after all children,
        # pick the last child (rounding guard).
        if selected is None:
            selected = node.children[-1]

        # ── Draw duration from the SELECTED child ──
        # Each node carries its own duration_distribution describing how
        # long that stage/outcome takes (e.g. "Respondent Fails S.34"
        # has uniform(9,18) for the S.34 court proceeding duration).
        dur = _draw_duration(selected, rng) if selected.duration_distribution else 0.0

        if dur > 0.0 or selected.duration_distribution:
            stages.append({
                "stage": selected.name,
                "duration": dur,
                "draw": float(u),
            })
            total_duration += dur

        path_names.append(selected.name)

        # Check SLP admission
        if "slp admitted" in selected.name.lower():
            slp_admitted = True

        node = selected

    return ChallengeResult(
        scenario=scenario_label,
        outcome=node.outcome,  # type: ignore[arg-type]
        path_description=" → ".join(path_names),
        challenge_duration_months=total_duration,
        stages_traversed=stages,
        slp_admitted=slp_admitted,
    )


def _draw_duration(node: TreeNode, rng: np.random.Generator) -> float:
    """Draw a stage duration from a node's distribution config."""
    dist = node.duration_distribution
    if dist is None:
        return 0.0
    dtype = dist.get("type", "fixed")
    if dtype == "fixed":
        return float(dist["value"])
    elif dtype == "uniform":
        return float(rng.uniform(dist["low"], dist["high"]))
    else:
        raise ValueError(
            f"Unknown duration_distribution type '{dtype}' on node '{node.name}'."
        )


# ============================================================================
# 2. simulate_full_challenge — convenience wrapper
# ============================================================================

def simulate_full_challenge(
    template: JurisdictionTemplate,
    arb_won: bool,
    rng: np.random.Generator,
) -> ChallengeResult:
    """Select the appropriate scenario tree and traverse it.

    Parameters
    ----------
    template : JurisdictionTemplate
        Jurisdiction template containing both scenario trees.
    arb_won : bool
        True → Scenario A (claimant won), False → Scenario B (claimant lost).
    rng : np.random.Generator

    Returns
    -------
    ChallengeResult
    """
    if arb_won:
        tree = template.default_challenge_tree.scenario_a
        label = "A"
    else:
        tree = template.default_challenge_tree.scenario_b
        label = "B"
    return simulate_challenge_tree(tree, rng, scenario_label=label)


# ============================================================================
# 3. compute_tree_probabilities — analytical (exact) computation
# ============================================================================

@dataclass
class TreeProbabilities:
    """Analytical probability breakdown for a scenario tree."""

    p_true_win: float
    p_restart: float
    p_lose: float
    terminal_paths: list[dict[str, Any]]
    """Each entry: {"path": "A → B → C", "probability": 0.504, "outcome": "TRUE_WIN"}."""


def compute_tree_probabilities(tree: ScenarioTree) -> TreeProbabilities:
    """Walk the tree analytically and compute exact outcome probabilities.

    No simulation — purely multiplicative traversal of all branches.
    Used for real-time UI display (instant, no MC noise).

    Parameters
    ----------
    tree : ScenarioTree

    Returns
    -------
    TreeProbabilities
    """
    paths: list[dict[str, Any]] = []
    _walk_tree(tree.root, 1.0, [], paths)

    p_tw = sum(p["probability"] for p in paths if p["outcome"] == "TRUE_WIN")
    p_rs = sum(p["probability"] for p in paths if p["outcome"] == "RESTART")
    p_lo = sum(p["probability"] for p in paths if p["outcome"] == "LOSE")

    return TreeProbabilities(
        p_true_win=p_tw,
        p_restart=p_rs,
        p_lose=p_lo,
        terminal_paths=paths,
    )


def _walk_tree(
    node: TreeNode,
    cumulative_prob: float,
    path_so_far: list[str],
    results: list[dict[str, Any]],
) -> None:
    """Recursive DFS to collect all terminal paths with cumulative probabilities."""
    p = cumulative_prob * node.probability
    current_path = path_so_far + [node.name]

    if not node.children:
        # Terminal node
        results.append({
            "path": " → ".join(current_path),
            "probability": p,
            "outcome": node.outcome,
        })
        return

    for child in node.children:
        _walk_tree(child, p, current_path, results)


# ============================================================================
# 4. validate_tree — structural validation
# ============================================================================

_TOL = 1e-4


def validate_tree(tree: ScenarioTree, scenario: str = "") -> list[str]:
    """Validate a scenario tree structure and return a list of errors.

    An empty list means the tree is valid.

    Checks:
      1. Every internal node's children probabilities sum to 1.0 (±1e-4).
      2. Every terminal (leaf) node has a valid outcome value.
      3. Scenario 'A' trees must not contain RESTART terminals.
      4. Scenario 'B' trees must not contain TRUE_WIN terminals.
      5. Tree has at least 1 terminal node.

    Parameters
    ----------
    tree : ScenarioTree
    scenario : str
        'A' or 'B' — used for outcome constraint checking.

    Returns
    -------
    list[str]
        Human-readable error messages.  Empty if valid.
    """
    errors: list[str] = []
    terminal_count = [0]  # mutable counter for nested closure

    _validate_node(tree.root, scenario, errors, terminal_count)

    if terminal_count[0] == 0:
        errors.append("Tree has no terminal nodes.")

    return errors


def _validate_node(
    node: TreeNode,
    scenario: str,
    errors: list[str],
    terminal_count: list[int],
) -> None:
    """Recursively validate a single node and its descendants."""
    if not node.children:
        # Terminal node
        terminal_count[0] += 1
        valid_outcomes = {"TRUE_WIN", "RESTART", "LOSE"}
        if node.outcome not in valid_outcomes:
            errors.append(
                f"Node '{node.name}': invalid outcome '{node.outcome}'. "
                f"Must be one of {valid_outcomes}."
            )
        if scenario.upper() == "A" and node.outcome == "RESTART":
            errors.append(
                f"Node '{node.name}': Scenario A must not have RESTART terminals "
                f"(found outcome='RESTART')."
            )
        if scenario.upper() == "B" and node.outcome == "TRUE_WIN":
            errors.append(
                f"Node '{node.name}': Scenario B must not have TRUE_WIN terminals "
                f"(found outcome='TRUE_WIN')."
            )
        return

    # Internal node — check children probability sum
    total = sum(c.probability for c in node.children)
    if abs(total - 1.0) > _TOL:
        errors.append(
            f"Node '{node.name}': children probabilities sum to {total:.6f}, "
            f"expected 1.0 (tolerance {_TOL})."
        )

    for child in node.children:
        _validate_node(child, scenario, errors, terminal_count)


# ============================================================================
# 5. simulate_challenge_tree_with_known_outcomes — partial tree traversal
# ============================================================================

def simulate_challenge_tree_with_known_outcomes(
    tree: ScenarioTree,
    known_outcomes: KnownOutcomes,
    jurisdiction: str,
    rng: np.random.Generator,
    *,
    scenario_label: str = "",
) -> ChallengeResult:
    """Traverse a challenge tree with some nodes already decided.

    For each level of the tree, checks if a known_outcome exists for
    that court stage.  If known:
      - Forces the selection to the known branch (no RNG draw)
      - Still draws duration from that node's duration_distribution
    If unknown:
      - Falls back to standard stochastic selection (rng.random())

    Parameters
    ----------
    tree : ScenarioTree
    known_outcomes : KnownOutcomes
    jurisdiction : str
        One of 'domestic', 'siac', 'hkiac'.
    rng : np.random.Generator
    scenario_label : str

    Returns
    -------
    ChallengeResult
    """
    node = tree.root
    path_names: list[str] = []
    stages: list[dict[str, Any]] = []
    total_duration = 0.0
    slp_admitted = False

    while node.children:
        forced = _get_forced_child(node, known_outcomes, jurisdiction, scenario_label)

        if forced is not None:
            selected = forced
            u = -1.0  # sentinel: not drawn
        else:
            # Standard stochastic draw
            u = rng.random()
            cumulative = 0.0
            selected = None
            for child in node.children:
                cumulative += child.probability
                if u < cumulative:
                    selected = child
                    break
            if selected is None:
                selected = node.children[-1]

        # Draw duration (always stochastic, even for known nodes)
        dur = _draw_duration(selected, rng) if selected.duration_distribution else 0.0
        if dur > 0.0 or selected.duration_distribution:
            stages.append({
                "stage": selected.name,
                "duration": dur,
                "draw": float(u),
                "known": forced is not None,
            })
            total_duration += dur

        path_names.append(selected.name)
        if "slp admitted" in selected.name.lower():
            slp_admitted = True

        node = selected

    return ChallengeResult(
        scenario=scenario_label,
        outcome=node.outcome,
        path_description=" → ".join(path_names),
        challenge_duration_months=total_duration,
        stages_traversed=stages,
        slp_admitted=slp_admitted,
    )


# ============================================================================
# Known-outcome helpers: identify decision level & force correct child
# ============================================================================

def _find_child_by_keyword(parent: TreeNode, keyword: str) -> Optional[TreeNode]:
    """Find a child whose name contains *keyword* (case-insensitive)."""
    kw = keyword.lower()
    for c in parent.children:
        if kw in c.name.lower():
            return c
    return None


def _get_forced_child(
    parent_node: TreeNode,
    known_outcomes: KnownOutcomes,
    jurisdiction: str,
    scenario_label: str,
) -> Optional[TreeNode]:
    """Determine if this node's decision is already known.

    Identifies the decision level by examining the FIRST child's name,
    then maps the corresponding ``known_outcomes`` field to the correct
    child.  Returns ``None`` when the decision is unknown (stochastic).
    """
    if not parent_node.children:
        return None
    first_cn = parent_node.children[0].name.lower()

    if jurisdiction == "domestic":
        return _forced_child_domestic(parent_node, known_outcomes, first_cn)
    elif jurisdiction == "siac":
        return _forced_child_siac(parent_node, known_outcomes, first_cn, scenario_label)
    elif jurisdiction == "hkiac":
        return _forced_child_hkiac(parent_node, known_outcomes, first_cn, scenario_label)
    return None


def _forced_child_domestic(
    parent: TreeNode, ko: KnownOutcomes, first_cn: str,
) -> Optional[TreeNode]:
    """Indian Domestic: S.34 → S.37 → SLP gate → SLP merits."""
    # Check from most-specific to least-specific to avoid collisions
    if "merits" in first_cn:
        # SLP merits level
        if ko.slp_merits_outcome is None:
            return None
        if ko.slp_merits_outcome == "claimant_won":
            return _find_child_by_keyword(parent, "tata wins")
        else:
            # Respondent won merits — pick child NOT containing "tata wins"
            f = _find_child_by_keyword(parent, "dfccil wins")
            if f:
                return f
            for c in parent.children:
                if "tata wins" not in c.name.lower():
                    return c
            return None

    if "slp" in first_cn and "s.3" not in first_cn:
        # SLP gate level (children: "... SLP dismissed", "... SLP admitted")
        if ko.slp_gate_outcome is None:
            return None
        if ko.slp_gate_outcome == "dismissed":
            return _find_child_by_keyword(parent, "dismissed")
        else:
            return _find_child_by_keyword(parent, "admitted")

    if "s.37" in first_cn:
        if ko.s37_outcome is None:
            return None
        if ko.s37_outcome == "claimant_won":
            # "dismissed" (Scenario A) or "tata wins" (Scenario B)
            return (
                _find_child_by_keyword(parent, "dismissed")
                or _find_child_by_keyword(parent, "tata wins")
            )
        else:
            return (
                _find_child_by_keyword(parent, "dfccil wins")
                or _find_child_by_keyword(parent, "loses")
                or _find_child_by_keyword(parent, "fails")
            )

    if "s.34" in first_cn:
        if ko.s34_outcome is None:
            return None
        if ko.s34_outcome == "claimant_won":
            return (
                _find_child_by_keyword(parent, "dismissed")
                or _find_child_by_keyword(parent, "tata wins")
            )
        else:
            return (
                _find_child_by_keyword(parent, "dfccil wins")
                or _find_child_by_keyword(parent, "fails")
            )

    return None


def _forced_child_siac(
    parent: TreeNode, ko: KnownOutcomes, first_cn: str, scenario: str,
) -> Optional[TreeNode]:
    """SIAC Singapore: HC → COA."""
    if "hc" in first_cn:
        if ko.hc_outcome is None:
            return None
        if scenario == "A":
            # Scenario A: respondent challenges. upheld = claimant_won
            if ko.hc_outcome == "claimant_won":
                return _find_child_by_keyword(parent, "upheld")
            else:
                return _find_child_by_keyword(parent, "set aside")
        else:
            # Scenario B: claimant challenges. overturns = claimant_won
            if ko.hc_outcome == "claimant_won":
                return _find_child_by_keyword(parent, "overturns")
            else:
                return _find_child_by_keyword(parent, "upholds")

    if "coa" in first_cn:
        if ko.coa_outcome is None:
            return None
        if scenario == "A":
            if ko.hc_outcome == "claimant_won":
                # Under "HC award upheld": upheld vs set aside
                return _find_child_by_keyword(
                    parent, "upheld" if ko.coa_outcome == "claimant_won" else "set aside"
                )
            else:
                # Under "HC award set aside": restores vs upholds
                return _find_child_by_keyword(
                    parent, "restores" if ko.coa_outcome == "claimant_won" else "upholds"
                )
        else:
            if ko.hc_outcome == "claimant_won":
                # Under "HC overturns adverse": upholds (overturn) vs restores (adverse)
                return _find_child_by_keyword(
                    parent, "upholds" if ko.coa_outcome == "claimant_won" else "restores"
                )
            else:
                # Under "HC upholds adverse": overturns vs upholds
                return _find_child_by_keyword(
                    parent, "overturns" if ko.coa_outcome == "claimant_won" else "upholds"
                )

    return None


def _forced_child_hkiac(
    parent: TreeNode, ko: KnownOutcomes, first_cn: str, scenario: str,
) -> Optional[TreeNode]:
    """HKIAC Hong Kong: CFI → CA → CFA gate → CFA merits."""
    if "cfi" in first_cn:
        if ko.cfi_outcome is None:
            return None
        if scenario == "A":
            return _find_child_by_keyword(
                parent, "upheld" if ko.cfi_outcome == "claimant_won" else "set aside"
            )
        else:
            return _find_child_by_keyword(
                parent, "overturns" if ko.cfi_outcome == "claimant_won" else "upholds"
            )

    # CFA before CA — "cfa" won't match "ca " but need explicit ordering
    if "cfa" in first_cn:
        if "leave" in first_cn:
            # CFA gate level
            if ko.cfa_gate_outcome is None:
                return None
            return _find_child_by_keyword(
                parent, "refused" if ko.cfa_gate_outcome == "dismissed" else "granted"
            )
        else:
            # CFA merits level — children are terminal nodes, match by outcome
            if ko.cfa_merits_outcome is None:
                return None
            if ko.cfa_merits_outcome == "claimant_won":
                target = "TRUE_WIN" if scenario == "A" else "RESTART"
            else:
                target = "LOSE"
            for c in parent.children:
                if c.outcome == target:
                    return c
            return None

    if "ca " in first_cn:
        if ko.ca_outcome is None:
            return None
        # CA follows same contextual pattern as CFI outcome
        if scenario == "A":
            if ko.cfi_outcome == "claimant_won":
                return _find_child_by_keyword(
                    parent, "upheld" if ko.ca_outcome == "claimant_won" else "set aside"
                )
            else:
                return _find_child_by_keyword(
                    parent, "restores" if ko.ca_outcome == "claimant_won" else "upholds"
                )
        else:
            if ko.cfi_outcome == "claimant_won":
                return _find_child_by_keyword(
                    parent, "upholds" if ko.ca_outcome == "claimant_won" else "restores"
                )
            else:
                return _find_child_by_keyword(
                    parent, "overturns" if ko.ca_outcome == "claimant_won" else "upholds"
                )

    return None
