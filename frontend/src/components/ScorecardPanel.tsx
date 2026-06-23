import { useState } from "react";
import type { BinDetail, ScorecardResponse, SelectionMethod } from "../types/analysis";


interface Props {
  scorecardData: ScorecardResponse | null;
  onFitScorecard: (baseScore: number, baseOdds: number, pdo: number, selectionMethod: SelectionMethod, pEnter: number, pRemove: number, maxFactors: number | null, forcedFactors: string[], maxCorr: number | null, roundPoints: boolean, efwMethod: string, efwThreshold: number) => void;
  loading: boolean;
  factorDescriptions: Record<string, string>;
  factorNames: string[];
  factorMetrics: Record<string, { iv: number; gini: number; bins: BinDetail[] }>;
}

function significance(p: number | null): { label: string; cls: string } {
  if (p === null) return { label: "-", cls: "sig-none" };
  if (p < 0.001) return { label: "< 0.1%", cls: "sig-high" };
  if (p < 0.01) return { label: "< 1%", cls: "sig-high" };
  if (p < 0.05) return { label: "< 5%", cls: "sig-mid" };
  if (p < 0.1) return { label: "< 10%", cls: "sig-low" };
  return { label: "Not sig.", cls: "sig-fail" };
}

export function ScorecardPanel({
  scorecardData,
  onFitScorecard,
  loading,
  factorDescriptions,
  factorNames,
  factorMetrics,
}: Props) {
  const [baseScore, setBaseScore] = useState(600);
  const [baseOdds, setBaseOdds] = useState(50);
  const [pdo, setPdo] = useState(20);
  const [selectionMethod, setSelectionMethod] = useState<SelectionMethod>("stepwise");
  const [pEnter, setPEnter] = useState(0.05);
  const [pRemove, setPRemove] = useState(0.05);
  const [maxFactors, setMaxFactors] = useState<number | null>(null);
  const [forcedFactors, setForcedFactors] = useState<Set<string>>(new Set());
  const [maxCorr, setMaxCorr] = useState<number | null>(null);
  const [roundPoints, setRoundPoints] = useState(false);
  const [efwMethod, setEfwMethod] = useState("range");
  const [efwThreshold, setEfwThreshold] = useState(0);
  const [expandedFactor, setExpandedFactor] = useState<string | null>(null);

  return (
    <div className="scorecard-panel">
      {selectionMethod !== "all" && (
        <details className="collapsible-section">
          <summary>Force-include Factors ({forcedFactors.size} of {factorNames.length} locked)</summary>
          <div style={{ padding: 18 }}>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text)" }}>
              Locked factors will always be included in the scorecard. Unlocked factors go through the selection process.
            </p>
            <div className="table-wrapper">
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th style={{ width: 50 }}>Lock</th>
                    <th>Factor</th>
                    <th>Description</th>
                    <th>IV</th>
                    <th>GINI</th>
                    <th>Bins</th>
                  </tr>
                </thead>
                <tbody>
                  {factorNames.map((name) => {
                    const m = factorMetrics[name];
                    const regBins = m ? m.bins.filter((b) => !b.is_special).length : 0;
                    return (
                      <tr key={name} className={forcedFactors.has(name) ? "highlight-row" : ""}>
                        <td>
                          <input
                            type="checkbox"
                            checked={forcedFactors.has(name)}
                            onChange={() => {
                              const next = new Set(forcedFactors);
                              if (next.has(name)) next.delete(name); else next.add(name);
                              setForcedFactors(next);
                            }}
                          />
                        </td>
                        <td>{name}</td>
                        <td className="audit-description">{factorDescriptions[name] ?? "-"}</td>
                        <td className="mono">{m ? m.iv.toFixed(4) : "-"}</td>
                        <td className="mono">{m ? m.gini.toFixed(4) : "-"}</td>
                        <td>{regBins}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </details>
      )}

      <div className="scorecard-config-panel">
        <div className="toolbar">
          <div className="config-row-label">Factor Selection</div>
          <div className="threshold-fields">
            <div className="method-toggle">
              {(["all", "forward", "backward", "stepwise", "lasso"] as SelectionMethod[]).map((m) => (
                <button
                  key={m}
                  className={`method-btn ${selectionMethod === m ? "active" : ""}`}
                  onClick={() => setSelectionMethod(m)}
                >
                  {{all: "All", forward: "Forward", backward: "Backward", stepwise: "Stepwise", lasso: "LASSO"}[m]}
                </button>
              ))}
            </div>
            {selectionMethod !== "all" && selectionMethod !== "lasso" && (
              <>
                <div className="threshold-field">
                  <label>P-enter</label>
                  <input type="number" step={0.01} min={0} max={1} value={pEnter}
                    onChange={(e) => setPEnter(parseFloat(e.target.value) || 0.05)} />
                </div>
                <div className="threshold-field">
                  <label>P-remove</label>
                  <input type="number" step={0.01} min={0} max={1} value={pRemove}
                    onChange={(e) => setPRemove(parseFloat(e.target.value) || 0.05)} />
                </div>
              </>
            )}
            <div className="threshold-field">
              <label>Max factors</label>
              <input type="number" min={1} value={maxFactors ?? ""} placeholder="Auto"
                onChange={(e) => { const v = parseInt(e.target.value); setMaxFactors(isNaN(v) ? null : v); }} />
            </div>
            <div className="threshold-field">
              <label>Max corr</label>
              <input type="number" step={0.05} min={0} max={1} value={maxCorr ?? ""} placeholder="Off"
                onChange={(e) => { const v = parseFloat(e.target.value); setMaxCorr(isNaN(v) ? null : v); }} />
            </div>
          </div>
        </div>
        <div className="toolbar">
          <div className="config-row-label">PDO Scaling</div>
          <div className="threshold-fields">
            <div className="threshold-field">
              <label>Base Score</label>
              <input type="number" value={baseScore}
                onChange={(e) => setBaseScore(parseInt(e.target.value) || 600)} />
            </div>
            <div className="threshold-field">
              <label>Base Odds</label>
              <input type="number" value={baseOdds}
                onChange={(e) => setBaseOdds(parseInt(e.target.value) || 50)} />
            </div>
            <div className="threshold-field">
              <label>PDO</label>
              <input type="number" value={pdo}
                onChange={(e) => setPdo(parseInt(e.target.value) || 20)} />
            </div>
            <label className="round-toggle">
              <input type="checkbox" checked={roundPoints}
                onChange={(e) => setRoundPoints(e.target.checked)} />
              Round points
            </label>
          </div>
        </div>
        <div className="toolbar">
          <div className="config-row-label">Effective Weight</div>
          <div className="threshold-fields">
            <div className="method-toggle">
              <button className={`method-btn ${efwMethod === "range" ? "active" : ""}`}
                onClick={() => setEfwMethod("range")}>Points Range</button>
              <button className={`method-btn ${efwMethod === "coefficient" ? "active" : ""}`}
                onClick={() => setEfwMethod("coefficient")}>Coefficient</button>
              <button className={`method-btn ${efwMethod === "variance" ? "active" : ""}`}
                onClick={() => setEfwMethod("variance")}>Score Variance</button>
            </div>
            <div className="threshold-field">
              <label>Min EFW %</label>
              <input type="number" step={1} min={0} max={50} value={efwThreshold}
                onChange={(e) => setEfwThreshold(parseFloat(e.target.value) || 0)} />
            </div>
            <button
              className="primary-button"
              onClick={() => onFitScorecard(baseScore, baseOdds, pdo, selectionMethod, pEnter, pRemove, maxFactors, [...forcedFactors], maxCorr, roundPoints, efwMethod, efwThreshold)}
              disabled={loading}
            >
              {loading ? "Fitting..." : "Fit Scorecard"}
            </button>
          </div>
        </div>
      </div>

      {scorecardData && (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <div className="summary-label">AUC</div>
              <div className="summary-value">{scorecardData.auc.toFixed(4)}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">GINI</div>
              <div className="summary-value">{scorecardData.gini.toFixed(4)}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">KS Statistic</div>
              <div className="summary-value">{scorecardData.ks_statistic.toFixed(4)}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Score Range</div>
              <div className="summary-value">
                {scorecardData.total_min_score.toFixed(0)} - {scorecardData.total_max_score.toFixed(0)}
              </div>
            </div>
          </div>

          {scorecardData.negative_coefficients.length > 0 && (
            <div className="proceed-blocker">
              <strong>Anomalous coefficient warning ({scorecardData.negative_coefficients.length} factors):</strong>
              <p style={{ margin: "6px 0 0", fontSize: 13 }}>
                The following factors have positive coefficients, meaning higher WoE increases the
                predicted probability of default. With the WoE convention used (higher WoE = lower risk),
                all coefficients should be negative. Positive coefficients typically indicate
                multicollinearity. Consider removing these factors or setting a max correlation threshold.
              </p>
              <ul>
                {scorecardData.negative_coefficients.map((n) => <li key={n}>{n}</li>)}
              </ul>
            </div>
          )}

          {scorecardData.stepwise_log.length > 0 && (
            <details className="collapsible-section">
              <summary>
                Factor Selection Log ({scorecardData.factors.length} selected, {scorecardData.dropped_factors.length} dropped)
              </summary>
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
                        <tr key={`${s.step}-${s.factor_name}`} className={s.action === "Added" || s.action === "Selected" ? "audit-shortlisted" : s.action === "Removed" || s.action === "Not entered" ? "audit-rejected" : ""}>
                          <td className="mono">{s.step}</td>
                          <td><span className={`audit-badge ${s.action === "Added" || s.action === "Selected" ? "audit-shortlisted" : "audit-rejected"}`}>{s.action}</span></td>
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
            <summary>Model Coefficients ({scorecardData.factors.length} factors)</summary>
            <div style={{ padding: 18 }}>
              {(() => {
                const efwData = scorecardData.factors.map((f) => {
                  const pts = f.bins.map((b) => b.points);
                  const woeVals = f.bins.filter((b) => !b.group.startsWith("S")).map((b) => b.woe);
                  const woeStd = woeVals.length > 1
                    ? Math.sqrt(woeVals.reduce((s, w) => s + (w - woeVals.reduce((a, b) => a + b, 0) / woeVals.length) ** 2, 0) / woeVals.length)
                    : 0;
                  const raw = efwMethod === "coefficient" ? Math.abs(f.coefficient)
                    : efwMethod === "variance" ? Math.abs(f.coefficient) * woeStd
                    : Math.max(...pts) - Math.min(...pts);
                  return { name: f.factor_name, raw };
                });
                const totalEfw = efwData.reduce((s, e) => s + e.raw, 0) || 1;
                const efwMap: Record<string, number> = {};
                efwData.forEach((e) => { efwMap[e.name] = (e.raw / totalEfw) * 100; });

                return (
              <div className="table-wrapper">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Factor</th>
                      <th>Description</th>
                      <th>Coefficient</th>
                      <th>P-value</th>
                      <th>Sig.</th>
                      <th>VIF</th>
                      <th>EFW %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...scorecardData.factors]
                      .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient))
                      .map((f) => (
                        <tr key={f.factor_name} className={f.coefficient > 0 ? "overridden-row" : ""}>
                          <td>
                            {f.factor_name}
                            {f.coefficient > 0 && <span className="neg-coef-badge">POS</span>}
                          </td>
                          <td className="audit-description">{factorDescriptions[f.factor_name] ?? "-"}</td>
                          <td className={`mono ${f.coefficient > 0 ? "points-negative" : ""}`}>
                            {f.coefficient.toFixed(4)}
                          </td>
                          <td className="mono">
                            {f.p_value !== null ? f.p_value.toFixed(4) : "-"}
                          </td>
                          <td className={`significance ${significance(f.p_value).cls}`}>
                            {significance(f.p_value).label}
                          </td>
                          <td className={`mono ${f.vif !== null && f.vif > 5 ? "points-negative" : ""}`}>
                            {f.vif !== null ? f.vif.toFixed(2) : "-"}
                          </td>
                          <td className="mono">{(efwMap[f.factor_name] ?? 0).toFixed(1)}%</td>
                        </tr>
                      ))}
                    <tr className="special-separator">
                      <td colSpan={7}>
                        Intercept: {scorecardData.intercept.toFixed(4)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
                );
              })()}
            </div>
          </details>

          <details className="collapsible-section">
            <summary>Scorecard Points</summary>
            <div style={{ padding: 18 }}>
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Factor</th>
                      <th>Description</th>
                      <th>Coefficient</th>
                      <th>Min Pts</th>
                      <th>Max Pts</th>
                      <th style={{ width: 44 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {scorecardData.factors.map((f) => {
                      const pts = f.bins.map((b) => b.points);
                      const minPts = Math.min(...pts);
                      const maxPts = Math.max(...pts);
                      const isExpanded = expandedFactor === f.factor_name;
                      return (
                        <>
                          <tr key={f.factor_name}>
                            <td>{f.factor_name}</td>
                            <td className="audit-description">{factorDescriptions[f.factor_name] ?? "-"}</td>
                            <td className="mono">{f.coefficient.toFixed(4)}</td>
                            <td className="mono">{minPts.toFixed(1)}</td>
                            <td className="mono">{maxPts.toFixed(1)}</td>
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
                            <tr key={`${f.factor_name}-detail`} className="expanded-row">
                              <td colSpan={6}>
                                <div className="expanded-content">
                                  <div style={{ padding: "12px 14px" }}>
                                    <table className="data-table compact">
                                      <thead>
                                        <tr>
                                          <th style={{ width: 50 }}>Group</th>
                                          <th>Bin</th>
                                          <th>WoE</th>
                                          <th>Points</th>
                                          <th>Count</th>
                                          <th>Event Rate</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {f.bins.filter((b) => !b.group.startsWith("S")).map((b) => (
                                          <tr key={b.bin_label}>
                                            <td className="mono group-cell">{b.group}</td>
                                            <td className="mono">{b.bin_label}</td>
                                            <td className="mono">{b.woe.toFixed(4)}</td>
                                            <td className={`mono ${b.points >= 0 ? "points-positive" : "points-negative"}`}>
                                              {b.points.toFixed(1)}
                                            </td>
                                            <td>{b.count.toLocaleString()}</td>
                                            <td className="mono">{(b.event_rate * 100).toFixed(2)}%</td>
                                          </tr>
                                        ))}
                                        {f.bins.filter((b) => b.group.startsWith("S")).length > 0 && (
                                          <>
                                            <tr className="special-separator">
                                              <td colSpan={6}>Missing / Special Values</td>
                                            </tr>
                                            {f.bins.filter((b) => b.group.startsWith("S")).map((b) => (
                                              <tr key={b.bin_label} className="special-bin-row">
                                                <td className="mono group-cell">{b.group}</td>
                                                <td className="mono">{b.bin_label}</td>
                                                <td className="mono">{b.woe.toFixed(4)}</td>
                                                <td className={`mono ${b.points >= 0 ? "points-positive" : "points-negative"}`}>
                                                  {b.points.toFixed(1)}
                                                </td>
                                                <td>{b.count.toLocaleString()}</td>
                                                <td className="mono">{(b.event_rate * 100).toFixed(2)}%</td>
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

          <details className="collapsible-section">
            <summary>Scorecard Master Table</summary>
            <div style={{ padding: 18 }}>
              <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text)" }}>
                Implementation-ready scorecard. Each row maps a factor attribute to its score points.
              </p>
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
                            {roundPoints ? b.points.toFixed(0) : b.points.toFixed(1)}
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
    </div>
  );
}
