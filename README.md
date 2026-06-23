# Scorecard Builder

[![CI/CD](https://github.com/dillonsnyman1/scorecard-builder/actions/workflows/ci-cd.yml/badge.svg)](https://github.com/dillonsnyman1/scorecard-builder/actions/workflows/ci-cd.yml)

A full-stack interactive tool for building credit risk scorecards from
raw data - covering the entire development pipeline from factor screening
through to a final points-based scorecard with full audit trail.

- **Backend**: Python + FastAPI for WoE/IV computation, factor clustering,
  logistic regression, PDO scaling and scorecard points generation
- **Frontend**: React + Vite + TypeScript interactive wizard with Recharts
  visualisations

> **Disclaimer**: This is a simplified, illustrative implementation built
> for portfolio purposes. It is **not** a production-grade scorecard
> development platform and should not be used for regulatory model
> submissions. All sample data is synthetic.

---

## What It Does

The tool guides the user through a 7-step scorecard development workflow:

### Step 1: Upload

Upload a CSV containing candidate factors and a binary target variable
(e.g. default flag). Optionally upload a metadata CSV with factor
descriptions. Configure special values (e.g. -999, 9999) that should be
treated as sentinels rather than valid data points.

The tool auto-detects the target variable from common naming patterns
(default_flag, target, bad, etc.) and the date column from naming
patterns (date, snapshot, period). Both the target and date columns
are excluded from the factor analysis. The date column is used later
for stability and cyclicality analysis in the Model Assessment step.
All columns are profiled for missing values, special values, data
types and unique counts. A "Use Sample Data" button loads the
included synthetic dataset with metadata in one click.

### Step 2: Univariate Analysis

Every factor is automatically binned and assessed for univariate
predictive power.

**Initial binning (grouping)**:

For numeric factors, the tool uses **decision-tree optimal binning** by
default: a single-variable `DecisionTreeClassifier` (from scikit-learn)
is fitted against the target with `max_leaf_nodes` set to the desired
number of bins (default 10). The tree's split thresholds become the bin
edges. This produces bins that maximise information gain with respect to
the target - unlike equal-width or equal-frequency binning, the splits
are placed where the data naturally separates good from bad.

An **equal-frequency (quantile)** binning method is also available as
an alternative - it distributes observations evenly across bins
regardless of the target variable.

Both the binning method and the maximum number of bins (default 10,
range 2-50) can be configured in the upload step and changed on the
fly in the univariate analysis step with a "Re-run" button to
recompute.

For categorical factors, each unique category value becomes its own bin.

Before binning, **missing values** (NaN) and **user-configured special
values** (e.g. -999, 9999) are separated out. They receive their own
dedicated bins with independently calculated WoE, ensuring sentinel
values don't distort the binning of valid observations.

**Per-bin and per-factor metrics**:

- **Weight of Evidence (WoE)** per bin: `ln(% non-events / % events)`,
  with a 0.0001 floor to prevent log(0)
- **Information Value (IV)**: `sum((% non-events - % events) * WoE)`
  across all bins - measures the overall predictive power of the factor
- **GINI coefficient**: `2 * AUC - 1` from a univariate logistic
  regression - measures the factor's ability to rank-order risk

Factors are ranked by GINI and can be filtered by configurable
thresholds:

| Threshold | Default | Description |
|---|---|---|
| Min IV | 0.02 | Minimum Information Value |
| Min GINI | 0.10 | Minimum absolute GINI coefficient |
| Min Valid % | 50% | Minimum percentage of non-missing, non-special observations |
| Min Bins | 2 | Minimum number of regular (non-special) bins |

Factors failing any threshold are flagged with categorised rejection
reasons (e.g. "Low information value", "Insufficient valid
observations"). Users can override rejections (force-include or
force-exclude) with a mandatory justification selected from pre-defined
industry-standard reason lists - all logged for audit.

### Step 3: Factor Clustering

Selected factors are clustered using Spearman rank correlation and
hierarchical agglomerative clustering. A correlation heatmap visualises
the relationships. Within each cluster, the factor with the highest GINI
is auto-selected as the representative.

Users can override the default selection (e.g. prefer a different factor
for operational or interpretability reasons), with mandatory
justification. The tool detects circular references (Factor A says
"prefer B", Factor B says "prefer A") and blocks progression until
resolved.

Configurable parameters:

| Parameter | Default | Description |
|---|---|---|
| Correlation threshold | 0.5 | Minimum absolute correlation to group factors |
| Max clusters | Auto | Hard cap on number of clusters |

### Step 4: Bin Refinement

Interactive coarse classing for each shortlisted factor:

- **Merge** adjacent bins to simplify the risk ranking
- **Split** bins at a user-specified value
- **Add bin edges** manually (essential for single-bin factors)
- **Enforce monotonicity**: Auto, Increasing, Decreasing, or U-shaped
- **Reset** to the original tree-based binning

WoE charts and bin statistics (count, event rate, WoE, IV contribution)
update live after each adjustment. Missing and special value bins are
displayed separately and excluded from monotonicity checks.

Progression to the next step is blocked until all factors have at least
2 regular bins and monotonic WoE trends.

### Step 5: Scorecard

Fits a logistic regression on the WoE-transformed factors and converts
the output to a points-based scorecard using PDO (Points to Double the
Odds) scaling.

**Factor selection methods**:

| Method | Description |
|---|---|
| All | Use all shortlisted factors (no selection) |
| Forward | Start empty, add most significant factor at each step |
| Backward | Start with all, remove least significant at each step |
| Stepwise | Combined forward and backward at each step |
| LASSO | L1 regularisation, automatically shrinks weak coefficients to zero |

**Configurable parameters**:

| Parameter | Default | Description |
|---|---|---|
| Selection method | Stepwise | All / Forward / Backward / Stepwise / LASSO |
| P-value to enter | 0.05 | Significance threshold for adding a factor (forward/stepwise) |
| P-value to remove | 0.05 | Significance threshold for removing a factor (backward/stepwise) |
| Max factors | Auto | Hard cap on number of factors in the scorecard |
| Max WoE correlation | Off | Maximum allowed Spearman correlation between any two factors |
| Forced factors | None | Factors always included regardless of selection |
| Base score | 600 | Score at which odds equal the base odds |
| Base odds | 50 | Good-to-bad odds at the base score |
| PDO | 20 | Points to double the odds |
| Round points | Off | Round scorecard points to integers |

**PDO scaling** converts log-odds to score points:

```
scaling_factor = PDO / ln(2)
scaling_offset = base_score - scaling_factor * ln(base_odds)
points_ij = -(coefficient_i * WoE_ij + intercept/n) * scaling_factor + scaling_offset/n
```

The output includes:

- **Model metrics**: AUC, GINI, KS statistic
- **Coefficient table**: factor, coefficient, p-value, significance
  level, VIF (Variance Inflation Factor)
- **Factor selection log**: step-by-step record of which factors were
  added/removed and why
- **Scorecard points table**: per-factor, per-bin point assignments
- **Score distribution**: histogram of scores across the dataset
- **Scorecard master table**: implementation-ready Factor | Attribute |
  Range | Points layout

Anomalous (positive) coefficients are flagged with a warning - with the
WoE convention used (`ln(% non-events / % events)`), all coefficients
should be negative.

### Step 6: Model Assessment

Automated assessment of the fitted scorecard, run against the full
date range of the dataset. Requires a date column to have been
identified at upload. Analysis runs automatically on entering this
step.

- **Model metrics summary**: AUC, GINI, KS statistic, score range,
  factor count
- **GINI over time**: GINI and GINI standard error (Hanley-McNeil
  approximation) per snapshot period, with line chart and SE bands
- **Score distribution**: histogram of scores across the dataset
- **Effective weights**: factor contribution analysis with three
  perspectives (points range, coefficient magnitude, score variance)
- **Stability Analysis (PSI)**:
  - Score PSI year-on-year (each period vs previous)
  - Factor IV by period (heatmap coloured by IV thresholds)
  - Factor PSI year-on-year (bin distribution shift from previous
    period, using refined bin edges)
  - Factor PSI vs latest period (each historic period compared to
    the most recent snapshot)
  - Interpretation thresholds documented inline
- **Cyclicality Analysis**:
  - ODR vs Model PD dual-line chart
  - Three cyclicality measures: log-log regression, two-point
    Delta PD / Delta ODR (user-selectable benign/stress periods),
    CV of model PD
  - Interpretation thresholds documented inline

### Step 7: Report

Comprehensive output and audit trail:

- **Factor Selection Log**: stepwise add/remove decisions with p-values
- **Configuration Summary**: all settings used (binning, thresholds,
  clustering, PDO) for reproducibility
- **Stability & Cyclicality Summary**: read-only summary of results
  from the Model Assessment step
- **Factor Audit Report**: every input factor listed with its status
  (Shortlisted/Rejected), the stage at which the decision was made,
  and the reason - including user overrides with justifications
- **Scorecard Summary**: model metrics, coefficients, point ranges
- **Scorecard Master Table**: implementation-ready scorecard
- **Exports**: Binning CSV, Binning JSON, Scorecard Points CSV, Scored
  Data CSV (score + default indicator per observation), Audit Report CSV

The scored data export (`score`, `bad` columns) is formatted for direct
import into PD calibration tools such as the
[MAPA PD Calibration Tool](https://dcg14fdv56g8g.cloudfront.net).

---

## Stability & Cyclicality Analysis

The Report step includes an optional analysis that assesses scorecard
stability and cyclicality across time periods. This requires a date
column in the dataset. These are two related but distinct concepts:

**Cyclicality** refers to how default rates vary with economic
conditions. The same borrower profile may default at different rates
depending on whether the economy is in expansion or recession. A
scorecard built on benign-period data may underpredict defaults in a
downturn. Cyclicality analysis helps assess how sensitive the model's
predictions are to the economic cycle.

**Population stability** refers to whether the characteristics of the
applicant population have shifted over time - for example, whether
the mix of high-risk vs low-risk applicants has changed. This is
independent of the economic cycle: even in a stable economy, a change
in marketing strategy or distribution channel can shift the population.

**What the tool measures:**

**Cyclicality** - the sensitivity of the model's PD predictions to
changes in the Observed Default Rate (ODR) across time periods. A
scorecard that assigns the same PD regardless of the economic
environment is Through-the-Cycle (TTC); one whose PDs move in
lockstep with realised defaults is Point-in-Time (PIT). Three
measures are implemented:

1. **Log-log regression**: regress the log of the model-implied PD
   on the log of the ODR across time periods:

   ```
   ln(mean_model_PD_t) = alpha + beta * ln(ODR_t) + epsilon
   ```

   The slope `beta` is the cyclicality index. `|beta| ~ 1` means
   fully PIT; `|beta| ~ 0` means fully TTC. Interpretation is
   based on the absolute value (a negative slope indicates inverse
   sensitivity but the same degree of cyclicality): |beta| > 0.8
   highly PIT, 0.5-0.8 moderately cyclical, 0.2-0.5 low
   cyclicality, < 0.2 near TTC.

2. **Two-point Delta PD / Delta ODR**: select two periods
   sufficiently apart in the cycle (e.g. a benign period and a
   stressed period) and compute:

   ```
   Cyclicality = (PD_stress - PD_benign) / (ODR_stress - ODR_benign)
   ```

   A value of 1 means the model fully passes through the cycle,
   < 1 means it dampens it (more TTC), > 1 means it amplifies it.
   The user selects the two reference periods, or the tool
   auto-selects the highest and lowest ODR periods.

3. **CV of model PD**: `std(PD_t) / mean(PD_t)` - measures how
   much the model's own PD predictions vary across periods. Higher
   values indicate greater sensitivity to the cycle.

**Methods not included and why**: Several other approaches are
commonly discussed in the context of cyclicality but measure
different things - either the severity of the default cycle in the
data, or calibration mechanics for converting between PIT and TTC
PDs. Under regulatory guidance, the rating system's ranking
ability (which is what the scorecard produces) is explicitly
separated from the calibration of PDs to long-run averages. These
methods belong in the calibration stage, not the scorecard
development stage:

- **Peak-to-trough ODR ratio** (`max(ODR_t) / min(ODR_t)`):
  this tells you how volatile actual defaults were across the
  observation window - it is a property of the portfolio and the
  economic environment, not of the model. Two completely different
  scorecards applied to the same data would produce the same
  peak-to-trough ODR ratio, so it cannot distinguish a cyclical
  model from a stable one.
- **Cycle index (Anderson)** (`long_run_average_PD / current_PD`):
  this is a scalar used to convert a point-in-time PD estimate to
  a through-the-cycle PD by scaling it to the long-run average. It
  answers "where are we in the cycle right now?" rather than "does
  the model move with the cycle?". It is applied after calibration,
  not during scorecard development.
- **Vasicek single-factor model** (ASRF framework,
  `ODR_t = Phi((Phi_inv(PD_TTC) - sqrt(rho) * Z_t) / sqrt(1 - rho))`):
  this decomposes observed defaults into a systematic factor `Z_t`
  (the economy) and an idiosyncratic component, with `rho` measuring
  how exposed the portfolio is to the systematic factor. This is the
  theoretical foundation of the Basel IRB capital formula - it
  determines how much capital to hold, not whether the scorecard's
  risk ranking is stable. A high `rho` means the portfolio is
  concentrated in cycle-sensitive segments, which is a portfolio
  characteristic, not a model property.
- **Macro regression** (regressing ODR on GDP growth, unemployment,
  etc.): this quantifies how sensitive the portfolio's default rate
  is to macroeconomic conditions. It requires external data not
  available during scorecard development and answers "how does the
  economy affect this portfolio?" rather than "does this model's PD
  assignment change with the economy?".

**Population stability (PSI)** - the Population Stability Index
quantifies how much the score distribution in each period has
shifted relative to a base period. This is distinct from cyclicality
- PSI measures whether the applicant population has changed, not
whether default rates have moved with the economy. A rising PSI
with stable default rates suggests population shift; a rising PSI
with rising defaults suggests both shift and cycle.

**Factor IV stability** - tracks each factor's Information Value
across periods to identify factors whose predictive power is
unstable. A factor with volatile IV may be capturing cyclical
effects rather than structural risk, making the scorecard less
robust through the cycle.

**Population Stability Index (PSI)** as implemented here:

**Score PSI** (year-on-year): decile bins are computed once from the
**full dataset** (all periods combined) to establish a fixed
reference grouping. Each period's score distribution is then counted
into those fixed bins, and the PSI is computed between consecutive
periods. This ensures the bins are stable and the PSI purely
measures population movement, not bin definition changes.

**Factor PSI**: for each factor, compare the distribution of
observations across the factor's **refined bin edges** (from Step 4)
between periods. This uses the actual scorecard binning, not
deciles, so the PSI directly measures whether the population is
shifting across the risk groups defined by the model. Two views are
provided: year-on-year (vs previous period) and vs latest (each
historic period compared to the most recent snapshot).

Formula (same for both score and factor PSI):

```
PSI = sum_i((P_i - Q_i) * ln(P_i / Q_i))
```

where `P_i` is the proportion in bin `i` for the comparison period and
`Q_i` is the proportion in bin `i` for the base period. A floor of
0.0001 is applied to prevent log(0).

Alternative PSI formulations include:

- **Equal-width bins** - using fixed score ranges instead of
  percentiles, more interpretable but sensitive to score scale
- **KL divergence** - Kullback-Leibler divergence is the asymmetric
  version; PSI is the symmetric form (sum of KL in both directions)
- **Kolmogorov-Smirnov** - maximum absolute difference between
  cumulative distributions, captures the single largest shift point
  rather than the aggregate

Interpretation thresholds (industry convention):
- PSI < 0.10: stable, no significant shift
- 0.10 <= PSI < 0.25: moderate shift, warrants investigation
- PSI >= 0.25: significant shift, model may need recalibration

**Factor IV stability** is computed by re-running the univariate
analysis (WoE binning + IV calculation) independently on each time
period's subset of data, using the same bin edges and special value
configuration. A factor whose IV varies significantly across periods
may be capturing cyclical rather than structural risk, which can cause
the scorecard to be unstable through the cycle.

**Alternative approaches** that could be used for cyclicality and
stability assessment include:

- **Characteristic Stability Index (CSI)** - PSI applied to individual
  factor distributions rather than scores, to pinpoint which factors
  are driving population shifts
- **GINI/AUC by vintage** - tracking discriminatory power over time,
  useful for detecting model degradation
- **Herfindahl index** - measuring concentration of observations across
  score bands over time

---

## WoE Convention

This tool uses the convention:

```
WoE = ln(% non-events / % events)
```

where "events" are defaults (target = 1). Higher WoE indicates lower
risk. This means:

- Logistic regression coefficients are expected to be **negative**
  (higher WoE reduces the log-odds of default)
- The scorecard points formula includes a negation so that higher
  points = lower risk (conventional scorecard interpretation)
- Positive coefficients are flagged as anomalous (typically caused by
  multicollinearity)

---

## Project Structure

```
scorecard-builder/
├── backend/
│   ├── app/
│   │   ├── main.py               # FastAPI routes + Mangum handler
│   │   ├── models.py             # Pydantic request/response schemas
│   │   ├── shortlist_engine.py   # WoE/IV/GINI, binning, monotonicity
│   │   ├── cluster_engine.py     # Spearman correlation, hierarchical clustering
│   │   ├── scorecard_engine.py   # Logistic regression, PDO scaling, points
│   │   └── sample_data/          # Synthetic 20k-row dataset + metadata
│   └── tests/                    # pytest suite (47 tests)
├── frontend/
│   └── src/
│       ├── App.tsx               # 7-step wizard controller
│       ├── components/           # UploadPanel, UnivariateTable, ClusterShortlist,
│       │                         # BinEditor, ScorecardPanel, ModelAssessmentPanel,
│       │                         # ExportPanel, etc.
│       ├── api/client.ts         # API client functions
│       └── types/analysis.ts     # TypeScript interfaces
├── infra/                        # Terraform (S3, CloudFront, Lambda, API Gateway)
└── .github/workflows/            # CI/CD pipeline
```

---

## Running Locally

### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

The API runs at `http://localhost:8000`.

Run the test suite:

```bash
pytest
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The dashboard runs at `http://localhost:5173` and expects the backend API
at `http://localhost:8000`.

---

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/upload` | Upload CSV, returns data profile + data_id |
| `POST` | `/api/univariate` | Univariate analysis (WoE/IV/GINI) for all factors |
| `POST` | `/api/cluster` | Factor clustering via Spearman correlation |
| `POST` | `/api/refine-bins` | Adjust bin edges for a single factor |
| `POST` | `/api/fit-scorecard` | Fit logistic regression + PDO scaling |
| `POST` | `/api/stability` | Stability, cyclicality, GINI over time, factor PSI |
| `POST` | `/api/export` | Export binning definitions as CSV/JSON |
| `POST` | `/api/export-scored-data` | Export scored dataset (score + default flag) |
| `GET` | `/api/sample-csv` | Download sample dataset (20k rows, 106 factors) |
| `GET` | `/api/sample-metadata` | Download sample factor descriptions |

The backend stores uploaded data in memory (keyed by UUID, 1-hour TTL)
to support the multi-step workflow without a database. On Lambda cold
starts the cache is empty and the user re-uploads.

---

## Sample Data

The included sample dataset (`backend/app/sample_data/`) contains 20,000
synthetic observations with 106 columns (105 candidate factors + date)
across 11 annual June snapshots (2005-2015), with year-dependent
factor distributions that simulate a realistic economic cycle
(GFC stress peaking in 2008, long-run average default rate ~3.5%):

- **Core financial factors**: income (growing ~3% pa with inflation),
  debt-to-income (looser pre-crisis, tighter post), loan amount
  (inflating ~4% pa), interest rate (higher pre-GFC, cut post-GFC),
  loan-to-value (higher pre-crisis lending), credit utilisation
  (spiking during stress), delinquency count (elevated during GFC)
- **Bureau/external data**: bureau scores, worst status, months since
  default, payment history scores - many with -999 or 9999 special
  values representing "not on file" or "not applicable"
- **Employment/property data**: months employed, property value, rental
  income - with realistic missing value patterns (higher missing rates
  for less commonly collected fields)
- **Derived/interaction factors**: debt service ratio, income per
  account, utilisation x delinquency, correlated variants of core
  factors (to test clustering)
- **Categorical factors**: region, employment type, loan purpose,
  property type, education, marital status
- **Pure noise factors**: 25 random uniform/normal/integer factors to
  test that threshold-based screening correctly rejects them

A companion metadata CSV provides descriptions for all 105 factors.

---

## Deployment

The app deploys to AWS with no custom domain - CloudFront serves the
frontend, and the FastAPI backend runs on Lambda (as a container image)
behind an API Gateway HTTP API. Everything is defined in Terraform under
[`infra/`](infra/), and a GitHub Actions workflow
([`.github/workflows/ci-cd.yml`](.github/workflows/ci-cd.yml)) runs the
backend tests and frontend build on every push/PR, then - if those pass
- builds the backend image, applies the Terraform config, and publishes
the frontend to S3/CloudFront. The deploy job runs automatically on
every push to `main`, or on demand via the Actions tab.

> **Live demo**: [d1kpl55ytl00tk.cloudfront.net](https://d1kpl55ytl00tk.cloudfront.net) - try uploading the sample dataset or your own CSV and building a scorecard end-to-end.
>
> The backend is fully stateless - uploaded data is held in memory for the duration of the session (1-hour TTL) and never written to disk, so it's safe for multiple people to use the demo at the same time without their data overlapping.

See `infra/bootstrap/` for the one-time AWS setup needed before the
first deploy.
