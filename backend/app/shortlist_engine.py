from __future__ import annotations

import math

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.tree import DecisionTreeClassifier

COMMON_SPECIALS = [-999.0, 9999.0]


def profile_dataframe(
    df: pd.DataFrame, special_values: list[float] | None = None
) -> tuple[list[dict], list[dict]]:
    sv = set(special_values or COMMON_SPECIALS)
    profiles = []
    detected_specials = []

    for col in df.columns:
        series = df[col]
        missing = int(series.isna().sum())

        special_counts: dict[str, int] = {}
        if pd.api.types.is_numeric_dtype(series):
            for v in sv:
                cnt = int((series == v).sum())
                if cnt > 0:
                    special_counts[str(v)] = cnt

        if special_counts:
            detected_specials.append({
                "column": col,
                "values": [float(k) for k in special_counts],
                "counts": list(special_counts.values()),
            })

        samples = series.dropna().unique()[:5]
        profiles.append({
            "name": col,
            "dtype": "numeric" if pd.api.types.is_numeric_dtype(series) else "categorical",
            "missing_count": missing,
            "missing_pct": round(missing / len(df) * 100, 2) if len(df) > 0 else 0.0,
            "unique_count": int(series.nunique()),
            "sample_values": [str(v) for v in samples],
            "special_value_counts": special_counts,
        })
    return profiles, detected_specials


def _separate_special_and_missing(
    values: np.ndarray, target: np.ndarray, special_values: list[float]
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Split into (clean_vals, clean_tgt, missing_tgt, special_vals, special_tgt, special_indicators)."""
    sv_set = set(special_values)
    is_nan = np.isnan(values) | np.isnan(target)
    is_special = np.array([v in sv_set for v in values]) & ~is_nan

    clean_mask = ~is_nan & ~is_special
    missing_mask = np.isnan(values) & ~np.isnan(target)

    return (
        values[clean_mask], target[clean_mask],
        target[missing_mask],
        values[is_special], target[is_special],
        values[missing_mask],
    )


def _make_special_bins(
    special_vals: np.ndarray,
    special_tgt: np.ndarray,
    missing_tgt: np.ndarray,
    total_events: int,
    total_non_events: int,
) -> list[dict]:
    """Create separate bins for each special value and for missing."""
    bins = []

    if len(missing_tgt) > 0:
        count = len(missing_tgt)
        event_count = int(missing_tgt.sum())
        non_event_count = count - event_count
        pct_e = event_count / total_events if total_events > 0 else 0
        pct_ne = non_event_count / total_non_events if total_non_events > 0 else 0
        woe = math.log(max(pct_ne, 0.0001) / max(pct_e, 0.0001))
        iv_c = (pct_ne - pct_e) * woe
        bins.append({
            "bin_label": "Missing",
            "lower": None, "upper": None,
            "count": count, "event_count": event_count,
            "event_rate": round(event_count / count, 6) if count > 0 else 0.0,
            "non_event_count": non_event_count,
            "woe": round(woe, 6), "iv_contribution": round(iv_c, 6),
            "pct_events": round(pct_e, 6), "pct_non_events": round(pct_ne, 6),
            "is_special": True,
        })

    for sv in sorted(set(special_vals)):
        mask = special_vals == sv
        tgt = special_tgt[mask]
        count = int(mask.sum())
        event_count = int(tgt.sum())
        non_event_count = count - event_count
        pct_e = event_count / total_events if total_events > 0 else 0
        pct_ne = non_event_count / total_non_events if total_non_events > 0 else 0
        woe = math.log(max(pct_ne, 0.0001) / max(pct_e, 0.0001))
        iv_c = (pct_ne - pct_e) * woe
        label = f"Special ({sv:g})"
        bins.append({
            "bin_label": label,
            "lower": None, "upper": None,
            "count": count, "event_count": event_count,
            "event_rate": round(event_count / count, 6) if count > 0 else 0.0,
            "non_event_count": non_event_count,
            "woe": round(woe, 6), "iv_contribution": round(iv_c, 6),
            "pct_events": round(pct_e, 6), "pct_non_events": round(pct_ne, 6),
            "is_special": True,
        })

    return bins


def auto_bin_numeric(
    values: np.ndarray, target: np.ndarray, max_bins: int = 10, method: str = "tree"
) -> list[float]:
    mask = ~(np.isnan(values) | np.isnan(target))
    vals = values[mask].reshape(-1, 1)
    tgt = target[mask]

    if len(np.unique(vals)) <= 1:
        return []

    if method == "tree":
        effective_bins = min(max_bins, len(np.unique(vals)))
        tree = DecisionTreeClassifier(max_leaf_nodes=effective_bins, random_state=42)
        tree.fit(vals, tgt)
        thresholds = sorted(set(tree.tree_.threshold[tree.tree_.threshold != -2]))
        return thresholds
    else:
        quantiles = np.linspace(0, 100, max_bins + 1)[1:-1]
        edges = list(np.unique(np.percentile(vals, quantiles)))
        return edges


def compute_woe_iv(
    values: np.ndarray, target: np.ndarray, bin_edges: list[float]
) -> tuple[list[dict], float]:
    mask = ~(np.isnan(values) | np.isnan(target))
    vals = values[mask]
    tgt = target[mask]

    total_events = int(tgt.sum())
    total_non_events = int(len(tgt) - total_events)

    if total_events == 0 or total_non_events == 0:
        return [], 0.0

    all_edges = [-np.inf] + sorted(bin_edges) + [np.inf]
    bins_data = []
    total_iv = 0.0

    for i in range(len(all_edges) - 1):
        lo, hi = all_edges[i], all_edges[i + 1]
        in_bin = (vals > lo) & (vals <= hi) if lo != -np.inf else (vals <= hi)

        bin_target = tgt[in_bin]
        count = int(in_bin.sum())
        event_count = int(bin_target.sum())
        non_event_count = count - event_count

        pct_events = event_count / total_events if total_events > 0 else 0
        pct_non_events = non_event_count / total_non_events if total_non_events > 0 else 0

        pct_events_adj = max(pct_events, 0.0001)
        pct_non_events_adj = max(pct_non_events, 0.0001)

        woe = math.log(pct_non_events_adj / pct_events_adj)
        iv_contrib = (pct_non_events - pct_events) * woe

        lo_label = f"{lo:.2f}" if lo != -np.inf else "-inf"
        hi_label = f"{hi:.2f}" if hi != np.inf else "+inf"

        bins_data.append({
            "bin_label": f"({lo_label}, {hi_label}]",
            "lower": None if lo == -np.inf else float(lo),
            "upper": None if hi == np.inf else float(hi),
            "count": count, "event_count": event_count,
            "event_rate": round(event_count / count, 6) if count > 0 else 0.0,
            "non_event_count": non_event_count,
            "woe": round(woe, 6), "iv_contribution": round(iv_contrib, 6),
            "pct_events": round(pct_events, 6), "pct_non_events": round(pct_non_events, 6),
            "is_special": False,
        })
        total_iv += iv_contrib

    return bins_data, round(total_iv, 6)


def compute_gini(values: np.ndarray, target: np.ndarray) -> float:
    mask = ~(np.isnan(values) | np.isnan(target))
    vals = values[mask].reshape(-1, 1)
    tgt = target[mask]

    if len(np.unique(tgt)) < 2 or len(np.unique(vals)) < 2:
        return 0.0

    try:
        lr = LogisticRegression(solver="lbfgs", max_iter=1000, random_state=42)
        lr.fit(vals, tgt)
        proba = lr.predict_proba(vals)[:, 1]
        auc = roc_auc_score(tgt, proba)
        return round(2 * auc - 1, 6)
    except Exception:
        return 0.0


def compute_woe_iv_categorical(
    values: np.ndarray, target: np.ndarray
) -> tuple[list[dict], float]:
    mask = pd.notna(values) & ~np.isnan(target)
    vals = values[mask]
    tgt = target[mask]

    total_events = int(tgt.sum())
    total_non_events = int(len(tgt) - total_events)

    if total_events == 0 or total_non_events == 0:
        return [], 0.0

    # Missing bin for categoricals
    missing_mask = pd.isna(values) & ~np.isnan(target)
    missing_tgt = target[missing_mask]
    bins_data = []
    total_iv = 0.0

    if len(missing_tgt) > 0:
        count = len(missing_tgt)
        ec = int(missing_tgt.sum())
        nec = count - ec
        pe = ec / total_events if total_events > 0 else 0
        pne = nec / total_non_events if total_non_events > 0 else 0
        woe = math.log(max(pne, 0.0001) / max(pe, 0.0001))
        iv_c = (pne - pe) * woe
        bins_data.append({
            "bin_label": "Missing",
            "lower": None, "upper": None,
            "count": count, "event_count": ec,
            "event_rate": round(ec / count, 6) if count > 0 else 0.0,
            "non_event_count": nec,
            "woe": round(woe, 6), "iv_contribution": round(iv_c, 6),
            "pct_events": round(pe, 6), "pct_non_events": round(pne, 6),
            "is_special": True,
        })
        total_iv += iv_c

    categories = sorted(set(vals))
    for cat in categories:
        in_bin = vals == cat
        bin_target = tgt[in_bin]
        count = int(in_bin.sum())
        event_count = int(bin_target.sum())
        non_event_count = count - event_count

        pct_events = event_count / total_events
        pct_non_events = non_event_count / total_non_events

        pct_events_adj = max(pct_events, 0.0001)
        pct_non_events_adj = max(pct_non_events, 0.0001)

        woe = math.log(pct_non_events_adj / pct_events_adj)
        iv_contrib = (pct_non_events - pct_events) * woe

        bins_data.append({
            "bin_label": str(cat),
            "lower": None, "upper": None,
            "count": count, "event_count": event_count,
            "event_rate": round(event_count / count, 6) if count > 0 else 0.0,
            "non_event_count": non_event_count,
            "woe": round(woe, 6), "iv_contribution": round(iv_contrib, 6),
            "pct_events": round(pct_events, 6), "pct_non_events": round(pct_non_events, 6),
            "is_special": False,
        })
        total_iv += iv_contrib

    return bins_data, round(total_iv, 6)


def compute_gini_categorical(values: np.ndarray, target: np.ndarray) -> float:
    mask = pd.notna(values) & ~np.isnan(target)
    vals = values[mask]
    tgt = target[mask]

    if len(np.unique(tgt)) < 2 or len(np.unique(vals)) < 2:
        return 0.0

    woe_map = {}
    total_events = tgt.sum()
    total_non_events = len(tgt) - total_events

    if total_events == 0 or total_non_events == 0:
        return 0.0

    for cat in set(vals):
        in_bin = vals == cat
        e = max(tgt[in_bin].sum() / total_events, 0.0001)
        ne = max((in_bin.sum() - tgt[in_bin].sum()) / total_non_events, 0.0001)
        woe_map[cat] = math.log(ne / e)

    woe_encoded = np.array([woe_map[v] for v in vals]).reshape(-1, 1)
    return compute_gini(woe_encoded.flatten(), tgt)


def analyze_factor(
    df: pd.DataFrame, factor: str, target: str,
    max_bins: int = 10, method: str = "tree",
    special_values: list[float] | None = None,
) -> dict:
    sv = special_values if special_values is not None else COMMON_SPECIALS
    target_values = df[target].values.astype(float)
    is_numeric = pd.api.types.is_numeric_dtype(df[factor])

    if is_numeric:
        raw_values = df[factor].values.astype(float)

        clean_vals, clean_tgt, missing_tgt, special_vals, special_tgt, _ = \
            _separate_special_and_missing(raw_values, target_values, sv)

        total_events = int(target_values[~np.isnan(target_values)].sum())
        total_non_events = int((~np.isnan(target_values)).sum() - total_events)
        missing_count = int(np.isnan(raw_values).sum())
        special_count = int(sum(1 for v in raw_values if v in set(sv) and not np.isnan(v)))

        special_bins = _make_special_bins(
            special_vals, special_tgt, missing_tgt, total_events, total_non_events
        )

        if len(clean_vals) > 0 and len(np.unique(clean_tgt)) >= 2:
            bin_edges = auto_bin_numeric(clean_vals, clean_tgt, max_bins, method)
            regular_bins, regular_iv = compute_woe_iv(clean_vals, clean_tgt, bin_edges)
            gini = compute_gini(clean_vals, clean_tgt)
        else:
            regular_bins, regular_iv = [], 0.0
            gini = 0.0

        all_bins = regular_bins + special_bins
        total_iv = regular_iv + sum(b["iv_contribution"] for b in special_bins)

        return {
            "factor_name": factor,
            "dtype": "numeric",
            "iv": round(total_iv, 6),
            "gini": gini,
            "bins": all_bins,
            "missing_count": missing_count,
            "special_count": special_count,
        }
    else:
        factor_values = df[factor].values
        bins_data, iv = compute_woe_iv_categorical(factor_values, target_values)
        gini = compute_gini_categorical(factor_values, target_values)
        missing_count = int(pd.isna(factor_values).sum())

        return {
            "factor_name": factor,
            "dtype": "categorical",
            "iv": iv,
            "gini": gini,
            "bins": bins_data,
            "missing_count": missing_count,
            "special_count": 0,
        }


def analyze_all_factors(
    df: pd.DataFrame, target: str, max_bins: int = 10, method: str = "tree",
    special_values: list[float] | None = None,
) -> list[dict]:
    factors = [col for col in df.columns if col != target]
    results = []
    for factor in factors:
        result = analyze_factor(df, factor, target, max_bins, method, special_values)
        results.append(result)
    results.sort(key=lambda x: x["gini"], reverse=True)
    return results


def refine_bins(
    values: np.ndarray, target: np.ndarray, bin_edges: list[float],
    special_values: list[float] | None = None,
) -> tuple[list[dict], float, float, float | None, float | None]:
    sv = special_values if special_values is not None else COMMON_SPECIALS

    clean_vals, clean_tgt, missing_tgt, special_vals, special_tgt, _ = \
        _separate_special_and_missing(values, target, sv)

    total_events = int(target[~np.isnan(target)].sum())
    total_non_events = int((~np.isnan(target)).sum() - total_events)

    special_bins = _make_special_bins(
        special_vals, special_tgt, missing_tgt, total_events, total_non_events
    )

    data_min = float(clean_vals.min()) if len(clean_vals) > 0 else None
    data_max = float(clean_vals.max()) if len(clean_vals) > 0 else None

    if len(clean_vals) > 0 and len(np.unique(clean_tgt)) >= 2:
        regular_bins, regular_iv = compute_woe_iv(clean_vals, clean_tgt, bin_edges)
        gini = compute_gini(clean_vals, clean_tgt)
    else:
        regular_bins, regular_iv = [], 0.0
        gini = 0.0

    all_bins = regular_bins + special_bins
    total_iv = regular_iv + sum(b["iv_contribution"] for b in special_bins)

    return all_bins, round(total_iv, 6), gini, data_min, data_max


def enforce_monotonicity(
    bins_data: list[dict], direction: str = "auto"
) -> list[dict]:
    regular = [b for b in bins_data if not b.get("is_special", False)]
    specials = [b for b in bins_data if b.get("is_special", False)]

    if len(regular) <= 1:
        return regular + specials

    if direction == "u_shaped":
        return _enforce_u_shaped(regular) + specials

    if direction == "auto":
        woe_values = [b["woe"] for b in regular]
        inc_violations = sum(1 for i in range(1, len(woe_values)) if woe_values[i] < woe_values[i - 1])
        dec_violations = sum(1 for i in range(1, len(woe_values)) if woe_values[i] > woe_values[i - 1])
        direction = "increasing" if inc_violations <= dec_violations else "decreasing"

    result = _enforce_direction(regular, direction)
    return result + specials


def _enforce_direction(bins: list[dict], direction: str) -> list[dict]:
    merged = True
    result = list(bins)

    while merged and len(result) > 1:
        merged = False
        i = 0
        new_result = []
        while i < len(result):
            if i + 1 < len(result):
                violates = (
                    (direction == "increasing" and result[i + 1]["woe"] < result[i]["woe"])
                    or (direction == "decreasing" and result[i + 1]["woe"] > result[i]["woe"])
                )
                if violates:
                    combined = _merge_two_bins(result[i], result[i + 1])
                    new_result.append(combined)
                    i += 2
                    merged = True
                    continue
            new_result.append(result[i])
            i += 1
        result = new_result

    return result


def _enforce_u_shaped(bins: list[dict]) -> list[dict]:
    if len(bins) <= 2:
        return bins

    best_result = bins
    best_violations = len(bins)

    for split in range(1, len(bins)):
        left = _enforce_direction(bins[:split], "decreasing")
        right = _enforce_direction(bins[split:], "increasing")
        candidate = left + right
        violations = _count_u_violations(candidate)
        if violations < best_violations:
            best_violations = violations
            best_result = candidate

    return best_result


def _count_u_violations(bins: list[dict]) -> int:
    if len(bins) <= 1:
        return 0
    woe = [b["woe"] for b in bins]
    min_idx = woe.index(min(woe))
    violations = 0
    for i in range(1, min_idx + 1):
        if woe[i] > woe[i - 1]:
            violations += 1
    for i in range(min_idx + 1, len(woe)):
        if woe[i] < woe[i - 1]:
            violations += 1
    return violations


def _merge_two_bins(a: dict, b: dict) -> dict:
    count = a["count"] + b["count"]
    event_count = a["event_count"] + b["event_count"]
    non_event_count = count - event_count
    pct_events = a["pct_events"] + b["pct_events"]
    pct_non_events = a["pct_non_events"] + b["pct_non_events"]

    pct_events_adj = max(pct_events, 0.0001)
    pct_non_events_adj = max(pct_non_events, 0.0001)
    woe = math.log(pct_non_events_adj / pct_events_adj)
    iv_contribution = (pct_non_events - pct_events) * woe

    lower = a["lower"]
    upper = b["upper"]
    lo_label = f"{lower:.2f}" if lower is not None else "-inf"
    hi_label = f"{upper:.2f}" if upper is not None else "+inf"

    return {
        "bin_label": f"({lo_label}, {hi_label}]",
        "lower": lower, "upper": upper,
        "count": count, "event_count": event_count,
        "event_rate": round(event_count / count, 6) if count > 0 else 0.0,
        "non_event_count": non_event_count,
        "woe": round(woe, 6), "iv_contribution": round(iv_contribution, 6),
        "pct_events": round(pct_events, 6), "pct_non_events": round(pct_non_events, 6),
        "is_special": False,
    }
