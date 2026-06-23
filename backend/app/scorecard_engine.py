from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score

from app.shortlist_engine import refine_bins


def woe_transform_dataset(
    df: pd.DataFrame,
    target_column: str,
    factors: list[dict],
    special_values: list[float],
) -> tuple[pd.DataFrame, np.ndarray, dict[str, list[dict]]]:
    sv_set = set(special_values)
    target = df[target_column].values.astype(float)
    valid_mask = ~np.isnan(target)

    woe_columns: dict[str, np.ndarray] = {}
    factor_bins_map: dict[str, list[dict]] = {}

    for f in factors:
        name = f["factor_name"]
        edges = sorted(f["bin_edges"])
        values = df[name].values.astype(float)

        bins_data, _, _, _, _ = refine_bins(values, target, edges, special_values)
        factor_bins_map[name] = bins_data

        regular = [b for b in bins_data if not b.get("is_special", False)]
        special = [b for b in bins_data if b.get("is_special", False)]

        missing_woe = 0.0
        special_woe_map: dict[float, float] = {}
        for b in special:
            if b["bin_label"] == "Missing":
                missing_woe = b["woe"]
            else:
                for sv in sv_set:
                    if str(sv) in b["bin_label"] or f"{sv:g}" in b["bin_label"]:
                        special_woe_map[sv] = b["woe"]

        bin_edges_full = [-np.inf] + edges + [np.inf]
        bin_woe_map: list[tuple[float, float, float]] = []
        for i, b in enumerate(regular):
            lo = bin_edges_full[i]
            hi = bin_edges_full[i + 1] if i + 1 < len(bin_edges_full) else np.inf
            bin_woe_map.append((lo, hi, b["woe"]))

        woe_col = np.zeros(len(values))
        for idx in range(len(values)):
            v = values[idx]
            if np.isnan(v):
                woe_col[idx] = missing_woe
            elif v in sv_set:
                woe_col[idx] = special_woe_map.get(v, 0.0)
            else:
                assigned = False
                for lo, hi, woe in bin_woe_map:
                    if (lo == -np.inf and v <= hi) or (lo < v <= hi):
                        woe_col[idx] = woe
                        assigned = True
                        break
                if not assigned:
                    woe_col[idx] = 0.0

        woe_columns[name] = woe_col

    woe_df = pd.DataFrame(woe_columns)
    factor_names = [f["factor_name"] for f in factors]

    woe_matrix = woe_df.loc[valid_mask, factor_names].values
    target_clean = target[valid_mask]

    return woe_df, target_clean, factor_bins_map


def _get_p_values(woe_matrix: np.ndarray, target: np.ndarray, names: list[str]) -> dict[str, float]:
    try:
        import statsmodels.api as sm
        X_const = sm.add_constant(woe_matrix)
        model = sm.Logit(target, X_const).fit(disp=0, maxiter=1000)
        pvals = model.pvalues[1:]
        return {names[i]: float(pvals[i]) for i in range(min(len(names), len(pvals)))}
    except Exception:
        return {n: 1.0 for n in names}


def _lasso_selection(
    woe_df: pd.DataFrame,
    target: np.ndarray,
    factor_names: list[str],
    max_factors: int | None = None,
) -> tuple[list[str], list[dict]]:
    from sklearn.linear_model import LogisticRegressionCV

    lr = LogisticRegressionCV(
        penalty="l1", solver="saga", cv=5, max_iter=2000,
        random_state=42, scoring="roc_auc",
    )
    lr.fit(woe_df[factor_names].values, target)

    coefs = lr.coef_[0]
    factor_coefs = list(zip(factor_names, coefs))
    nonzero = [(n, c) for n, c in factor_coefs if abs(c) > 1e-6]
    nonzero.sort(key=lambda x: abs(x[1]), reverse=True)

    if max_factors and len(nonzero) > max_factors:
        nonzero = nonzero[:max_factors]

    selected = [n for n, _ in nonzero]
    log: list[dict] = []
    step = 0

    for n, c in nonzero:
        step += 1
        log.append({"step": step, "action": "Selected", "factor_name": n,
                     "p_value": None, "reason": f"LASSO coefficient {c:.4f}"})

    for n, c in factor_coefs:
        if n not in selected:
            step += 1
            reason = "Coefficient shrunk to zero by LASSO" if abs(c) <= 1e-6 else f"Below max factors limit"
            log.append({"step": step, "action": "Removed", "factor_name": n,
                         "p_value": None, "reason": reason})

    return selected, log


def factor_selection(
    woe_df: pd.DataFrame,
    target: np.ndarray,
    factor_names: list[str],
    method: str = "stepwise",
    p_enter: float = 0.05,
    p_remove: float = 0.05,
    max_factors: int | None = None,
) -> tuple[list[str], list[dict]]:
    log: list[dict] = []
    step_num = 0

    if method == "all":
        selected = list(factor_names)
        if max_factors and len(selected) > max_factors:
            pvals = _get_p_values(woe_df[selected].values, target, selected)
            ranked = sorted(selected, key=lambda n: pvals.get(n, 1.0))
            dropped = ranked[max_factors:]
            selected = ranked[:max_factors]
            for f in dropped:
                step_num += 1
                log.append({"step": step_num, "action": "Removed", "factor_name": f,
                            "p_value": round(pvals.get(f, 1.0), 6), "reason": f"Max factors ({max_factors}) exceeded"})
        return selected, log

    if method == "lasso":
        return _lasso_selection(woe_df, target, factor_names, max_factors)

    if method == "backward":
        selected = list(factor_names)
    else:
        selected = []

    remaining = set(factor_names) - set(selected)
    changed = True

    while changed:
        changed = False

        if method in ("forward", "stepwise"):
            best_factor = None
            best_p = 1.0
            for candidate in remaining:
                trial = selected + [candidate]
                if max_factors and len(trial) > max_factors:
                    continue
                pvals = _get_p_values(woe_df[trial].values, target, trial)
                p = pvals.get(candidate, 1.0)
                if p < best_p:
                    best_p = p
                    best_factor = candidate
            if best_factor and best_p < p_enter:
                selected.append(best_factor)
                remaining.discard(best_factor)
                step_num += 1
                log.append({"step": step_num, "action": "Added", "factor_name": best_factor,
                            "p_value": round(best_p, 6), "reason": f"p-value {best_p:.4f} < {p_enter}"})
                changed = True

        if method in ("backward", "stepwise") and len(selected) > 1:
            pvals = _get_p_values(woe_df[selected].values, target, selected)
            worst_factor = max(selected, key=lambda n: pvals.get(n, 0.0))
            worst_p = pvals.get(worst_factor, 0.0)
            if worst_p > p_remove:
                selected.remove(worst_factor)
                remaining.add(worst_factor)
                step_num += 1
                log.append({"step": step_num, "action": "Removed", "factor_name": worst_factor,
                            "p_value": round(worst_p, 6), "reason": f"p-value {worst_p:.4f} > {p_remove}"})
                changed = True

        if max_factors and len(selected) >= max_factors and method in ("forward", "stepwise"):
            if method == "forward":
                break

    dropped_in_stepwise = set(factor_names) - set(selected)
    for f in dropped_in_stepwise:
        if not any(entry["factor_name"] == f for entry in log):
            step_num += 1
            log.append({"step": step_num, "action": "Not entered", "factor_name": f,
                        "p_value": None, "reason": "Did not meet entry criteria"})

    return selected, log


def fit_logistic_regression(
    woe_matrix: np.ndarray,
    target: np.ndarray,
    factor_names: list[str],
) -> tuple[np.ndarray, float, dict[str, float | None]]:
    lr = LogisticRegression(C=np.inf, solver="lbfgs", max_iter=1000, random_state=42)
    lr.fit(woe_matrix, target)

    coefficients = lr.coef_[0]
    intercept = float(lr.intercept_[0])

    p_values: dict[str, float | None] = {}
    try:
        import statsmodels.api as sm
        X_const = sm.add_constant(woe_matrix)
        logit_model = sm.Logit(target, X_const).fit(disp=0, maxiter=1000)
        pvals = logit_model.pvalues[1:]
        for i, name in enumerate(factor_names):
            p_values[name] = round(float(pvals[i]), 6) if i < len(pvals) else None
    except Exception:
        for name in factor_names:
            p_values[name] = None

    return coefficients, intercept, p_values


def compute_model_metrics(
    model: LogisticRegression,
    woe_matrix: np.ndarray,
    target: np.ndarray,
) -> tuple[float, float, float]:
    proba = model.predict_proba(woe_matrix)[:, 1]

    auc = roc_auc_score(target, proba)
    gini = 2 * auc - 1

    events = proba[target == 1]
    non_events = proba[target == 0]
    thresholds = np.sort(np.unique(proba))
    max_ks = 0.0
    for t in thresholds:
        tpr = np.mean(events <= t)
        fpr = np.mean(non_events <= t)
        ks = abs(tpr - fpr)
        if ks > max_ks:
            max_ks = ks

    return round(auc, 6), round(gini, 6), round(max_ks, 6)


def compute_scorecard_points(
    coefficients: np.ndarray,
    intercept: float,
    factor_bins: dict[str, list[dict]],
    factor_names: list[str],
    base_score: float,
    base_odds: float,
    pdo: int,
    woe_df: pd.DataFrame,
    target: np.ndarray,
    round_points: bool = False,
) -> tuple[list[dict], float, float, float, float, float, list[dict]]:
    n_factors = len(factor_names)
    scaling_factor = pdo / math.log(2)
    scaling_offset = base_score - scaling_factor * math.log(base_odds)
    intercept_share = intercept / n_factors

    factors_result = []

    for i, name in enumerate(factor_names):
        coef = float(coefficients[i])
        bins_data = factor_bins[name]

        regular_idx = 0
        special_idx = 0
        bin_points = []

        for b in bins_data:
            woe = b["woe"]
            raw = coef * woe + intercept_share
            pts = -raw * scaling_factor + scaling_offset / n_factors
            points = round(pts) if round_points else round(pts, 1)

            if b.get("is_special", False):
                special_idx += 1
                group = f"S{special_idx}"
            else:
                regular_idx += 1
                group = str(regular_idx)

            bin_points.append({
                "group": group,
                "bin_label": b["bin_label"],
                "woe": round(woe, 6),
                "points": points,
                "count": b["count"],
                "event_rate": b["event_rate"],
            })

        factors_result.append({
            "factor_name": name,
            "coefficient": round(coef, 6),
            "bins": bin_points,
        })

    valid_mask = ~pd.isna(woe_df[factor_names[0]])
    scores = np.zeros(int(valid_mask.sum()))
    for i, name in enumerate(factor_names):
        coef = float(coefficients[i])
        woe_vals = woe_df.loc[valid_mask, name].values
        raw = coef * woe_vals + intercept_share
        scores += -raw * scaling_factor + scaling_offset / n_factors

    if round_points:
        scores = np.round(scores)

    total_min = float(scores.min()) if len(scores) > 0 else 0.0
    total_max = float(scores.max()) if len(scores) > 0 else 0.0

    band_size = pdo
    if len(scores) > 0:
        lo = math.floor(total_min / band_size) * band_size
        hi = math.ceil(total_max / band_size) * band_size
        bands = list(range(lo, hi + band_size, band_size))
        distribution = []
        total = len(scores)
        for j in range(len(bands) - 1):
            count = int(((scores >= bands[j]) & (scores < bands[j + 1])).sum())
            distribution.append({
                "band": f"{bands[j]}-{bands[j + 1]}",
                "count": count,
                "pct": round(count / total * 100, 2) if total > 0 else 0,
            })
        last_count = int((scores >= bands[-1]).sum()) if len(bands) > 0 else 0
        if last_count > 0:
            distribution[-1]["count"] += last_count
            distribution[-1]["pct"] = round(distribution[-1]["count"] / total * 100, 2)
    else:
        distribution = []

    return (
        factors_result,
        round(scaling_factor, 6),
        round(scaling_offset, 6),
        round(total_min, 1),
        round(total_max, 1),
        round(scaling_offset, 1),
        distribution,
    )


def fit_scorecard(
    df: pd.DataFrame,
    target_column: str,
    factors: list[dict],
    special_values: list[float],
    base_score: float,
    base_odds: float,
    pdo: int,
    stepwise_method: str = "both",
    p_value_enter: float = 0.05,
    p_value_remove: float = 0.05,
    max_factors: int | None = None,
    forced_factors: list[str] | None = None,
    max_corr: float | None = None,
    round_points: bool = False,
    efw_method: str = "range",
    efw_threshold: float = 0.0,
) -> dict:
    all_factor_names = [f["factor_name"] for f in factors]
    forced = set(forced_factors or [])

    woe_df, target_clean, factor_bins = woe_transform_dataset(
        df, target_column, factors, special_values,
    )

    valid_mask = ~pd.isna(woe_df[all_factor_names[0]])
    woe_valid = woe_df.loc[valid_mask].copy()

    candidate_names = [n for n in all_factor_names if n not in forced]

    selected_names, stepwise_log = factor_selection(
        woe_valid, target_clean, candidate_names,
        method=stepwise_method, p_enter=p_value_enter, p_remove=p_value_remove,
        max_factors=max_factors - len(forced) if max_factors else None,
    )

    for f_name in forced:
        if f_name not in selected_names:
            selected_names.insert(0, f_name)
            stepwise_log.insert(0, {"step": 0, "action": "Forced", "factor_name": f_name,
                                    "p_value": None, "reason": "User-specified forced inclusion"})

    if max_corr is not None and max_corr < 1.0:
        changed = True
        while changed:
            changed = False
            corr_matrix = woe_valid[selected_names].corr(method="spearman").abs()
            for i in range(len(selected_names)):
                for j in range(i + 1, len(selected_names)):
                    if corr_matrix.iloc[i, j] > max_corr:
                        ni, nj = selected_names[i], selected_names[j]
                        if nj in forced:
                            drop, keep = ni, nj
                        elif ni in forced:
                            drop, keep = nj, ni
                        else:
                            drop, keep = nj, ni
                        stepwise_log.append({
                            "step": len(stepwise_log) + 1, "action": "Removed",
                            "factor_name": drop, "p_value": None,
                            "reason": f"WoE correlation {corr_matrix.iloc[i, j]:.2f} with {keep} exceeds {max_corr}",
                        })
                        selected_names.remove(drop)
                        changed = True
                        break
                if changed:
                    break

    if len(selected_names) == 0:
        selected_names = all_factor_names[:1]
        stepwise_log.append({"step": len(stepwise_log) + 1, "action": "Fallback",
                             "factor_name": selected_names[0], "p_value": None,
                             "reason": "No factors met criteria, kept top factor"})

    dropped = [n for n in all_factor_names if n not in selected_names]

    woe_matrix = woe_valid[selected_names].values

    coefficients, intercept, p_values = fit_logistic_regression(
        woe_matrix, target_clean, selected_names,
    )

    lr = LogisticRegression(C=np.inf, solver="lbfgs", max_iter=1000, random_state=42)
    lr.fit(woe_matrix, target_clean)
    auc, gini, ks = compute_model_metrics(lr, woe_matrix, target_clean)

    factors_result, scaling_factor, scaling_offset, total_min, total_max, base_points, distribution = \
        compute_scorecard_points(
            coefficients, intercept, factor_bins, selected_names,
            base_score, base_odds, pdo, woe_df, target_clean, round_points,
        )

    if efw_threshold > 0 and len(selected_names) > 1:
        forced_set = set(forced or [])
        for _ in range(len(selected_names)):
            efw = {}
            for i, name in enumerate(selected_names):
                coef = float(coefficients[i])
                woe_vals = [b["woe"] for b in factor_bins[name] if not b.get("is_special", False)]

                if efw_method == "coefficient":
                    efw[name] = abs(coef)
                elif efw_method == "variance":
                    woe_std = float(np.std(woe_vals)) if len(woe_vals) > 1 else 0
                    efw[name] = abs(coef) * woe_std
                else:
                    fr = next((f for f in factors_result if f["factor_name"] == name), None)
                    if fr:
                        bin_pts = [b["points"] for b in fr["bins"]]
                        efw[name] = max(bin_pts) - min(bin_pts) if bin_pts else 0
                    else:
                        efw[name] = 0

            total_efw = sum(efw.values()) or 1
            efw_pct = {n: (v / total_efw) * 100 for n, v in efw.items()}

            below = [n for n in selected_names if efw_pct.get(n, 0) < efw_threshold and n not in forced_set]
            if not below:
                break

            worst = min(below, key=lambda n: efw_pct.get(n, 0))
            selected_names.remove(worst)
            stepwise_log.append({
                "step": len(stepwise_log) + 1, "action": "Removed",
                "factor_name": worst, "p_value": None,
                "reason": f"Effective weight {efw_pct.get(worst, 0):.1f}% below threshold {efw_threshold}% ({efw_method})",
            })

            if len(selected_names) < 2:
                break

            woe_matrix = woe_valid[selected_names].values
            coefficients, intercept, p_values = fit_logistic_regression(woe_matrix, target_clean, selected_names)
            lr = LogisticRegression(C=np.inf, solver="lbfgs", max_iter=1000, random_state=42)
            lr.fit(woe_matrix, target_clean)
            auc, gini, ks = compute_model_metrics(lr, woe_matrix, target_clean)
            factors_result, scaling_factor, scaling_offset, total_min, total_max, base_points, distribution = \
                compute_scorecard_points(
                    coefficients, intercept, factor_bins, selected_names,
                    base_score, base_odds, pdo, woe_df, target_clean, round_points,
                )

        dropped = [n for n in all_factor_names if n not in selected_names]

    vif_values: dict[str, float] = {}
    if len(selected_names) > 1:
        try:
            from statsmodels.stats.outliers_influence import variance_inflation_factor
            woe_sel = woe_valid[selected_names].values
            for i, name in enumerate(selected_names):
                vif_values[name] = round(float(variance_inflation_factor(woe_sel, i)), 2)
        except Exception:
            pass

    for fr in factors_result:
        fr["p_value"] = p_values.get(fr["factor_name"])
        fr["vif"] = vif_values.get(fr["factor_name"])

    negative_coefs = [fr["factor_name"] for fr in factors_result if fr["coefficient"] > 0]

    return {
        "factors": factors_result,
        "intercept": round(intercept, 6),
        "base_points": base_points,
        "scaling_factor": scaling_factor,
        "scaling_offset": scaling_offset,
        "auc": auc,
        "gini": gini,
        "ks_statistic": ks,
        "total_min_score": total_min,
        "total_max_score": total_max,
        "score_distribution": distribution,
        "stepwise_log": stepwise_log,
        "dropped_factors": dropped,
        "negative_coefficients": negative_coefs,
    }
