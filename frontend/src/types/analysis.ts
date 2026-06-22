export interface ColumnProfile {
  name: string;
  dtype: string;
  missing_count: number;
  missing_pct: number;
  unique_count: number;
  sample_values: string[];
  special_value_counts: Record<string, number>;
}

export interface DetectedSpecials {
  column: string;
  values: number[];
  counts: number[];
}

export interface UploadResponse {
  data_id: string;
  row_count: number;
  column_count: number;
  columns: ColumnProfile[];
  detected_specials: DetectedSpecials[];
}

export interface BinDetail {
  bin_label: string;
  lower: number | null;
  upper: number | null;
  count: number;
  event_count: number;
  event_rate: number;
  non_event_count: number;
  woe: number;
  iv_contribution: number;
  pct_events: number;
  pct_non_events: number;
  is_special: boolean;
}

export interface FactorAnalysis {
  factor_name: string;
  dtype: string;
  iv: number;
  gini: number;
  bins: BinDetail[];
  missing_count: number;
  special_count: number;
}

export interface UnivariateResponse {
  factors: FactorAnalysis[];
  target_event_rate: number;
  total_events: number;
  total_non_events: number;
}

export interface UnivariateRequest {
  data_id: string;
  target_column: string;
  binning_method: "tree" | "equal_frequency";
  max_bins: number;
  iv_threshold: number;
  special_values: number[];
}

export interface ClusterFactor {
  factor_name: string;
  gini: number;
  iv: number;
  is_selected: boolean;
}

export interface ClusterResult {
  cluster_id: number;
  factors: ClusterFactor[];
}

export interface ClusterRequest {
  data_id: string;
  target_column: string;
  factor_names: string[];
  distance_threshold: number;
  max_clusters: number | null;
}

export interface ClusterResponse {
  correlation_matrix: number[][];
  factor_names: string[];
  clusters: ClusterResult[];
  linkage_matrix: number[][];
}

export interface RefineBinsRequest {
  data_id: string;
  target_column: string;
  factor_name: string;
  bin_edges: number[];
  enforce_monotonicity: boolean;
  monotonicity_direction: "auto" | "increasing" | "decreasing" | "u_shaped";
  special_values: number[];
}

export interface RefineBinsResponse {
  bins: BinDetail[];
  iv: number;
  gini: number;
  is_monotonic: boolean;
  data_min: number | null;
  data_max: number | null;
}

export interface ExportFactor {
  factor_name: string;
  bin_edges: number[];
}

export interface ExportRequest {
  data_id: string;
  target_column: string;
  factors: ExportFactor[];
  format: "csv" | "json";
}

export type Step = "upload" | "univariate" | "cluster" | "refine" | "scorecard" | "report";

export const STEP_LABELS: Record<Step, string> = {
  upload: "Upload",
  univariate: "Univariate Analysis",
  cluster: "Factor Clustering",
  refine: "Bin Refinement",
  scorecard: "Scorecard",
  report: "Report",
};

export const STEP_ORDER: Step[] = ["upload", "univariate", "cluster", "refine", "scorecard", "report"];

export type SelectionMethod = "all" | "forward" | "backward" | "stepwise" | "lasso";

export interface ScorecardRequest {
  data_id: string;
  target_column: string;
  factors: ExportFactor[];
  special_values: number[];
  base_score: number;
  base_odds: number;
  pdo: number;
  max_factors: number | null;
  selection_method: SelectionMethod;
  p_value_enter: number;
  p_value_remove: number;
  forced_factors: string[];
  max_corr: number | null;
  round_points: boolean;
}

export interface ScorecardBinPoints {
  group: string;
  bin_label: string;
  woe: number;
  points: number;
  count: number;
  event_rate: number;
}

export interface ScorecardFactor {
  factor_name: string;
  coefficient: number;
  p_value: number | null;
  vif: number | null;
  bins: ScorecardBinPoints[];
}

export interface StepwiseStep {
  step: number;
  action: string;
  factor_name: string;
  p_value: number | null;
  reason: string;
}

export interface ScorecardResponse {
  factors: ScorecardFactor[];
  intercept: number;
  base_points: number;
  scaling_factor: number;
  scaling_offset: number;
  auc: number;
  gini: number;
  ks_statistic: number;
  total_min_score: number;
  total_max_score: number;
  score_distribution: Array<{ band: string; count: number; pct: number }>;
  stepwise_log: StepwiseStep[];
  dropped_factors: string[];
  negative_coefficients: string[];
}

export interface FactorThresholds {
  iv: number;
  gini: number;
  minValidPct: number;
  minBins: number;
}

function validPct(f: FactorAnalysis, totalRows: number): number {
  return totalRows > 0
    ? ((totalRows - f.missing_count - f.special_count) / totalRows) * 100
    : 0;
}

export function passesThresholds(
  f: FactorAnalysis, totalRows: number, t: FactorThresholds,
): boolean {
  return rejectionReasons(f, totalRows, t).length === 0;
}

export function factorValidPct(f: FactorAnalysis, totalRows: number): number {
  return validPct(f, totalRows);
}

export function rejectionReasons(
  f: FactorAnalysis, totalRows: number, t: FactorThresholds,
): string[] {
  const reasons: string[] = [];
  if (f.iv < t.iv) reasons.push("Low information value");
  const absGini = Math.abs(f.gini);
  if (absGini < t.gini) reasons.push("Low discriminatory power");
  const vPct = validPct(f, totalRows);
  if (vPct < t.minValidPct) reasons.push("Insufficient valid observations");
  const regularBins = f.bins.filter((b) => !b.is_special).length;
  if (regularBins < t.minBins) reasons.push("Insufficient distinct bins");
  return reasons;
}
