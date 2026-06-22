# Frontend

React + Vite + TypeScript. No UI framework - vanilla CSS with custom
properties matching the other projects in this portfolio.

## Steps

The app is a 6-step wizard controlled by `App.tsx`:

- **Upload** - CSV file upload with auto-target detection, special value
  chip input, metadata CSV upload, collapsible column profiles and
  detected special values tables.
- **Univariate Analysis** - factor screening table with IV/GINI/missing%/
  SV%/valid% columns, configurable thresholds (IV, GINI, valid %,
  min bins), expandable WoE charts, rejection reasons, and override
  justification dropdowns for both include and exclude overrides.
- **Factor Clustering** - SVG correlation heatmap with hover interaction,
  cluster cards with factor rankings and descriptions, override
  justification with "replaced by" cross-cluster references, circular
  reference detection.
- **Bin Refinement** - collapsible per-factor editors with WoE chart,
  merge/split/add edge/reset controls, monotonicity enforcement (auto/
  increasing/decreasing/U-shaped), bin warning for single-bin factors,
  data range display, grouped bin indices. Proceed blocked until all
  factors have monotonic trends and sufficient bins.
- **Scorecard** - factor selection method toggle (All/Forward/Backward/
  Stepwise/LASSO), forced-include factor table, PDO scaling config,
  round points toggle, model summary cards (AUC/GINI/KS/score range),
  coefficient table with p-values/significance/VIF, selection log,
  scorecard points table with expandable per-factor detail, score
  distribution chart, scorecard master table.
- **Report** - summary cards, scorecard summary, master table, factor
  audit report with full decision trail, shortlist binning summary with
  expandable WoE charts, exports (binning CSV/JSON, scorecard CSV,
  scored data CSV, audit report CSV), next steps with link to PD
  calibration.

## Components

| Component | Purpose |
|-----------|---------|
| `UploadPanel` | File upload, target auto-detection, SV chips, metadata upload |
| `DataProfileCards` | Summary cards for event rate, counts |
| `UnivariateTable` | Factor screening with thresholds, overrides, WoE charts |
| `CorrelationHeatmap` | SVG-based Spearman correlation matrix |
| `ClusterShortlist` | Cluster cards with factor selection and override audit |
| `BinEditor` | Interactive bin refinement with merge/split/monotonicity |
| `WoeChart` | Recharts composed bar + line chart for WoE and event rate |
| `ScorecardPanel` | Factor selection, model fitting, PDO config, points table |
| `ExportPanel` | Audit report, master table, exports, next steps |

## Running locally

```bash
npm install
npm run dev
```

Expects the backend running on http://localhost:8000. Set
`VITE_API_BASE_URL` to override (e.g. for a deployed backend).

## Build

```bash
npm run build
```

Output goes to `dist/`, which gets synced to S3 + CloudFront on deploy.

## Charts

All charts use [Recharts](https://recharts.org/). The correlation
heatmap is custom SVG. TypeScript types in `src/types/analysis.ts`
mirror the backend Pydantic models.
