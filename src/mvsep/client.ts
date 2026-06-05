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
  /** Raw audio bytes to upload. A Node Buffer/Uint8Array — NOT a web `Blob`
   * (Live's Extension Host runtime does not expose the `Blob`/`FormData` globals). */
  fileData: Uint8Array;
  fileName: string;
  sepType: number;
  outputFormat: number;
  options: Partial<Record<AddOptKey, string>>;
}

export interface TokenStatus {
  valid: boolean;
  premiumMinutes?: number;
  premiumEnabled?: boolean;
  message?: string;
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

/**
 * Encodes a multipart/form-data body as a Node Buffer. We build it by hand because
 * Live's Extension Host runtime exposes `fetch` but NOT the `FormData`/`Blob` web
 * globals, so the usual `new FormData()` upload throws "Blob is not defined".
 */
function buildMultipart(
  fields: Record<string, string>,
  file: { field: string; filename: string; data: Uint8Array; contentType?: string },
): { body: Uint8Array; contentType: string } {
  const boundary = `----mvsep${Date.now().toString(16)}${Math.floor(Math.random() * 1e9).toString(16)}`;
  const enc = (s: string) => Buffer.from(s, "utf8");
  const parts: Uint8Array[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(enc(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  parts.push(
    enc(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
        `Content-Type: ${file.contentType ?? "application/octet-stream"}\r\n\r\n`,
    ),
  );
  parts.push(file.data);
  parts.push(enc(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

export async function createSeparation(p: CreateParams, fetchImpl: typeof fetch = fetch): Promise<string> {
  const fields: Record<string, string> = {
    api_token: p.apiToken,
    sep_type: String(p.sepType),
    output_format: String(p.outputFormat),
  };
  for (const [k, v] of Object.entries(p.options)) {
    if (v != null && v !== "") fields[k] = v;
  }
  const { body, contentType } = buildMultipart(fields, {
    field: "audiofile",
    filename: p.fileName,
    data: p.fileData,
    contentType: "audio/wav",
  });
  const res = await fetchImpl(`${BASE}/api/separation/create`, {
    method: "POST",
    headers: { "content-type": contentType },
    // Uint8Array is a valid fetch body at runtime; cast past the TS 5.7+ BufferSource generic nit.
    body: body as RequestInit["body"],
  });
  const json: any = await res.json().catch(() => ({}));
  if (!res.ok || !json?.success || !json?.data?.hash) {
    throw new MvsepError(json?.data?.message ?? `HTTP ${res.status}`, res.status);
  }
  return String(json.data.hash);
}

/**
 * Validates an mvsep API token via `GET /api/app/user`. Non-throwing: returns
 * `{ valid: false, message }` on a bad token or network error, so it can be used
 * as a lightweight launch-time health check.
 */
export async function checkToken(apiToken: string, fetchImpl: typeof fetch = fetch): Promise<TokenStatus> {
  try {
    const res = await fetchImpl(`${BASE}/api/app/user?api_token=${encodeURIComponent(apiToken)}`);
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok || json?.success === false) {
      return { valid: false, message: json?.data?.message ?? json?.message ?? `HTTP ${res.status}` };
    }
    const d = json?.data ?? json ?? {};
    return {
      valid: true,
      premiumMinutes: numOrUndef(d.premium_minutes),
      premiumEnabled: d.premium_enabled === 1 || d.premium_enabled === true,
    };
  } catch (e) {
    return { valid: false, message: e instanceof Error ? e.message : "network error" };
  }
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
