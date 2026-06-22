import { useState } from "react";
import { exportShortlist } from "../api/client";
import { WoeChart } from "./WoeChart";
import type { BinDetail, ExportFactor, FactorAnalysis, FactorThresholds, ScorecardResponse } from "../types/analysis";
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
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedFactor, setExpandedFactor] = useState<string | null>(null);

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

      <details className="collapsible-section" open>
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
