import ExcelJS from "exceljs";
import type {
  FactorAnalysis,
  FactorThresholds,
  ScorecardResponse,
  StabilityResponse,
} from "../types/analysis";

interface ReportData {
  config: {
    binningMethod: string;
    maxBins: number;
    corrThreshold: number;
    maxClusters: number | null;
    dateColumn: string;
    efwMethod: string;
  };
  totalRows: number;
  targetColumn: string;
  thresholds: FactorThresholds;
  allFactors: FactorAnalysis[];
  scorecardData: ScorecardResponse;
  stabilityData: StabilityResponse | null;
  factorDescriptions: Record<string, string>;
  audit: Array<{
    factor_name: string;
    description: string;
    iv: number;
    gini: number;
    valid_pct: number;
    regular_bins: number;
    status: string;
    stage: string;
    reason: string;
    in_model: boolean;
    model_rejection_reason: string;
  }>;
}

async function captureCharts(): Promise<Array<{ label: string; blob: Blob; width: number; height: number }>> {
  const results: Array<{ label: string; blob: Blob; width: number; height: number }> = [];

  const svgs = document.querySelectorAll(".recharts-wrapper svg");

  for (let i = 0; i < svgs.length; i++) {
    try {
      const svg = svgs[i] as SVGSVGElement;
      const rect = svg.getBoundingClientRect();
      if (rect.width < 50 || rect.height < 50) continue;

      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("width", String(rect.width));
      clone.setAttribute("height", String(rect.height));
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

      const styles = document.querySelectorAll("style");
      const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
      let cssText = "";
      styles.forEach((s) => { cssText += s.textContent ?? ""; });
      styleEl.textContent = cssText;
      clone.insertBefore(styleEl, clone.firstChild);

      const bgRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      bgRect.setAttribute("width", "100%");
      bgRect.setAttribute("height", "100%");
      bgRect.setAttribute("fill", "white");
      clone.insertBefore(bgRect, clone.firstChild);

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.width = rect.width * 2;
      img.height = rect.height * 2;

      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = rect.width * 2;
      canvas.height = rect.height * 2;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      URL.revokeObjectURL(url);

      const blob = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      );

      const parent = svg.closest("details");
      const summary = parent?.querySelector("summary");
      const label = summary?.textContent?.trim() ?? `Chart ${i + 1}`;

      results.push({ label, blob, width: rect.width, height: rect.height });
    } catch {
      // Skip charts that can't be captured
    }
  }
  return results;
}

function applyNumberFormat(ws: ExcelJS.Worksheet, colIndex: number, fmt: string) {
  ws.getColumn(colIndex).eachCell({ includeEmpty: false }, (cell, rowNum) => {
    if (rowNum > 1 && typeof cell.value === "number") {
      cell.numFmt = fmt;
    }
  });
}

function addDataSheet(
  wb: ExcelJS.Workbook,
  name: string,
  headers: string[],
  rows: (string | number)[][],
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name);

  // Header row
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 24;
  headerRow.eachCell((cell) => {
    cell.border = {
      bottom: { style: "medium", color: { argb: "FF1E3A5F" } },
    };
  });

  // Data rows with alternating bands
  for (let r = 0; r < rows.length; r++) {
    const dataRow = ws.addRow(rows[r]);
    dataRow.font = { size: 10, name: "Calibri" };
    dataRow.alignment = { vertical: "middle" };

    if (r % 2 === 1) {
      dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };
    }

    dataRow.eachCell((cell) => {
      cell.border = {
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
      if (typeof cell.value === "number") {
        cell.alignment = { horizontal: "right", vertical: "middle" };
      }
    });
  }

  // Auto column widths
  headers.forEach((_, i) => {
    const col = ws.getColumn(i + 1);
    const maxDataLen = rows.reduce((max, r) => Math.max(max, String(r[i] ?? "").length), 0);
    col.width = Math.max(headers[i].length + 4, maxDataLen + 3, 12);
  });

  // Freeze header row
  ws.views = [{ state: "frozen", ySplit: 1 }];

  // Auto filter
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1 + rows.length, column: headers.length },
  };

  return ws;
}

export async function exportFullReport(data: ReportData) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Scorecard Builder";
  wb.created = new Date();

  // 1. Configuration
  const configWs = wb.addWorksheet("Configuration");
  configWs.properties.tabColor = { argb: "FF1E3A5F" };
  configWs.getColumn(1).width = 28;
  configWs.getColumn(2).width = 32;

  const addConfigSection = (title: string, items: [string, string | number][]) => {
    const sectionRow = configWs.addRow([title]);
    sectionRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
    sectionRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    sectionRow.height = 24;
    sectionRow.alignment = { vertical: "middle" };
    configWs.mergeCells(sectionRow.number, 1, sectionRow.number, 2);

    for (let i = 0; i < items.length; i++) {
      const [label, value] = items[i];
      const row = configWs.addRow([label, value]);
      row.font = { size: 10, name: "Calibri" };
      row.getCell(1).font = { size: 10, name: "Calibri", bold: true, color: { argb: "FF475569" } };
      row.getCell(2).alignment = { horizontal: "left" };
      row.eachCell((cell) => {
        cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
      });
      if (i % 2 === 1) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };
      }
    }
    configWs.addRow([]);
  };

  addConfigSection("Data Configuration", [
    ["Observations", data.totalRows],
    ["Target Variable", data.targetColumn],
    ["Date Column", data.config.dateColumn || "None"],
    ["Binning Method", data.config.binningMethod === "equal_frequency" ? "Equal Frequency" : "Optimal (Tree)"],
    ["Max Bins", data.config.maxBins],
  ]);

  addConfigSection("Factor Selection Thresholds", [
    ["Min IV", data.thresholds.iv],
    ["Min GINI", data.thresholds.gini],
    ["Min Valid %", `${data.thresholds.minValidPct}%`],
    ["Min Bins", data.thresholds.minBins],
    ["Correlation Threshold", data.config.corrThreshold],
    ["Max Clusters", data.config.maxClusters ?? "Auto"],
    ["EFW Method", data.config.efwMethod],
  ]);

  addConfigSection("Model Performance", [
    ["AUC", Number(data.scorecardData.auc.toFixed(4))],
    ["GINI", Number(data.scorecardData.gini.toFixed(4))],
    ["KS Statistic", Number(data.scorecardData.ks_statistic.toFixed(4))],
    ["Score Range", `${data.scorecardData.total_min_score.toFixed(0)} - ${data.scorecardData.total_max_score.toFixed(0)}`],
    ["Factors in Model", data.scorecardData.factors.length],
  ]);

  // 2. Coefficients
  const efwMethod = data.config.efwMethod;
  const efwRaw = data.scorecardData.factors.map((f) => {
    const pts = f.bins.map((b) => b.points);
    const woeVals = f.bins.filter((b) => !b.group.startsWith("S")).map((b) => b.woe);
    const mean = woeVals.length > 0 ? woeVals.reduce((a, b) => a + b, 0) / woeVals.length : 0;
    const woeStd = woeVals.length > 1 ? Math.sqrt(woeVals.reduce((s, w) => s + (w - mean) ** 2, 0) / woeVals.length) : 0;
    const raw = efwMethod === "coefficient" ? Math.abs(f.coefficient) : efwMethod === "variance" ? Math.abs(f.coefficient) * woeStd : Math.max(...pts) - Math.min(...pts);
    return { name: f.factor_name, raw };
  });
  const totalEfw = efwRaw.reduce((s, e) => s + e.raw, 0) || 1;
  const efwMap: Record<string, number> = {};
  efwRaw.forEach((e) => { efwMap[e.name] = (e.raw / totalEfw) * 100; });

  const coeffWs = addDataSheet(wb, "Coefficients",
    ["Factor", "Description", "Coefficient", "P-value", "VIF", "EFW %"],
    data.scorecardData.factors.map((f) => [
      f.factor_name,
      data.factorDescriptions[f.factor_name] ?? "",
      f.coefficient,
      f.p_value ?? "",
      f.vif ?? "",
      Number((efwMap[f.factor_name] ?? 0).toFixed(1)),
    ]),
  );
  coeffWs.properties.tabColor = { argb: "FF2563EB" };
  applyNumberFormat(coeffWs, 3, "0.0000");
  applyNumberFormat(coeffWs, 4, "0.0000");
  applyNumberFormat(coeffWs, 5, "0.00");
  applyNumberFormat(coeffWs, 6, "0.0");

  // 3. Scorecard Points
  const pointsRows: (string | number)[][] = [];
  for (const f of data.scorecardData.factors) {
    for (const b of f.bins) {
      pointsRows.push([f.factor_name, data.factorDescriptions[f.factor_name] ?? "", b.group, b.bin_label, b.woe, b.points, b.count, b.event_rate]);
    }
  }
  const pointsWs = addDataSheet(wb, "Scorecard Points",
    ["Factor", "Description", "Group", "Bin", "WoE", "Points", "Count", "Event Rate"],
    pointsRows,
  );
  pointsWs.properties.tabColor = { argb: "FF2563EB" };
  applyNumberFormat(pointsWs, 5, "0.0000");
  applyNumberFormat(pointsWs, 6, "0");
  applyNumberFormat(pointsWs, 8, "0.00%");

  // 4. Factor Selection Log
  if (data.scorecardData.stepwise_log.length > 0) {
    const selWs = addDataSheet(wb, "Selection Log",
      ["Step", "Action", "Factor", "P-value", "Reason"],
      data.scorecardData.stepwise_log.map((s) => [
        s.step, s.action, s.factor_name, s.p_value ?? "", s.reason,
      ]),
    );
    selWs.properties.tabColor = { argb: "FF64748B" };
    applyNumberFormat(selWs, 4, "0.0000");
  }

  // 5. Factor Audit
  const auditWs = addDataSheet(wb, "Factor Audit",
    ["Factor", "Description", "IV", "GINI", "Valid %", "Bins", "Status", "Stage", "Reason", "In Model", "Model Rejection"],
    data.audit.map((a) => [
      a.factor_name, a.description, a.iv, a.gini,
      a.valid_pct / 100, a.regular_bins, a.status, a.stage, a.reason,
      a.in_model ? "Yes" : "No", a.model_rejection_reason,
    ]),
  );
  auditWs.properties.tabColor = { argb: "FF64748B" };
  applyNumberFormat(auditWs, 3, "0.0000");
  applyNumberFormat(auditWs, 4, "0.0000");
  applyNumberFormat(auditWs, 5, "0.0%");

  // 6. Stability
  if (data.stabilityData) {
    const giniWs = addDataSheet(wb, "GINI over Time",
      ["Period", "GINI", "GINI SE", "Observations", "Event Rate"],
      data.stabilityData.periods.map((p) => [
        p.period, p.gini ?? "", p.gini_se ?? "", p.obs_count, p.event_rate,
      ]),
    );
    giniWs.properties.tabColor = { argb: "FF16A34A" };
    applyNumberFormat(giniWs, 2, "0.0000");
    applyNumberFormat(giniWs, 3, "0.0000");
    applyNumberFormat(giniWs, 5, "0.00%");

    const psiWs = addDataSheet(wb, "Score PSI",
      ["Period", "Observations", "Events", "Event Rate", "Mean Score", "PSI"],
      data.stabilityData.periods.map((p) => [
        p.period, p.obs_count, p.event_count, p.event_rate,
        p.mean_score ?? "", p.psi ?? "",
      ]),
    );
    psiWs.properties.tabColor = { argb: "FF16A34A" };
    applyNumberFormat(psiWs, 4, "0.00%");
    applyNumberFormat(psiWs, 5, "0");
    applyNumberFormat(psiWs, 6, "0.0000");

    // Factor IV
    if (data.stabilityData.factor_stability.length > 0) {
      const periods = data.stabilityData.periods.map((p) => p.period);
      const ivWs = addDataSheet(wb, "Factor IV",
        ["Factor", ...periods],
        data.stabilityData.factor_stability.map((fs) => [
          fs.factor_name,
          ...periods.map((p) => {
            const pd = fs.periods.find((fp) => fp.period === p);
            return pd ? pd.iv : "";
          }),
        ]),
      );
      ivWs.properties.tabColor = { argb: "FF16A34A" };
      for (let c = 2; c <= periods.length + 1; c++) {
        applyNumberFormat(ivWs, c, "0.0000");
      }
    }

    // Factor PSI
    if ((data.stabilityData.factor_psi ?? []).length > 0) {
      const periods = data.stabilityData.periods.map((p) => p.period);
      const fpsiWs = addDataSheet(wb, "Factor PSI YoY",
        ["Factor", ...periods],
        (data.stabilityData.factor_psi ?? []).map((fp) => [
          fp.factor_name,
          ...periods.map((p) => {
            const pd = fp.periods.find((x) => x.period === p);
            return pd?.psi_yoy ?? "";
          }),
        ]),
      );
      fpsiWs.properties.tabColor = { argb: "FF16A34A" };
      for (let c = 2; c <= periods.length + 1; c++) {
        applyNumberFormat(fpsiWs, c, "0.0000");
      }
    }

    // Cyclicality
    if (Object.keys(data.stabilityData.cyclicality).length > 0) {
      const cycWs = wb.addWorksheet("Cyclicality");
      cycWs.properties.tabColor = { argb: "FFEA580C" };
      cycWs.getColumn(1).width = 32;
      cycWs.getColumn(2).width = 16;
      cycWs.getColumn(3).width = 28;

      const sectionRow = cycWs.addRow(["Cyclicality Measures"]);
      sectionRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
      sectionRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
      sectionRow.height = 24;
      sectionRow.alignment = { vertical: "middle" };
      cycWs.mergeCells(1, 1, 1, 3);

      const headerRow = cycWs.addRow(["Method", "Value", "Interpretation"]);
      headerRow.font = { bold: true, color: { argb: "FF1E3A5F" }, size: 10, name: "Calibri" };
      headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      headerRow.height = 22;
      headerRow.alignment = { vertical: "middle" };
      headerRow.eachCell((cell) => {
        cell.border = { bottom: { style: "medium", color: { argb: "FF1E3A5F" } } };
      });

      const c = data.stabilityData.cyclicality;
      const cycRows: [string, number, string][] = [];
      if (c.log_regression !== undefined) {
        cycRows.push(["Log-log regression", c.log_regression,
          Math.abs(c.log_regression) > 0.8 ? "Highly PIT" : Math.abs(c.log_regression) > 0.5 ? "Moderately cyclical" : Math.abs(c.log_regression) > 0.2 ? "Low cyclicality" : "Near TTC"]);
      }
      if (c.two_point !== undefined) {
        cycRows.push([`Two-point${c.two_point_periods ? ` (${c.two_point_periods})` : ""}`, c.two_point,
          Math.abs(c.two_point) > 1 ? "Amplifies cycle" : Math.abs(c.two_point) > 0.5 ? "Passes through" : "Dampens cycle"]);
      }
      if (c.cv_model_pd !== undefined) {
        cycRows.push(["CV of model PD", c.cv_model_pd,
          c.cv_model_pd > 0.3 ? "High dispersion" : c.cv_model_pd > 0.15 ? "Moderate" : "Low dispersion"]);
      }
      cycRows.forEach((row, i) => {
        const dataRow = cycWs.addRow(row);
        dataRow.font = { size: 10, name: "Calibri" };
        dataRow.getCell(2).numFmt = "0.0000";
        dataRow.getCell(2).alignment = { horizontal: "right" };
        if (i % 2 === 1) {
          dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };
        }
        dataRow.eachCell((cell) => {
          cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
        });
      });

      cycWs.addRow([]);
      const periodSection = cycWs.addRow(["Period Data"]);
      periodSection.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11, name: "Calibri" };
      periodSection.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
      periodSection.height = 24;
      periodSection.alignment = { vertical: "middle" };
      cycWs.mergeCells(periodSection.number, 1, periodSection.number, 3);

      const periodHeader = cycWs.addRow(["Period", "ODR", "Model PD"]);
      periodHeader.font = { bold: true, color: { argb: "FF1E3A5F" }, size: 10, name: "Calibri" };
      periodHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
      periodHeader.height = 22;
      periodHeader.alignment = { vertical: "middle" };
      periodHeader.eachCell((cell) => {
        cell.border = { bottom: { style: "medium", color: { argb: "FF1E3A5F" } } };
      });

      data.stabilityData.periods.forEach((p, i) => {
        const row = cycWs.addRow([p.period, p.event_rate, p.mean_model_pd ?? ""]);
        row.font = { size: 10, name: "Calibri" };
        row.getCell(2).numFmt = "0.00%";
        row.getCell(3).numFmt = "0.00%";
        row.getCell(2).alignment = { horizontal: "right" };
        row.getCell(3).alignment = { horizontal: "right" };
        if (i % 2 === 1) {
          row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F6FA" } };
        }
        row.eachCell((cell) => {
          cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
        });
      });

      cycWs.views = [{ state: "frozen", ySplit: 2 }];
    }
  }

  // 7. Score Distribution
  if (data.scorecardData.score_distribution.length > 0) {
    const distWs = addDataSheet(wb, "Score Distribution",
      ["Band", "Count", "Percentage"],
      data.scorecardData.score_distribution.map((d) => [d.band, d.count, d.pct / 100]),
    );
    distWs.properties.tabColor = { argb: "FF8B5CF6" };
    applyNumberFormat(distWs, 3, "0.0%");
  }

  // 8. Capture charts and embed into relevant sheets
  try {
    const charts = await captureCharts();
    const sheetMap: Record<string, string> = {
      "Score Distribution": "Score Distribution",
      "GINI over Time": "GINI over Time",
      "Effective Weights": "Coefficients",
      "Cyclicality Analysis": "Cyclicality",
      "Stability Analysis": "Score PSI",
    };

    for (const chart of charts) {
      const targetSheet = Object.entries(sheetMap).find(([key]) =>
        chart.label.includes(key),
      )?.[1] ?? "Score PSI";

      const ws = wb.getWorksheet(targetSheet);
      if (!ws) continue;

      const buffer = await chart.blob.arrayBuffer();
      const imageId = wb.addImage({
        buffer: buffer as ArrayBuffer,
        extension: "png",
      });

      const lastRow = ws.rowCount + 2;
      const imgWidth = Math.min(chart.width, 700);
      const imgHeight = Math.round(imgWidth * chart.height / chart.width);

      ws.getCell(lastRow, 1).value = chart.label;
      ws.getCell(lastRow, 1).font = { bold: true, size: 11 };

      ws.addImage(imageId, {
        tl: { col: 0, row: lastRow },
        ext: { width: imgWidth, height: imgHeight },
      });
    }
  } catch {
    // Charts capture failed - skip silently
  }

  // Generate and download
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "scorecard_report.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}
