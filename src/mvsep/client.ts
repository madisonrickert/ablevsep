export const BASE = "https://mvsep.com";
export const POLL_MS = 2500;
export const DEFAULT_OUTPUT_FORMAT = 1; // wav 16-bit

export type AddOptKey = "add_opt1" | "add_opt2" | "add_opt3";

export type SepStatus =
  | "not_found" | "waiting" | "processing" | "distributing" | "merging" | "done" | "failed";

export interface StatusFile {
  /** Filename WITH extension, safe to write to disk and import into Live. */
  filename: string;
  downloadUrl: string;
  /** Clean stem label from mvsep (e.g. "Bass", "Vocals"), used for track names. */
  stemName?: string;
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

/** Resolves a possibly-relative URL against BASE. Does NOT use `new URL()`: in Live's
 * Extension Host runtime the WHATWG URL parser throws (or is absent), which silently
 * swallowed every absolute stem url and made jobs look like "done with no files". mvsep
 * always returns absolute https urls, so return those as-is and join relatives by hand. */
function resolveUrl(s: string): string {
  if (typeof s !== "string" || !s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return s.startsWith("/") ? `${BASE}${s}` : `${BASE}/${s}`;
}

/** Decoded basename of a URL's path, e.g. ".../song_bass.wav?x=1" → "song_bass.wav".
 * Hand-parsed (no `new URL()`, see resolveUrl) so it works in the Extension Host runtime. */
function urlBasename(url: string): string {
  if (typeof url !== "string" || !url) return "";
  const seg = url.split(/[?#]/)[0].split("/").pop() ?? "";
  try {
    return decodeURIComponent(seg);
  } catch {
    return seg;
  }
}

/** mvsep nests each stem's download URL under a varying field; scan robustly.
 * NB: `download` holds the FILENAME (not a URL), so it is excluded here. */
function fileUrl(f: any): string {
  if (typeof f === "string") return f ? resolveUrl(f) : "";
  for (const c of [f.url, f.download_url, f.link, f.file_url, f.path]) {
    if (typeof c === "string" && c) return resolveUrl(c);
  }
  for (const v of Object.values(f)) {
    if (typeof v === "string" && /^https?:\/\//i.test(v)) return resolveUrl(v);
  }
  return "";
}

/** Extension from the URL basename (e.g. ".wav"), defaulting to ".wav". */
function urlExt(url: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(urlBasename(url));
  return m ? `.${m[1]}` : ".wav";
}

/** A filename WITH an audio extension — critical so importIntoProject recognises it. */
function fileName(f: any, url: string, i: number): string {
  let n = "";
  if (typeof f === "string") n = urlBasename(url);
  else if (typeof f.filename === "string" && f.filename) n = f.filename;
  else if (typeof f.download === "string" && f.download) n = f.download;
  if (!n) n = urlBasename(url);
  if (!n) n = `stem-${i + 1}`;
  if (!/\.[a-z0-9]{1,5}$/i.test(n)) n += urlExt(url);
  return n;
}

/** Clean stem label, preferring mvsep's `type` ("Bass", "Vocals", …). */
function stemLabel(f: any): string | undefined {
  if (f && typeof f === "object" && typeof f.type === "string" && f.type) return f.type;
  return undefined;
}

// Monotonic poll counter, module-level so the cache-bust query differs across polls.
let pollSeq = 0;

export async function getStatus(hash: string, fetchImpl: typeof fetch = fetch): Promise<StatusResult> {
  // Cache-bust the poll (unique URL + no-cache headers) so nothing pins a stale response.
  const seq = ++pollSeq;
  const bust = `${seq}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
  const url = `${BASE}/api/separation/get?hash=${encodeURIComponent(hash)}&t=${bust}`;
  const res = await fetchImpl(url, { headers: { "cache-control": "no-cache", pragma: "no-cache" } });
  const json: any = await res.json().catch((e: unknown) => {
    console.warn(`[ablevsep] getStatus: non-JSON response (HTTP ${res.status}):`, e instanceof Error ? e.message : e);
    return {};
  });
  const d = json?.data ?? {};
  const rawFiles: any[] = Array.isArray(d.files) ? d.files : [];
  const files: StatusFile[] = rawFiles
    .map((f: any, i: number): StatusFile => {
      const downloadUrl = fileUrl(f);
      return { filename: fileName(f, downloadUrl, i), downloadUrl, stemName: stemLabel(f) };
    })
    .filter((f: StatusFile) => f.downloadUrl !== "");
  // Only log once stem entries actually appear (skips the quiet done-but-exporting window).
  if (json?.status === "done" && rawFiles.length > 0) {
    if (files.length < rawFiles.length) {
      // Loud on purpose: stem entries are present but some urls did not resolve. This is the
      // exact signature of the bug that masqueraded as "done with no files" (a url helper
      // failing in the Host runtime) — never let it stall silently again.
      console.warn(
        `[ablevsep] getStatus: resolved only ${files.length}/${rawFiles.length} stem url(s); ` +
          `${rawFiles.length - files.length} dropped (sample entry: ${JSON.stringify(rawFiles[0] ?? {}).slice(0, 120)})`,
      );
    } else {
      console.info(`[ablevsep] done: ${files.length}/${rawFiles.length} stem url(s) resolved`);
    }
  }
  return {
    status: json?.status as SepStatus,
    message: d.message,
    queueCount: numOrUndef(d.queue_count),
    currentOrder: numOrUndef(d.current_order),
    finishedChunks: numOrUndef(d.finished_chunks),
    allChunks: numOrUndef(d.all_chunks),
    files,
  };
}

export async function downloadFile(url: string, fetchImpl: typeof fetch = fetch): Promise<ArrayBuffer> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new MvsepError(`Download failed: HTTP ${res.status}`, res.status);
  return res.arrayBuffer();
}
