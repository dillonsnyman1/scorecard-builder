# Frontend

React + Vite + TypeScript. No UI framework - vanilla CSS with custom
properties matching the other projects in this portfolio.

## Steps

The app is a 7-step wizard controlled by `App.tsx`:

- **Upload** - CSV file upload with auto-target and date column
  detection, special value chip input, metadata CSV upload, "Use
  Sample Data" button, binning method selector, collapsible column
  profiles and detected special values tables.
- **Univariate** - factor screening table with IV/GINI/missing%/
  SV%/valid% columns, configurable thresholds (IV, GINI, valid %,
  min bins), binning method toggle with re-run, expandable WoE
  charts, rejection reasons, and override justification dropdowns
  for both include and exclude overrides.
- **Clustering** - SVG correlation heatmap with hover interaction,
  cluster cards with factor rankings and descriptions, override
  justification with "replaced by" cross-cluster references, circular
  reference detection.
- **Refinement** - collapsible per-factor editors with WoE chart,
  merge/split/add edge/reset controls, monotonicity enforcement (auto/
  increasing/decreasing/U-shaped), bin warning for single-bin factors,
  data range display, grouped bin indices. Proceed blocked until all
  factors have monotonic trends and sufficient bins.
- **Scorecard** - factor selection method toggle (All/Forward/Backward/
  Stepwise/LASSO), forced-include factor table, PDO scaling config,
  round points toggle, EFW method selector (Points Range/Coefficient/
  Score Variance) with min threshold and iterative auto-removal,
  coefficient table with p-values/significance/VIF/EFW%, selection log,
  scorecard points table with expandable per-factor detail, scorecard
  master table.
- **Assessment** - auto-runs stability analysis on entry. Model
  metrics summary, GINI over time with SE bands, score distribution,
  effective weights (method selected in scorecard build), stability
  analysis (score PSI YoY, factor IV by period, factor PSI YoY,
  factor PSI vs latest - all with heatmap colouring), cyclicality
  analysis (ODR vs PD dual-line chart, three cyclicality measures
  with user-selectable stress/benign periods).
- **Report** - standalone document with summary cards, configuration
  summary, scorecard summary with EFW%, master table, factor selection
  log, GINI over time chart, stability/cyclicality summary with
  heatmap colouring, factor audit report with In Model and Model
  Rejection columns. Exports: full Excel report (multi-sheet with
  embedded charts) and scored data CSV.

## Components

| Component | Purpose |
|-----------|---------|
| `UploadPanel` | File upload, target/date auto-detection, SV chips, metadata, sample data |
| `DataProfileCards` | Summary cards for event rate, counts |
| `UnivariateTable` | Factor screening with thresholds, binning toggle, overrides, WoE charts |
| `CorrelationHeatmap` | SVG-based Spearman correlation matrix |
| `ClusterShortlist` | Cluster cards with factor selection and override audit |
| `BinEditor` | Interactive bin refinement with merge/split/monotonicity |
| `WoeChart` | Recharts composed bar + line chart for WoE and event rate |
| `ScorecardPanel` | Factor selection, model fitting, PDO config, points table |
| `ModelAssessmentPanel` | GINI over time, stability (PSI), cyclicality, effective weights |
| `ExportPanel` | Report page: standalone document, Excel export, scored data export |

### Utilities

| File | Purpose |
|------|---------|
| `utils/exportReport.ts` | Excel report generation with ExcelJS, chart capture via SVG-to-canvas |

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
