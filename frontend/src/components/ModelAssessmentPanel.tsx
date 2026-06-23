import { useEffect, useRef, useState } from "react";
import {
  Area,
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
import type { ScorecardResponse, StabilityResponse } from "../types/analysis";

interface Props {
  scorecardData: ScorecardResponse;
  stabilityData: StabilityResponse | null;
  onRunStability: (dateCol: string, bucketMonths: number, dateStart: string | null, dateEnd: string | null, stressPeriod: string | null, benignPeriod: string | null) => void;
  loading: boolean;
  columns: string[];
  targetColumn: string;
  factorDescriptions: Record<string, string>;
  initialDateColumn: string;
}

type WeightMethod = "variance" | "coefficient" | "range";

export function ModelAssessmentPanel({
  scorecardData,
  stabilityData,
  onRunStability,
  loading,
  initialDateColumn,
}: Props) {
  const [weightMethod, setWeightMethod] = useState<WeightMethod>("range");
  const [stressPeriod, setStressPeriod] = useState("");
  const [benignPeriod, setBenignPeriod] = useState("");
  const hasAutoRun = useRef(false);

  useEffect(() => {
    if (initialDateColumn && !stabilityData && !hasAutoRun.current && !loading) {
      hasAutoRun.current = true;
      onRunStability(initialDateColumn, 1, null, null, null, null);
    }
  }, [initialDateColumn, stabilityData, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const weights = scorecardData.factors.map((f) => {
    const pts = f.bins.map((b) => b.points);
    const woeVals = f.bins.filter((b) => !b.group.startsWith("S")).map((b) => b.woe);
    const woeStd = woeVals.length > 1
      ? Math.sqrt(woeVals.reduce((s, w) => s + (w - woeVals.reduce((a, b) => a + b, 0) / woeVals.length) ** 2, 0) / woeVals.length)
      : 0;
    return {
      factor_name: f.factor_name,
      absCoef: Math.abs(f.coefficient),
      variance: Math.abs(f.coefficient) * woeStd,
      range: Math.max(...pts) - Math.min(...pts),
    };
  });

  const totalCoef = weights.reduce((s, w) => s + w.absCoef, 0) || 1;
  const totalVariance = weights.reduce((s, w) => s + w.variance, 0) || 1;
  const totalRange = weights.reduce((s, w) => s + w.range, 0) || 1;

  const weightData = weights.map((w) => ({
    name: w.factor_name,
    pct: weightMethod === "coefficient" ? w.absCoef / totalCoef * 100
      : weightMethod === "variance" ? w.variance / totalVariance * 100
      : w.range / totalRange * 100,
  })).sort((a, b) => b.pct - a.pct);

  return (
    <div className="scorecard-panel">
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
        <div className="summary-card">
          <div className="summary-label">Factors</div>
          <div className="summary-value">{scorecardData.factors.length}</div>
        </div>
      </div>

      {stabilityData && stabilityData.periods.some((p) => p.gini !== null) && (
        <details className="collapsible-section">
          <summary>GINI over Time</summary>
          <div style={{ padding: 18 }}>
            <div className="table-wrapper" style={{ marginBottom: 16 }}>
              <table className="data-table compact">
                <thead>
                  <tr>
                    <th>Period</th>
                    <th>GINI</th>
                    <th>GINI SE</th>
                    <th>Obs</th>
                    <th>Event Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {stabilityData.periods.map((p) => (
                    <tr key={p.period}>
                      <td className="mono">{p.period}</td>
                      <td className="mono">{p.gini !== null ? p.gini.toFixed(4) : "-"}</td>
                      <td className="mono">{p.gini_se !== null ? p.gini_se.toFixed(4) : "-"}</td>
                      <td>{p.obs_count.toLocaleString()}</td>
                      <td className="mono">{(p.event_rate * 100).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ResponsiveContainer width="100%" height={250}>
              <ComposedChart data={stabilityData.periods.filter((p) => p.gini !== null).map((p) => ({
                period: p.period,
                gini: p.gini! * 100,
                gini_upper: p.gini_se !== null ? (p.gini! + p.gini_se) * 100 : undefined,
                gini_lower: p.gini_se !== null ? (p.gini! - p.gini_se) * 100 : undefined,
                se_band: p.gini_se !== null ? [(p.gini! - p.gini_se) * 100, (p.gini! + p.gini_se) * 100] : undefined,
              }))} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} angle={-30} textAnchor="end" height={50} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
                <Tooltip formatter={(v, name) => {
                  if (name === "GINI SE Band") return undefined;
                  return `${Number(v).toFixed(2)}%`;
                }} />
                <Area dataKey="gini_upper" stroke="none" fill="var(--accent)" fillOpacity={0.1} name="GINI SE Band" />
                <Area dataKey="gini_lower" stroke="none" fill="white" fillOpacity={1} name="" />
                <Line type="monotone" dataKey="gini_upper" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" dot={false} name="GINI + SE" />
                <Line type="monotone" dataKey="gini_lower" stroke="var(--accent)" strokeWidth={1} strokeDasharray="4 3" dot={false} name="GINI - SE" />
                <Line type="monotone" dataKey="gini" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} name="GINI %" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </details>
      )}

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

      <details className="collapsible-section">
        <summary>Effective Weights</summary>
        <div style={{ padding: 18 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 13, color: "var(--text)" }}>Weighting method:</span>
            <div className="method-toggle">
              <button className={`method-btn ${weightMethod === "range" ? "active" : ""}`}
                onClick={() => setWeightMethod("range")}>Points Range</button>
              <button className={`method-btn ${weightMethod === "coefficient" ? "active" : ""}`}
                onClick={() => setWeightMethod("coefficient")}>Coefficient</button>
              <button className={`method-btn ${weightMethod === "variance" ? "active" : ""}`}
                onClick={() => setWeightMethod("variance")}>Score Variance</button>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={Math.max(200, weightData.length * 32)}>
            <BarChart data={weightData} layout="vertical" margin={{ top: 0, right: 24, bottom: 0, left: 140 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${v.toFixed(0)}%`} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={130} />
              <Tooltip formatter={(v) => `${Number(v).toFixed(1)}%`} />
              <Bar dataKey="pct" name="Weight" radius={[0, 3, 3, 0]}>
                {weightData.map((_, i) => (
                  <Cell key={i} fill="var(--accent)" />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </details>


      {stabilityData && (
        <>
          <details className="collapsible-section">
            <summary>Stability Analysis (PSI)</summary>
            <div style={{ padding: 18 }}>
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontSize: 12, color: "var(--text)", cursor: "pointer" }}>Interpretation thresholds</summary>
                <div style={{ marginTop: 8 }}>
                  <table className="data-table compact" style={{ fontSize: 11 }}>
                    <thead>
                      <tr><th>Metric</th><th>Value</th><th>Interpretation</th><th>Colour</th></tr>
                    </thead>
                    <tbody>
                      <tr><td rowSpan={3}>PSI</td><td className="mono">&lt; 0.10</td><td>Stable</td><td className="psi-green">Green</td></tr>
                      <tr><td className="mono">0.10 - 0.25</td><td>Moderate shift</td><td className="psi-amber">Amber</td></tr>
                      <tr><td className="mono">&gt; 0.25</td><td>Significant shift</td><td className="psi-red">Red</td></tr>
                      <tr><td rowSpan={3}>IV</td><td className="mono">&ge; 0.10</td><td>Good predictive power</td><td className="iv-green">Green</td></tr>
                      <tr><td className="mono">0.02 - 0.10</td><td>Weak</td><td className="iv-amber">Amber</td></tr>
                      <tr><td className="mono">&lt; 0.02</td><td>Unpredictive</td><td className="iv-red">Red</td></tr>
                    </tbody>
                  </table>
                </div>
              </details>
              <details>
              <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text-h)", cursor: "pointer", marginBottom: 8 }}>Score PSI Year-on-Year</summary>
              <div className="table-wrapper" style={{ marginBottom: 16 }}>
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Period</th>
                      <th>Obs</th>
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
                        <td className={`mono ${p.psi !== null ? p.psi > 0.25 ? "psi-red" : p.psi > 0.1 ? "psi-amber" : "psi-green" : ""}`}>
                          {p.psi !== null ? p.psi.toFixed(4) : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {stabilityData.overall_psi !== null && (
                <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--text)" }}>
                  Overall PSI (latest vs full population): <strong
                    className={stabilityData.overall_psi > 0.25 ? "points-negative" : stabilityData.overall_psi > 0.1 ? "sig-mid" : ""}
                  >{stabilityData.overall_psi.toFixed(4)}</strong>
                  {stabilityData.overall_psi < 0.1 && " - stable"}
                  {stabilityData.overall_psi >= 0.1 && stabilityData.overall_psi < 0.25 && " - moderate shift"}
                  {stabilityData.overall_psi >= 0.25 && " - significant shift"}
                </p>
              )}
              </details>
              {stabilityData.factor_stability.length > 0 && (
                <>
                  <details>
                  <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text-h)", cursor: "pointer", marginBottom: 8 }}>Factor IV by Period</summary>
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
                              const iv = pd?.iv;
                              return <td key={p.period} className={`mono ${iv != null ? iv >= 0.1 ? "iv-green" : iv >= 0.02 ? "iv-amber" : "iv-red" : ""}`}>{pd ? pd.iv.toFixed(4) : "-"}</td>;
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </details>
                </>
              )}

              {(stabilityData.factor_psi ?? []).length > 0 && (
                <>
                  <details style={{ marginTop: 16 }}>
                  <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text-h)", cursor: "pointer", marginBottom: 8 }}>Factor PSI Year-on-Year</summary>
                  <div className="table-wrapper" style={{ marginBottom: 16 }}>
                    <table className="data-table compact">
                      <thead>
                        <tr>
                          <th>Factor</th>
                          {stabilityData.periods.map((p) => (
                            <th key={p.period} className="mono">{p.period.slice(0, 4)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(stabilityData.factor_psi ?? []).map((fp) => (
                          <tr key={fp.factor_name}>
                            <td>{fp.factor_name}</td>
                            {stabilityData.periods.map((p) => {
                              const pd = fp.periods.find((x) => x.period === p.period);
                              const val = pd?.psi_yoy;
                              return (
                                <td key={p.period} className={`mono ${val != null ? val > 0.25 ? "psi-red" : val > 0.1 ? "psi-amber" : "psi-green" : ""}`}>
                                  {val != null ? val.toFixed(4) : "-"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </details>

                  <details style={{ marginTop: 16 }}>
                  <summary style={{ fontSize: 14, fontWeight: 600, color: "var(--text-h)", cursor: "pointer", marginBottom: 8 }}>Factor PSI vs Latest Period ({stabilityData.periods[stabilityData.periods.length - 1]?.period.slice(0, 4)})</summary>
                  <div className="table-wrapper">
                    <table className="data-table compact">
                      <thead>
                        <tr>
                          <th>Factor</th>
                          {stabilityData.periods.map((p) => (
                            <th key={p.period} className="mono">{p.period.slice(0, 4)}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(stabilityData.factor_psi ?? []).map((fp) => (
                          <tr key={fp.factor_name}>
                            <td>{fp.factor_name}</td>
                            {stabilityData.periods.map((p) => {
                              const pd = fp.periods.find((x) => x.period === p.period);
                              const val = pd?.psi_vs_latest;
                              return (
                                <td key={p.period} className={`mono ${val != null ? val > 0.25 ? "psi-red" : val > 0.1 ? "psi-amber" : "psi-green" : ""}`}>
                                  {val != null ? val.toFixed(4) : "-"}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  </details>
                </>
              )}

            </div>
          </details>

          <details className="collapsible-section">
            <summary>Cyclicality Analysis</summary>
            <div style={{ padding: 18 }}>
              <details style={{ marginBottom: 16 }}>
                <summary style={{ fontSize: 12, color: "var(--text)", cursor: "pointer" }}>Interpretation thresholds</summary>
                <div style={{ marginTop: 8 }}>
                  <table className="data-table compact" style={{ fontSize: 11 }}>
                    <thead>
                      <tr><th>Method</th><th>Value</th><th>Interpretation</th></tr>
                    </thead>
                    <tbody>
                      <tr><td rowSpan={4}>Log-log regression</td><td className="mono">|beta| &gt; 0.8</td><td>Highly PIT</td></tr>
                      <tr><td className="mono">|beta| &gt; 0.5</td><td>Moderately cyclical</td></tr>
                      <tr><td className="mono">|beta| &gt; 0.2</td><td>Low cyclicality</td></tr>
                      <tr><td className="mono">|beta| &le; 0.2</td><td>Near TTC</td></tr>
                      <tr><td rowSpan={4}>Two-point</td><td className="mono">|val| &gt; 1</td><td>Amplifies cycle</td></tr>
                      <tr><td className="mono">|val| &gt; 0.5</td><td>Passes through cycle</td></tr>
                      <tr><td className="mono">|val| &gt; 0</td><td>Dampens cycle</td></tr>
                      <tr><td className="mono">|val| = 0</td><td>No sensitivity</td></tr>
                      <tr><td rowSpan={3}>CV of model PD</td><td className="mono">val &gt; 0.3</td><td>High dispersion</td></tr>
                      <tr><td className="mono">val &gt; 0.15</td><td>Moderate</td></tr>
                      <tr><td className="mono">val &le; 0.15</td><td>Low dispersion</td></tr>
                    </tbody>
                  </table>
                </div>
              </details>
              <div className="table-wrapper" style={{ marginBottom: 12 }}>
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th></th>
                      {stabilityData.periods.map((p) => (
                        <th key={p.period} className="mono">{p.period.slice(0, 4)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td style={{ fontWeight: 600 }}>ODR</td>
                      {stabilityData.periods.map((p) => (
                        <td key={p.period} className="mono">{(p.event_rate * 100).toFixed(2)}%</td>
                      ))}
                    </tr>
                    <tr>
                      <td style={{ fontWeight: 600 }}>Model PD</td>
                      {stabilityData.periods.map((p) => (
                        <td key={p.period} className="mono">{p.mean_model_pd !== null ? (p.mean_model_pd * 100).toFixed(2) + "%" : "-"}</td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>

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

              {Object.keys(stabilityData.cyclicality).length > 0 && (
                <>
                  <div className="threshold-fields" style={{ margin: "12px 0" }}>
                    <div className="threshold-field">
                      <label>Benign period</label>
                      <select value={benignPeriod} onChange={(e) => {
                        setBenignPeriod(e.target.value);
                        onRunStability(initialDateColumn, 1, null, null, stressPeriod || null, e.target.value || null);
                      }} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", fontSize: 12 }}>
                        <option value="">Auto</option>
                        {stabilityData.periods.map((p) => (
                          <option key={p.period} value={p.period}>{p.period} ({(p.event_rate * 100).toFixed(1)}%)</option>
                        ))}
                      </select>
                    </div>
                    <div className="threshold-field">
                      <label>Stress period</label>
                      <select value={stressPeriod} onChange={(e) => {
                        setStressPeriod(e.target.value);
                        onRunStability(initialDateColumn, 1, null, null, e.target.value || null, benignPeriod || null);
                      }} style={{ padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", fontSize: 12 }}>
                        <option value="">Auto</option>
                        {stabilityData.periods.map((p) => (
                          <option key={p.period} value={p.period}>{p.period} ({(p.event_rate * 100).toFixed(1)}%)</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="table-wrapper">
                    <table className="data-table compact">
                      <thead>
                        <tr><th>Method</th><th>Value</th><th>Interpretation</th></tr>
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
                            <td>Two-point{stabilityData.cyclicality.two_point_periods ? ` (${stabilityData.cyclicality.two_point_periods})` : ""}</td>
                            <td className="mono">{stabilityData.cyclicality.two_point.toFixed(4)}</td>
                            <td>{Math.abs(stabilityData.cyclicality.two_point) > 1 ? "Amplifies cycle" :
                              Math.abs(stabilityData.cyclicality.two_point) > 0.5 ? "Passes through" :
                              Math.abs(stabilityData.cyclicality.two_point) > 0 ? "Dampens cycle" : "No sensitivity"}</td>
                          </tr>
                        )}
                        {stabilityData.cyclicality.cv_model_pd !== undefined && (
                          <tr>
                            <td>CV of model PD</td>
                            <td className="mono">{stabilityData.cyclicality.cv_model_pd.toFixed(4)}</td>
                            <td>{stabilityData.cyclicality.cv_model_pd > 0.3 ? "High dispersion" :
                              stabilityData.cyclicality.cv_model_pd > 0.15 ? "Moderate" : "Low dispersion"}</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

            </div>
          </details>
        </>
      )}
    </div>
  );
}
