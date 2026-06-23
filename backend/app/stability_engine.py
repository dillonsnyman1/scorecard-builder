from __future__ import annotations

import math

import numpy as np
import pandas as pd

from sklearn.metrics import roc_auc_score

from app.shortlist_engine import analyze_factor


def compute_psi(base_dist: np.ndarray, compare_dist: np.ndarray, n_bins: int = 10) -> float:
    if len(base_dist) < 2 or len(compare_dist) < 2:
        return 0.0

    edges = np.percentile(base_dist, np.linspace(0, 100, n_bins + 1))
    edges[0] = -np.inf
    edges[-1] = np.inf
    edges = np.unique(edges)

    base_counts = np.histogram(base_dist, bins=edges)[0].astype(float)
    comp_counts = np.histogram(compare_dist, bins=edges)[0].astype(float)

    base_pct = base_counts / base_counts.sum()
    comp_pct = comp_counts / comp_counts.sum()

    base_pct = np.maximum(base_pct, 0.0001)
    comp_pct = np.maximum(comp_pct, 0.0001)

    psi = float(np.sum((comp_pct - base_pct) * np.log(comp_pct / base_pct)))
    return round(psi, 6)


def assign_periods(dates: pd.Series, period: str = "quarter", bucket_months: int = 3) -> pd.Series:
    dt = pd.to_datetime(dates)
    if period == "year" or bucket_months >= 12:
        return dt.dt.strftime("%Y")
    elif period == "half" or bucket_months >= 6:
        return dt.dt.year.astype(str) + "H" + ((dt.dt.month - 1) // 6 + 1).astype(str)
    elif bucket_months >= 3:
        return dt.dt.to_period("Q").astype(str)
    else:
        return dt.dt.strftime("%Y-%m")


def compute_all_cyclicality(
    period_odrs: list[float],
    period_model_pds: list[float],
    period_labels: list[str],
    stress_period: str | None = None,
    benign_period: str | None = None,
) -> dict:
    results: dict = {}
    odrs = np.array(period_odrs)
    pds = np.array(period_model_pds)
    valid = (odrs > 0) & (pds > 0)

    # 1. Log-log regression
    if valid.sum() >= 3:
        log_odr = np.log(odrs[valid])
        log_pd = np.log(pds[valid])
        if np.std(log_odr) > 1e-10:
            slope = float(np.polyfit(log_odr, log_pd, 1)[0])
            results["log_regression"] = round(slope, 4)

    # 2. Two-point Delta PD / Delta ODR
    if stress_period and benign_period:
        try:
            si = period_labels.index(stress_period)
            bi = period_labels.index(benign_period)
            d_odr = odrs[si] - odrs[bi]
            d_pd = pds[si] - pds[bi]
            if abs(d_odr) > 1e-10:
                results["two_point"] = round(float(d_pd / d_odr), 4)
                results["two_point_periods"] = f"{benign_period} to {stress_period}"
        except (ValueError, IndexError):
            pass
    if "two_point" not in results and valid.sum() >= 2:
        max_i = int(np.argmax(odrs[valid]))
        min_i = int(np.argmin(odrs[valid]))
        valid_idx = np.where(valid)[0]
        d_odr = odrs[valid_idx[max_i]] - odrs[valid_idx[min_i]]
        d_pd = pds[valid_idx[max_i]] - pds[valid_idx[min_i]]
        if abs(d_odr) > 1e-10:
            results["two_point"] = round(float(d_pd / d_odr), 4)
            results["two_point_periods"] = f"{period_labels[valid_idx[min_i]]} to {period_labels[valid_idx[max_i]]}"

    # 3. Coefficient of variation of model PD
    valid_pds = pds[valid]
    if len(valid_pds) >= 2 and np.mean(valid_pds) > 0:
        results["cv_model_pd"] = round(float(np.std(valid_pds) / np.mean(valid_pds)), 4)

    return results


def run_stability_analysis(
    df: pd.DataFrame,
    target_column: str,
    date_column: str,
    factors: list[dict],
    special_values: list[float],
    period: str,
    scores: np.ndarray | None = None,
    model_pds: np.ndarray | None = None,
    stress_period: str | None = None,
    benign_period: str | None = None,
    bucket_months: int = 3,
    date_start: str | None = None,
    date_end: str | None = None,
) -> dict:
    df = df.copy()
    dt = pd.to_datetime(df[date_column])
    date_min = str(dt.min().date())
    date_max = str(dt.max().date())

    if date_start or date_end:
        mask = pd.Series(True, index=df.index)
        if date_start:
            mask = mask & (dt >= pd.Timestamp(date_start))
        if date_end:
            mask = mask & (dt <= pd.Timestamp(date_end))
        df = df.loc[mask].copy()
        if scores is not None:
            scores = scores[mask.values]
        if model_pds is not None:
            model_pds = model_pds[mask.values]

    periods_col = assign_periods(df[date_column], period, bucket_months)
    df["_period"] = periods_col
    target = df[target_column].values.astype(float)

    all_periods = sorted(df["_period"].unique())

    period_metrics = []
    period_scores: dict[str, np.ndarray] = {}
    period_odrs: list[float] = []
    period_model_pds: list[float] = []

    for p in all_periods:
        mask = df["_period"] == p
        tgt = target[mask]
        valid = ~np.isnan(tgt)
        obs = int(valid.sum())
        events = int(np.nansum(tgt))
        er = round(events / obs, 6) if obs > 0 else 0.0

        mean_score = None
        mean_model_pd = None
        if scores is not None:
            p_scores = scores[mask.values]
            valid_scores = p_scores[~np.isnan(p_scores)]
            if len(valid_scores) > 0:
                mean_score = round(float(np.mean(valid_scores)), 1)
                period_scores[p] = valid_scores

        if model_pds is not None:
            p_pds = model_pds[mask.values]
            valid_pds = p_pds[~np.isnan(p_pds)]
            if len(valid_pds) > 0:
                mean_model_pd = round(float(np.mean(valid_pds)), 6)

        period_gini = None
        period_gini_se = None
        if model_pds is not None:
            p_pds_all = model_pds[mask.values]
            p_tgt = tgt[valid]
            p_pds_valid = p_pds_all[valid]
            if len(np.unique(p_tgt)) >= 2 and len(p_pds_valid) >= 10:
                try:
                    auc = roc_auc_score(p_tgt, p_pds_valid)
                    period_gini = round(2 * auc - 1, 4)
                    n1 = int(p_tgt.sum())
                    n0 = len(p_tgt) - n1
                    if n1 > 0 and n0 > 0:
                        q1 = auc / (2 - auc)
                        q2 = 2 * auc * auc / (1 + auc)
                        auc_var = (auc * (1 - auc) + (n1 - 1) * (q1 - auc * auc) + (n0 - 1) * (q2 - auc * auc)) / (n1 * n0)
                        period_gini_se = round(2 * math.sqrt(max(auc_var, 0)), 4)
                except Exception:
                    pass

        period_odrs.append(er)
        period_model_pds.append(mean_model_pd if mean_model_pd is not None else er)

        period_metrics.append({
            "period": p,
            "obs_count": obs,
            "event_count": events,
            "event_rate": er,
            "mean_score": mean_score,
            "mean_model_pd": mean_model_pd,
            "gini": period_gini,
            "gini_se": period_gini_se,
            "psi": None,
        })

    if scores is not None and len(period_scores) > 1:
        all_scores_combined = np.concatenate(list(period_scores.values()))
        score_edges = np.percentile(all_scores_combined, np.linspace(0, 100, 11))
        score_edges[0] = -np.inf
        score_edges[-1] = np.inf
        score_edges = np.unique(score_edges)

        prev_pct = None
        for i, pm in enumerate(period_metrics):
            p = pm["period"]
            curr_scores = period_scores.get(p, np.array([]))
            if len(curr_scores) > 0:
                curr_counts = np.histogram(curr_scores, bins=score_edges)[0].astype(float)
                curr_pct = np.maximum(curr_counts / curr_counts.sum(), 0.0001)
                if prev_pct is None:
                    pm["psi"] = 0.0
                else:
                    pm["psi"] = round(float(np.sum((curr_pct - prev_pct) * np.log(curr_pct / prev_pct))), 6)
                prev_pct = curr_pct

    overall_psi = None
    if scores is not None and len(period_scores) > 1:
        all_scores = np.concatenate(list(period_scores.values()))
        last_period = all_periods[-1]
        if last_period in period_scores and len(all_scores) > 0:
            overall_psi = compute_psi(all_scores, period_scores[last_period])

    factor_stability = []
    for f in factors:
        name = f["factor_name"]
        period_data = []
        for p in all_periods:
            mask = df["_period"] == p
            sub = df.loc[mask]
            if len(sub) < 10:
                continue
            try:
                result = analyze_factor(sub, name, target_column, special_values=special_values)
                period_data.append({
                    "period": p,
                    "iv": result["iv"],
                    "gini": result["gini"],
                    "obs_count": int(mask.sum()),
                })
            except Exception:
                period_data.append({"period": p, "iv": 0.0, "gini": 0.0, "obs_count": int(mask.sum())})
        factor_stability.append({"factor_name": name, "periods": period_data})

    factor_psi = []
    for f in factors:
        name = f["factor_name"]
        edges = sorted(f.get("bin_edges", []))
        if name not in df.columns:
            continue
        try:
            vals = df[name].values.astype(float)
        except (ValueError, TypeError):
            continue

        bin_edges = [-np.inf] + edges + [np.inf]

        def bin_distribution(v: np.ndarray) -> np.ndarray:
            v = v[~np.isnan(v)]
            if len(v) == 0:
                return np.zeros(len(bin_edges) - 1)
            counts = np.histogram(v, bins=bin_edges)[0].astype(float)
            total = counts.sum()
            return counts / total if total > 0 else counts

        base_period = all_periods[0]
        latest_period = all_periods[-1]
        base_dist = bin_distribution(vals[(df["_period"] == base_period).values])
        latest_dist = bin_distribution(vals[(df["_period"] == latest_period).values])

        def psi_between(ref: np.ndarray, comp: np.ndarray) -> float | None:
            if ref.sum() > 0 and comp.sum() > 0:
                r = np.maximum(ref, 0.0001)
                c = np.maximum(comp, 0.0001)
                return round(float(np.sum((c - r) * np.log(c / r))), 6)
            return None

        all_dists = {}
        for p in all_periods:
            all_dists[p] = bin_distribution(vals[(df["_period"] == p).values])

        psi_by_period = []
        for i, p in enumerate(all_periods):
            prev_dist = all_dists[all_periods[i - 1]] if i > 0 else all_dists[p]
            psi_by_period.append({
                "period": p,
                "psi_yoy": psi_between(prev_dist, all_dists[p]) if i > 0 else 0.0,
                "psi_vs_latest": psi_between(latest_dist, all_dists[p]),
            })
        factor_psi.append({"factor_name": name, "periods": psi_by_period})

    cyclicality = compute_all_cyclicality(
        period_odrs, period_model_pds, all_periods,
        stress_period, benign_period,
    )

    return {
        "periods": period_metrics,
        "factor_stability": factor_stability,
        "factor_psi": factor_psi,
        "overall_psi": overall_psi,
        "cyclicality": cyclicality,
        "date_min": date_min,
        "date_max": date_max,
    }
