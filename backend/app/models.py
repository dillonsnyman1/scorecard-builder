from __future__ import annotations

from enum import Enum

from pydantic import BaseModel, Field


class BinningMethod(str, Enum):
    tree = "tree"
    equal_frequency = "equal_frequency"


class MonotonicityDirection(str, Enum):
    auto = "auto"
    increasing = "increasing"
    decreasing = "decreasing"
    u_shaped = "u_shaped"


class ExportFormat(str, Enum):
    csv = "csv"
    json = "json"


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------

class ColumnProfile(BaseModel):
    name: str
    dtype: str
    missing_count: int
    missing_pct: float
    unique_count: int
    sample_values: list[str]
    special_value_counts: dict[str, int] = {}


class DetectedSpecials(BaseModel):
    column: str
    values: list[float]
    counts: list[int]


class UploadResponse(BaseModel):
    data_id: str
    row_count: int
    column_count: int
    columns: list[ColumnProfile]
    detected_specials: list[DetectedSpecials] = []


# ---------------------------------------------------------------------------
# Univariate analysis
# ---------------------------------------------------------------------------

class UnivariateRequest(BaseModel):
    data_id: str
    target_column: str
    binning_method: BinningMethod = BinningMethod.tree
    max_bins: int = Field(default=10, ge=2, le=50)
    iv_threshold: float = Field(default=0.02, ge=0.0)
    special_values: list[float] = Field(default_factory=lambda: [-999.0, 9999.0])


class BinDetail(BaseModel):
    bin_label: str
    lower: float | None = None
    upper: float | None = None
    count: int
    event_count: int
    event_rate: float
    non_event_count: int
    woe: float
    iv_contribution: float
    pct_events: float
    pct_non_events: float
    is_special: bool = False


class FactorAnalysis(BaseModel):
    factor_name: str
    dtype: str
    iv: float
    gini: float
    bins: list[BinDetail]
    missing_count: int = 0
    special_count: int = 0


class UnivariateResponse(BaseModel):
    factors: list[FactorAnalysis]
    target_event_rate: float
    total_events: int
    total_non_events: int


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------

class ClusterRequest(BaseModel):
    data_id: str
    target_column: str
    factor_names: list[str]
    distance_threshold: float = Field(default=0.5, ge=0.0, le=2.0)
    max_clusters: int | None = Field(default=None, ge=1)


class ClusterFactor(BaseModel):
    factor_name: str
    gini: float
    iv: float
    is_selected: bool


class ClusterResult(BaseModel):
    cluster_id: int
    factors: list[ClusterFactor]


class ClusterResponse(BaseModel):
    correlation_matrix: list[list[float]]
    factor_names: list[str]
    clusters: list[ClusterResult]
    linkage_matrix: list[list[float]]


# ---------------------------------------------------------------------------
# Bin refinement
# ---------------------------------------------------------------------------

class RefineBinsRequest(BaseModel):
    data_id: str
    target_column: str
    factor_name: str
    bin_edges: list[float]
    enforce_monotonicity: bool = False
    monotonicity_direction: MonotonicityDirection = MonotonicityDirection.auto
    special_values: list[float] = Field(default_factory=lambda: [-999.0, 9999.0])


class RefineBinsResponse(BaseModel):
    bins: list[BinDetail]
    iv: float
    gini: float
    is_monotonic: bool
    data_min: float | None = None
    data_max: float | None = None


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------

class ExportFactor(BaseModel):
    factor_name: str
    bin_edges: list[float]


class ExportRequest(BaseModel):
    data_id: str
    target_column: str
    factors: list[ExportFactor]
    format: ExportFormat = ExportFormat.csv


# ---------------------------------------------------------------------------
# Scorecard fitting
# ---------------------------------------------------------------------------

class SelectionMethod(str, Enum):
    all_factors = "all"
    forward = "forward"
    backward = "backward"
    stepwise = "stepwise"
    lasso = "lasso"


class ScorecardRequest(BaseModel):
    data_id: str
    target_column: str
    factors: list[ExportFactor]
    special_values: list[float] = Field(default_factory=lambda: [-999.0, 9999.0])
    base_score: float = Field(default=600.0)
    base_odds: float = Field(default=50.0)
    pdo: int = Field(default=20)
    max_factors: int | None = Field(default=None, ge=1)
    selection_method: SelectionMethod = SelectionMethod.stepwise
    p_value_enter: float = Field(default=0.05, ge=0.0, le=1.0)
    p_value_remove: float = Field(default=0.05, ge=0.0, le=1.0)
    forced_factors: list[str] = Field(default_factory=list)
    max_corr: float | None = Field(default=None, ge=0.0, le=1.0)
    round_points: bool = False


class ScorecardBinPoints(BaseModel):
    group: str
    bin_label: str
    woe: float
    points: float
    count: int
    event_rate: float


class ScorecardFactor(BaseModel):
    factor_name: str
    coefficient: float
    p_value: float | None
    vif: float | None
    bins: list[ScorecardBinPoints]


class StepwiseStep(BaseModel):
    step: int
    action: str
    factor_name: str
    p_value: float | None
    reason: str


class ScorecardResponse(BaseModel):
    factors: list[ScorecardFactor]
    intercept: float
    base_points: float
    scaling_factor: float
    scaling_offset: float
    auc: float
    gini: float
    ks_statistic: float
    total_min_score: float
    total_max_score: float
    score_distribution: list[dict]
    stepwise_log: list[StepwiseStep] = []
    dropped_factors: list[str] = []
    negative_coefficients: list[str] = []
