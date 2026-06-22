import numpy as np
import pandas as pd
import pytest

from app.shortlist_engine import (
    analyze_all_factors,
    analyze_factor,
    auto_bin_numeric,
    compute_gini,
    compute_gini_categorical,
    compute_woe_iv,
    compute_woe_iv_categorical,
    enforce_monotonicity,
    profile_dataframe,
    refine_bins,
)


def make_simple_df():
    np.random.seed(42)
    n = 500
    good_factor = np.random.normal(0, 1, n)
    noise = np.random.uniform(0, 1, n)
    target = (good_factor > 0.3).astype(int)
    return pd.DataFrame({"good_factor": good_factor, "noise": noise, "target": target})


class TestProfileDataframe:
    def test_returns_all_columns(self):
        df = pd.DataFrame({"a": [1, 2, 3], "b": ["x", "y", "z"]})
        profiles, detected = profile_dataframe(df)
        assert len(profiles) == 2
        assert profiles[0]["name"] == "a"
        assert profiles[1]["name"] == "b"

    def test_detects_types(self):
        df = pd.DataFrame({"num": [1.0, 2.0], "cat": ["a", "b"]})
        profiles, _ = profile_dataframe(df)
        assert profiles[0]["dtype"] == "numeric"
        assert profiles[1]["dtype"] == "categorical"

    def test_missing_counts(self):
        df = pd.DataFrame({"a": [1, None, 3, None]})
        profiles, _ = profile_dataframe(df)
        assert profiles[0]["missing_count"] == 2
        assert profiles[0]["missing_pct"] == 50.0

    def test_detects_special_values(self):
        df = pd.DataFrame({"a": [1, -999, 3, -999, 5]})
        profiles, detected = profile_dataframe(df, [-999.0])
        assert profiles[0]["special_value_counts"] == {"-999.0": 2}
        assert len(detected) == 1
        assert detected[0]["column"] == "a"


class TestAutoBinNumeric:
    def test_tree_binning_produces_edges(self):
        np.random.seed(42)
        values = np.random.normal(0, 1, 200)
        target = (values > 0).astype(float)
        edges = auto_bin_numeric(values, target, max_bins=5, method="tree")
        assert len(edges) > 0
        assert all(edges[i] < edges[i + 1] for i in range(len(edges) - 1))

    def test_equal_frequency_binning(self):
        np.random.seed(42)
        values = np.random.uniform(0, 100, 200)
        target = (values > 50).astype(float)
        edges = auto_bin_numeric(values, target, max_bins=4, method="equal_frequency")
        assert len(edges) > 0

    def test_single_value_returns_empty(self):
        values = np.array([5.0, 5.0, 5.0])
        target = np.array([0.0, 1.0, 0.0])
        edges = auto_bin_numeric(values, target)
        assert edges == []


class TestComputeWoeIv:
    def test_basic_woe_iv(self):
        values = np.array([1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0])
        target = np.array([1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
        edges = [5.0]
        bins_data, iv = compute_woe_iv(values, target, edges)
        assert len(bins_data) == 2
        assert iv >= 0
        assert all("woe" in b for b in bins_data)
        assert all(b["is_special"] is False for b in bins_data)

    def test_iv_is_sum_of_contributions(self):
        np.random.seed(42)
        values = np.random.normal(0, 1, 200)
        target = (values > 0).astype(float)
        edges = [0.0]
        bins_data, iv = compute_woe_iv(values, target, edges)
        iv_sum = sum(b["iv_contribution"] for b in bins_data)
        assert iv == pytest.approx(iv_sum, abs=0.001)

    def test_no_events_returns_empty(self):
        values = np.array([1.0, 2.0, 3.0])
        target = np.array([0.0, 0.0, 0.0])
        bins_data, iv = compute_woe_iv(values, target, [2.0])
        assert bins_data == []
        assert iv == 0.0


class TestComputeGini:
    def test_perfect_predictor(self):
        values = np.array([0.0, 0.0, 0.0, 1.0, 1.0, 1.0])
        target = np.array([0.0, 0.0, 0.0, 1.0, 1.0, 1.0])
        gini = compute_gini(values, target)
        assert gini == pytest.approx(1.0, abs=0.01)

    def test_random_predictor(self):
        np.random.seed(42)
        values = np.random.uniform(0, 1, 1000)
        target = np.random.randint(0, 2, 1000).astype(float)
        gini = compute_gini(values, target)
        assert abs(gini) < 0.15

    def test_single_unique_value(self):
        values = np.array([1.0, 1.0, 1.0])
        target = np.array([0.0, 1.0, 0.0])
        gini = compute_gini(values, target)
        assert gini == 0.0


class TestCategorical:
    def test_woe_iv_categorical(self):
        values = np.array(["A", "A", "A", "B", "B", "B", "C", "C", "C"])
        target = np.array([1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0])
        bins_data, iv = compute_woe_iv_categorical(values, target)
        assert len(bins_data) == 3
        assert iv >= 0

    def test_gini_categorical(self):
        np.random.seed(42)
        values = np.array(["A"] * 100 + ["B"] * 100)
        target = np.array([1] * 80 + [0] * 20 + [0] * 80 + [1] * 20).astype(float)
        gini = compute_gini_categorical(values, target)
        assert gini > 0.3


class TestAnalyzeFactor:
    def test_numeric_factor(self):
        df = make_simple_df()
        result = analyze_factor(df, "good_factor", "target")
        assert result["factor_name"] == "good_factor"
        assert result["dtype"] == "numeric"
        assert result["gini"] > 0
        assert result["iv"] > 0
        assert len(result["bins"]) > 0
        assert result["missing_count"] == 0
        assert result["special_count"] == 0

    def test_analyze_all_sorts_by_gini(self):
        df = make_simple_df()
        results = analyze_all_factors(df, "target")
        assert len(results) == 2
        assert results[0]["gini"] >= results[1]["gini"]

    def test_factor_with_specials(self):
        np.random.seed(42)
        values = list(range(100)) + [-999] * 20
        target = [1 if v > 50 else 0 for v in range(100)] + [1] * 10 + [0] * 10
        df = pd.DataFrame({"factor": values, "target": target})
        result = analyze_factor(df, "factor", "target", special_values=[-999.0])
        assert result["special_count"] == 20
        special_bins = [b for b in result["bins"] if b["is_special"]]
        assert len(special_bins) == 1
        assert "Special" in special_bins[0]["bin_label"]

    def test_factor_with_missing(self):
        np.random.seed(42)
        values = [float(i) for i in range(80)] + [np.nan] * 20
        target = [1 if i > 40 else 0 for i in range(80)] + [1] * 10 + [0] * 10
        df = pd.DataFrame({"factor": values, "target": target})
        result = analyze_factor(df, "factor", "target")
        assert result["missing_count"] == 20
        missing_bins = [b for b in result["bins"] if b["bin_label"] == "Missing"]
        assert len(missing_bins) == 1

    def test_factor_with_both_missing_and_special(self):
        np.random.seed(42)
        values = [float(i) for i in range(60)] + [np.nan] * 20 + [-999.0] * 20
        target = [1 if i > 30 else 0 for i in range(60)] + [1] * 10 + [0] * 10 + [1] * 10 + [0] * 10
        df = pd.DataFrame({"factor": values, "target": target})
        result = analyze_factor(df, "factor", "target", special_values=[-999.0])
        assert result["missing_count"] == 20
        assert result["special_count"] == 20
        special_bins = [b for b in result["bins"] if b["is_special"]]
        assert len(special_bins) == 2


class TestRefineBins:
    def test_refine_with_specials(self):
        np.random.seed(42)
        values = np.concatenate([np.random.normal(0, 1, 80), np.full(20, -999.0)])
        target = np.concatenate([(np.random.normal(0, 1, 80) > 0).astype(float), np.array([1.0] * 10 + [0.0] * 10)])
        bins_data, iv, gini, _, _ = refine_bins(values, target, [0.0], special_values=[-999.0])
        regular = [b for b in bins_data if not b["is_special"]]
        specials = [b for b in bins_data if b["is_special"]]
        assert len(regular) == 2
        assert len(specials) == 1


class TestEnforceMonotonicity:
    def test_already_monotonic(self):
        bins = [
            {"woe": -1.0, "count": 10, "event_count": 8, "non_event_count": 2,
             "pct_events": 0.4, "pct_non_events": 0.1, "lower": None, "upper": 5.0,
             "bin_label": "(-inf, 5.00]", "event_rate": 0.8, "iv_contribution": 0.1, "is_special": False},
            {"woe": 0.5, "count": 10, "event_count": 4, "non_event_count": 6,
             "pct_events": 0.2, "pct_non_events": 0.3, "lower": 5.0, "upper": 10.0,
             "bin_label": "(5.00, 10.00]", "event_rate": 0.4, "iv_contribution": 0.05, "is_special": False},
            {"woe": 1.5, "count": 10, "event_count": 2, "non_event_count": 8,
             "pct_events": 0.1, "pct_non_events": 0.4, "lower": 10.0, "upper": None,
             "bin_label": "(10.00, +inf]", "event_rate": 0.2, "iv_contribution": 0.08, "is_special": False},
        ]
        result = enforce_monotonicity(bins, "increasing")
        assert len(result) == 3

    def test_merges_violating_bins(self):
        bins = [
            {"woe": -1.0, "count": 10, "event_count": 8, "non_event_count": 2,
             "pct_events": 0.4, "pct_non_events": 0.1, "lower": None, "upper": 5.0,
             "bin_label": "(-inf, 5.00]", "event_rate": 0.8, "iv_contribution": 0.1, "is_special": False},
            {"woe": 1.0, "count": 10, "event_count": 2, "non_event_count": 8,
             "pct_events": 0.1, "pct_non_events": 0.4, "lower": 5.0, "upper": 10.0,
             "bin_label": "(5.00, 10.00]", "event_rate": 0.2, "iv_contribution": 0.05, "is_special": False},
            {"woe": -0.5, "count": 10, "event_count": 6, "non_event_count": 4,
             "pct_events": 0.3, "pct_non_events": 0.2, "lower": 10.0, "upper": None,
             "bin_label": "(10.00, +inf]", "event_rate": 0.6, "iv_contribution": 0.02, "is_special": False},
        ]
        result = enforce_monotonicity(bins, "increasing")
        regular = [b for b in result if not b.get("is_special", False)]
        assert len(regular) < 3

    def test_special_bins_excluded_from_monotonicity(self):
        bins = [
            {"woe": -1.0, "count": 10, "event_count": 8, "non_event_count": 2,
             "pct_events": 0.4, "pct_non_events": 0.1, "lower": None, "upper": 5.0,
             "bin_label": "(-inf, 5.00]", "event_rate": 0.8, "iv_contribution": 0.1, "is_special": False},
            {"woe": 0.5, "count": 10, "event_count": 4, "non_event_count": 6,
             "pct_events": 0.2, "pct_non_events": 0.3, "lower": 5.0, "upper": None,
             "bin_label": "(5.00, +inf]", "event_rate": 0.4, "iv_contribution": 0.05, "is_special": False},
            {"woe": 2.0, "count": 5, "event_count": 1, "non_event_count": 4,
             "pct_events": 0.05, "pct_non_events": 0.2, "lower": None, "upper": None,
             "bin_label": "Missing", "event_rate": 0.2, "iv_contribution": 0.03, "is_special": True},
        ]
        result = enforce_monotonicity(bins, "increasing")
        specials = [b for b in result if b["is_special"]]
        assert len(specials) == 1
        assert specials[0]["bin_label"] == "Missing"

    def test_u_shaped(self):
        bins = [
            {"woe": 1.0, "count": 10, "event_count": 2, "non_event_count": 8,
             "pct_events": 0.1, "pct_non_events": 0.4, "lower": None, "upper": 3.0,
             "bin_label": "(-inf, 3.00]", "event_rate": 0.2, "iv_contribution": 0.1, "is_special": False},
            {"woe": -0.5, "count": 10, "event_count": 6, "non_event_count": 4,
             "pct_events": 0.3, "pct_non_events": 0.2, "lower": 3.0, "upper": 6.0,
             "bin_label": "(3.00, 6.00]", "event_rate": 0.6, "iv_contribution": 0.05, "is_special": False},
            {"woe": -1.0, "count": 10, "event_count": 8, "non_event_count": 2,
             "pct_events": 0.4, "pct_non_events": 0.1, "lower": 6.0, "upper": 9.0,
             "bin_label": "(6.00, 9.00]", "event_rate": 0.8, "iv_contribution": 0.08, "is_special": False},
            {"woe": 0.8, "count": 10, "event_count": 3, "non_event_count": 7,
             "pct_events": 0.15, "pct_non_events": 0.35, "lower": 9.0, "upper": None,
             "bin_label": "(9.00, +inf]", "event_rate": 0.3, "iv_contribution": 0.06, "is_special": False},
        ]
        result = enforce_monotonicity(bins, "u_shaped")
        regular = [b for b in result if not b.get("is_special", False)]
        assert len(regular) >= 2
