"""Verify expected_xirr is never None in serialized grid."""
from engine.v2_core.v2_json_exporter import _pct, _cr


def test_pct_handles_none():
    assert _pct(None) == 0.0
    assert _pct(0.0) == 0.0
    assert _pct(0.1234567) == 0.123457


def test_cr_handles_none():
    assert _cr(None) == 0.0
    assert _cr(1.234) == 1.23
