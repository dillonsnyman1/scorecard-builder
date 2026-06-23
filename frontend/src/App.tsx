import { useCallback, useState } from "react";

import "./App.css";
import { exportScoredData, fitScorecard, runClustering, runStabilityAnalysis, runUnivariate } from "./api/client";
import { BinEditor } from "./components/BinEditor";
import { ClusterShortlist, type ClusterOverride } from "./components/ClusterShortlist";
import { CorrelationHeatmap } from "./components/CorrelationHeatmap";
import { DataProfileCards } from "./components/DataProfileCards";
import { ExportPanel } from "./components/ExportPanel";
import { ModelAssessmentPanel } from "./components/ModelAssessmentPanel";
import { ScorecardPanel } from "./components/ScorecardPanel";
import { UnivariateTable } from "./components/UnivariateTable";
import { UploadPanel } from "./components/UploadPanel";
import type {
  BinDetail,
  ClusterResponse,
  FactorThresholds,
  ScorecardResponse,
  StabilityResponse,
  Step,
  UnivariateResponse,
  UploadResponse,
} from "./types/analysis";
import { STEP_LABELS, STEP_ORDER, passesThresholds } from "./types/analysis";
import { refineBins } from "./api/client";

function detectTrend(bins: BinDetail[]): string {
  const woe = bins.filter((b) => !b.is_special).map((b) => b.woe);
  if (woe.length <= 1) return "Increasing";
  const inc = woe.every((w, i) => i === 0 || w >= woe[i - 1]);
  const dec = woe.every((w, i) => i === 0 || w <= woe[i - 1]);
  if (dec) return "Decreasing";
  if (inc) return "Increasing";
  return "Non-monotonic";
}

const DEFAULT_THRESHOLDS: FactorThresholds = { iv: 0.02, gini: 0.1, minValidPct: 50, minBins: 2 };

function App() {
  const [step, setStepRaw] = useState<Step>("upload");
  const setStep = useCallback((s: Step) => {
    setStepRaw(s);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const [dataId, setDataId] = useState<string | null>(null);
  const [targetColumn, setTargetColumn] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [specialValues, setSpecialValues] = useState<number[]>([-999, 9999]);
  const [totalRows, setTotalRows] = useState(0);
  const [allColumns, setAllColumns] = useState<string[]>([]);
  const [dateColumn, setDateColumn] = useState("");

  const [univariateData, setUnivariateData] = useState<UnivariateResponse | null>(null);
  const [thresholds, setThresholds] = useState<FactorThresholds>(DEFAULT_THRESHOLDS);
  const [maxClusters, setMaxClusters] = useState<number | null>(null);
  const [corrThreshold, setCorrThreshold] = useState(0.5);
  const [selectedFactors, setSelectedFactors] = useState<Set<string>>(new Set());
  const [overrideReasons, setOverrideReasons] = useState<Record<string, string>>({});
  const [binningMethod, setBinningMethod] = useState<"tree" | "equal_frequency">("tree");
  const [maxBins, setMaxBins] = useState(10);
  const [factorDescriptions, setFactorDescriptions] = useState<Record<string, string>>({});

  const [clusterData, setClusterData] = useState<ClusterResponse | null>(null);
  const [shortlistedFactors, setShortlistedFactors] = useState<Set<string>>(new Set());
  const [clusterOverrides, setClusterOverrides] = useState<Record<string, ClusterOverride>>({});

  const [refinedFactors, setRefinedFactors] = useState<
    Map<string, { bins: BinDetail[]; iv: number; gini: number }>
  >(new Map());
  const [refineRevision, setRefineRevision] = useState(0);
  const [scorecardData, setScorecardData] = useState<ScorecardResponse | null>(null);
  const [lastScorecardRequest, setLastScorecardRequest] = useState<Parameters<typeof fitScorecard>[0] | null>(null);
  const [stabilityData, setStabilityData] = useState<StabilityResponse | null>(null);

  function handleRerunAnalysis() {
    if (!dataId) return;
    setLoading(true);
    setError(null);
    runUnivariate({
      data_id: dataId,
      target_column: targetColumn!,
      binning_method: binningMethod,
      max_bins: maxBins,
      iv_threshold: 0,
      special_values: specialValues,
      exclude_columns: dateColumn ? [dateColumn] : [],
    })
      .then((res) => {
        setUnivariateData(res);
        applyThresholds(res, totalRows, thresholds);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Analysis failed."))
      .finally(() => setLoading(false));
  }

  function applyThresholds(data?: UnivariateResponse, rows?: number, t?: FactorThresholds) {
    const d = data ?? univariateData;
    const r = rows ?? totalRows;
    const th = t ?? thresholds;
    if (!d) return;
    const passing = d.factors
      .filter((f) => passesThresholds(f, r, th))
      .map((f) => f.factor_name);
    setSelectedFactors(new Set(passing));
  }

  function handleUploaded(data: UploadResponse, target: string, dateCol: string, specials: number[], descriptions: Record<string, string>, binningMethod: "tree" | "equal_frequency" = "tree", maxBins: number = 10) {
    setDataId(data.data_id);
    setTargetColumn(target);
    setSpecialValues(specials);
    setTotalRows(data.row_count);
    setAllColumns(data.columns.map((c) => c.name));
    setDateColumn(dateCol);
    setFactorDescriptions(descriptions);
    setBinningMethod(binningMethod);
    setMaxBins(maxBins);
    setLoading(true);
    setError(null);

    runUnivariate({
      data_id: data.data_id,
      target_column: target,
      binning_method: binningMethod,
      max_bins: maxBins,
      iv_threshold: 0,
      special_values: specials,
      exclude_columns: dateCol ? [dateCol] : [],
    })
      .then((res) => {
        setUnivariateData(res);
        applyThresholds(res, data.row_count, thresholds);
        setStep("univariate");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Analysis failed."))
      .finally(() => setLoading(false));
  }

  function handleRunClustering() {
    if (!dataId || !targetColumn) return;
    setLoading(true);
    setError(null);

    runClustering({
      data_id: dataId,
      target_column: targetColumn,
      factor_names: [...selectedFactors],
      distance_threshold: 1 - corrThreshold,
      max_clusters: maxClusters,
    })
      .then((res) => {
        setClusterData(res);
        const selected = new Set<string>();
        for (const cluster of res.clusters) {
          const best = cluster.factors.find((f) => f.is_selected);
          if (best) selected.add(best.factor_name);
        }
        setShortlistedFactors(selected);
        setStep("cluster");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Clustering failed."))
      .finally(() => setLoading(false));
  }

  function handleProceedToRefine() {
    if (!univariateData) return;
    const initial = new Map<string, { bins: BinDetail[]; iv: number; gini: number }>();
    for (const name of shortlistedFactors) {
      const factor = univariateData.factors.find((f) => f.factor_name === name);
      if (factor) {
        initial.set(name, { bins: factor.bins, iv: factor.iv, gini: factor.gini });
      }
    }
    setRefinedFactors(initial);
    setStep("refine");
  }

  async function handleFitScorecard(baseScore: number, baseOdds: number, pdo: number, selectionMethod: string = "stepwise", pEnter: number = 0.05, pRemove: number = 0.05, maxFactors: number | null = null, forcedFactors: string[] = [], maxCorr: number | null = null, roundPoints: boolean = false) {
    if (!dataId || !targetColumn) return;
    setLoading(true);
    setError(null);
    try {
      const factorsList = [...refinedFactors.entries()].map(([name, data]) => {
        const edges: number[] = [];
        for (const b of data.bins) {
          if (!b.is_special) {
            if (b.lower !== null) edges.push(b.lower);
            if (b.upper !== null) edges.push(b.upper);
          }
        }
        return { factor_name: name, bin_edges: [...new Set(edges)].sort((a, b) => a - b) };
      });
      const reqBody = {
        data_id: dataId,
        target_column: targetColumn,
        factors: factorsList,
        special_values: specialValues,
        base_score: baseScore,
        base_odds: baseOdds,
        pdo,
        max_factors: maxFactors,
        selection_method: selectionMethod as "all" | "forward" | "backward" | "stepwise" | "lasso",
        p_value_enter: pEnter,
        p_value_remove: pRemove,
        forced_factors: forcedFactors,
        max_corr: maxCorr,
        round_points: roundPoints,
      };
      const result = await fitScorecard(reqBody);
      setLastScorecardRequest(reqBody);
      setScorecardData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scorecard fitting failed.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRunStability(
    dateCol: string, bucketMonths: number, dateStart: string | null, dateEnd: string | null,
    stressPeriod: string | null, benignPeriod: string | null,
  ) {
    if (!dataId || !targetColumn) return;
    setLoading(true);
    setError(null);
    try {
      const factorsList = [...refinedFactors.entries()].map(([name, data]) => {
        const edges: number[] = [];
        for (const b of data.bins) {
          if (!b.is_special) {
            if (b.lower !== null) edges.push(b.lower);
            if (b.upper !== null) edges.push(b.upper);
          }
        }
        return { factor_name: name, bin_edges: [...new Set(edges)].sort((a, b) => a - b) };
      });
      const result = await runStabilityAnalysis({
        data_id: dataId, target_column: targetColumn, date_column: dateCol,
        factors: factorsList, special_values: specialValues,
        period: bucketMonths >= 12 ? "year" : bucketMonths >= 6 ? "half" : "quarter",
        bucket_months: bucketMonths,
        date_start: dateStart, date_end: dateEnd,
        base_score: scorecardData?.scaling_offset !== undefined
          ? Math.round(scorecardData.scaling_offset + scorecardData.scaling_factor * Math.log(50)) : 600,
        base_odds: 50,
        pdo: scorecardData ? Math.round(scorecardData.scaling_factor * Math.LN2) : 20,
        stress_period: stressPeriod, benign_period: benignPeriod,
      });
      setStabilityData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stability analysis failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleBinUpdate(factorName: string, bins: BinDetail[], iv: number, gini: number) {
    setRefinedFactors((prev) => {
      const next = new Map(prev);
      next.set(factorName, { bins, iv, gini });
      return next;
    });
  }

  async function handleAutoMonotonicAll() {
    if (!dataId || !targetColumn) return;
    setLoading(true);
    setError(null);
    try {
      const entries = [...refinedFactors.entries()];
      const results = await Promise.all(
        entries.map(([name, data]) => {
          const edges: number[] = [];
          for (const b of data.bins) {
            if (!b.is_special) {
              if (b.lower !== null) edges.push(b.lower);
              if (b.upper !== null) edges.push(b.upper);
            }
          }
          return refineBins({
            data_id: dataId!,
            target_column: targetColumn!,
            factor_name: name,
            bin_edges: [...new Set(edges)].sort((a, b) => a - b),
            enforce_monotonicity: true,
            monotonicity_direction: "auto",
            special_values: specialValues,
          });
        }),
      );
      setRefinedFactors((prev) => {
        const next = new Map(prev);
        entries.forEach(([name], i) => {
          const res = results[i];
          next.set(name, { bins: res.bins, iv: res.iv, gini: res.gini });
        });
        return next;
      });
      setRefineRevision((r) => r + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Auto monotonicity failed.");
    } finally {
      setLoading(false);
    }
  }

  function toggleFactor(set: Set<string>, name: string): Set<string> {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  }

  const currentStepIndex = STEP_ORDER.indexOf(step);

  const exportFactors = [...refinedFactors.entries()].map(([name, data]) => ({
    factor_name: name,
    iv: data.iv,
    gini: data.gini,
    bins: data.bins,
  }));

  return (
    <>
      <header className="app-header">
        <h1>Scorecard Builder</h1>
        <p>
          An interactive tool for developing credit risk scorecards, covering the full model
          development pipeline from raw data to a production-ready points-based scorecard.
          Designed for PD (Probability of Default) model development, it can also support
          LGD and other binary outcome models. The tool handles factor screening with
          Weight of Evidence and Information Value, correlation-based clustering to remove
          redundancy, interactive coarse classing with monotonicity enforcement, and
          logistic regression fitting with PDO scaling. Every decision is logged with
          mandatory justifications, producing a complete audit trail suitable for model
          validation and governance review.
        </p>
      </header>

      <nav className="step-nav">
        {STEP_ORDER.map((s, i) => {
          const canNavigate = i < currentStepIndex;
          return (
            <div
              key={s}
              className={`step-indicator ${s === step ? "active" : ""} ${canNavigate ? "completed clickable" : ""}`}
              onClick={canNavigate ? () => setStep(s) : undefined}
            >
              <span className="step-number">{i + 1}</span>
              <span className="step-label">{STEP_LABELS[s]}</span>
            </div>
          );
        })}
      </nav>

      {loading && <div className="status-message">Processing...</div>}
      {error && <div className="status-message error">{error}</div>}

      {step === "upload" && <UploadPanel onUploaded={handleUploaded} />}

      {step === "univariate" && univariateData && (
        <>
          <DataProfileCards
            totalEvents={univariateData.total_events}
            totalNonEvents={univariateData.total_non_events}
            eventRate={univariateData.target_event_rate}
            factorCount={univariateData.factors.length}
          />
          <UnivariateTable
            factors={univariateData.factors}
            totalRows={totalRows}
            thresholds={thresholds}
            onThresholdsChange={setThresholds}
            selectedFactors={selectedFactors}
            onToggleFactor={(name) => setSelectedFactors(toggleFactor(selectedFactors, name))}
            onApplyThresholds={() => applyThresholds()}
            onDeselectAll={() => setSelectedFactors(new Set())}
            overrideReasons={overrideReasons}
            onOverrideReasonChange={(name, reason) =>
              setOverrideReasons((prev) => ({ ...prev, [name]: reason }))
            }
            maxClusters={maxClusters}
            onMaxClustersChange={setMaxClusters}
            corrThreshold={corrThreshold}
            onCorrThresholdChange={setCorrThreshold}
            onProceed={handleRunClustering}
            proceedDisabled={loading || selectedFactors.size < 2}
            factorDescriptions={factorDescriptions}
            onDescriptionChange={(name, desc) =>
              setFactorDescriptions((prev) => ({ ...prev, [name]: desc }))
            }
            binningMethod={binningMethod}
            onBinningMethodChange={setBinningMethod}
            maxBins={maxBins}
            onMaxBinsChange={setMaxBins}
            onRerunAnalysis={handleRerunAnalysis}
          />
        </>
      )}

      {step === "cluster" && clusterData && (
        <>
          <CorrelationHeatmap
            matrix={clusterData.correlation_matrix}
            factorNames={clusterData.factor_names}
          />
          {(() => {
            const REASONS_REQUIRING_ALT = new Set([
              "Known stronger predictor in production",
              "Better alternative available",
              "More stable across time periods",
            ]);

            const missingReasons: string[] = [];
            const contradictions: string[] = [];

            for (const cluster of clusterData.clusters) {
              const topFactor = cluster.factors[0]?.factor_name;
              if (topFactor && !shortlistedFactors.has(topFactor)) {
                const ov = clusterOverrides[topFactor];
                if (!ov?.reason) {
                  missingReasons.push(`Cluster ${cluster.cluster_id}: reason needed for excluding ${topFactor}`);
                } else {
                  const base = ov.reason.startsWith("Other: ") ? "Other" : ov.reason;
                  if (REASONS_REQUIRING_ALT.has(base) && !ov.preferredFactor) {
                    missingReasons.push(`Cluster ${cluster.cluster_id}: specify preferred factor for ${topFactor}`);
                  }
                }
              }
              for (const f of cluster.factors.slice(1)) {
                if (shortlistedFactors.has(f.factor_name)) {
                  const ov = clusterOverrides[f.factor_name];
                  if (!ov?.reason) {
                    missingReasons.push(`Cluster ${cluster.cluster_id}: reason needed for including ${f.factor_name}`);
                  } else {
                    const base = ov.reason.startsWith("Other: ") ? "Other" : ov.reason;
                    if (REASONS_REQUIRING_ALT.has(base) && !ov.preferredFactor) {
                      missingReasons.push(`Cluster ${cluster.cluster_id}: specify preferred factor for ${f.factor_name}`);
                    }
                  }
                }
              }
            }

            for (const [factorA, ovA] of Object.entries(clusterOverrides)) {
              if (ovA.preferredFactor) {
                const ovB = clusterOverrides[ovA.preferredFactor];
                if (ovB?.preferredFactor === factorA) {
                  const key = [factorA, ovA.preferredFactor].sort().join(" <-> ");
                  if (!contradictions.includes(key)) {
                    contradictions.push(key);
                  }
                }
              }
            }

            const allIssues = [...missingReasons, ...contradictions.map((c) => `Circular: ${c}`)];

            return (
              <>
                <ClusterShortlist
                  clusters={clusterData.clusters}
                  selectedFactors={shortlistedFactors}
                  onToggleFactor={(name) => setShortlistedFactors(toggleFactor(shortlistedFactors, name))}
                  clusterOverrides={clusterOverrides}
                  onClusterOverrideChange={(name, override) =>
                    setClusterOverrides((prev) => ({ ...prev, [name]: override }))
                  }
                  contradictions={contradictions.map((c) => `${c}: both factors reference each other as the preferred alternative`)}
                  factorDescriptions={factorDescriptions}
                />
                {allIssues.length > 0 && (
                  <div className="proceed-blocker">
                    <strong>Resolve before proceeding ({allIssues.length} issues):</strong>
                    <ul>
                      {allIssues.map((r) => <li key={r}>{r}</li>)}
                    </ul>
                  </div>
                )}
                <button
                  className="primary-button"
                  onClick={handleProceedToRefine}
                  disabled={shortlistedFactors.size === 0 || allIssues.length > 0}
                >
                  Refine Bins ({shortlistedFactors.size} factors)
                </button>
              </>
            );
          })()}
        </>
      )}

      {step === "refine" && dataId && targetColumn && (
        <>
          <div className="toolbar">
            <span className="selection-count">
              {refinedFactors.size} shortlisted factors
            </span>
            <button
              className="primary-button"
              onClick={handleAutoMonotonicAll}
              disabled={loading}
            >
              Auto-enforce monotonicity (all)
            </button>
          </div>
          {[...refinedFactors.entries()].map(([name, data]) => {
            const trend = detectTrend(data.bins);
            const isMono = trend !== "Non-monotonic";
            const regularBinCount = data.bins.filter((b) => !b.is_special).length;
            const hasWarning = regularBinCount <= 1;
            return (
              <details key={`${name}-${refineRevision}`} className={`collapsible-section bin-editor-section ${hasWarning ? "bin-editor-warning" : ""}`}>
                <summary>
                  <span className="bin-editor-summary">
                    <span className="bin-editor-summary-name">{name}</span>
                    <span className="mono">IV: {data.iv.toFixed(4)}</span>
                    <span className="mono">GINI: {data.gini.toFixed(4)}</span>
                    <span className="mono">{regularBinCount} bins</span>
                    <span className={isMono ? "monotonic-yes" : "monotonic-no"}>
                      {trend}
                    </span>
                    {hasWarning && (
                      <span className="bin-warning-badge">Insufficient bins</span>
                    )}
                  </span>
                </summary>
                <div className="bin-editor-body">
                  <BinEditor
                    dataId={dataId}
                    targetColumn={targetColumn}
                    factorName={name}
                    initialBins={data.bins}
                    initialIv={data.iv}
                    initialGini={data.gini}
                    specialValues={specialValues}
                    onUpdate={handleBinUpdate}
                  />
                </div>
              </details>
            );
          })}
          {(() => {
            const issues: string[] = [];
            for (const [name, data] of refinedFactors) {
              const regBins = data.bins.filter((b) => !b.is_special).length;
              if (regBins <= 1) issues.push(`${name}: insufficient bins`);
              const trend = detectTrend(data.bins);
              if (trend === "Non-monotonic") issues.push(`${name}: non-monotonic`);
            }
            return (
              <>
                {issues.length > 0 && (
                  <div className="proceed-blocker">
                    <strong>Resolve before exporting ({issues.length} issues):</strong>
                    <ul>
                      {issues.map((issue) => <li key={issue}>{issue}</li>)}
                    </ul>
                  </div>
                )}
                <button
                  className="primary-button"
                  onClick={() => setStep("scorecard")}
                  disabled={issues.length > 0}
                >
                  Proceed to Scorecard
                </button>
              </>
            );
          })()}
        </>
      )}

      {step === "scorecard" && dataId && targetColumn && (
        <>
          <ScorecardPanel
            scorecardData={scorecardData}
            onFitScorecard={handleFitScorecard}
            loading={loading}
            factorDescriptions={factorDescriptions}
            factorNames={[...refinedFactors.keys()]}
            factorMetrics={Object.fromEntries(refinedFactors)}
          />
          {scorecardData && (
            <button className="primary-button" onClick={() => setStep("assessment")}>
              Proceed to Model Assessment
            </button>
          )}
        </>
      )}

      {step === "assessment" && dataId && targetColumn && scorecardData && (
        <>
          <ModelAssessmentPanel
            scorecardData={scorecardData}
            stabilityData={stabilityData}
            onRunStability={handleRunStability}
            loading={loading}
            columns={allColumns}
            targetColumn={targetColumn}
            factorDescriptions={factorDescriptions}
            initialDateColumn={dateColumn}
          />
          <button className="primary-button" onClick={() => setStep("report")}>
            Proceed to Report
          </button>
        </>
      )}

      {step === "report" && dataId && targetColumn && univariateData && (
        <ExportPanel
          dataId={dataId}
          targetColumn={targetColumn}
          factors={exportFactors}
          allFactors={univariateData.factors}
          totalRows={totalRows}
          thresholds={thresholds}
          selectedAfterThresholds={selectedFactors}
          overrideReasons={overrideReasons}
          shortlistedFactors={shortlistedFactors}
          clusterOverrides={clusterOverrides}
          factorDescriptions={factorDescriptions}
          scorecardData={scorecardData}
          stabilityData={stabilityData}
          specialValues={specialValues}
          columns={allColumns}
          config={{
            binningMethod,
            maxBins,
            corrThreshold,
            maxClusters,
            dateColumn,
          }}
          onExportScoredData={lastScorecardRequest ? async () => {
            try {
              const blob = await exportScoredData(lastScorecardRequest);
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "scored_data.csv";
              a.click();
              URL.revokeObjectURL(url);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Export failed.");
            }
          } : undefined}
        />
      )}
    </>
  );
}

export default App;
