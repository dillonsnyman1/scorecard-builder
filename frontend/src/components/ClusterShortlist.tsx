import type { ClusterResult } from "../types/analysis";

const REASONS_REQUIRING_ALTERNATIVE = new Set([
  "Known stronger predictor in production",
  "Better alternative available",
  "More stable across time periods",
]);

const EXCLUSION_REASONS = [
  "Better alternative available",
  "Operational preference - easier to source at origination",
  "More stable across time periods",
  "Better interpretability for stakeholders",
  "Regulatory/policy preference",
  "Known stronger predictor in production",
  "Better data quality profile",
  "Other",
];

const INCLUSION_REASONS = [
  "Better alternative available",
  "Operational preference - easier to source at origination",
  "More stable across time periods",
  "Better interpretability for stakeholders",
  "Regulatory/policy preference",
  "Known stronger predictor in production",
  "Better data quality profile",
  "Other",
];

export interface ClusterOverride {
  reason: string;
  preferredFactor: string;
}

interface Props {
  clusters: ClusterResult[];
  selectedFactors: Set<string>;
  onToggleFactor: (name: string) => void;
  clusterOverrides: Record<string, ClusterOverride>;
  onClusterOverrideChange: (factorName: string, override: ClusterOverride) => void;
  contradictions: string[];
  factorDescriptions: Record<string, string>;
}

export function ClusterShortlist({
  clusters,
  selectedFactors,
  onToggleFactor,
  clusterOverrides,
  onClusterOverrideChange,
  contradictions,
  factorDescriptions,
}: Props) {
  const replacementSources = new Map<string, { sourceFactor: string; reason: string }>();
  for (const [factorName, override] of Object.entries(clusterOverrides)) {
    if (override.preferredFactor) {
      replacementSources.set(override.preferredFactor, {
        sourceFactor: factorName,
        reason: override.reason,
      });
    }
  }
  const replacementFactors = new Set(replacementSources.keys());

  return (
    <div className="cluster-shortlist">
      <h3>Factor Clusters</h3>
      <p>
        Each cluster groups correlated factors. The top-ranked factor per cluster is selected
        by default. Overriding requires a justification.
      </p>

      {contradictions.length > 0 && (
        <div className="proceed-blocker">
          <strong>Circular reference detected:</strong>
          <ul>
            {contradictions.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      )}

      <div className="cluster-grid">
        {clusters.map((cluster) => {
          const topFactor = cluster.factors[0]?.factor_name;
          const topIsSelected = selectedFactors.has(topFactor);
          const nonTopSelected = cluster.factors
            .filter((f) => f.factor_name !== topFactor && selectedFactors.has(f.factor_name));
          const hasOverride = !topIsSelected || nonTopSelected.length > 0;

          return (
            <div key={cluster.cluster_id} className={`chart-card cluster-card ${hasOverride ? "cluster-override" : ""}`}>
              <h4>Cluster {cluster.cluster_id}</h4>
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>Factor</th>
                    <th>Description</th>
                    <th style={{ width: 80 }}>GINI</th>
                    <th style={{ width: 80 }}>IV</th>
                  </tr>
                </thead>
                <tbody>
                  {cluster.factors.map((f, i) => {
                    const isTop = i === 0;
                    const isSelected = selectedFactors.has(f.factor_name);
                    const isReplacement = replacementFactors.has(f.factor_name);
                    const needsReason = (isTop && !isSelected) || (!isTop && isSelected && !isReplacement);
                    const override = clusterOverrides[f.factor_name] ?? { reason: "", preferredFactor: "" };
                    const baseReason = override.reason.startsWith("Other: ") ? "Other" : override.reason;
                    const requiresAlt = REASONS_REQUIRING_ALTERNATIVE.has(baseReason);

                    return (
                      <>
                        <tr
                          key={f.factor_name}
                          className={isTop ? "highlight-row" : ""}
                        >
                          <td>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => onToggleFactor(f.factor_name)}
                            />
                          </td>
                          <td>
                            {f.factor_name}
                            {isTop && <span className="top-factor-badge">Top</span>}
                          </td>
                          <td className="cluster-description">{factorDescriptions[f.factor_name] ?? "-"}</td>
                          <td className="mono">{f.gini.toFixed(4)}</td>
                          <td className="mono">{f.iv.toFixed(4)}</td>
                        </tr>
                        {!isTop && isReplacement && isSelected && (() => {
                          const source = replacementSources.get(f.factor_name);
                          return source ? (
                            <tr key={`${f.factor_name}-audit`} className="cluster-override-row">
                              <td colSpan={5}>
                                <div className="cluster-replacement-note">
                                  Replaces <strong>{source.sourceFactor}</strong>: {source.reason}
                                </div>
                              </td>
                            </tr>
                          ) : null;
                        })()}
                        {needsReason && (
                          <tr key={`${f.factor_name}-override`} className="cluster-override-row">
                            <td colSpan={5}>
                              <div className="cluster-override-input">
                                <label>{isTop ? "Exclusion reason:" : "Selection reason:"}</label>
                                <select
                                  value={baseReason}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    onClusterOverrideChange(f.factor_name, {
                                      reason: val === "Other" ? "Other: " : val,
                                      preferredFactor: REASONS_REQUIRING_ALTERNATIVE.has(val) ? override.preferredFactor : "",
                                    });
                                  }}
                                >
                                  <option value="">Select reason...</option>
                                  {(isTop ? EXCLUSION_REASONS : INCLUSION_REASONS).map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                  ))}
                                </select>
                                {override.reason.startsWith("Other: ") && (
                                  <input
                                    type="text"
                                    value={override.reason.slice(7)}
                                    onChange={(e) =>
                                      onClusterOverrideChange(f.factor_name, {
                                        ...override,
                                        reason: `Other: ${e.target.value}`,
                                      })
                                    }
                                    placeholder="Specify reason..."
                                  />
                                )}
                                {requiresAlt && isTop && (
                                  <>
                                    <label>Replaced by:</label>
                                    <select
                                      value={override.preferredFactor}
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        onClusterOverrideChange(f.factor_name, {
                                          ...override,
                                          preferredFactor: val,
                                        });
                                        if (val && !selectedFactors.has(val)) {
                                          onToggleFactor(val);
                                        }
                                      }}
                                    >
                                      <option value="">Select factor...</option>
                                      {clusters.map((c) => {
                                        const others = c.factors
                                          .filter((cf) => cf.factor_name !== f.factor_name)
                                          .map((cf) => cf.factor_name);
                                        if (others.length === 0) return null;
                                        return (
                                          <optgroup key={c.cluster_id} label={`Cluster ${c.cluster_id}`}>
                                            {others.map((name) => (
                                              <option key={name} value={name}>{name}</option>
                                            ))}
                                          </optgroup>
                                        );
                                      })}
                                    </select>
                                  </>
                                )}
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
          );
        })}
      </div>
    </div>
  );
}
