import { useState } from "react";
import { refineBins } from "../api/client";
import type { BinDetail, RefineBinsResponse } from "../types/analysis";
import { WoeChart } from "./WoeChart";

interface Props {
  dataId: string;
  targetColumn: string;
  factorName: string;
  initialBins: BinDetail[];
  initialIv: number;
  initialGini: number;
  specialValues: number[];
  onUpdate: (factorName: string, bins: BinDetail[], iv: number, gini: number) => void;
}

export function BinEditor({
  dataId,
  targetColumn,
  factorName,
  initialBins,
  initialIv,
  initialGini,
  specialValues,
  onUpdate,
}: Props) {
  const [bins, setBins] = useState(initialBins);
  const [iv, setIv] = useState(initialIv);
  const [gini, setGini] = useState(initialGini);
  const [isMonotonic, setIsMonotonic] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [splitIndex, setSplitIndex] = useState<number | null>(null);
  const [splitValue, setSplitValue] = useState("");
  const [addEdgeValue, setAddEdgeValue] = useState("");
  const [dataMin, setDataMin] = useState<number | null>(() => {
    const lowers = initialBins.filter((b) => !b.is_special && b.lower !== null).map((b) => b.lower!);
    return lowers.length > 0 ? Math.min(...lowers) : null;
  });
  const [dataMax, setDataMax] = useState<number | null>(() => {
    const uppers = initialBins.filter((b) => !b.is_special && b.upper !== null).map((b) => b.upper!);
    return uppers.length > 0 ? Math.max(...uppers) : null;
  });

  const [baseEdges] = useState<number[]>(() => {
    const edges: number[] = [];
    for (const b of initialBins) {
      if (!b.is_special) {
        if (b.lower !== null) edges.push(b.lower);
        if (b.upper !== null) edges.push(b.upper);
      }
    }
    return [...new Set(edges)].sort((a, b) => a - b);
  });

  const regularBins = bins.filter((b) => !b.is_special);
  const specialBins = bins.filter((b) => b.is_special);

  function getCurrentEdges(): number[] {
    const edges: number[] = [];
    for (const b of regularBins) {
      if (b.lower !== null) edges.push(b.lower);
      if (b.upper !== null) edges.push(b.upper);
    }
    return [...new Set(edges)].sort((a, b) => a - b);
  }

  async function callRefine(
    edges: number[],
    enforceMonotonicity: boolean = false,
    direction: "auto" | "increasing" | "decreasing" | "u_shaped" = "auto",
  ) {
    setLoading(true);
    setError(null);
    try {
      const res: RefineBinsResponse = await refineBins({
        data_id: dataId,
        target_column: targetColumn,
        factor_name: factorName,
        bin_edges: edges,
        enforce_monotonicity: enforceMonotonicity,
        monotonicity_direction: direction,
        special_values: specialValues,
      });
      setBins(res.bins);
      setIv(res.iv);
      setGini(res.gini);
      setIsMonotonic(res.is_monotonic);
      if (res.data_min !== null) setDataMin(res.data_min);
      if (res.data_max !== null) setDataMax(res.data_max);
      onUpdate(factorName, res.bins, res.iv, res.gini);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refinement failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleMerge(index: number) {
    const edges = getCurrentEdges();
    if (index < regularBins.length - 1 && regularBins[index].upper !== null) {
      const newEdges = edges.filter((e) => e !== regularBins[index].upper);
      callRefine(newEdges);
    }
  }

  function handleSplit() {
    const val = parseFloat(splitValue);
    if (isNaN(val)) return;

    const edges = getCurrentEdges();
    if (!edges.includes(val)) {
      edges.push(val);
      edges.sort((a, b) => a - b);
    }
    callRefine(edges);
    setSplitIndex(null);
    setSplitValue("");
  }

  function handleReset() {
    callRefine(baseEdges);
  }

  function handleAddEdge() {
    const val = parseFloat(addEdgeValue);
    if (isNaN(val)) return;
    const edges = getCurrentEdges();
    if (!edges.includes(val)) {
      edges.push(val);
      edges.sort((a, b) => a - b);
    }
    callRefine(edges);
    setAddEdgeValue("");
  }

  function handleMonotonicity(direction: "auto" | "increasing" | "decreasing" | "u_shaped") {
    callRefine(baseEdges, true, direction);
  }

  return (
    <div className="bin-editor">
      <div className="bin-editor-header">
        <h4>{factorName}</h4>
        <div className="bin-editor-stats">
          <span>IV: <strong>{iv.toFixed(4)}</strong></span>
          <span>GINI: <strong>{gini.toFixed(4)}</strong></span>
          <span className={isMonotonic ? "monotonic-yes" : "monotonic-no"}>
            {isMonotonic ? "Monotonic" : "Non-monotonic"}
          </span>
        </div>
      </div>

      {error && <div className="status-message error">{error}</div>}

      {regularBins.length <= 1 && (
        <div className="bin-warning">
          Only {regularBins.length} regular bin — this factor has no risk differentiation
          across its valid range. Add bin edges below to create meaningful splits.
        </div>
      )}

      <WoeChart bins={bins} />

      <div className="bin-edge-controls">
        <span>Add bin edge:</span>
        <input
          type="number"
          step="any"
          value={addEdgeValue}
          onChange={(e) => setAddEdgeValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddEdge(); } }}
          placeholder={dataMin !== null ? `${dataMin.toFixed(2)} - ${dataMax?.toFixed(2)}` : "Enter value..."}
          disabled={loading}
        />
        <button className="small-button" onClick={handleAddEdge} disabled={loading || addEdgeValue === ""}>
          Add
        </button>
        <button className="small-button" onClick={handleReset} disabled={loading}>
          Reset
        </button>
        <span className="bin-edge-count">
          {regularBins.length} bins | {getCurrentEdges().length} edges
          {dataMin !== null && <> | Range: {dataMin.toFixed(2)} to {dataMax?.toFixed(2)}</>}
        </span>
      </div>

      {regularBins.some((b) => b.count === 0) && (
        <div className="bin-warning">
          One or more bins are empty (0 observations). Adjust bin edges to ensure all bins contain data.
        </div>
      )}

      <div className="monotonicity-controls">
        <span>Enforce monotonicity:</span>
        <button className="link-button" onClick={() => handleMonotonicity("auto")} disabled={loading}>
          Auto
        </button>
        <button className="link-button" onClick={() => handleMonotonicity("increasing")} disabled={loading}>
          Increasing
        </button>
        <button className="link-button" onClick={() => handleMonotonicity("decreasing")} disabled={loading}>
          Decreasing
        </button>
        <button className="link-button" onClick={() => handleMonotonicity("u_shaped")} disabled={loading}>
          U-shaped
        </button>
      </div>

      <div className="table-wrapper">
        <table className="data-table compact">
          <thead>
            <tr>
              <th style={{ width: 50 }}>Group</th>
              <th>Bin</th>
              <th>Count</th>
              <th>Events</th>
              <th>Event Rate</th>
              <th>WoE</th>
              <th>IV Contrib</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {regularBins.map((b, i) => (
              <>
                <tr key={b.bin_label}>
                  <td className="mono group-cell">{i + 1}</td>
                  <td className="mono">{b.bin_label}</td>
                  <td>{b.count.toLocaleString()}</td>
                  <td>{b.event_count.toLocaleString()}</td>
                  <td className="mono">{(b.event_rate * 100).toFixed(2)}%</td>
                  <td className="mono">{b.woe.toFixed(4)}</td>
                  <td className="mono">{b.iv_contribution.toFixed(4)}</td>
                  <td>
                    {i < regularBins.length - 1 && (
                      <button
                        className="small-button"
                        onClick={() => handleMerge(i)}
                        disabled={loading}
                      >
                        Merge
                      </button>
                    )}
                    {b.lower !== null && b.upper !== null && (
                      <button
                        className="small-button"
                        onClick={() => setSplitIndex(splitIndex === i ? null : i)}
                        disabled={loading}
                      >
                        Split
                      </button>
                    )}
                  </td>
                </tr>
                {splitIndex === i && (
                  <tr key={`${b.bin_label}-split`} className="split-row">
                    <td colSpan={8}>
                      <div className="split-input">
                        <label>Split at value:</label>
                        <input
                          type="number"
                          step="any"
                          value={splitValue}
                          onChange={(e) => setSplitValue(e.target.value)}
                          placeholder={`Between ${b.lower ?? "-inf"} and ${b.upper ?? "+inf"}`}
                        />
                        <button className="small-button" onClick={() => handleSplit()}>
                          Apply
                        </button>
                        <button
                          className="small-button"
                          onClick={() => { setSplitIndex(null); setSplitValue(""); }}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
            {specialBins.length > 0 && (
              <>
                <tr className="special-separator">
                  <td colSpan={8}>Missing / Special Values</td>
                </tr>
                {specialBins.map((b, i) => (
                  <tr key={b.bin_label} className="special-bin-row">
                    <td className="mono group-cell">S{i + 1}</td>
                    <td className="mono">{b.bin_label}</td>
                    <td>{b.count.toLocaleString()}</td>
                    <td>{b.event_count.toLocaleString()}</td>
                    <td className="mono">{(b.event_rate * 100).toFixed(2)}%</td>
                    <td className="mono">{b.woe.toFixed(4)}</td>
                    <td className="mono">{b.iv_contribution.toFixed(4)}</td>
                    <td></td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
