import { useRef, useState } from "react";
import { uploadCsv, loadSampleData, sampleCsvUrl } from "../api/client";
import type { ColumnProfile, UploadResponse } from "../types/analysis";

interface Props {
  onUploaded: (data: UploadResponse, targetColumn: string, dateColumn: string, specialValues: number[], descriptions: Record<string, string>, binningMethod: "tree" | "equal_frequency", maxBins: number) => void;
}

const TARGET_HINTS = [
  "default", "target", "flag", "label", "bad", "good_bad", "default_flag",
  "is_default", "y", "outcome", "event", "status", "dpd", "delinquent",
];

function detectTarget(cols: ColumnProfile[]): string {
  const candidates = cols.filter((c) => c.dtype === "numeric" && c.unique_count === 2);
  if (candidates.length === 0) {
    const relaxed = cols.filter((c) => c.dtype === "numeric" && c.unique_count <= 5);
    if (relaxed.length > 0) return relaxed[0].name;
    return "";
  }
  for (const hint of TARGET_HINTS) {
    const match = candidates.find((c) => c.name.toLowerCase().includes(hint));
    if (match) return match.name;
  }
  return candidates[candidates.length - 1].name;
}

export function UploadPanel({ onUploaded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [columns, setColumns] = useState<ColumnProfile[]>([]);
  const [targetColumn, setTargetColumn] = useState("");
  const [dateColumnLocal, setDateColumnLocal] = useState("");
  const [uploadData, setUploadData] = useState<UploadResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [specialValues, setSpecialValues] = useState<number[]>([-999, 9999]);
  const [svInput, setSvInput] = useState("");
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [binningMethod, setBinningMethod] = useState<"tree" | "equal_frequency">("tree");
  const [maxBins, setMaxBins] = useState(10);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setFileName(file.name);

    try {
      const data = await uploadCsv(file);
      setUploadData(data);
      setColumns(data.columns);
      const detected = detectTarget(data.columns);
      const dateCol = data.columns.find((c) =>
        c.name.toLowerCase().includes("date") || c.name.toLowerCase().includes("snapshot") || c.name.toLowerCase().includes("period")
      );
      if (dateCol) setDateColumnLocal(dateCol.name);
      setTargetColumn(detected);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setLoading(false);
    }
  }

  function handleAddSv() {
    const val = Number(svInput.trim());
    if (!isNaN(val) && svInput.trim() !== "" && !specialValues.includes(val)) {
      setSpecialValues([...specialValues, val]);
    }
    setSvInput("");
  }

  function handleRemoveSv(val: number) {
    setSpecialValues(specialValues.filter((v) => v !== val));
  }

  function handleSvKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSv();
    }
  }

  function handleMetadataUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
      if (lines.length < 2) return;
      const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
      const nameIdx = header.findIndex((h) => h === "factor_name" || h === "factor" || h === "name" || h === "variable");
      const descIdx = header.findIndex((h) => h === "description" || h === "desc" || h === "label");
      if (nameIdx === -1 || descIdx === -1) return;
      const parsed: Record<string, string> = {};
      for (const line of lines.slice(1)) {
        const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        if (cols[nameIdx] && cols[descIdx]) {
          parsed[cols[nameIdx]] = cols[descIdx];
        }
      }
      setDescriptions((prev) => ({ ...prev, ...parsed }));
    };
    reader.readAsText(file);
  }

  function handleProceed() {
    if (uploadData && targetColumn) {
      onUploaded(uploadData, targetColumn, dateColumnLocal, specialValues, descriptions, binningMethod, maxBins);
    }
  }

  const binaryColumns = columns.filter(
    (c) => c.dtype === "numeric" && c.unique_count <= 10,
  );

  const [showTargetPicker, setShowTargetPicker] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const columnsWithSpecials = columns.filter(
    (c) => Object.keys(c.special_value_counts).length > 0,
  );
  const columnsWithMissing = columns.filter((c) => c.missing_count > 0);

  return (
    <div className="upload-panel">
      <div className="upload-section">
        <h3>Upload Dataset</h3>
        <p>Upload a CSV file containing your candidate factors and binary target variable.</p>

        <div className="upload-actions">
          <label className="upload-button">
            Choose CSV File
            <input
              ref={fileRef}
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              hidden
            />
          </label>
          <label className="link-button">
            {Object.keys(descriptions).length > 0
              ? `Metadata: ${Object.keys(descriptions).length} descriptions`
              : "Upload Metadata CSV"}
            <input type="file" accept=".csv" onChange={handleMetadataUpload} hidden />
          </label>
          <button className="primary-button" disabled={loading} onClick={async () => {
            setLoading(true);
            setError(null);
            try {
              const { uploadResponse, descriptions: desc } = await loadSampleData();
              setUploadData(uploadResponse);
              setColumns(uploadResponse.columns);
              setDescriptions(desc);
              const detected = detectTarget(uploadResponse.columns);
              setTargetColumn(detected);
              const dateCol = uploadResponse.columns.find((c) =>
                c.name.toLowerCase().includes("date") || c.name.toLowerCase().includes("snapshot")
              );
              if (dateCol) setDateColumnLocal(dateCol.name);
              setFileName("sample_factors.csv");
            } catch (err) {
              setError(err instanceof Error ? err.message : "Failed to load sample data.");
            } finally {
              setLoading(false);
            }
          }}>
            Use Sample Data
          </button>
          <a className="link-button" href={sampleCsvUrl()} download>
            Download sample
          </a>
        </div>

        {fileName && <p className="file-name">File: {fileName}</p>}
        {loading && <div className="status-message">Uploading and profiling data...</div>}
        {error && <div className="status-message error">{error}</div>}
      </div>

      {uploadData && !loading && (
        <>
          <div className="summary-cards">
            <div className="summary-card">
              <div className="summary-label">Rows</div>
              <div className="summary-value">{uploadData.row_count.toLocaleString()}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Columns</div>
              <div className="summary-value">{uploadData.column_count}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">With Missing</div>
              <div className="summary-value">{columnsWithMissing.length}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">With Specials</div>
              <div className="summary-value">{columnsWithSpecials.length}</div>
            </div>
          </div>

          <div className="toolbar">
            <div className="config-field">
              <label>Target variable:</label>
              {!showTargetPicker ? (
                <div className="target-detected">
                  {targetColumn ? (
                    <>
                      <span className="target-name">{targetColumn}</span>
                      <button className="link-button" onClick={() => setShowTargetPicker(true)}>
                        Change
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="target-none">Not detected</span>
                      <button className="link-button" onClick={() => setShowTargetPicker(true)}>
                        Select
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="target-picker">
                  {binaryColumns.map((c) => (
                    <label key={c.name} className={`target-option ${targetColumn === c.name ? "selected" : ""}`}>
                      <input
                        type="radio"
                        name="target"
                        checked={targetColumn === c.name}
                        onChange={() => { setTargetColumn(c.name); setShowTargetPicker(false); }}
                      />
                      {c.name}
                      <span className="target-option-meta">{c.unique_count} unique</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="config-field">
              <label>Date column:</label>
              {!showDatePicker ? (
                <div className="target-detected">
                  {dateColumnLocal ? (
                    <>
                      <span className="target-name">{dateColumnLocal}</span>
                      <button className="link-button" onClick={() => setShowDatePicker(true)}>
                        Change
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="target-none">None</span>
                      <button className="link-button" onClick={() => setShowDatePicker(true)}>
                        Select
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="target-picker">
                  <label className={`target-option ${dateColumnLocal === "" ? "selected" : ""}`}>
                    <input type="radio" name="date" checked={dateColumnLocal === ""}
                      onChange={() => { setDateColumnLocal(""); setShowDatePicker(false); }} />
                    None
                  </label>
                  {columns.filter((c) => c.name !== targetColumn).map((c) => (
                    <label key={c.name} className={`target-option ${dateColumnLocal === c.name ? "selected" : ""}`}>
                      <input type="radio" name="date" checked={dateColumnLocal === c.name}
                        onChange={() => { setDateColumnLocal(c.name); setShowDatePicker(false); }} />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="config-field">
              <label>Special values:</label>
              <div className="sv-chips">
                {specialValues.map((v) => (
                  <span key={v} className="sv-chip">
                    {v}
                    <button className="sv-chip-remove" onClick={() => handleRemoveSv(v)}>x</button>
                  </span>
                ))}
                <input
                  className="sv-chip-input"
                  type="number"
                  step="any"
                  value={svInput}
                  onChange={(e) => setSvInput(e.target.value)}
                  onKeyDown={handleSvKeyDown}
                  placeholder="Add value..."
                />
              </div>
            </div>
            <div className="config-field">
              <label>Binning:</label>
              <div className="method-toggle">
                <button className={`method-btn ${binningMethod === "tree" ? "active" : ""}`}
                  onClick={() => setBinningMethod("tree")}>Optimal (Tree)</button>
                <button className={`method-btn ${binningMethod === "equal_frequency" ? "active" : ""}`}
                  onClick={() => setBinningMethod("equal_frequency")}>Equal Frequency</button>
              </div>
            </div>
            <div className="config-field">
              <label>Max bins:</label>
              <input type="number" min={2} max={50} value={maxBins}
                onChange={(e) => setMaxBins(parseInt(e.target.value) || 10)}
                style={{ width: 60, padding: "6px 8px", borderRadius: 6, border: "1px solid var(--border)", fontSize: 14 }}
              />
            </div>
            <button
              className="primary-button"
              onClick={handleProceed}
              disabled={!targetColumn}
            >
              Run Univariate Analysis
            </button>
          </div>

          <details className="collapsible-section">
            <summary>
              Column Profiles ({columns.length} columns)
            </summary>
            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Type</th>
                    <th>Missing %</th>
                    <th>SV %</th>
                    <th>Valid %</th>
                    <th>Unique</th>
                  </tr>
                </thead>
                <tbody>
                  {columns.map((c) => {
                    const specialTotal = Object.values(c.special_value_counts).reduce(
                      (a, b) => a + b,
                      0,
                    );
                    const svPct = uploadData.row_count > 0
                      ? (specialTotal / uploadData.row_count) * 100
                      : 0;
                    const validPct = uploadData.row_count > 0
                      ? ((uploadData.row_count - c.missing_count - specialTotal) / uploadData.row_count) * 100
                      : 0;
                    return (
                      <tr key={c.name}>
                        <td>{c.name}</td>
                        <td>{c.dtype}</td>
                        <td className="mono">{c.missing_count > 0 ? `${c.missing_pct.toFixed(1)}%` : "-"}</td>
                        <td className="mono">{specialTotal > 0 ? `${svPct.toFixed(1)}%` : "-"}</td>
                        <td className="mono">{validPct < 100 ? `${validPct.toFixed(1)}%` : "100%"}</td>
                        <td>{c.unique_count}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>

          <details className="collapsible-section">
            <summary>
              Detected Special Values ({columnsWithSpecials.length} columns)
            </summary>
            {columnsWithSpecials.length > 0 ? (
              <div className="table-wrapper">
                <table className="data-table compact">
                  <thead>
                    <tr>
                      <th>Column</th>
                      <th>Special Value</th>
                      <th>Count</th>
                      <th>% of Rows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {columnsWithSpecials.map((c) =>
                      Object.entries(c.special_value_counts).map(([val, count]) => (
                        <tr key={`${c.name}-${val}`}>
                          <td>{c.name}</td>
                          <td className="mono">{val}</td>
                          <td>{count.toLocaleString()}</td>
                          <td className="mono">
                            {((count / uploadData.row_count) * 100).toFixed(1)}%
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="chart-note">No special values detected in the dataset.</p>
            )}
          </details>
        </>
      )}
    </div>
  );
}
