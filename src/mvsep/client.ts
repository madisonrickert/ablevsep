export const BASE = "https://mvsep.com";
export const POLL_MS = 2500;
export const DEFAULT_OUTPUT_FORMAT = 1; // wav 16-bit

export type AddOptKey = "add_opt1" | "add_opt2" | "add_opt3";

export type SepStatus =
  | "not_found" | "waiting" | "processing" | "distributing" | "merging" | "done" | "failed";

export interface StatusFile {
  filename: string;
  downloadUrl: string;
}

export interface StatusResult {
  status: SepStatus;
  message?: string;
  queueCount?: number;
  currentOrder?: number;
  finishedChunks?: number;
  allChunks?: number;
  files: StatusFile[];
}

export interface CreateParams {
  apiToken: string;
  file: Blob;
  fileName: string;
  sepType: number;
  outputFormat: number;
  options: Partial<Record<AddOptKey, string>>;
}

export class MvsepError extends Error {
  constructor(message: string, public code?: number) {
    super(message);
    this.name = "MvsepError";
  }
}

function numOrUndef(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}

export async function createSeparation(p: CreateParams, fetchImpl: typeof fetch = fetch): Promise<string> {
  const fd = new FormData();
  fd.append("api_token", p.apiToken);
  fd.append("audiofile", p.file, p.fileName);
  fd.append("sep_type", String(p.sepType));
  fd.append("output_format", String(p.outputFormat));
  for (const [k, v] of Object.entries(p.options)) {
    if (v != null && v !== "") fd.append(k, v);
  }
  const res = await fetchImpl(`${BASE}/api/separation/create`, { method: "POST", body: fd });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success || !json?.data?.hash) {
    throw new MvsepError(json?.data?.message ?? `HTTP ${res.status}`, res.status);
  }
  return String(json.data.hash);
}

export async function getStatus(hash: string, fetchImpl: typeof fetch = fetch): Promise<StatusResult> {
  const res = await fetchImpl(`${BASE}/api/separation/get?hash=${encodeURIComponent(hash)}`);
  const json: any = await res.json().catch(() => ({}));
  const d = json?.data ?? {};
  return {
    status: json?.status as SepStatus,
    message: d.message,
    queueCount: numOrUndef(d.queue_count),
    currentOrder: numOrUndef(d.current_order),
    finishedChunks: numOrUndef(d.finished_chunks),
    allChunks: numOrUndef(d.all_chunks),
    files: Array.isArray(d.files)
      ? d.files.map((f: any) => ({ filename: String(f.filename), downloadUrl: String(f.download_url) }))
      : [],
  };
}

export async function downloadFile(url: string, fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new MvsepError(`Download failed: HTTP ${res.status}`, res.status);
  return res.arrayBuffer();
}
