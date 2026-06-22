import math

import numpy as np
import pandas as pd
import pytest

from app.scorecard_engine import (
    compute_model_metrics,
    compute_scorecard_points,
    fit_logistic_regression,
    fit_scorecard,
    woe_transform_dataset,
)


def make_test_data():
    np.random.seed(42)
    n = 1000
    factor_a = np.random.normal(0, 1, n)
    factor_b = np.random.normal(0, 1, n)
    log_odds = -1.0 + 0.8 * factor_a + 0.5 * factor_b
    prob = 1 / (1 + np.exp(-log_odds))
    target = (np.random.uniform(0, 1, n) < prob).astype(int)
    df = pd.DataFrame({"factor_a": factor_a, "factor_b": factor_b, "target": target})
    return df


def make_test_factors():
    return [
        {"factor_name": "factor_a", "bin_edges": [-0.5, 0.5]},
        {"factor_name": "factor_b", "bin_edges": [-0.5, 0.5]},
    ]


class TestWoeTransform:
    def test_basic_transform(self):
        df = make_test_data()
        factors = make_test_factors()
        woe_df, target, bins_map = woe_transform_dataset(df, "target", factors, [])
        assert "factor_a" in woe_df.columns
        assert "factor_b" in woe_df.columns
        assert len(target) == len(df)
        assert set(bins_map.keys()) == {"factor_a", "factor_b"}

    def test_woe_values_not_raw(self):
        df = make_test_data()
        factors = make_test_factors()
        woe_df, _, _ = woe_transform_dataset(df, "target", factors, [])
        unique_woe = woe_df["factor_a"].nunique()
        assert unique_woe <= 5

    def test_special_values_mapped(self):
        np.random.seed(42)
        values = list(range(100)) + [-999] * 20
        target = [1 if v > 50 else 0 for v in range(100)] + [0] * 20
        df = pd.DataFrame({"f1": values, "target": target})
        factors = [{"factor_name": "f1", "bin_edges": [50.0]}]
        woe_df, _, bins_map = woe_transform_dataset(df, "target", factors, [-999.0])
        sv_rows = woe_df.iloc[100:120]["f1"]
        assert sv_rows.nunique() == 1

    def test_missing_values_mapped(self):
        np.random.seed(42)
        values = [float(i) for i in range(80)] + [np.nan] * 20
        target = [1 if i > 40 else 0 for i in range(80)] + [0] * 20
        df = pd.DataFrame({"f1": values, "target": target})
        factors = [{"factor_name": "f1", "bin_edges": [40.0]}]
        woe_df, _, _ = woe_transform_dataset(df, "target", factors, [])
        nan_woe = woe_df.iloc[80:100]["f1"]
        assert nan_woe.nunique() == 1


class TestFitLogisticRegression:
    def test_returns_correct_shape(self):
        df = make_test_data()
        factors = make_test_factors()
        woe_df, target, _ = woe_transform_dataset(df, "target", factors, [])
        names = ["factor_a", "factor_b"]
        valid = ~pd.isna(woe_df["factor_a"])
        matrix = woe_df.loc[valid, names].values

        coefs, intercept, pvals = fit_logistic_regression(matrix, target, names)
        assert len(coefs) == 2
        assert isinstance(intercept, float)
        assert len(pvals) == 2

    def test_coefficients_nonzero(self):
        df = make_test_data()
        factors = make_test_factors()
        woe_df, target, _ = woe_transform_dataset(df, "target", factors, [])
        names = ["factor_a", "factor_b"]
        valid = ~pd.isna(woe_df["factor_a"])
        matrix = woe_df.loc[valid, names].values

        coefs, _, _ = fit_logistic_regression(matrix, target, names)
        assert all(abs(c) > 0.01 for c in coefs)

    def test_single_factor(self):
        df = make_test_data()
        factors = [{"factor_name": "factor_a", "bin_edges": [0.0]}]
        woe_df, target, _ = woe_transform_dataset(df, "target", factors, [])
        names = ["factor_a"]
        valid = ~pd.isna(woe_df["factor_a"])
        matrix = woe_df.loc[valid, names].values

        coefs, intercept, pvals = fit_logistic_regression(matrix, target, names)
        assert len(coefs) == 1
        assert "factor_a" in pvals


class TestComputeModelMetrics:
    def test_auc_range(self):
        df = make_test_data()
        factors = make_test_factors()
        woe_df, target, _ = woe_transform_dataset(df, "target", factors, [])
        names = ["factor_a", "factor_b"]
        valid = ~pd.isna(woe_df["factor_a"])
        matrix = woe_df.loc[valid, names].values

        from sklearn.linear_model import LogisticRegression
        lr = LogisticRegression(C=np.inf, solver="lbfgs", max_iter=1000, random_state=42)
        lr.fit(matrix, target)

        auc, gini, ks = compute_model_metrics(lr, matrix, target)
        assert 0.5 < auc <= 1.0
        assert gini == pytest.approx(2 * auc - 1, abs=0.001)
        assert 0 < ks <= 1.0


class TestComputeScorecardPoints:
    def test_min_max_range(self):
        df = make_test_data()
        factors = make_test_factors()
        woe_df, target, bins_map = woe_transform_dataset(df, "target", factors, [])
        names = ["factor_a", "factor_b"]
        valid = ~pd.isna(woe_df["factor_a"])
        matrix = woe_df.loc[valid, names].values

        coefs, intercept, _ = fit_logistic_regression(matrix, target, names)

        result, sf, so, mn, mx, bp, dist = compute_scorecard_points(
            coefs, intercept, bins_map, names, 600.0, 50.0, 20, woe_df, target,
        )
        assert mn < mx
        assert len(result) == 2

    def test_distribution_covers_all(self):
        df = make_test_data()
        factors = make_test_factors()
        woe_df, target, bins_map = woe_transform_dataset(df, "target", factors, [])
        names = ["factor_a", "factor_b"]
        valid = ~pd.isna(woe_df["factor_a"])
        matrix = woe_df.loc[valid, names].values

        coefs, intercept, _ = fit_logistic_regression(matrix, target, names)

        _, _, _, _, _, _, dist = compute_scorecard_points(
            coefs, intercept, bins_map, names, 600.0, 50.0, 20, woe_df, target,
        )
        total = sum(d["count"] for d in dist)
        assert total == len(target)


class TestFitScorecardEndToEnd:
    def test_full_pipeline(self):
        df = make_test_data()
        factors = make_test_factors()
        result = fit_scorecard(df, "target", factors, [], 600.0, 50.0, 20, stepwise_method="all")

        assert "factors" in result
        assert "intercept" in result
        assert "auc" in result
        assert "gini" in result
        assert "ks_statistic" in result
        assert "total_min_score" in result
        assert "total_max_score" in result
        assert "score_distribution" in result
        assert "stepwise_log" in result
        assert "dropped_factors" in result
        assert result["auc"] > 0.5
        assert len(result["factors"]) == 2

    def test_all_factors_have_bins(self):
        df = make_test_data()
        factors = make_test_factors()
        result = fit_scorecard(df, "target", factors, [], 600.0, 50.0, 20, stepwise_method="all")
        for f in result["factors"]:
            assert len(f["bins"]) > 0
            for b in f["bins"]:
                assert "points" in b
                assert "woe" in b

    def test_with_sample_data(self):
        from pathlib import Path
        sample_path = Path(__file__).parent.parent / "app" / "sample_data" / "sample_factors.csv"
        if not sample_path.exists():
            pytest.skip("Sample data not available")

        df = pd.read_csv(sample_path)
        factors = [
            {"factor_name": "debt_service_ratio", "bin_edges": [0.05, 0.1, 0.15]},
            {"factor_name": "interest_rate", "bin_edges": [8.0, 14.0, 20.0]},
            {"factor_name": "months_employed", "bin_edges": [12.0, 36.0, 72.0]},
        ]
        result = fit_scorecard(df, "default_flag", factors, [-999.0, 9999.0], 600.0, 50.0, 20)
        assert result["auc"] > 0.5
        assert result["total_min_score"] < result["total_max_score"]
        assert len(result["score_distribution"]) > 0
