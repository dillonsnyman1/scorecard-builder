import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { exportShortlist, runStabilityAnalysis } from "../api/client";
import { WoeChart } from "./WoeChart";
import type { BinDetail, ExportFactor, FactorAnalysis, FactorThresholds, ScorecardResponse, StabilityResponse } from "../types/analysis";
import type { ClusterOverride } from "./ClusterShortlist";
import { factorValidPct, rejectionReasons } from "../types/analysis";

interface FactorSummary {
  factor_name: string;
  iv: number;
  gini: number;
  bins: BinDetail[];
}

interface Props {
  dataId: string;
  targetColumn: string;
  factors: FactorSummary[];
  allFactors: FactorAnalysis[];
  totalRows: number;
  thresholds: FactorThresholds;
  selectedAfterThresholds: Set<string>;
  overrideReasons: Record<string, string>;
  shortlistedFactors: Set<string>;
  clusterOverrides: Record<string, ClusterOverride>;
  factorDescriptions: Record<string, string>;
  scorecardData?: ScorecardResponse | null;
  onExportScoredData?: () => void;
  config?: {
    binningMethod: string;
    maxBins: number;
    corrThreshold: number;
    maxClusters: number | null;
  };
  specialValues: number[];
  columns: string[];
}

type AuditStatus = "Shortlisted" | "Rejected";

interface AuditRow {
  factor_name: string;
  description: string;
  dtype: string;
  iv: number;
  gini: number;
  valid_pct: number;
  regular_bins: number;
  status: AuditStatus;
  stage: string;
  reason: string;
}

function buildAudit(
  allFactors: FactorAnalysis[],
  totalRows: number,
  thresholds: FactorThresholds,
  selectedAfterThresholds: Set<string>,
  overrideReasons: Record<string, string>,
  shortlistedFactors: Set<string>,
  finalFactors: Set<string>,
  clusterOverrides: Record<string, ClusterOverride>,
  factorDescriptions: Record<string, string>,
): AuditRow[] {
  return allFactors.map((f) => {
    const vPct = factorValidPct(f, totalRows);
    const regBins = f.bins.filter((b) => !b.is_special).length;
    const reasons = rejectionReasons(f, totalRows, thresholds);
    const passesThresholds = reasons.length === 0;
    const wasSelected = selectedAfterThresholds.has(f.factor_name);
    const wasShortlisted = shortlistedFactors.has(f.factor_name);
    const isFinal = finalFactors.has(f.factor_name);
    const override = overrideReasons[f.factor_name] ?? "";

    let status: AuditStatus;
    let stage: string;
    let reason: string;

    if (isFinal) {
      status = "Shortlisted";
      if (!passesThresholds && wasSelected) {
        stage = "Univariate screening (user override)";
        reason = override || "Override reason not specified";
      } else {
        stage = "Final";
        reason = "";
      }
    } else if (!passesThresholds && !wasSelected) {
      status = "Rejected";
      stage = "Univariate screening";
      reason = reasons.join("; ");
    } else if (passesThresholds && !wasSelected) {
      status = "Rejected";
      stage = "Univariate screening (user exclusion)";
      reason = override || "User exclusion reason not specified";
    } else if (wasSelected && !wasShortlisted) {
      status = "Rejected";
      stage = "Factor clustering";
      const clusterOv = clusterOverrides[f.factor_name];
      if (clusterOv?.reason) {
        reason = clusterOv.reason + (clusterOv.preferredFactor ? ` (replaced by ${clusterOv.preferredFactor})` : "");
      } else {
        reason = "Replaced by higher-ranked factor in cluster";
      }
    } else if (!passesThresholds && wasSelected) {
      status = "Shortlisted";
      stage = "Univariate screening (user override)";
      reason = override || "Override reason not specified";
    } else {
      status = "Rejected";
      stage = "Factor clustering";
      reason = "Not selected from cluster";
    }

    return {
      factor_name: f.factor_name,
      description: factorDescriptions[f.factor_name] ?? "",
      dtype: f.dtype,
      iv: f.iv,
      gini: f.gini,
      valid_pct: vPct,
      regular_bins: regBins,
      status,
      stage,
      reason,
    };
  });
}

function statusClass(status: AuditStatus): string {
  return status === "Shortlisted" ? "audit-shortlisted" : "audit-rejected";
}

export function ExportPanel({
  dataId,
  targetColumn,
  factors,
  allFactors,
  totalRows,
  thresholds,
  selectedAfterThresholds,
  overrideReasons,
  shortlistedFactors,
  clusterOverrides,
  factorDescriptions,
  scorecardData,
  onExportScoredData,
  config,
  specialValues,
  columns,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFactor, setExpandedFactor] = useState<string | null>(null);
  const [dateColumn, setDateColumn] = useState("");
  const [periodType, setPeriodType] = useState("quarter");
  const [stabilityData, setStabilityData] = useState<StabilityResponse | null>(null);
  const [stabilityLoading, setStabilityLoading] = useState(false);
  const [stressPeriod, setStressPeriod] = useState("");
  const [benignPeriod, setBenignPeriod] = useState("");

  async function runStability(overrideStress?: string, overrideBenign?: string) {
    if (!dateColumn) return;
    setStabilityLoading(true);
    try {
      const factorsList = factors.map((f) => {
        const edges: number[] = [];
        for (const b of f.bins) {
          if (!b.is_special) {
            if (b.lower !== null) edges.push(b.lower);
            if (b.upper !== null) edges.push(b.upper);
          }
        }
        return { factor_name: f.factor_name, bin_edges: [...new Set(edges)].sort((a, b) => a - b) };
      });
      const result = await runStabilityAnalysis({
        data_id: dataId, target_column: targetColumn, date_column: dateColumn,
        factors: factorsList, special_values: specialValues, period: periodType,
        bucket_months: periodType === "year" ? 12 : periodType === "half" ? 6 : 3,
        date_start: null, date_end: null,
        base_score: scorecardData?.scaling_offset !== undefined
          ? Math.round(scorecardData.scaling_offset + scorecardData.scaling_factor * Math.log(50)) : 600,
        base_odds: 50, pdo: scorecardData ? Math.round(scorecardData.scaling_factor * Math.LN2) : 20,
        stress_period: (overrideStress ?? stressPeriod) || null,
        benign_period: (overrideBenign ?? benignPeriod) || null,
      });
      setStabilityData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stability analysis failed.");
    } finally {
      setStabilityLoading(false);
    }
  }

  const finalFactors = new Set(factors.map((f) => f.factor_name));
  const audit = buildAudit(
    allFactors, totalRows, thresholds,
    selectedAfterThresholds, overrideReasons,
    shortlistedFactors, finalFactors, clusterOverrides, factorDescriptions,
  );

  const shortlisted = audit.filter((a) => a.status === "Shortlisted");
  const rejected = audit.filter((a) => a.status === "Rejected");

  function getExportFactors(): ExportFactor[] {
    return factors.map((f) => {
      const edges: number[] = [];
      for (const b of f.bins) {
        if (!b.is_special) {
          if (b.lower !== null) edges.push(b.lower);
          if (b.upper !== null) edges.push(b.upper);
        }
      }
      return {
        factor_name: f.factor_name,
        bin_edges: [...new Set(edges)].sort((a, b) => a - b),
      };
    });
  }

  async function handleExport(format: "csv" | "json") {
    setLoading(true);
    setError(null);
    try {
      const blob = await exportShortlist({
        data_id: dataId,
        target_column: targetColumn,
        factors: getExportFactors(),
        format,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `shortlist.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleExportAudit() {
    const headers = ["Factor", "Description", "Type", "IV", "GINI", "Valid %", "Bins", "Status", "Stage", "Reason"];
    const rows = audit.map((a) => [
      a.factor_name, a.description, a.dtype, a.iv.toFixed(4), a.gini.toFixed(4),
      `${a.valid_pct.toFixed(1)}%`, a.regular_bins, a.status, a.stage, a.reason,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "factor_audit_report.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="export-panel">
      <h3>Report</h3>

      <div className="summary-cards">
        <div className="summary-card">
          <div className="summary-label">Total Factors</div>
          <div className="summary-value">{allFactors.length}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Shortlisted</div>
          <div className="summary-value">{shortlisted.length}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">Rejected</div>
          <div className="summary-value">{rejected.length}</div>
        </div>
        {scorecardData && (
          <>
            <div className="summary-card">
              <div className="summary-label">Scorecard Factors</div>
              <div className="summary-value">{scorecardData.factors.length}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">AUC / GINI</div>
              <div className="summary-value">{scorecardData.auc.toFixed(3)} / {scorecardData.gini.toFixed(3)}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Score Range</div>
              <div className="summary-value">{scorecardData.total_min_score.toFixed(0)} - {scorecardData.total_max_score.toFixed(0)}</div>
            </div>
          </>
        )}
      </div>

      {scorecardData && (
        <>
        <details className="collapsible-section">
          <summary>Scorecard Summary ({scorecardData.factors.length} factors)</summary>
          <div style={{ padding: 18 }}>
            <div className="table-wrapper">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Factor</th>
                    <th>Description</th>
                    <th>Coefficient</th>
                    <th>Min Pts</th>
                    <th>Max Pts</th>
                    <th>Bins</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecardData.factors.map((f) => {
                    const pts = f.bins.map((b) => b.points);
                    return (
                      <tr key={f.factor_name}>
                        <td>{f.factor_name}</td>
                        <td className="audit-description">{factorDescriptions[f.factor_name] ?? "-"}</td>
                        <td className="mono">{f.coefficient.toFixed(4)}</td>
                        <td className="mono">{Math.min(...pts).toFixed(1)}</td>
                        <td className="mono">{Math.max(...pts).toFixed(1)}</td>
                        <td>{f.bins.filter((b) => !b.group.startsWith("S")).length}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </details>

        <details className="collapsible-section">
          <summary>Scorecard Master Table</summary>
          <div style={{ padding: 18 }}>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Factor</th>
                    <th>Description</th>
                    <th>Attribute</th>
                    <th>Range / Value</th>
                    <th>Points</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecardData.factors.map((f) => {
                    const sorted = [
                      ...f.bins.filter((b) => b.group.startsWith("S")),
                      ...f.bins.filter((b) => !b.group.startsWith("S")),
                    ];
                    return sorted.map((b, i) => (
                      <tr key={`${f.factor_name}-${b.group}`}
                        className={b.group.startsWith("S") ? "special-bin-row" : ""}
                      >
                        {i === 0 ? (
                          <>
                            <td rowSpan={sorted.length} className="master-factor-cell">
                              {f.factor_name}
                            </td>
                            <td rowSpan={sorted.length} className="master-factor-cell audit-description">
                              {factorDescriptions[f.factor_name] ?? "-"}
                            </td>
                          </>
                        ) : null}
                        <td className="mono">{b.group.startsWith("S") ? b.bin_label : `Group ${b.group}`}</td>
                        <td className="mono">{b.bin_label}</td>
                        <td className={`mono ${b.points >= 0 ? "points-positive" : "points-negative"}`}>
                          {b.points.toFixed(1)}
                        </td>
                      </tr>
                    ));
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </details>
        </>
      )}

      {scorecardData && scorecardData.score_distribution.length > 0 && (
        <details className="collapsible-section">
          <summary>Score Distribution</summary>
          <div style={{ padding: 18 }}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={scorecardData.score_distribution} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="band" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={60} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value, name) => {
                  if (name === "pct") return `${Number(value).toFixed(1)}%`;
                  return Number(value).toLocaleString();
                }} />
                <Bar dataKey="count" name="Count" radius={[3, 3, 0, 0]}>
                  {scorecardData.score_distribution.map((_, i) => (
                    <Cell key={i} fill="var(--accent)" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </details>
      )}

      {scorecardData && scorecardData.stepwise_log.length > 0 && (
        <details className="collapsible-section">
          <summary>Factor Selection Log ({scorecardData.stepwise_log.length} steps)</summary>
          <div style={{ padding: 18 }}>
            <div className="table-wrapper">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>Step</th>
                    <th>Action</th>
                    <th>Factor</th>
                    <th>P-value</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {scorecardData.stepwise_log.map((s) => (
                    <tr key={`${s.step}-${s.factor_name}`} className={s.action === "Added" || s.action === "Selected" || s.action === "Forced" ? "audit-shortlisted" : "audit-rejected"}>
                      <td className="mono">{s.step}</td>
                      <td><span className={`audit-badge ${s.action === "Added" || s.action === "Selected" || s.action === "Forced" ? "audit-shortlisted" : "audit-rejected"}`}>{s.action}</span></td>
                      <td>{s.factor_name}</td>
                      <td className="mono">{s.p_value !== null ? s.p_value.toFixed(4) : "-"}</td>
                      <td className="audit-reason">{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}

      <details className="collapsible-section">
        <summary>Configuration Summary</summary>
        <div style={{ padding: 18 }}>
          <div className="config-summary-grid">
            <div className="config-summary-section">
              <h4>Data</h4>
              <dl>
                <dt>Observations</dt><dd>{totalRows.toLocaleString()}</dd>
                <dt>Target variable</dt><dd className="mono">{targetColumn}</dd>
                <dt>Total factors</dt><dd>{allFactors.length}</dd>
              </dl>
            </div>
            <div className="config-summary-section">
              <h4>Binning</h4>
              <dl>
                <dt>Method</dt><dd>{config?.binningMethod === "equal_frequency" ? "Equal Frequency" : "Optimal (Tree)"}</dd>
                <dt>Max bins</dt><dd>{config?.maxBins ?? 10}</dd>
              </dl>
            </div>
            <div className="config-summary-section">
              <h4>Screening Thresholds</h4>
              <dl>
                <dt>Min IV</dt><dd>{thresholds.iv}</dd>
                <dt>Min GINI</dt><dd>{thresholds.gini}</dd>
                <dt>Min Valid %</dt><dd>{thresholds.minValidPct}%</dd>
                <dt>Min Bins</dt><dd>{thresholds.minBins}</dd>
              </dl>
            </div>
            <div className="config-summary-section">
              <h4>Clustering</h4>
              <dl>
                <dt>Correlation threshold</dt><dd>{config?.corrThreshold ?? 0.5}</dd>
                <dt>Max clusters</dt><dd>{config?.maxClusters ?? "Auto"}</dd>
              </dl>
            </div>
            {scorecardData && (
              <div className="config-summary-section">
                <h4>Scorecard</h4>
                <dl>
                  <dt>Base score</dt><dd>{scorecardData.scaling_offset !== undefined ? Math.round(scorecardData.scaling_offset + scorecardData.scaling_factor * Math.log(50)) : 600}</dd>
                  <dt>PDO</dt><dd>{Math.round(scorecardData.scaling_factor * Math.LN2)}</dd>
                  <dt>Factors in model</dt><dd>{scorecardData.factors.length}</dd>
                  <dt>Round points</dt><dd>{Number.isInteger(scorecardData.factors[0]?.bins[0]?.points) ? "Yes" : "No"}</dd>
                </dl>
              </div>
            )}
          </div>
        </div>
      </details>

      <details className="collapsible-section">
        <summary>Stability Analysis (PSI)</summary>
        <div style={{ padding: 18 }}>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text)" }}>
            Assess whether the applicant population and score distribution have shifted
            across time periods. PSI measures distribution change, not default rate movement.
          </p>
          <div className="threshold-fields" style={{ marginBottom: 16 }}>
            <div className="threshold-field">
              <label>Date column</label>
              <select value={dateColumn} onChange={(e) => setDateColumn(e.target.value)}>
                <option value="">Select...</option>
                {columns.filter((c) => c !== targetColumn).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="threshold-field">
              <label>Period</label>
              <div className="method-toggle">
                <button className={`method-btn ${periodType === "quarter" ? "active" : ""}`}
                  onClick={() => setPeriodType("quarter")}>Quarter</button>
                <button className={`method-btn ${periodType === "half" ? "active" : ""}`}
                  onClick={() => setPeriodType("half")}>Half-Year</button>
                <button className={`method-btn ${periodType === "year" ? "active" : ""}`}
                  onClick={() => setPeriodType("year")}>Year</button>
              </div>
            </div>
            <button className="primary-button" disabled={!dateColumn || stabilityLoading}
              onClick={() => runStability()}
            >
              {stabilityLoading ? "Analysing..." : "Run Analysis"}
            </button>
          </div>

          {stabilityData && (
            <>
              <div className="table-wrapper" style={{ marginBottom: 16 }}>
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Observations</th>
                      <th>Events</th>
                      <th>Event Rate</th>
                      <th>Mean Score</th>
                      <th>PSI</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stabilityData.periods.map((p) => (
                      <tr key={p.period}>
                        <td className="mono">{p.period}</td>
                        <td>{p.obs_count.toLocaleString()}</td>
                        <td>{p.event_count.toLocaleString()}</td>
                        <td className="mono">{(p.event_rate * 100).toFixed(2)}%</td>
                        <td className="mono">{p.mean_score !== null ? p.mean_score.toFixed(1) : "-"}</td>
                        <td className={`mono ${p.psi !== null && p.psi > 0.25 ? "points-negative" : p.psi !== null && p.psi > 0.1 ? "sig-mid" : ""}`}>
                          {p.psi !== null ? p.psi.toFixed(4) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {stabilityData.overall_psi !== null && (
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text)" }}>
                  Overall PSI (latest period vs full population): <strong
                    className={stabilityData.overall_psi > 0.25 ? "points-negative" : stabilityData.overall_psi > 0.1 ? "sig-mid" : ""}
                  >{stabilityData.overall_psi.toFixed(4)}</strong>
                  {stabilityData.overall_psi < 0.1 && " - stable"}
                  {stabilityData.overall_psi >= 0.1 && stabilityData.overall_psi < 0.25 && " - moderate shift"}
                  {stabilityData.overall_psi >= 0.25 && " - significant shift"}
                </p>
              )}

              {stabilityData.factor_stability.length > 0 && (
                <>
                  <h4 style={{ margin: "0 0 8px", fontSize: 14 }}>Factor IV Stability by Period</h4>
                  <div className="table-wrapper">
                    <table className="data-table compact">
                      <thead>
                        <tr>
                          <th>Factor</th>
                          {stabilityData.periods.map((p) => (
                            <th key={p.period} className="mono">{p.period}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stabilityData.factor_stability.map((fs) => (
                          <tr key={fs.factor_name}>
                            <td>{fs.factor_name}</td>
                            {stabilityData.periods.map((p) => {
                              const pd = fs.periods.find((fp) => fp.period === p.period);
                              return <td key={p.period} className="mono">{pd ? pd.iv.toFixed(4) : "-"}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </details>

      <details className="collapsible-section">
        <summary>Cyclicality Analysis</summary>
        <div style={{ padding: 18 }}>
          <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text)" }}>
            Measures how sensitive the model's PD predictions are to changes in the
            Observed Default Rate (ODR) across time periods. This is distinct from population
            stability - cyclicality asks whether the model's risk ranking moves with the
            economic cycle.
          </p>

          {!stabilityData && (
            <p style={{ margin: 0, fontSize: 13, color: "var(--text)", fontStyle: "italic" }}>
              Run the stability analysis above first to generate cyclicality measures.
            </p>
          )}

          {stabilityData && (
            <>
              <div className="table-wrapper" style={{ marginBottom: 16 }}>
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>ODR</th>
                      <th>Mean Model PD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stabilityData.periods.map((p) => (
                      <tr key={p.period}>
                        <td className="mono">{p.period}</td>
                        <td className="mono">{(p.event_rate * 100).toFixed(2)}%</td>
                        <td className="mono">{p.mean_model_pd !== null ? (p.mean_model_pd * 100).toFixed(2) + "%" : "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stabilityData.periods.map((p) => ({
                  period: p.period,
                  event_rate: p.event_rate * 100,
                }))} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={50} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                  <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                  <Bar dataKey="event_rate" name="ODR %" radius={[3, 3, 0, 0]}>
                    {stabilityData.periods.map((_, i) => (
                      <Cell key={i} fill="var(--accent)" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {Object.keys(stabilityData.cyclicality).length > 0 && (
                <>
                  <h4 style={{ margin: "16px 0 4px", fontSize: 14 }}>Cyclicality Measures</h4>
                  <div className="threshold-fields" style={{ marginBottom: 12 }}>
                    <div className="threshold-field">
                      <label>Benign period</label>
                      <select value={benignPeriod} onChange={(e) => {
                        setBenignPeriod(e.target.value);
                        runStability(undefined, e.target.value);
                      }}>
                        <option value="">Auto (lowest ODR)</option>
                        {stabilityData.periods.map((p) => (
                          <option key={p.period} value={p.period}>{p.period} (ODR {(p.event_rate * 100).toFixed(1)}%)</option>
                        ))}
                      </select>
                    </div>
                    <div className="threshold-field">
                      <label>Stress period</label>
                      <select value={stressPeriod} onChange={(e) => {
                        setStressPeriod(e.target.value);
                        runStability(e.target.value, undefined);
                      }}>
                        <option value="">Auto (highest ODR)</option>
                        {stabilityData.periods.map((p) => (
                          <option key={p.period} value={p.period}>{p.period} (ODR {(p.event_rate * 100).toFixed(1)}%)</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="table-wrapper">
                    <table className="data-table compact">
                      <thead>
                        <tr>
                          <th>Method</th>
                          <th>Value</th>
                          <th>Interpretation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stabilityData.cyclicality.log_regression !== undefined && (
                          <tr>
                            <td>Log-log regression</td>
                            <td className="mono">{stabilityData.cyclicality.log_regression.toFixed(4)}</td>
                            <td>{Math.abs(stabilityData.cyclicality.log_regression) > 0.8 ? "Highly PIT" :
                              Math.abs(stabilityData.cyclicality.log_regression) > 0.5 ? "Moderately cyclical" :
                              Math.abs(stabilityData.cyclicality.log_regression) > 0.2 ? "Low cyclicality" : "Near TTC"}</td>
                          </tr>
                        )}
                        {stabilityData.cyclicality.two_point !== undefined && (
                          <tr>
                            <td>Two-point Delta PD / Delta ODR{stabilityData.cyclicality.two_point_periods ? ` (${stabilityData.cyclicality.two_point_periods})` : ""}</td>
                            <td className="mono">{stabilityData.cyclicality.two_point.toFixed(4)}</td>
                            <td>{Math.abs(stabilityData.cyclicality.two_point) > 1 ? "Amplifies cycle" :
                              Math.abs(stabilityData.cyclicality.two_point) > 0.5 ? "Passes through cycle" :
                              Math.abs(stabilityData.cyclicality.two_point) > 0 ? "Dampens cycle" : "No sensitivity"}</td>
                          </tr>
                        )}
                        {stabilityData.cyclicality.cv_model_pd !== undefined && (
                          <tr>
                            <td>CV of model PD</td>
                            <td className="mono">{stabilityData.cyclicality.cv_model_pd.toFixed(4)}</td>
                            <td>{stabilityData.cyclicality.cv_model_pd > 0.3 ? "High dispersion" :
                              stabilityData.cyclicality.cv_model_pd > 0.15 ? "Moderate dispersion" : "Low dispersion"}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </details>

      <details className="collapsible-section">
        <summary>Factor Audit Report ({allFactors.length} factors)</summary>
        <div className="audit-table-container">
          <div className="table-wrapper">
            <table className="data-table compact">
              <thead>
                <tr>
                  <th>Factor</th>
                  <th>Description</th>
                  <th>IV</th>
                  <th>GINI</th>
                  <th>Valid %</th>
                  <th>Bins</th>
                  <th>Status</th>
                  <th>Stage</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a.factor_name} className={statusClass(a.status)}>
                    <td>{a.factor_name}</td>
                    <td className="audit-description">{a.description || "-"}</td>
                    <td className="mono">{a.iv.toFixed(4)}</td>
                    <td className="mono">{a.gini.toFixed(4)}</td>
                    <td className="mono">{a.valid_pct.toFixed(1)}%</td>
                    <td>{a.regular_bins}</td>
                    <td><span className={`audit-badge ${statusClass(a.status)}`}>{a.status}</span></td>
                    <td>{a.stage}</td>
                    <td className="audit-reason">{a.reason || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      <details className="collapsible-section">
        <summary>Shortlist Binning Summary ({factors.length} factors)</summary>
        <div style={{ padding: 18 }}>
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Factor</th>
                  <th>Description</th>
                  <th>IV</th>
                  <th>GINI</th>
                  <th>Bins</th>
                  <th>Trend</th>
                  <th style={{ width: 44 }}></th>
                </tr>
              </thead>
              <tbody>
                {factors.map((f) => {
                  const regularBins = f.bins.filter((b) => !b.is_special);
                  const woe = regularBins.map((b) => b.woe);
                  const inc = woe.length <= 1 || woe.every((w, i) => i === 0 || w >= woe[i - 1]);
                  const dec = woe.length <= 1 || woe.every((w, i) => i === 0 || w <= woe[i - 1]);
                  const trend = dec ? "Decreasing" : inc ? "Increasing" : "Non-monotonic";
                  const isExpanded = expandedFactor === f.factor_name;
                  return (
                    <>
                      <tr key={f.factor_name}>
                        <td>{f.factor_name}</td>
                        <td className="audit-description">{factorDescriptions[f.factor_name] ?? "-"}</td>
                        <td className="mono">{f.iv.toFixed(4)}</td>
                        <td className="mono">{f.gini.toFixed(4)}</td>
                        <td>{regularBins.length}</td>
                        <td className={trend === "Non-monotonic" ? "monotonic-no" : "monotonic-yes"}>{trend}</td>
                        <td>
                          <button
                            className="link-button"
                            onClick={() => setExpandedFactor(isExpanded ? null : f.factor_name)}
                          >
                            {isExpanded ? "Hide" : "Show"}
                          </button>
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="expanded-row">
                          <td colSpan={7}>
                            <div className="expanded-content">
                              <div className="expanded-chart">
                                <WoeChart bins={f.bins} compact />
                              </div>
                              <div style={{ padding: "0 14px 12px" }}>
                                <table className="data-table compact">
                                  <thead>
                                    <tr>
                                      <th style={{ width: 50 }}>Group</th>
                                      <th>Bin</th>
                                      <th>Count</th>
                                      <th>Event Rate</th>
                                      <th>WoE</th>
                                      <th>IV Contrib</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {regularBins.map((b, i) => (
                                      <tr key={b.bin_label}>
                                        <td className="mono group-cell">{i + 1}</td>
                                        <td className="mono">{b.bin_label}</td>
                                        <td>{b.count.toLocaleString()}</td>
                                        <td className="mono">{(b.event_rate * 100).toFixed(2)}%</td>
                                        <td className="mono">{b.woe.toFixed(4)}</td>
                                        <td className="mono">{b.iv_contribution.toFixed(4)}</td>
                                      </tr>
                                    ))}
                                    {f.bins.filter((b) => b.is_special).length > 0 && (
                                      <>
                                        <tr className="special-separator">
                                          <td colSpan={6}>Missing / Special Values</td>
                                        </tr>
                                        {f.bins.filter((b) => b.is_special).map((b, i) => (
                                          <tr key={b.bin_label} className="special-bin-row">
                                            <td className="mono group-cell">S{i + 1}</td>
                                            <td className="mono">{b.bin_label}</td>
                                            <td>{b.count.toLocaleString()}</td>
                                            <td className="mono">{(b.event_rate * 100).toFixed(2)}%</td>
                                            <td className="mono">{b.woe.toFixed(4)}</td>
                                            <td className="mono">{b.iv_contribution.toFixed(4)}</td>
                                          </tr>
                                        ))}
                                      </>
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </details>

      {error && <div className="status-message error">{error}</div>}

      <div className="export-actions">
        <button className="primary-button" onClick={() => handleExport("csv")} disabled={loading}>
          Export Binning CSV
        </button>
        <button className="primary-button" onClick={() => handleExport("json")} disabled={loading}>
          Export Binning JSON
        </button>
        {scorecardData && (
          <button className="primary-button" onClick={() => {
            const headers = ["Factor", "Group", "Bin", "WoE", "Points", "Count", "Event Rate"];
            const rows: string[][] = [];
            for (const f of scorecardData.factors) {
              for (const b of f.bins) {
                rows.push([
                  f.factor_name, b.group, b.bin_label,
                  b.woe.toFixed(4), b.points.toFixed(1),
                  b.count.toString(), `${(b.event_rate * 100).toFixed(2)}%`,
                ]);
              }
            }
            const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
            const blob = new Blob([csv], { type: "text/csv" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "scorecard_points.csv";
            a.click();
            URL.revokeObjectURL(url);
          }}>
            Export Scorecard CSV
          </button>
        )}
        <button className="link-button" onClick={handleExportAudit}>
          Export Audit Report
        </button>
        {onExportScoredData && scorecardData && (
          <button className="primary-button" onClick={onExportScoredData}>
            Export Scored Data
          </button>
        )}
      </div>

      {scorecardData && (
        <div className="next-steps-card">
          <h3>Next Steps</h3>
          <p>
            The scored dataset (score + default indicator per observation) can be exported
            and used for PD calibration - the process of mapping scorecard scores to
            calibrated Probabilities of Default. Several calibration methodologies can be applied to achieve this.
          </p>
          <p>
            One such approach is the Monotone Adjacent Pooling Algorithm (MAPA). Export the
            scored data above and try it in the{" "}
            <a href="https://dcg14fdv56g8g.cloudfront.net" target="_blank" rel="noopener noreferrer">
              MAPA PD Calibration Tool
            </a>
            {" "}to see how scores translate to calibrated PDs.
          </p>
        </div>
      )}
    </div>
  );
}
