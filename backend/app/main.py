from __future__ import annotations

import io
import os
import time
import uuid
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.cluster_engine import cluster_factors, compute_spearman_matrix, select_best_per_cluster
from app.models import (
    BinDetail,
    ClusterFactor,
    ClusterRequest,
    ClusterResponse,
    ClusterResult,
    DetectedSpecials,
    ExportRequest,
    FactorAnalysis,
    RefineBinsRequest,
    RefineBinsResponse,
    SampleDataResponse,
    ScorecardRequest,
    ScorecardResponse,
    StabilityRequest,
    StabilityResponse,
    UnivariateRequest,
    UnivariateResponse,
    UploadResponse,
)
from app.shortlist_engine import (
    analyze_all_factors,
    compute_gini,
    enforce_monotonicity,
    profile_dataframe,
    refine_bins as engine_refine_bins,
)

SAMPLE_DATA_PATH = Path(__file__).parent / "sample_data" / "sample_factors.csv"
SAMPLE_METADATA_PATH = Path(__file__).parent / "sample_data" / "sample_metadata.csv"

DATA_STORE_TTL = 3600
_data_store: dict[str, tuple[pd.DataFrame, float]] = {}

app = FastAPI(title="Scorecard Builder")

CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_dataframe(data_id: str) -> pd.DataFrame:
    _evict_expired()
    entry = _data_store.get(data_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Dataset not found. Please re-upload your CSV.")
    return entry[0]


def _evict_expired() -> None:
    now = time.time()
    expired = [k for k, (_, ts) in _data_store.items() if now - ts > DATA_STORE_TTL]
    for k in expired:
        del _data_store[k]


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/api/upload", response_model=UploadResponse)
async def upload_csv(file: UploadFile) -> UploadResponse:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=422, detail="Please upload a CSV file.")

    try:
        df = pd.read_csv(file.file)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Could not read CSV file: {exc}") from exc

    if len(df.columns) < 2:
        raise HTTPException(status_code=422, detail="CSV must have at least two columns (factors + target).")

    data_id = str(uuid.uuid4())
    _data_store[data_id] = (df, time.time())

    columns, detected = profile_dataframe(df)
    return UploadResponse(
        data_id=data_id,
        row_count=len(df),
        column_count=len(df.columns),
        columns=columns,
        detected_specials=[DetectedSpecials(**d) for d in detected],
    )


@app.post("/api/univariate", response_model=UnivariateResponse)
def univariate_analysis(req: UnivariateRequest) -> UnivariateResponse:
    df = _get_dataframe(req.data_id)

    if req.target_column not in df.columns:
        raise HTTPException(status_code=422, detail=f"Target column '{req.target_column}' not found.")

    exclude = set(req.exclude_columns)
    df_analysis = df.drop(columns=[c for c in exclude if c in df.columns and c != req.target_column], errors="ignore")

    results = analyze_all_factors(
        df_analysis, req.target_column, req.max_bins, req.binning_method.value, req.special_values
    )

    target = df[req.target_column].values.astype(float)
    total_events = int(np.nansum(target))
    total_non_events = int(len(target) - np.nansum(np.isnan(target)) - total_events)
    event_rate = total_events / (total_events + total_non_events) if (total_events + total_non_events) > 0 else 0

    factors = [
        FactorAnalysis(
            factor_name=r["factor_name"],
            dtype=r["dtype"],
            iv=r["iv"],
            gini=r["gini"],
            bins=[BinDetail(**b) for b in r["bins"]],
            missing_count=r.get("missing_count", 0),
            special_count=r.get("special_count", 0),
        )
        for r in results
    ]

    return UnivariateResponse(
        factors=factors,
        target_event_rate=round(event_rate, 6),
        total_events=total_events,
        total_non_events=total_non_events,
    )


@app.post("/api/cluster", response_model=ClusterResponse)
def cluster_analysis(req: ClusterRequest) -> ClusterResponse:
    df = _get_dataframe(req.data_id)

    missing = [f for f in req.factor_names if f not in df.columns]
    if missing:
        raise HTTPException(status_code=422, detail=f"Factors not found: {', '.join(missing)}")

    numeric_factors = [f for f in req.factor_names if pd.api.types.is_numeric_dtype(df[f])]
    if len(numeric_factors) < 2:
        raise HTTPException(status_code=422, detail="Need at least 2 numeric factors for clustering.")

    corr = compute_spearman_matrix(df, numeric_factors)
    clusters, linkage_list = cluster_factors(corr, numeric_factors, req.distance_threshold, req.max_clusters)

    target = df[req.target_column].values.astype(float)
    factor_ginis = {}
    factor_ivs = {}
    for f in numeric_factors:
        vals = df[f].values.astype(float)
        factor_ginis[f] = compute_gini(vals, target)
        from app.shortlist_engine import auto_bin_numeric, compute_woe_iv
        edges = auto_bin_numeric(vals, target)
        _, iv = compute_woe_iv(vals, target, edges)
        factor_ivs[f] = iv

    best = select_best_per_cluster(clusters, factor_ginis)

    cluster_results = []
    for cluster_id, factors in sorted(clusters.items()):
        cluster_factors_list = [
            ClusterFactor(
                factor_name=f,
                gini=factor_ginis.get(f, 0),
                iv=factor_ivs.get(f, 0),
                is_selected=(f == best[cluster_id]),
            )
            for f in sorted(factors, key=lambda x: factor_ginis.get(x, 0), reverse=True)
        ]
        cluster_results.append(ClusterResult(cluster_id=cluster_id, factors=cluster_factors_list))

    corr_clean = [[round(float(v), 6) for v in row] for row in corr]

    return ClusterResponse(
        correlation_matrix=corr_clean,
        factor_names=numeric_factors,
        clusters=cluster_results,
        linkage_matrix=[list(row) for row in linkage_list],
    )


@app.post("/api/refine-bins", response_model=RefineBinsResponse)
def refine_bins_endpoint(req: RefineBinsRequest) -> RefineBinsResponse:
    df = _get_dataframe(req.data_id)

    if req.factor_name not in df.columns:
        raise HTTPException(status_code=422, detail=f"Factor '{req.factor_name}' not found.")

    values = df[req.factor_name].values.astype(float)
    target = df[req.target_column].values.astype(float)

    bins_data, iv, gini, data_min, data_max = engine_refine_bins(values, target, sorted(req.bin_edges), req.special_values)

    if req.enforce_monotonicity:
        bins_data = enforce_monotonicity(bins_data, req.monotonicity_direction.value)
        iv = round(sum(b["iv_contribution"] for b in bins_data), 6)

    regular_woe = [b["woe"] for b in bins_data if not b.get("is_special", False)]
    is_monotonic = (
        all(regular_woe[i] <= regular_woe[i + 1] for i in range(len(regular_woe) - 1))
        or all(regular_woe[i] >= regular_woe[i + 1] for i in range(len(regular_woe) - 1))
    ) if len(regular_woe) > 1 else True

    return RefineBinsResponse(
        bins=[BinDetail(**b) for b in bins_data],
        iv=iv,
        gini=gini,
        is_monotonic=is_monotonic,
        data_min=data_min,
        data_max=data_max,
    )


@app.post("/api/export")
def export_shortlist(req: ExportRequest) -> StreamingResponse:
    df = _get_dataframe(req.data_id)
    target = df[req.target_column].values.astype(float)

    rows = []
    for ef in req.factors:
        values = df[ef.factor_name].values.astype(float)
        bins_data, iv, gini, _, _ = engine_refine_bins(values, target, sorted(ef.bin_edges))
        regular_idx = 0
        special_idx = 0
        for b in bins_data:
            if b.get("is_special", False):
                special_idx += 1
                group = f"S{special_idx}"
            else:
                regular_idx += 1
                group = str(regular_idx)
            rows.append({"factor": ef.factor_name, "group": group, "iv": iv, "gini": gini, **b})

    result_df = pd.DataFrame(rows)

    if req.format.value == "json":
        content = result_df.to_json(orient="records", indent=2)
        return StreamingResponse(
            io.StringIO(content),
            media_type="application/json",
            headers={"Content-Disposition": "attachment; filename=shortlist.json"},
        )

    buf = io.StringIO()
    result_df.to_csv(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=shortlist.csv"},
    )


@app.post("/api/fit-scorecard", response_model=ScorecardResponse)
def fit_scorecard_endpoint(req: ScorecardRequest) -> ScorecardResponse:
    df = _get_dataframe(req.data_id)

    if req.target_column not in df.columns:
        raise HTTPException(status_code=422, detail=f"Target column '{req.target_column}' not found.")

    missing = [f.factor_name for f in req.factors if f.factor_name not in df.columns]
    if missing:
        raise HTTPException(status_code=422, detail=f"Factors not found: {', '.join(missing)}")

    if len(req.factors) == 0:
        raise HTTPException(status_code=422, detail="At least one factor is required.")

    from app.scorecard_engine import fit_scorecard
    result = fit_scorecard(
        df, req.target_column,
        [{"factor_name": f.factor_name, "bin_edges": f.bin_edges} for f in req.factors],
        req.special_values, req.base_score, req.base_odds, req.pdo,
        req.selection_method.value, req.p_value_enter, req.p_value_remove, req.max_factors,
        req.forced_factors, req.max_corr, req.round_points,
        req.efw_method, req.efw_threshold,
    )

    return ScorecardResponse(**result)


@app.post("/api/export-scored-data")
def export_scored_data(req: ScorecardRequest) -> StreamingResponse:
    df = _get_dataframe(req.data_id)

    if req.target_column not in df.columns:
        raise HTTPException(status_code=422, detail=f"Target column '{req.target_column}' not found.")

    from app.scorecard_engine import woe_transform_dataset, fit_logistic_regression
    import math

    factors_list = [{"factor_name": f.factor_name, "bin_edges": f.bin_edges} for f in req.factors]
    all_names = [f.factor_name for f in req.factors]

    woe_df, target_clean, _ = woe_transform_dataset(df, req.target_column, factors_list, req.special_values)
    target = df[req.target_column].values.astype(float)
    valid_mask = ~np.isnan(target)

    woe_matrix = woe_df.loc[valid_mask, all_names].values
    coefficients, intercept, _ = fit_logistic_regression(woe_matrix, target_clean, all_names)

    n = len(all_names)
    scaling_factor = req.pdo / math.log(2)
    scaling_offset = req.base_score - scaling_factor * math.log(req.base_odds)
    intercept_share = intercept / n

    scores = np.zeros(int(valid_mask.sum()))
    for i, name in enumerate(all_names):
        coef = float(coefficients[i])
        woe_vals = woe_df.loc[valid_mask, name].values
        raw = coef * woe_vals + intercept_share
        scores += -raw * scaling_factor + scaling_offset / n

    if req.round_points:
        scores = np.round(scores)

    result_df = pd.DataFrame({
        "score": scores,
        "bad": target_clean.astype(int),
    })

    buf = io.StringIO()
    result_df.to_csv(buf, index=False)
    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=scored_data.csv"},
    )


@app.post("/api/stability", response_model=StabilityResponse)
def stability_analysis(req: StabilityRequest) -> StabilityResponse:
    df = _get_dataframe(req.data_id)

    if req.date_column not in df.columns:
        raise HTTPException(status_code=422, detail=f"Date column '{req.date_column}' not found.")

    scores = None
    model_pds = None
    if len(req.factors) > 0:
        from app.scorecard_engine import woe_transform_dataset, fit_logistic_regression
        from sklearn.linear_model import LogisticRegression
        import math as _math

        factors_list = [{"factor_name": f.factor_name, "bin_edges": f.bin_edges} for f in req.factors]
        all_names = [f.factor_name for f in req.factors]
        target = df[req.target_column].values.astype(float)
        valid_mask = ~np.isnan(target)

        woe_df, target_clean, _ = woe_transform_dataset(df, req.target_column, factors_list, req.special_values)
        woe_matrix = woe_df.loc[valid_mask, all_names].values
        coefficients, intercept, _ = fit_logistic_regression(woe_matrix, target_clean, all_names)

        lr = LogisticRegression(C=np.inf, solver="lbfgs", max_iter=1000, random_state=42)
        lr.fit(woe_matrix, target_clean)
        all_model_pds = np.full(len(df), np.nan)
        all_model_pds[valid_mask] = lr.predict_proba(woe_matrix)[:, 1]
        model_pds = all_model_pds

        n = len(all_names)
        sf = req.pdo / _math.log(2)
        so = req.base_score - sf * _math.log(req.base_odds)
        intercept_share = intercept / n

        all_scores = np.full(len(df), np.nan)
        score_vals = np.zeros(int(valid_mask.sum()))
        for i, name in enumerate(all_names):
            coef = float(coefficients[i])
            woe_vals = woe_df.loc[valid_mask, name].values
            raw = coef * woe_vals + intercept_share
            score_vals += -raw * sf + so / n
        all_scores[valid_mask] = score_vals
        scores = all_scores

    from app.stability_engine import run_stability_analysis
    result = run_stability_analysis(
        df, req.target_column, req.date_column,
        [{"factor_name": f.factor_name, "bin_edges": f.bin_edges} for f in req.factors],
        req.special_values, req.period, scores, model_pds,
        req.stress_period, req.benign_period,
        req.bucket_months, req.date_start, req.date_end,
    )

    return StabilityResponse(**result)


@app.post("/api/load-sample", response_model=SampleDataResponse)
def load_sample_data() -> SampleDataResponse:
    if not SAMPLE_DATA_PATH.exists():
        raise HTTPException(status_code=404, detail="Sample data not available.")

    df = pd.read_csv(SAMPLE_DATA_PATH)
    data_id = str(uuid.uuid4())
    _data_store[data_id] = (df, time.time())

    columns, detected = profile_dataframe(df)
    upload = UploadResponse(
        data_id=data_id,
        row_count=len(df),
        column_count=len(df.columns),
        columns=columns,
        detected_specials=[DetectedSpecials(**d) for d in detected],
    )

    descriptions: dict[str, str] = {}
    if SAMPLE_METADATA_PATH.exists():
        meta_df = pd.read_csv(SAMPLE_METADATA_PATH)
        name_col = next((c for c in meta_df.columns if c.lower() in ("factor_name", "factor", "name")), None)
        desc_col = next((c for c in meta_df.columns if c.lower() in ("description", "desc")), None)
        if name_col and desc_col:
            for _, row in meta_df.iterrows():
                if pd.notna(row[name_col]) and pd.notna(row[desc_col]):
                    descriptions[str(row[name_col])] = str(row[desc_col])

    return SampleDataResponse(upload=upload, descriptions=descriptions)


from mangum import Mangum  # noqa: E402

handler = Mangum(app)
