from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import fcluster, linkage


def compute_spearman_matrix(df: pd.DataFrame, columns: list[str]) -> np.ndarray:
    return df[columns].corr(method="spearman").values


def cluster_factors(
    corr_matrix: np.ndarray, factor_names: list[str],
    threshold: float = 0.5, max_clusters: int | None = None,
) -> tuple[dict[int, list[str]], list[list[float]]]:
    n = len(factor_names)
    if n <= 1:
        return {1: factor_names}, []

    distance = 1 - np.abs(corr_matrix)
    np.fill_diagonal(distance, 0)

    condensed = []
    for i in range(n):
        for j in range(i + 1, n):
            condensed.append(distance[i, j])
    condensed = np.array(condensed)

    Z = linkage(condensed, method="complete")

    if max_clusters is not None and max_clusters < n:
        labels = fcluster(Z, t=max_clusters, criterion="maxclust")
    else:
        labels = fcluster(Z, t=threshold, criterion="distance")

    clusters: dict[int, list[str]] = {}
    for factor, label in zip(factor_names, labels):
        clusters.setdefault(int(label), []).append(factor)

    linkage_list = Z.tolist()
    return clusters, linkage_list


def select_best_per_cluster(
    clusters: dict[int, list[str]], factor_ginis: dict[str, float]
) -> dict[int, str]:
    best = {}
    for cluster_id, factors in clusters.items():
        ranked = sorted(factors, key=lambda f: factor_ginis.get(f, 0), reverse=True)
        best[cluster_id] = ranked[0]
    return best
