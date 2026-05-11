"""Celery tasks for running simulations with progress tracking."""

from __future__ import annotations

import copy
import json
import math
import shutil
from datetime import datetime, date
from dateutil.relativedelta import relativedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

from celery import Task

from .celery_app import celery_app
from .schemas import SimulationStatus
from ..storage.factory import get_storage_backend


class SimulationProgressTask(Task):
    """Custom task class with progress callback support."""

    def update_progress(self, current: int, total: int, message: str = "") -> None:
        """Update task progress state."""
        if total > 0:
            percent = int((current / total) * 100)
        else:
            percent = 0

        self.update_state(
            state="PROGRESS",
            meta={
                "current": current,
                "total": total,
                "percent": percent,
                "message": message,
            },
        )


def apply_funding_profile(inputs: dict, profile: str) -> dict:
    """Apply funding profile transformation to inputs.
    
    Args:
        inputs: Base inputs dictionary
        profile: Either 'UF' (Upfront Funding) or 'SF' (Scaled Funding)
        
    Returns:
        Modified inputs dictionary
    """
    data = copy.deepcopy(inputs)
    if profile == "UF":
        return data

    if profile == "SF":
        fund = data.get("fund", {})
        initial_closing = fund.get("initial_closing_date") or fund.get("investment_date")
        if initial_closing is None:
            initial_closing_date = datetime.now().date()
        else:
            initial_closing_date = date.fromisoformat(str(initial_closing))

        final_closing_raw = fund.get("final_closing_date")
        if final_closing_raw is not None:
            final_closing_date = date.fromisoformat(str(final_closing_raw))
        else:
            final_closing_date = initial_closing_date + relativedelta(months=+24)

        fund["initial_closing_date"] = initial_closing_date.isoformat()
        fund["final_closing_date"] = final_closing_date.isoformat()
        fund["initial_committed_capital"] = 200_000_000.0  # 20 crore
        fund["committed_capital"] = float(fund.get("committed_capital", 5_000_000_000.0))
        fund["fund_size"] = float(fund.get("fund_size", fund["committed_capital"]))

        fund["investors"] = [
            {
                "name": "Sponsor",
                "class_name": "B",
                "commitment": 102_000_000.0,  # 51% of initial 20 crore
                "unit_price": 1000,
                "management_fee_rate": 0.0,
                "carry_rate": 0.0,
                "carry_recipient_rate": 0.2,
            },
            {
                "name": "Anchor Investor",
                "class_name": "A1",
                "commitment": 4_898_000_000.0,  # 9.8cr + 20cr monthly for 24 months
                "unit_price": 1000,
                "carry_rate": 0.2,
            },
        ]

        data["fund"] = fund

    return data


@celery_app.task(bind=True, base=SimulationProgressTask, name="run_simulation")
def run_simulation_task(
    self,
    inputs_path: str,
    simulations: Optional[int] = None,
    sensitivity: bool = False,
    sensitivity_divisor: Optional[int] = None,
    alpha_seed: Optional[int] = None,
    scenario: Optional[str] = "base",
    scenarios: Optional[List[str]] = None,
    all_scenarios: bool = False,
    case_mode: Optional[str] = "legacy",
    funding_profile: Optional[str] = "UF",
    custom_parameters: Optional[Dict[str, Any]] = None,
    **_legacy_kwargs: Any,
) -> Dict[str, Any]:
    """
    Execute a Monte Carlo simulation as a Celery task with full report generation.

    This task runs in a separate worker process and can be distributed
    across multiple machines. Progress is reported via Celery's state system.
    
    Now supports multiple scenarios and generates all report artifacts like the CLI.

    Args:
        inputs_path: Path to the fund parameters JSON file
        simulations: Number of Monte Carlo simulations (optional, uses config default)
        sensitivity: Whether to run sensitivity analysis
        sensitivity_divisor: Sample divisor for sensitivity sweeps
        alpha_seed: Optional legacy seed override for compatibility with older payloads
        scenario: Single scenario name (default: "base")
        scenarios: List of scenario names to run
        all_scenarios: Run all scenarios defined in inputs file
        case_mode: Case modeling mode: "legacy" or "claims"
        funding_profile: Funding profile: "UF" or "SF"
        custom_parameters: Custom fund parameters to override file contents

    Returns:
        Dictionary containing dashboard data and metadata
    """
    try:
        # Get Celery's auto-generated task ID
        task_id = self.request.id
        
        # Update state to running
        self.update_state(state="STARTED", meta={"message": "Initializing simulation..."})

        # Import here to avoid issues with Celery worker startup
        from ..config.inputs import (
            apply_scenario_overrides,
            build_fund_from_inputs,
            get_exchange_rate,
            get_simulation_settings,
            load_model_inputs,
        )
        from ..core.simulation import CashFlowModel
        from ..reporting.dashboard_runner import (
            compute_irr_distribution,
            prepare_sensitivity_data,
        )
        from ..reporting.d3_dashboard import (
            _load_sensitivity_frames,
            _prepare_irr_distribution,
            _prepare_j_curve,
            generate_d3_dashboard,
        )
        from ..reporting.reports import visualize_results
        from ..testing.diagnostics import run_diagnostics, save_payload

        # Load inputs and build model
        self.update_progress(0, 100, "Loading model inputs...")
        
        # If custom parameters provided, use them instead of file
        if custom_parameters:
            base_inputs = custom_parameters
        else:
            base_inputs = load_model_inputs(Path(inputs_path))
        
        scenario_block = base_inputs.get("scenarios", {}) or {}
        
        # Determine which scenarios to run
        if all_scenarios and scenario_block:
            scenario_names = list(scenario_block.keys())
        elif scenarios:
            scenario_names = scenarios
        elif scenario:
            scenario_names = [scenario]
        else:
            scenario_names = ["base"]
        
        # Create timestamped output directory
        run_timestamp = datetime.now().strftime("%Y%m%d-%H%M")
        output_root = Path("reports")
        run_output_dir = output_root / run_timestamp
        run_output_dir.mkdir(parents=True, exist_ok=True)
        
        scenario_metrics = []
        total_scenarios = len(scenario_names)
        
        # Process each scenario
        for idx, scenario_name in enumerate(scenario_names):
            scenario_progress_base = int((idx / total_scenarios) * 80)  # Reserve 80% for scenarios
            
            self.update_progress(
                scenario_progress_base, 
                100, 
                f"Processing scenario {idx+1}/{total_scenarios}: {scenario_name}"
            )
            
            # Apply scenario overrides and funding profile
            scenario_inputs = apply_scenario_overrides(base_inputs, scenario_name)
            scenario_inputs = apply_funding_profile(scenario_inputs, funding_profile or "UF")
            simulation_settings = get_simulation_settings(scenario_inputs)
            effective_alpha_seed = (
                int(alpha_seed) if alpha_seed is not None else simulation_settings.alpha_seed
            )
            
            num_sims = simulations if simulations is not None else simulation_settings.num_simulations
            num_sims = max(1, num_sims)
            
            fund = build_fund_from_inputs(scenario_inputs, case_modeling_mode=case_mode or "legacy")
            
            # Run simulation
            self.update_progress(
                scenario_progress_base + 5,
                100,
                f"[{scenario_name}] Running {num_sims} Monte Carlo simulations..."
            )
            
            model = CashFlowModel(
                fund=fund,
                forecast_start_date=simulation_settings.forecast_start_date,
                num_simulations=num_sims,
                alpha_seed=effective_alpha_seed,
            )
            model.run_simulation()
            
            # Create scenario directory
            scenario_dir = run_output_dir / scenario_name
            scenario_dir.mkdir(parents=True, exist_ok=True)
            
            # Compute IRR distribution
            self.update_progress(
                scenario_progress_base + 40,
                100,
                f"[{scenario_name}] Computing IRR distribution..."
            )
            irr_results = compute_irr_distribution(model)
            
            # Prepare sensitivity data if requested
            sensitivity_sources = []
            if sensitivity:
                self.update_progress(
                    scenario_progress_base + 50,
                    100,
                    f"[{scenario_name}] Running sensitivity analysis..."
                )
                
                config_divisor = max(1, simulation_settings.sensitivity_sample_divisor)
                effective_divisor = max(
                    1, sensitivity_divisor if sensitivity_divisor is not None else config_divisor
                )
                sensitivity_sample_size = max(1, math.ceil(num_sims / effective_divisor))
                
                sensitivity_script = Path(__file__).resolve().parents[1] / "sensitivity.py"
                sensitivity_sources = prepare_sensitivity_data(
                    regenerate=True,
                    script_path=sensitivity_script,
                    sample_size=sensitivity_sample_size,
                    case_mode=case_mode or "legacy",
                    archive_dir=scenario_dir / "sensitivity",
                    timestamp=run_timestamp,
                )
            
            # Generate visualization reports
            self.update_progress(
                scenario_progress_base + 60,
                100,
                f"[{scenario_name}] Generating reports..."
            )
            visualize_results(model, irr_results, output_dir=scenario_dir, timestamp=run_timestamp)
            
            # Run diagnostics
            self.update_progress(
                scenario_progress_base + 70,
                100,
                f"[{scenario_name}] Running diagnostics..."
            )
            payload = run_diagnostics(
                fund=fund,
                simulation_seed=effective_alpha_seed,
                total_cases=len(fund.portfolio),
                deposit_rate=simulation_settings.deposit_rate,
                inputs_path=Path(inputs_path),
            )
            
            # Prepare fund metadata for dashboard
            fund_metadata_for_dashboard: dict[str, object] = dict(scenario_inputs.get("fund", {}))
            if getattr(payload, "fund_metadata", None):
                fund_metadata_for_dashboard.update(payload.fund_metadata)
            
            exchange_rate = get_exchange_rate(scenario_inputs)
            
            # Generate D3 dashboard
            current_reports_dir = Path("reports/current") / scenario_name
            current_reports_dir.mkdir(parents=True, exist_ok=True)
            
            dashboard_path = generate_d3_dashboard(
                model,
                irr_results,
                sensitivity_files=sensitivity_sources,
                fund_metadata=fund_metadata_for_dashboard,
                fund_metrics=getattr(payload, "fund_metrics", None),
                exchange_rate=exchange_rate,
                monthly_timeseries=getattr(payload, "monthly_timeseries", None),
                output_dir=current_reports_dir,
            )
            
            # Copy to timestamped location
            timestamped_dashboard = scenario_dir / f"fund_dashboard_{scenario_name}_{run_timestamp}.html"
            shutil.copy2(dashboard_path, timestamped_dashboard)
            # Also save stable filename inside this run's directory for task-specific serving.
            shutil.copy2(dashboard_path, scenario_dir / "fund_dashboard.html")
            
            # Save Alpha diagnostics
            final_dir = save_payload(
                payload,
                scenario_dir,
                timestamp=run_timestamp,
                inputs_path=Path(inputs_path),
                exchange_rate=exchange_rate,
            )
            
            scenario_metrics.append({
                "scenario": scenario_name,
                "irr_results": irr_results,
                "payload": payload,
                "scenario_dir": str(scenario_dir),
                "dashboard_path": str(dashboard_path),
            })
        
        # Generate scenario comparison chart if multiple scenarios
        if len(scenario_metrics) > 1:
            try:
                from ..reporting.scenario_reports import generate_scenario_comparison_chart
                chart_path = generate_scenario_comparison_chart(scenario_metrics, output_dir=run_output_dir)
            except Exception:
                pass  # Scenario comparison is optional
        
        # Prepare final dashboard data for API response (use first/primary scenario)
        self.update_progress(90, 100, "Preparing dashboard data...")
        
        primary_scenario = scenario_metrics[0] if scenario_metrics else None
        if primary_scenario:
            # Load the dashboard we just generated
            dashboard_html_path = Path(primary_scenario["dashboard_path"])
            
            # Generate dashboard data structure for API
            j_curve = _prepare_j_curve(model)
            irr_payload = _prepare_irr_distribution(primary_scenario["irr_results"])
            
            # Load sensitivity data if available
            sensitivity_series = _load_sensitivity_frames(sensitivity_sources)
            sensitivity_payload = [
                {"variable": series.variable, "records": series.records}
                for series in sensitivity_series
            ]
            
            # Build summary metrics from model statistics
            summary_metrics = {}
            stats_df = getattr(model, "simulation_statistics", None)
            if stats_df is not None and not stats_df.empty:
                stats_records = stats_df.to_dict("records")
                for row in stats_records:
                    metric_key = row.get("metric")
                    if metric_key:
                        summary_metrics[metric_key] = {
                            "label": row.get("label") or metric_key,
                            "value": row.get("median"),
                            "format": row.get("format", "number"),
                            "distribution": True,
                        }
            
            dashboard_dict = {
                "summary_metrics": summary_metrics,
                "j_curve": j_curve,
                "irr_distribution": irr_payload,
                "sensitivity_data": sensitivity_payload,
            }
        else:
            dashboard_dict = {
                "summary_metrics": {},
                "j_curve": [],
                "irr_distribution": [],
                "sensitivity_data": [],
            }
        
        # Store results using configured storage backend
        self.update_progress(95, 100, "Saving results...")
        
        storage_backend = get_storage_backend()
        storage_backend.save_dashboard_data(task_id, dashboard_dict)
        
        self.update_progress(100, 100, "Simulation complete!")

        return {
            "task_id": task_id,
            "status": "completed",
            "dashboard_data": dashboard_dict,
            "scenarios": [s["scenario"] for s in scenario_metrics],
            "output_directory": str(run_output_dir),
        }

    except Exception as e:
        # Log the error and re-raise
        error_msg = f"Simulation failed: {str(e)}"
        self.update_state(state="FAILURE", meta={"message": error_msg, "error": str(e)})
        raise


@celery_app.task(bind=True, base=SimulationProgressTask, name="run_case_simulation")
def run_case_simulation(self, case_parameters: Dict[str, Any]) -> Dict[str, Any]:
    """
    Execute an individual case simulation as a Celery task.
    
    This task simulates a single arbitration case with multiple claims,
    running Monte Carlo simulations to analyze outcomes, costs, and timelines.
    
    Args:
        case_parameters: Dictionary containing case configuration:
            - case: case metadata (name, ID, description, etc.)
            - financial: financial parameters (costs, multiples, etc.)
            - claims: list of claim dictionaries
            - timeline: timeline and challenge parameters
            - simulation: simulation settings (num_simulations, seed)
    
    Returns:
        Dictionary containing case simulation results and metadata
    """
    try:
        task_id = self.request.id
        self.update_state(state="STARTED", meta={"message": "Initializing case simulation..."})
        
        # Import dependencies
        import numpy as np
        from ..core.models import Case, USDINR
        from ..core.claims import Claim, CaseTimeline
        from datetime import date
        
        # Extract parameters
        case_info = case_parameters.get("case", {})
        financial = case_parameters.get("financial", {})
        claims_data = case_parameters.get("claims", [])
        timeline_params = case_parameters.get("timeline", {})
        sim_params = case_parameters.get("simulation", {})
        
        # Simulation settings
        num_simulations = sim_params.get("num_simulations", 1000)
        seed = sim_params.get("seed", 42)
        np.random.seed(seed)
        
        self.update_progress(10, 100, "Creating case model...")
        
        # Parse start date
        start_date_str = case_info.get("start_date", "2026-01-01")
        start_date = date.fromisoformat(start_date_str)
        
        # Create case
        case = Case(
            name=case_info.get("name", "Unnamed Case"),
            start_date=start_date,
            case_type=case_info.get("case_type", "Cost Financing"),
            modeling_mode="claims",
            monthly_base_cost=financial.get("monthly_base_cost", 13833333.33),
            excess_cost_threshold=financial.get("excess_cost_threshold", 1666666666.67),
            excess_cost_rate=financial.get("excess_cost_rate", 0.05),
            payout_multiple=financial.get("payout_multiple", 4.0),
        )
        
        # Add claims
        self.update_progress(20, 100, f"Adding {len(claims_data)} claims...")
        
        for claim_data in claims_data:
            claim = Claim(
                claim_id=claim_data.get("claim_id", ""),
                description=claim_data.get("description", ""),
                quantum=claim_data.get("quantum", 0),
                prob_success=claim_data.get("prob_success", 0.65),
                duration_months=claim_data.get("duration_months", 42),
                settlement_probability=claim_data.get("settlement_probability", 0.30),
                settlement_recovery_pct=claim_data.get("settlement_recovery_pct", 0.50),
                dismissal_probability=claim_data.get("dismissal_probability", 0.05),
                dismissal_stage_months=claim_data.get("dismissal_stage_months", 12),
            )
            case.add_claim(claim)
        
        # Setup timeline if specified
        if timeline_params.get("timeline_type"):
            from ..core.claims import setup_indian_section_34_37_timeline
            setup_indian_section_34_37_timeline(
                case,
                initiate_challenge_probability=timeline_params.get("initiate_challenge_probability", 0.40)
            )
        
        # Run simulations
        self.update_progress(30, 100, f"Running {num_simulations} simulations...")
        
        results = []
        total_quantum = sum(claim_data.get("quantum", 0) for claim_data in claims_data)
        
        for i in range(num_simulations):
            if i % 100 == 0:
                progress = 30 + int((i / num_simulations) * 60)
                self.update_progress(progress, 100, f"Simulation {i+1}/{num_simulations}...")
            
            # Run single simulation
            final_payout, monthly_cost, end_date, initial_payment, final_investment, trial_success = case.get_simulated_outcome()
            
            # Collect results
            total_recovery = sum(outcome.final_recovery for outcome in case._claim_outcomes)
            
            results.append({
                "simulation_id": i + 1,
                "total_quantum": total_quantum,
                "total_recovery": total_recovery,
                "final_payout": final_payout,
                "final_investment": final_investment,
                "monthly_cost": monthly_cost,
                "duration_months": (end_date - start_date).days // 30,
                "end_date": end_date.isoformat(),
                "trial_success": trial_success,
                "recovery_rate": total_recovery / total_quantum if total_quantum > 0 else 0,
                "payout_multiple": final_payout / final_investment if final_investment > 0 else 0,
                "claim_outcomes": [
                    {
                        "claim_id": outcome.claim_id,
                        "final_status": outcome.final_status.value,
                        "final_recovery": outcome.final_recovery,
                        "total_duration_months": outcome.total_duration_months,
                    }
                    for outcome in case._claim_outcomes
                ],
            })
        
        self.update_progress(90, 100, "Calculating summary statistics...")
        
        # Calculate summary statistics
        recoveries = [r["total_recovery"] for r in results]
        payouts = [r["final_payout"] for r in results]
        investments = [r["final_investment"] for r in results]
        payout_multiples = [r["payout_multiple"] for r in results]
        recovery_rates = [r["recovery_rate"] for r in results]
        durations = [r["duration_months"] for r in results]
        
        summary = {
            "total_quantum": total_quantum,
            "num_claims": len(claims_data),
            "num_simulations": num_simulations,
            "mean_recovery": float(np.mean(recoveries)),
            "median_recovery": float(np.median(recoveries)),
            "std_recovery": float(np.std(recoveries)),
            "p25_recovery": float(np.percentile(recoveries, 25)),
            "p75_recovery": float(np.percentile(recoveries, 75)),
            "mean_payout": float(np.mean(payouts)),
            "median_payout": float(np.median(payouts)),
            "mean_cost": float(np.mean(investments)),
            "median_cost": float(np.median(investments)),
            "mean_payout_multiple": float(np.mean(payout_multiples)),
            "median_payout_multiple": float(np.median(payout_multiples)),
            "mean_recovery_rate": float(np.mean(recovery_rates)),
            "median_recovery_rate": float(np.median(recovery_rates)),
            "mean_duration_months": float(np.mean(durations)),
            "median_duration_months": float(np.median(durations)),
        }
        
        # Save results
        self.update_progress(95, 100, "Saving results...")
        
        output_data = {
            "task_id": task_id,
            "case_name": case_info.get("name"),
            "case_id": case_info.get("case_id"),
            "submitted_at": case_parameters.get("submitted_at", datetime.utcnow().isoformat()),
            "completed_at": datetime.utcnow().isoformat(),
            "status": "COMPLETED",
            "num_claims": len(claims_data),
            "num_simulations": num_simulations,
            "summary": summary,
            "simulations": results,
            "case_parameters": case_parameters,
        }
        
        # Save to file
        case_results_dir = Path("server/runs/fund_cases")
        case_results_dir.mkdir(parents=True, exist_ok=True)
        
        output_file = case_results_dir / f"{task_id}_case.json"
        with open(output_file, "w") as f:
            json.dump(output_data, f, indent=2)
        
        self.update_progress(100, 100, "Case simulation complete!")
        
        return {
            "task_id": task_id,
            "status": "completed",
            "summary": summary,
            "output_file": str(output_file),
        }
        
    except Exception as e:
        error_msg = f"Case simulation failed: {str(e)}"
        self.update_state(state="FAILURE", meta={"message": error_msg, "error": str(e)})
        raise
