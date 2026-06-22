import { useState } from "react";
import type { FactorAnalysis, FactorThresholds } from "../types/analysis";
import { factorValidPct, passesThresholds, rejectionReasons } from "../types/analysis";
import { WoeChart } from "./WoeChart";

interface Props {
  factors: FactorAnalysis[];
  totalRows: number;
  thresholds: FactorThresholds;
  onThresholdsChange: (t: FactorThresholds) => void;
  selectedFactors: Set<string>;
  onToggleFactor: (name: string) => void;
  onApplyThresholds: () => void;
  onDeselectAll: () => void;
  overrideReasons: Record<string, string>;
  onOverrideReasonChange: (name: string, reason: string) => void;
  maxClusters: number | null;
  onMaxClustersChange: (v: number | null) => void;
  corrThreshold: number;
  onCorrThresholdChange: (v: number) => void;
  onProceed: () => void;
  proceedDisabled: boolean;
  factorDescriptions: Record<string, string>;
  onDescriptionChange: (name: string, desc: string) => void;
}

type SortKey = "factor_name" | "iv" | "gini";

const INCLUDE_OVERRIDE_REASONS = [
  "Regulatory requirement",
  "Business/policy mandate",
  "Expert judgement - known predictive in population",
  "Factor required for model interpretability",
  "Data quality expected to improve",
  "Threshold marginally missed",
  "Other",
];

const EXCLUDE_OVERRIDE_REASONS = [
  "Operational - not available at point of application",
  "Data quality concerns beyond what metrics capture",
  "Regulatory/compliance restriction",
  "Potential target leakage",
  "Factor being decommissioned",
  "Redundant with preferred factor",
  "Unstable across time periods",
  "Other",
];

export function UnivariateTable({
  factors,
  totalRows,
  thresholds,
  onThresholdsChange,
  selectedFactors,
  onToggleFactor,
  onApplyThresholds,
  onDeselectAll,
  overrideReasons,
  onOverrideReasonChange,
  maxClusters,
  onMaxClustersChange,
  corrThreshold,
  onCorrThresholdChange,
  onProceed,
  proceedDisabled,
  factorDescriptions,
  onDescriptionChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("gini");
  const [sortAsc, setSortAsc] = useState(false);
  const [expandedFactor, setExpandedFactor] = useState<string | null>(null);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(key === "factor_name");
    }
  }

  const passingFactors = factors.filter((f) => passesThresholds(f, totalRows, thresholds));
  const rejectedFactors = factors.filter((f) => !passesThresholds(f, totalRows, thresholds));

  const sortFn = (a: FactorAnalysis, b: FactorAnalysis) => {
    const cmp = sortKey === "factor_name"
      ? a.factor_name.localeCompare(b.factor_name)
      : a[sortKey] < b[sortKey] ? -1 : a[sortKey] > b[sortKey] ? 1 : 0;
    return sortAsc ? cmp : -cmp;
  };

  const sortedPassing = [...passingFactors].sort(sortFn);
  const sortedRejected = [...rejectedFactors].sort(sortFn);

  function ivStrength(iv: number): string {
    if (iv < 0.02) return "Unpredictive";
    if (iv < 0.1) return "Weak";
    if (iv < 0.3) return "Medium";
    if (iv < 0.5) return "Strong";
    return "Very Strong";
  }

  const sortIcon = (key: SortKey) =>
    sortKey === key ? (sortAsc ? " ▲" : " ▼") : "";

  function renderRow(f: FactorAnalysis, rejected: boolean) {
    const vPct = factorValidPct(f, totalRows);
    const reasons = rejectionReasons(f, totalRows, thresholds);
    const isSelected = selectedFactors.has(f.factor_name);
    const includeOverride = rejected && isSelected;
    const excludeOverride = !rejected && !isSelected;
    const hasOverride = includeOverride || excludeOverride;
    const override = overrideReasons[f.factor_name] ?? "";

    let rowClass = "";
    if (rejected && !includeOverride) rowClass = "rejected-row";
    else if (includeOverride) rowClass = "overridden-row";
    else if (excludeOverride) rowClass = "excluded-override-row";

    return (
      <>
        <tr key={f.factor_name} className={rowClass}>
          <td>
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggleFactor(f.factor_name)}
            />
          </td>
          <td>{f.factor_name}</td>
          <td>
            <input
              className="description-input"
              type="text"
              value={factorDescriptions[f.factor_name] ?? ""}
              onChange={(e) => onDescriptionChange(f.factor_name, e.target.value)}
              placeholder="Add description..."
            />
          </td>
          <td className="mono">
            <span className={`iv-inline iv-${ivStrength(f.iv).toLowerCase().replace(" ", "-")}`}>
              {f.iv.toFixed(4)}
            </span>
          </td>
          <td className="mono">{f.gini.toFixed(4)}</td>
          <td className="mono">
            {f.missing_count > 0
              ? `${((f.missing_count / totalRows) * 100).toFixed(1)}%`
              : "-"}
          </td>
          <td className="mono">
            {f.special_count > 0
              ? `${((f.special_count / totalRows) * 100).toFixed(1)}%`
              : "-"}
          </td>
          <td className="mono">{`${vPct.toFixed(1)}%`}</td>
          <td className="sticky-col sticky-col-2">
            {reasons.length > 0
              ? <span className="rejection-badge">{reasons.length}</span>
              : ""}
          </td>
          <td className="sticky-col sticky-col-1">
            <button
              className="link-button"
              onClick={() =>
                setExpandedFactor(
                  expandedFactor === f.factor_name ? null : f.factor_name,
                )
              }
            >
              {expandedFactor === f.factor_name ? "Hide" : "Show"}
            </button>
          </td>
        </tr>
        {hasOverride && (
          <tr key={`${f.factor_name}-override`} className={includeOverride ? "override-row" : "exclude-override-row"}>
            <td colSpan={10}>
              <div className={includeOverride ? "override-input" : "override-input exclude"}>
                <label>{includeOverride ? "Include override:" : "Exclude override:"}</label>
                <select
                  value={override.startsWith("Other: ") ? "Other" : override}
                  onChange={(e) => {
                    if (e.target.value === "Other") {
                      onOverrideReasonChange(f.factor_name, "Other: ");
                    } else {
                      onOverrideReasonChange(f.factor_name, e.target.value);
                    }
                  }}
                >
                  <option value="">Select reason...</option>
                  {(includeOverride ? INCLUDE_OVERRIDE_REASONS : EXCLUDE_OVERRIDE_REASONS).map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                {override.startsWith("Other: ") && (
                  <input
                    type="text"
                    value={override.slice(7)}
                    onChange={(e) => onOverrideReasonChange(f.factor_name, `Other: ${e.target.value}`)}
                    placeholder="Specify reason..."
                  />
                )}
              </div>
            </td>
          </tr>
        )}
        {expandedFactor === f.factor_name && (
          <tr key={`${f.factor_name}-chart`} className="expanded-row">
            <td colSpan={10}>
              <div className="expanded-content">
                {reasons.length > 0 && (
                  <div className="expanded-reasons">
                    <span className="expanded-reasons-label">Rejection reasons:</span>
                    {reasons.map((r) => <span key={r} className="rejection-tag">{r}</span>)}
                  </div>
                )}
                <div className="expanded-chart">
                  <div className="expanded-chart-header">
                    <h4>Weight of Evidence by Bin - {f.factor_name}</h4>
                    <p>
                      Bars show the WoE per bin (blue = lower risk, red = higher risk relative to population average).
                      The orange line tracks the observed event rate across bins.
                      A monotonic WoE pattern indicates a consistent risk ranking.
                    </p>
                  </div>
                  <WoeChart bins={f.bins} compact />
                </div>
              </div>
            </td>
          </tr>
        )}
      </>
    );
  }

  return (
    <div className="univariate-section">
      <div className="toolbar threshold-toolbar">
        <div className="threshold-fields">
          <div className="threshold-field">
            <label>IV</label>
            <input
              type="number"
              step={0.01}
              min={0}
              value={thresholds.iv}
              onChange={(e) =>
                onThresholdsChange({ ...thresholds, iv: parseFloat(e.target.value) || 0 })
              }
            />
          </div>
          <div className="threshold-field">
            <label>GINI</label>
            <input
              type="number"
              step={0.01}
              min={0}
              max={1}
              value={thresholds.gini}
              onChange={(e) =>
                onThresholdsChange({ ...thresholds, gini: parseFloat(e.target.value) || 0 })
              }
            />
          </div>
          <div className="threshold-field">
            <label>Valid %</label>
            <input
              type="number"
              step={1}
              min={0}
              max={100}
              value={thresholds.minValidPct}
              onChange={(e) =>
                onThresholdsChange({ ...thresholds, minValidPct: parseFloat(e.target.value) || 0 })
              }
            />
          </div>
          <div className="threshold-field">
            <label>Bins</label>
            <input
              type="number"
              step={1}
              min={1}
              value={thresholds.minBins}
              onChange={(e) =>
                onThresholdsChange({ ...thresholds, minBins: parseInt(e.target.value) || 1 })
              }
            />
          </div>
          <button className="link-button" onClick={onApplyThresholds}>Apply</button>
        </div>
        <div className="threshold-divider" />
        <div className="selection-actions">
          <button className="link-button" onClick={onDeselectAll}>Deselect all</button>
          <span className="selection-count">
            {passingFactors.length} passing | {selectedFactors.size} selected
          </span>
          <div className="threshold-divider" />
          <div className="threshold-field">
            <label>Corr</label>
            <input
              type="number"
              step={0.05}
              min={0}
              max={1}
              value={corrThreshold}
              onChange={(e) => onCorrThresholdChange(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="threshold-field">
            <label>Max clusters</label>
            <input
              type="number"
              min={1}
              value={maxClusters ?? ""}
              onChange={(e) => {
                const v = parseInt(e.target.value);
                onMaxClustersChange(isNaN(v) ? null : v);
              }}
              placeholder="Auto"
            />
          </div>
          <button className="primary-button" onClick={onProceed} disabled={proceedDisabled}>
            Cluster ({selectedFactors.size})
          </button>
        </div>
      </div>

      <div className="chart-card">
        <div className="univariate-table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th onClick={() => handleSort("factor_name")} className="sortable">
                  Factor{sortIcon("factor_name")}
                </th>
                <th>Description</th>
                <th onClick={() => handleSort("iv")} className="sortable">
                  IV{sortIcon("iv")}
                </th>
                <th onClick={() => handleSort("gini")} className="sortable">
                  GINI{sortIcon("gini")}
                </th>
                <th>Miss %</th>
                <th>SV %</th>
                <th>Valid %</th>
                <th className="sticky-col sticky-col-2" style={{ width: 28 }}></th>
                <th className="sticky-col sticky-col-1" style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {sortedPassing.map((f) => renderRow(f, false))}
              {sortedRejected.length > 0 && (
                <>
                  <tr className="special-separator">
                    <td colSpan={10}>
                      Rejected ({sortedRejected.length} factors below thresholds)
                    </td>
                  </tr>
                  {sortedRejected.map((f) => renderRow(f, true))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
