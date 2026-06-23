import type {
  ClusterRequest,
  ClusterResponse,
  ExportRequest,
  RefineBinsRequest,
  RefineBinsResponse,
  ScorecardRequest,
  ScorecardResponse,
  StabilityRequest,
  StabilityResponse,
  UnivariateRequest,
  UnivariateResponse,
  UploadResponse,
} from "../types/analysis";

const API_BASE: string = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export async function uploadCsv(file: File): Promise<UploadResponse> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Upload failed (${res.status})`);
  }

  return res.json();
}

export async function runUnivariate(req: UnivariateRequest): Promise<UnivariateResponse> {
  const res = await fetch(`${API_BASE}/api/univariate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Univariate analysis failed (${res.status})`);
  }

  return res.json();
}

export async function runClustering(req: ClusterRequest): Promise<ClusterResponse> {
  const res = await fetch(`${API_BASE}/api/cluster`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Clustering failed (${res.status})`);
  }

  return res.json();
}

export async function refineBins(req: RefineBinsRequest): Promise<RefineBinsResponse> {
  const res = await fetch(`${API_BASE}/api/refine-bins`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Bin refinement failed (${res.status})`);
  }

  return res.json();
}

export async function exportShortlist(req: ExportRequest): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Export failed (${res.status})`);
  }

  return res.blob();
}

export async function fitScorecard(req: ScorecardRequest): Promise<ScorecardResponse> {
  const res = await fetch(`${API_BASE}/api/fit-scorecard`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Scorecard fitting failed (${res.status})`);
  }

  return res.json();
}

export async function runStabilityAnalysis(req: StabilityRequest): Promise<StabilityResponse> {
  const res = await fetch(`${API_BASE}/api/stability`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Stability analysis failed (${res.status})`);
  }

  return res.json();
}

export async function exportScoredData(req: ScorecardRequest): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/export-scored-data`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Scored data export failed (${res.status})`);
  }

  return res.blob();
}

export async function loadSampleData(): Promise<{ uploadResponse: UploadResponse; descriptions: Record<string, string> }> {
  const [csvRes, metaRes] = await Promise.all([
    fetch(`${API_BASE}/api/sample-csv`),
    fetch(`${API_BASE}/api/sample-metadata`),
  ]);

  if (!csvRes.ok) throw new Error("Failed to load sample data");
  if (!metaRes.ok) throw new Error("Failed to load sample metadata");

  const csvBlob = await csvRes.blob();
  const file = new File([csvBlob], "sample_factors.csv", { type: "text/csv" });
  const uploadResponse = await uploadCsv(file);

  const metaText = await metaRes.text();
  const descriptions: Record<string, string> = {};
  const lines = metaText.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length > 1) {
    const header = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
    const nameIdx = header.findIndex((h) => h === "factor_name" || h === "factor" || h === "name");
    const descIdx = header.findIndex((h) => h === "description" || h === "desc");
    if (nameIdx !== -1 && descIdx !== -1) {
      for (const line of lines.slice(1)) {
        const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        if (cols[nameIdx] && cols[descIdx]) descriptions[cols[nameIdx]] = cols[descIdx];
      }
    }
  }

  return { uploadResponse, descriptions };
}

export function sampleCsvUrl(): string {
  return `${API_BASE}/api/sample-csv`;
}

export function sampleMetadataUrl(): string {
  return `${API_BASE}/api/sample-metadata`;
}
