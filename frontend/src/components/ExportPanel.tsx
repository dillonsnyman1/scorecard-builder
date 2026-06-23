import { useState } from "react";
import { exportFullReport } from "../utils/exportReport";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { WoeChart } from "./WoeChart";
import type { BinDetail, FactorAnalysis, FactorThresholds, ScorecardResponse, StabilityResponse } from "../types/analysis";
import type { ClusterOverride } from "./ClusterShortlist";
import { factorValidPct, rejectionReasons } from "../types/analysis";

interface FactorSummary {
  factor_name: string;
  iv: number;
  gini: number;
  bins: BinDetail[];
}

interface Props {
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
  stabilityData?: StabilityResponse | null;
  onExportScoredData?: () => void;
  config?: {
    binningMethod: string;
    maxBins: number;
    corrThreshold: number;
    maxClusters: number | null;
    dateColumn: string;
    efwMethod: string;
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
  in_model: boolean;
  model_rejection_reason: string;
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
  scorecardFactors: Set<string>,
  stepwiseLog: Array<{ action: string; factor_name: string; reason: string }>,
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

    const inModel = scorecardFactors.has(f.factor_name);
    let modelRejectionReason = "";
    if (isFinal && !inModel) {
      const logEntry = stepwiseLog.find(
        (s) => s.factor_name === f.factor_name && (s.action === "Removed" || s.action === "Not entered"),
      );
      modelRejectionReason = logEntry?.reason ?? "Dropped during model fitting";
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
      in_model: inModel,
      model_rejection_reason: inModel ? "" : (isFinal ? modelRejectionReason : ""),
    };
  });
}

function statusClass(status: AuditStatus): string {
  return status === "Shortlisted" ? "audit-shortlisted" : "audit-rejected";
}

export function ExportPanel({
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
  stabilityData,
  onExportScoredData,
  config,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFactor, setExpandedFactor] = useState<string | null>(null);


  const finalFactors = new Set(factors.map((f) => f.factor_name));
  const audit = buildAudit(
    allFactors, totalRows, thresholds,
    selectedAfterThresholds, overrideReasons,
    shortlistedFactors, finalFactors, clusterOverrides, factorDescriptions,
    new Set(scorecardData?.factors.map((f) => f.factor_name) ?? []),
    scorecardData?.stepwise_log ?? [],
  );

  const shortlisted = audit.filter((a) => a.status === "Shortlisted");
  const rejected = audit.filter((a) => a.status === "Rejected");



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
              <div style={{ marginTop: 6, fontSize: 13, color: "var(--text)" }}>Range: {scorecardData.total_min_score.toFixed(0)} - {scorecardData.total_max_score.toFixed(0)}</div>
            </div>
          </>
        )}
      </div>

      <details className="collapsible-section">
        <summary>Configuration Summary</summary>
        <div style={{ padding: 18 }}>
          <div className="config-summary-grid">
            <div className="config-summary-section">
              <h4>Data</h4>
              <dl>
                <dt>Observations</dt><dd>{totalRows.toLocaleString()}</dd>
                <dt>Target variable</dt><dd className="mono">{targetColumn}</dd>
                <dt>Date column</dt><dd className="mono">{config?.dateColumn || "-"}</dd>
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

      {scorecardData && (
        <>
        <details className="collapsible-section">
          <summary>Scorecard Summary ({scorecardData.factors.length} factors)</summary>
          <div style={{ padding: 18 }}>
            {(() => {
              const em = config?.efwMethod ?? "range";
              const efwRaw = scorecardData.factors.map((f) => {
                const pts = f.bins.map((b) => b.points);
                const woeVals = f.bins.filter((b) => !b.group.startsWith("S")).map((b) => b.woe);
                const woeStd = woeVals.length > 1 ? Math.sqrt(woeVals.reduce((s, w) => s + (w - woeVals.reduce((a, b) => a + b, 0) / woeVals.length) ** 2, 0) / woeVals.length) : 0;
                const raw = em === "coefficient" ? Math.abs(f.coefficient) : em === "variance" ? Math.abs(f.coefficient) * woeStd : Math.max(...pts) - Math.min(...pts);
                return { name: f.factor_name, raw };
              });
              const totalEfw = efwRaw.reduce((s, e) => s + e.raw, 0) || 1;
              const efwMap: Record<string, number> = {};
              efwRaw.forEach((e) => { efwMap[e.name] = (e.raw / totalEfw) * 100; });
              return (
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
                    <th>EFW %</th>
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
                        <td className="mono">{(efwMap[f.factor_name] ?? 0).toFixed(1)}%</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
              );
            })()}
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

      {stabilityData && (
        <>
        <details className="collapsible-section">
          <summary>GINI over Time</summary>
          <div style={{ padding: 18 }}>
            {stabilityData.periods.some((p) => p.gini !== null) && (<>
              <div className="table-wrapper">
                <table className="data-table compact">
                  <thead><tr><th>Period</th><th>GINI</th><th>GINI SE</th><th>Obs</th><th>Event Rate</th></tr></thead>
                  <tbody>
                    {stabilityData.periods.map((p) => (
                      <tr key={p.period}><td className="mono">{p.period.slice(0, 4)}</td><td className="mono">{p.gini !== null ? p.gini.toFixed(4) : "-"}</td><td className="mono">{p.gini_se !== null ? p.gini_se.toFixed(4) : "-"}</td><td>{p.obs_count.toLocaleString()}</td><td className="mono">{(p.event_rate * 100).toFixed(2)}%</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ResponsiveContainer width="100%" height={250}>
                <ComposedChart data={stabilityData.periods.filter((p) => p.gini !== null).map((p) => ({
                  period: p.period.slice(0, 4),
                  gini: p.gini! * 100,
                  gini_upper: p.gini_se !== null ? (p.gini! + p.gini_se) * 100 : undefined,
                  gini_lower: p.gini_se !== null ? (p.gini! - p.gini_se) * 100 : undefined,
                }))} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                  <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                  <Line type="monotone" dataKey="gini_upper" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" dot={false} name="GINI + SE" />
                  <Line type="monotone" dataKey="gini_lower" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" dot={false} name="GINI - SE" />
                  <Line type="monotone" dataKey="gini" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} name="GINI %" />
                </ComposedChart>
              </ResponsiveContainer>
            </>)}
          </div>
        </details>
        <details className="collapsible-section">
          <summary>Stability Analysis</summary>
          <div style={{ padding: 18 }}>
            <details>
              <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text-h)", cursor: "pointer", marginBottom: 8 }}>Score PSI Year-on-Year</summary>
              <div className="table-wrapper" style={{ marginBottom: 16 }}>
                <table className="data-table compact">
                  <thead><tr><th>Period</th><th>Obs</th><th>Events</th><th>Event Rate</th><th>Mean Score</th><th>PSI</th></tr></thead>
                  <tbody>
                    {stabilityData.periods.map((p) => (
                      <tr key={p.period}><td className="mono">{p.period.slice(0, 4)}</td><td>{p.obs_count.toLocaleString()}</td><td>{p.event_count.toLocaleString()}</td><td className="mono">{(p.event_rate * 100).toFixed(2)}%</td><td className="mono">{p.mean_score !== null ? p.mean_score.toFixed(1) : "-"}</td><td className={`mono ${p.psi !== null ? p.psi > 0.25 ? "psi-red" : p.psi > 0.1 ? "psi-amber" : "psi-green" : ""}`}>{p.psi !== null ? p.psi.toFixed(4) : "-"}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
            {stabilityData.factor_stability.length > 0 && (
              <details>
                <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text-h)", cursor: "pointer", marginBottom: 8 }}>Factor IV by Period</summary>
                <div className="table-wrapper" style={{ marginBottom: 16 }}>
                  <table className="data-table compact">
                    <thead><tr><th>Factor</th>{stabilityData.periods.map((p) => (<th key={p.period} className="mono">{p.period.slice(0, 4)}</th>))}</tr></thead>
                    <tbody>
                      {stabilityData.factor_stability.map((fs) => (<tr key={fs.factor_name}><td>{fs.factor_name}</td>{stabilityData.periods.map((p) => { const pd = fs.periods.find((fp) => fp.period === p.period); const iv = pd?.iv; return <td key={p.period} className={`mono ${iv != null ? iv >= 0.1 ? "iv-green" : iv >= 0.02 ? "iv-amber" : "iv-red" : ""}`}>{pd ? pd.iv.toFixed(4) : "-"}</td>; })}</tr>))}
                    </tbody>
                  </table>
                </div>
              </details>
            )}
            {(stabilityData.factor_psi ?? []).length > 0 && (<>
              <details>
                <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text-h)", cursor: "pointer", marginBottom: 8 }}>Factor PSI Year-on-Year</summary>
                <div className="table-wrapper" style={{ marginBottom: 16 }}>
                  <table className="data-table compact">
                    <thead><tr><th>Factor</th>{stabilityData.periods.map((p) => (<th key={p.period} className="mono">{p.period.slice(0, 4)}</th>))}</tr></thead>
                    <tbody>
                      {(stabilityData.factor_psi ?? []).map((fp) => (<tr key={fp.factor_name}><td>{fp.factor_name}</td>{stabilityData.periods.map((p) => { const pd = fp.periods.find((x) => x.period === p.period); const val = pd?.psi_yoy; return <td key={p.period} className={`mono ${val != null ? val > 0.25 ? "psi-red" : val > 0.1 ? "psi-amber" : "psi-green" : ""}`}>{val != null ? val.toFixed(4) : "-"}</td>; })}</tr>))}
                    </tbody>
                  </table>
                </div>
              </details>
              <details>
                <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text-h)", cursor: "pointer", marginBottom: 8 }}>Factor PSI vs Latest ({stabilityData.periods[stabilityData.periods.length - 1]?.period.slice(0, 4)})</summary>
                <div className="table-wrapper">
                  <table className="data-table compact">
                    <thead><tr><th>Factor</th>{stabilityData.periods.map((p) => (<th key={p.period} className="mono">{p.period.slice(0, 4)}</th>))}</tr></thead>
                    <tbody>
                      {(stabilityData.factor_psi ?? []).map((fp) => (<tr key={fp.factor_name}><td>{fp.factor_name}</td>{stabilityData.periods.map((p) => { const pd = fp.periods.find((x) => x.period === p.period); const val = pd?.psi_vs_latest; return <td key={p.period} className={`mono ${val != null ? val > 0.25 ? "psi-red" : val > 0.1 ? "psi-amber" : "psi-green" : ""}`}>{val != null ? val.toFixed(4) : "-"}</td>; })}</tr>))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>)}
          </div>
        </details>

        <details className="collapsible-section">
          <summary>Cyclicality Analysis</summary>
          <div style={{ padding: 18 }}>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={stabilityData.periods.map((p) => ({
                period: p.period.slice(0, 4),
                odr: p.event_rate * 100,
                model_pd: p.mean_model_pd !== null ? p.mean_model_pd * 100 : undefined,
              }))} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(1)}%`} />
                <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} />
                <Line type="monotone" dataKey="odr" name="ODR" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="model_pd" name="Model PD" stroke="var(--negative)" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="5 3" />
              </ComposedChart>
            </ResponsiveContainer>
            <div className="table-wrapper" style={{ marginBottom: 12 }}>
              <table className="data-table compact">
                <thead><tr><th></th>{stabilityData.periods.map((p) => (<th key={p.period} className="mono">{p.period.slice(0, 4)}</th>))}</tr></thead>
                <tbody>
                  <tr><td style={{ fontWeight: 600 }}>ODR</td>{stabilityData.periods.map((p) => (<td key={p.period} className="mono">{(p.event_rate * 100).toFixed(2)}%</td>))}</tr>
                  <tr><td style={{ fontWeight: 600 }}>Model PD</td>{stabilityData.periods.map((p) => (<td key={p.period} className="mono">{p.mean_model_pd !== null ? (p.mean_model_pd * 100).toFixed(2) + "%" : "-"}</td>))}</tr>
                </tbody>
              </table>
            </div>
            {Object.keys(stabilityData.cyclicality).length > 0 && (
              <div className="table-wrapper">
                <table className="data-table compact">
                  <thead><tr><th>Method</th><th>Value</th><th>Interpretation</th></tr></thead>
                  <tbody>
                    {stabilityData.cyclicality.log_regression !== undefined && (<tr><td>Log-log regression</td><td className="mono">{stabilityData.cyclicality.log_regression.toFixed(4)}</td><td>{Math.abs(stabilityData.cyclicality.log_regression) > 0.8 ? "Predominantly PIT" : Math.abs(stabilityData.cyclicality.log_regression) > 0.3 ? "Hybrid" : Math.abs(stabilityData.cyclicality.log_regression) > 0.1 ? "Largely TTC" : "Near TTC"}</td></tr>)}
                    {stabilityData.cyclicality.two_point !== undefined && (<tr><td>Two-point{stabilityData.cyclicality.two_point_periods ? ` (${stabilityData.cyclicality.two_point_periods})` : ""}</td><td className="mono">{stabilityData.cyclicality.two_point.toFixed(4)}</td><td>{Math.abs(stabilityData.cyclicality.two_point) > 1 ? "Amplifies cycle" : Math.abs(stabilityData.cyclicality.two_point) > 0.3 ? "Partially PIT" : Math.abs(stabilityData.cyclicality.two_point) > 0 ? "Within PRA expectation" : "No sensitivity"}</td></tr>)}
                    {stabilityData.cyclicality.cv_model_pd !== undefined && (<tr><td>CV of model PD</td><td className="mono">{stabilityData.cyclicality.cv_model_pd.toFixed(4)}</td><td>{stabilityData.cyclicality.cv_model_pd > 0.3 ? "High dispersion" : stabilityData.cyclicality.cv_model_pd > 0.15 ? "Moderate" : "Low dispersion"}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </details>
        </>
      )}

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
                  <th>In Model</th>
                  <th>Model Rejection</th>
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
                    <td className={a.in_model ? "monotonic-yes" : ""}>{a.in_model ? "Yes" : "No"}</td>
                    <td className="audit-reason">{a.model_rejection_reason || "-"}</td>
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
        {scorecardData && (
          <button className="primary-button" style={{ background: "#15803d" }} onClick={async () => {
            setLoading(true);
            try {
              await exportFullReport({
                config: config ?? { binningMethod: "tree", maxBins: 10, corrThreshold: 0.5, maxClusters: null, dateColumn: "", efwMethod: "range" },
                totalRows, targetColumn, thresholds, allFactors,
                scorecardData, stabilityData: stabilityData ?? null,
                factorDescriptions,
                audit,
              });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Report export failed.");
            } finally {
              setLoading(false);
            }
          }} disabled={loading}>
            {loading ? "Generating..." : "Export Full Report (Excel)"}
          </button>
        )}
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
