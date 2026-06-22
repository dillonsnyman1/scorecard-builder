# Backend

Python + FastAPI. Stateful across a session (in-memory data store with
1-hour TTL) but no database - data is held in a dict keyed by UUID and
evicted after expiry.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/upload` | Parse uploaded CSV, profile columns, detect special values |
| `POST` | `/api/univariate` | Compute WoE/IV/GINI for all factors with special value handling |
| `POST` | `/api/cluster` | Spearman correlation matrix + hierarchical clustering |
| `POST` | `/api/refine-bins` | Adjust bin edges, enforce monotonicity, return updated WoE/IV |
| `POST` | `/api/fit-scorecard` | Logistic regression + PDO scaling + scorecard points |
| `POST` | `/api/export` | Export binning definitions as CSV/JSON |
| `POST` | `/api/export-scored-data` | Export score + default indicator per observation |
| `GET`  | `/api/sample-csv` | Download sample dataset (20k rows, 105 factors) |
| `GET`  | `/api/sample-metadata` | Download factor descriptions CSV |
| `GET`  | `/api/health` | Health check |

## Engine modules

### `shortlist_engine.py`

Core WoE/IV computation with missing and special value handling:

- **`profile_dataframe`** - column profiling with special value detection
- **`auto_bin_numeric`** - decision-tree optimal binning or equal-frequency
- **`compute_woe_iv`** - WoE per bin + total IV for numeric factors
- **`compute_woe_iv_categorical`** - same for categorical factors
- **`compute_gini`** - GINI from univariate logistic regression AUC
- **`analyze_all_factors`** - orchestrates the above for every factor
- **`refine_bins`** - recompute bins for user-adjusted edges
- **`enforce_monotonicity`** - merge bins to enforce WoE ordering
  (increasing, decreasing, or U-shaped)

Missing values (NaN) and user-configured special values (e.g. -999,
9999) are separated into their own bins before the regular values are
binned, ensuring they don't distort the WoE pattern.

### `cluster_engine.py`

- **`compute_spearman_matrix`** - Spearman rank correlation
- **`cluster_factors`** - hierarchical agglomerative clustering with
  configurable distance threshold or max clusters
- **`select_best_per_cluster`** - pick highest-GINI factor per cluster

### `scorecard_engine.py`

- **`woe_transform_dataset`** - replace raw values with bin WoE values,
  handling missing/special values
- **`fit_logistic_regression`** - sklearn for coefficients, statsmodels
  for p-values
- **`compute_model_metrics`** - AUC, GINI, KS statistic
- **`compute_scorecard_points`** - PDO scaling + per-bin point
  assignments + score distribution
- **`factor_selection`** - stepwise (forward/backward/both), LASSO, or
  all-factors selection with forced-include support
- **`fit_scorecard`** - top-level orchestrator combining all of the
  above, including VIF computation and multicollinearity checks

## Data flow

1. Upload stores the DataFrame in `_data_store` keyed by UUID
2. All subsequent endpoints receive the `data_id` and retrieve the
   DataFrame from the store
3. The frontend drives the multi-step workflow, passing `data_id` and
   parameters at each step

## Running locally

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

API docs at http://localhost:8000/docs.

## Tests

```bash
pytest
```

47 tests covering WoE/IV computation, binning, clustering, monotonicity
enforcement, scorecard fitting, and PDO scaling.

## Deployment

The Dockerfile builds a Lambda container image (arm64). Mangum wraps
the FastAPI app as a Lambda handler. See `../infra/` for the Terraform
config.
