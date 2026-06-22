import numpy as np
import pandas as pd

from app.cluster_engine import cluster_factors, compute_spearman_matrix, select_best_per_cluster


class TestComputeSpearmanMatrix:
    def test_identical_columns(self):
        df = pd.DataFrame({"a": [1, 2, 3, 4, 5], "b": [1, 2, 3, 4, 5]})
        corr = compute_spearman_matrix(df, ["a", "b"])
        assert corr[0, 1] == 1.0
        assert corr[1, 0] == 1.0

    def test_negatively_correlated(self):
        df = pd.DataFrame({"a": [1, 2, 3, 4, 5], "b": [5, 4, 3, 2, 1]})
        corr = compute_spearman_matrix(df, ["a", "b"])
        assert corr[0, 1] == -1.0

    def test_matrix_shape(self):
        df = pd.DataFrame({"a": range(10), "b": range(10), "c": range(10)})
        corr = compute_spearman_matrix(df, ["a", "b", "c"])
        assert corr.shape == (3, 3)


class TestClusterFactors:
    def test_correlated_factors_same_cluster(self):
        corr = np.array([
            [1.0, 0.95, 0.1],
            [0.95, 1.0, 0.05],
            [0.1, 0.05, 1.0],
        ])
        clusters, linkage = cluster_factors(corr, ["a", "b", "c"], threshold=0.3)
        a_cluster = next(cid for cid, fs in clusters.items() if "a" in fs)
        b_cluster = next(cid for cid, fs in clusters.items() if "b" in fs)
        c_cluster = next(cid for cid, fs in clusters.items() if "c" in fs)
        assert a_cluster == b_cluster
        assert c_cluster != a_cluster

    def test_uncorrelated_factors_different_clusters(self):
        corr = np.array([
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        ])
        clusters, _ = cluster_factors(corr, ["a", "b", "c"], threshold=0.3)
        assert len(clusters) == 3

    def test_single_factor(self):
        clusters, linkage = cluster_factors(np.array([[1.0]]), ["a"])
        assert len(clusters) == 1
        assert clusters[1] == ["a"]
        assert linkage == []

    def test_linkage_returned(self):
        corr = np.eye(3)
        _, linkage = cluster_factors(corr, ["a", "b", "c"])
        assert len(linkage) > 0


class TestSelectBestPerCluster:
    def test_selects_highest_gini(self):
        clusters = {1: ["a", "b"], 2: ["c"]}
        ginis = {"a": 0.3, "b": 0.5, "c": 0.4}
        best = select_best_per_cluster(clusters, ginis)
        assert best[1] == "b"
        assert best[2] == "c"

    def test_missing_gini_defaults_zero(self):
        clusters = {1: ["a", "b"]}
        ginis = {"a": 0.3}
        best = select_best_per_cluster(clusters, ginis)
        assert best[1] == "a"
