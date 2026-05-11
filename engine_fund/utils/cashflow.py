import numpy as np

# Default USD to INR exchange rate.
# NOTE: For fund-specific rates, use the "currency.usd_inr" field in fund_parameters.json
# and call get_exchange_rate(inputs) from engine_fund.config.inputs.
# This constant is only used as a fallback when no inputs are available.
USDINR = 90.0
# Global parameter for Goods & Services Tax rate on fee income.
GST_RATE = 0.18


def _npv(rate: float, cashflows: np.ndarray) -> float:
	"""Compute net present value for a sequence of cashflows."""
	periods = np.arange(cashflows.size, dtype=float)
	# Mask overflow/divide warnings so extreme bracket guesses do not explode IRR search.
	with np.errstate(over="ignore", divide="ignore", invalid="ignore"):
		discount = np.power(1.0 + rate, periods, dtype=float)
		values = np.divide(
			cashflows,
			discount,
			out=np.zeros_like(cashflows, dtype=float),
			where=(discount != 0.0) & np.isfinite(discount),
		)
	return float(np.sum(values))


def _npv_derivative(rate: float, cashflows: np.ndarray) -> float:
	"""Derivative of NPV with respect to the discount rate."""
	periods = np.arange(cashflows.size, dtype=float)
	# Keep derivative stable by ignoring invalid discount factors from extreme rates.
	with np.errstate(over="ignore", divide="ignore", invalid="ignore"):
		discount = np.power(1.0 + rate, periods + 1.0, dtype=float)
		values = np.divide(
			periods * cashflows,
			discount,
			out=np.zeros_like(cashflows, dtype=float),
			where=(discount != 0.0) & np.isfinite(discount),
		)
	return float(-np.sum(values))


def compute_internal_rate_of_return(
	cashflows,
	*,
	guess: float = 0.1,
	tol: float = 1e-6,
	max_iterations: int = 100,
) -> float:
	"""Approximate the IRR for a sequence of cashflows.

	Falls back to a Newton-Raphson iteration with a bisection safety net when
	``np.irr`` is unavailable (NumPy >= 2.0).
	Returns ``np.nan`` if the cashflows do not contain at least one positive and
	one negative value or the root cannot be found within the iteration limits.
	"""

	flows = np.asarray(cashflows, dtype=float)
	flows = np.trim_zeros(np.trim_zeros(flows, "f"), "b")

	if flows.size < 2:
		return np.nan

	has_pos = np.any(flows > 0)
	has_neg = np.any(flows < 0)
	if not (has_pos and has_neg):
		return np.nan

	# Try NumPy's implementation first (available on <2.0)
	irr_func = getattr(np, "irr", None)
	if irr_func is not None:
		try:
			solution = irr_func(flows)
			if solution is not None and np.isfinite(solution):
				return float(solution)
		except (ValueError, RuntimeError, FloatingPointError):
			pass

	# Prefer a positive root if one exists
	npv_at_zero = _npv(0.0, flows)
	positive_brackets = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1.0, 2.0, 5.0, 10.0]
	lower = 0.0
	npv_lower = npv_at_zero
	positive_root = None
	for upper in positive_brackets:
		npv_upper = _npv(upper, flows)
		if npv_lower * npv_upper < 0:
			positive_root = (lower, upper, npv_lower, npv_upper)
			break
		lower, npv_lower = upper, npv_upper

	def _bisection(low, high, npv_low, npv_high):
		l, h = low, high
		npv_l, npv_h = npv_low, npv_high
		for _ in range(max_iterations * 2):
			mid = (l + h) / 2.0
			npv_mid = _npv(mid, flows)
			if abs(npv_mid) < tol:
				return mid
			if npv_l * npv_mid < 0:
				h, npv_h = mid, npv_mid
			else:
				l, npv_l = mid, npv_mid
		return (l + h) / 2.0

	if positive_root is not None:
		low, high, npv_low, npv_high = positive_root
		return float(_bisection(low, high, npv_low, npv_high))

	# Fall back to Newton-Raphson with bisection safety for the general case
	rate = guess
	for _ in range(max_iterations):
		if rate <= -1.0:
			rate = -0.9999
		value = _npv(rate, flows)
		derivative = _npv_derivative(rate, flows)
		if abs(derivative) < 1e-12:
			break
		next_rate = rate - value / derivative
		if abs(next_rate - rate) < tol and np.isfinite(next_rate):
			return float(next_rate)
		rate = next_rate

	lower, upper = -0.9999, 1.0
	npv_lower = _npv(lower, flows)
	npv_upper = _npv(upper, flows)

	for bound in (5.0, 10.0, 20.0, 50.0, 100.0):
		if npv_lower * npv_upper <= 0:
			break
		upper = bound
		npv_upper = _npv(upper, flows)

	if npv_lower * npv_upper > 0:
		return np.nan

	return float(_bisection(lower, upper, npv_lower, npv_upper))
