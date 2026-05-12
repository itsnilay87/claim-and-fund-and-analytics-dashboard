export const FIELD_TYPES = {
  TEXT: 'text',
  NUMBER: 'number',
  PERCENT: 'percent',
  CURRENCY_INR: 'currency_inr',
  CURRENCY_CR: 'currency_cr',
  DATE: 'date',
  SELECT: 'select',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
}

const T = FIELD_TYPES

export const FUND_FIELDS = [
  { key: 'name', label: 'Name', type: T.TEXT },
  { key: 'committed_capital', label: 'Committed Capital', type: T.CURRENCY_CR, unit: 'INR Cr' },
  { key: 'fund_size', label: 'Fund Size', type: T.CURRENCY_CR, unit: 'INR Cr' },
  { key: 'capital_reserve', label: 'Capital Reserve', type: T.PERCENT, unit: '%' },
  { key: 'regulatory_concentration_limit', label: 'Regulatory Concentration Limit', type: T.PERCENT, unit: '%' },
  { key: 'fund_concentration_limit', label: 'Fund Concentration Limit', type: T.PERCENT, unit: '%' },
  { key: 'deployment_limit_tolerance', label: 'Deployment Limit Tolerance', type: T.PERCENT, unit: '%' },
  { key: 'monetisation_ratio', label: 'Monetisation Ratio', type: T.PERCENT, unit: '%' },
  { key: 'case_origination_rate', label: 'Case Origination Rate', type: T.NUMBER, step: 0.1 },
  { key: 'average_quantum', label: 'Average Quantum', type: T.CURRENCY_CR, unit: 'INR Cr' },
  { key: 'quantum_std_dev', label: 'Quantum Std Dev', type: T.CURRENCY_CR, unit: 'INR Cr' },
  { key: 'average_prob_success', label: 'Average Prob Success', type: T.PERCENT, unit: '%' },
  { key: 'prob_success_std_dev', label: 'Prob Success Std Dev', type: T.PERCENT, unit: '%' },
  { key: 'average_duration', label: 'Average Duration', type: T.NUMBER, unit: 'months', step: 0.1 },
  { key: 'duration_std_dev', label: 'Duration Std Dev', type: T.NUMBER, unit: 'months', step: 0.01 },
  { key: 'audit_base_fee_inr', label: 'Audit Base Fee', type: T.CURRENCY_INR, unit: 'INR' },
  { key: 'audit_fee_per_case_inr', label: 'Audit Fee Per Case', type: T.CURRENCY_INR, unit: 'INR' },
  { key: 'fiscal_year_end_month', label: 'Fiscal Year End Month', type: T.INTEGER, unit: '(1-12)', min: 1, max: 12 },
  { key: 'fiscal_year_end_day', label: 'Fiscal Year End Day', type: T.INTEGER, unit: '(1-366)', min: 1, max: 366 },
  { key: 'organizational_costs_inr', label: 'Organizational Costs', type: T.CURRENCY_INR, unit: 'INR' },
  { key: 'origination_cost_per_case_inr', label: 'Origination Cost Per Case', type: T.CURRENCY_INR, unit: 'INR' },
  { key: 'trustee_fee_monthly_inr', label: 'Trustee Fee Monthly', type: T.CURRENCY_INR, unit: 'INR' },
  { key: 'compliance_cost_monthly_inr', label: 'Compliance Cost Monthly', type: T.CURRENCY_INR, unit: 'INR' },
  { key: 'fundraising_cost_inr', label: 'Fundraising Cost', type: T.CURRENCY_INR, unit: 'INR' },
  { key: 'insurance_cost_monthly_inr', label: 'Insurance Cost Monthly', type: T.CURRENCY_INR, unit: 'INR' },
  { key: 'marketing_cost_monthly_inr', label: 'Marketing Cost Monthly', type: T.CURRENCY_INR, unit: 'INR' },
  { key: 'management_fee_frequency', label: 'Management Fee Frequency', type: T.SELECT, options: ['monthly', 'quarterly', 'semi-annual', 'annual'] },
  { key: 'management_fee_timing', label: 'Management Fee Timing', type: T.SELECT, options: ['advance', 'arrears'] },
  { key: 'investment_date', label: 'Investment Date', type: T.DATE },
  { key: 'initial_closing_date', label: 'Initial Closing Date', type: T.DATE },
]

export const UNIT_CLASS_FIELDS = [
  { key: 'class_name', label: 'Class Name', type: T.TEXT },
  { key: 'management_fee_rate', label: 'Management Fee Rate', type: T.PERCENT, unit: '%' },
  { key: 'performance_fee_rate', label: 'Performance Fee Rate', type: T.PERCENT, unit: '%' },
  { key: 'unit_face_value', label: 'Unit Face Value', type: T.NUMBER },
]

export const INVESTOR_FIELDS = [
  { key: 'name', label: 'Name', type: T.TEXT },
  { key: 'class_name', label: 'Class', type: T.TEXT },
  { key: 'commitment', label: 'Commitment', type: T.CURRENCY_CR, unit: 'INR Cr' },
  { key: 'unit_price', label: 'Unit Price', type: T.NUMBER },
  { key: 'management_fee_rate', label: 'Mgmt Fee Rate', type: T.PERCENT, unit: '%' },
  { key: 'carry_rate', label: 'Carry Rate', type: T.PERCENT, unit: '%' },
  { key: 'carry_recipient_rate', label: 'Carry Recipient Rate', type: T.PERCENT, unit: '%' },
]

export const PORTFOLIO_FIELDS = [
  { key: 'total_cases', label: 'Total Cases', type: T.INTEGER, min: 1 },
  { key: 'portfolio_seed', label: 'Portfolio Seed', type: T.INTEGER, min: 0 },
  { key: 'fund_start_date', label: 'Fund Start Date', type: T.DATE },
]

export const SIMULATION_FIELDS = [
  { key: 'forecast_start_date', label: 'Forecast Start Date', type: T.DATE },
  { key: 'num_simulations', label: 'Num Simulations', type: T.INTEGER, min: 100, max: 50000 },
  { key: 'alpha_seed', label: 'Alpha Seed', type: T.INTEGER, min: 0 },
  { key: 'deposit_rate', label: 'Deposit Rate', type: T.PERCENT, unit: '%' },
  { key: 'sensitivity_sample_divisor', label: 'Sensitivity Sample Divisor', type: T.INTEGER, min: 1 },
]

export const CLAIMS_FIELDS = [
  { key: 'average_claims_per_case', label: 'Average Claims Per Case', type: T.INTEGER },
  { key: 'claims_per_case_std_dev', label: 'Claims Per Case Std Dev', type: T.NUMBER, step: 0.1 },
  { key: 'min_claims_per_case', label: 'Min Claims Per Case', type: T.INTEGER },
  { key: 'max_claims_per_case', label: 'Max Claims Per Case', type: T.INTEGER },
  { key: 'claim_quantum_distribution', label: 'Claim Quantum Distribution', type: T.SELECT, options: ['dirichlet', 'uniform', 'normal'] },
  { key: 'dirichlet_alpha', label: 'Dirichlet Alpha', type: T.NUMBER, step: 0.1 },
  { key: 'average_prob_success', label: 'Average Prob Success', type: T.PERCENT, unit: '%' },
  { key: 'prob_success_std_dev', label: 'Prob Success Std Dev', type: T.PERCENT, unit: '%' },
  { key: 'average_duration', label: 'Average Duration', type: T.INTEGER, unit: 'months' },
  { key: 'duration_std_dev', label: 'Duration Std Dev', type: T.INTEGER, unit: 'months' },
  { key: 'average_settlement_probability', label: 'Average Settlement Probability', type: T.PERCENT, unit: '%' },
  { key: 'settlement_probability_std_dev', label: 'Settlement Probability Std Dev', type: T.PERCENT, unit: '%' },
  { key: 'average_settlement_recovery_pct', label: 'Average Settlement Recovery %', type: T.PERCENT, unit: '%' },
  { key: 'settlement_recovery_pct_std_dev', label: 'Settlement Recovery % Std Dev', type: T.PERCENT, unit: '%' },
  { key: 'average_dismissal_probability', label: 'Average Dismissal Probability', type: T.PERCENT, unit: '%' },
  { key: 'dismissal_probability_std_dev', label: 'Dismissal Probability Std Dev', type: T.PERCENT, unit: '%' },
  { key: 'dismissal_stage_months', label: 'Dismissal Stage Months', type: T.INTEGER, unit: 'months' },
  { key: 'timeline_type', label: 'Timeline Type', type: T.SELECT, options: ['india_section_34_37', 'simple', 'custom'] },
  { key: 'initiate_challenge_probability', label: 'Initiate Challenge Probability', type: T.PERCENT, unit: '%' },
]

export const CHALLENGE_STAGE_FIELDS = [
  { key: 'stage_type', label: 'Stage Type', type: T.TEXT },
  { key: 'description', label: 'Description', type: T.TEXT },
  { key: 'duration_months', label: 'Duration', type: T.INTEGER, unit: 'months' },
  { key: 'success_probability', label: 'Success Probability', type: T.PERCENT, unit: '%' },
  { key: 'time_limit_months', label: 'Time Limit', type: T.INTEGER, unit: 'months' },
  { key: 'discretionary', label: 'Discretionary', type: T.BOOLEAN },
]

export const SCENARIO_FUND_FIELDS = [
  { key: 'average_prob_success', label: 'Average Prob Success', type: T.PERCENT, unit: '%' },
  { key: 'prob_success_std_dev', label: 'Prob Success Std Dev', type: T.PERCENT, unit: '%' },
  { key: 'average_duration', label: 'Average Duration', type: T.NUMBER, unit: 'months', step: 0.1 },
  { key: 'duration_std_dev', label: 'Duration Std Dev', type: T.NUMBER, unit: 'months', step: 0.1 },
  { key: 'payout_multiple', label: 'Payout Multiple', type: T.NUMBER, step: 0.1 },
  { key: 'award_ratio', label: 'Award Ratio', type: T.PERCENT, unit: '%' },
  { key: 'average_quantum', label: 'Average Quantum', type: T.CURRENCY_CR, unit: 'INR Cr' },
  { key: 'quantum_std_dev', label: 'Quantum Std Dev', type: T.CURRENCY_CR, unit: 'INR Cr' },
]

export const SCENARIO_CLAIMS_FIELDS = [
  { key: 'average_prob_success', label: 'Average Prob Success', type: T.PERCENT, unit: '%' },
  { key: 'prob_success_std_dev', label: 'Prob Success Std Dev', type: T.PERCENT, unit: '%' },
  { key: 'average_duration', label: 'Average Duration', type: T.INTEGER, unit: 'months' },
  { key: 'duration_std_dev', label: 'Duration Std Dev', type: T.INTEGER, unit: 'months' },
  { key: 'average_settlement_probability', label: 'Avg Settlement Probability', type: T.PERCENT, unit: '%' },
  { key: 'average_settlement_recovery_pct', label: 'Avg Settlement Recovery %', type: T.PERCENT, unit: '%' },
  { key: 'average_dismissal_probability', label: 'Avg Dismissal Probability', type: T.PERCENT, unit: '%' },
  { key: 'initiate_challenge_probability', label: 'Initiate Challenge Prob', type: T.PERCENT, unit: '%' },
  { key: 'settlement_recovery_pct_std_dev', label: 'Settlement Recovery Std Dev', type: T.PERCENT, unit: '%' },
  { key: 'settlement_probability_std_dev', label: 'Settlement Prob Std Dev', type: T.PERCENT, unit: '%' },
]

export const INR_CR_DIVISOR = 10000000

export function toDisplay(value, type) {
  if (value === null || value === undefined) return ''
  if (type === T.PERCENT) return +(value * 100).toFixed(4)
  if (type === T.CURRENCY_CR) return +(value / INR_CR_DIVISOR).toFixed(2)
  if (type === T.BOOLEAN) return !!value
  return value
}

export function fromDisplay(displayValue, type) {
  if (displayValue === '' || displayValue === null || displayValue === undefined) return undefined
  if (type === T.PERCENT) return Number(displayValue) / 100
  if (type === T.CURRENCY_CR) return Number(displayValue) * INR_CR_DIVISOR
  if (type === T.BOOLEAN) return !!displayValue
  if (type === T.INTEGER) return Math.round(Number(displayValue))
  if (type === T.NUMBER || type === T.CURRENCY_INR) return Number(displayValue)
  return displayValue
}
