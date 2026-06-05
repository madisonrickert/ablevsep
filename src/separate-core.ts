import { MvsepError, type StatusResult, type StatusFile } from "./mvsep/client";

export class AbortError extends Error {
  constructor() {
    super("Cancelled");
    this.name = "AbortError";
  }
}

export interface Progress {
  text: string;
  percent: number;
}

export function progressFor(s: StatusResult): Progress {
  switch (s.status) {
    case "waiting":
      return { text: `Queued — position ${s.currentOrder ?? "?"} of ${s.queueCount ?? "?"}`, percent: 20 };
    case "processing": {
      const frac = s.allChunks && s.finishedChunks != null ? s.finishedChunks / s.allChunks : 0;
      const detail = s.allChunks ? ` (${s.finishedChunks}/${s.allChunks})` : "";
      return { text: `Processing…${detail}`, percent: 20 + Math.round(frac * 60) };
    }
    case "distributing":
      return { text: "Distributing across GPUs…", percent: 30 };
    case "merging":
      return { text: "Merging results…", percent: 78 };
    case "done":
      return { text: "Done", percent: 80 };
    case "failed":
      return { text: s.message ?? "Separation failed", percent: 80 };
    case "not_found":
    default:
      return { text: "Job not found or expired", percent: 0 };
  }
}

export async function pollUntilDone(
  hash: string,
  deps: {
    getStatus: (hash: string) => Promise<StatusResult>;
    sleep: (ms: number, signal: AbortSignal) => Promise<void>;
    signal: AbortSignal;
    onProgress: (p: Progress) => void;
  },
): Promise<StatusFile[]> {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (deps.signal.aborted) throw new AbortError();
    const s = await deps.getStatus(hash);
    deps.onProgress(progressFor(s));
    if (s.status === "done") return s.files;
    if (s.status === "failed") throw new MvsepError(s.message ?? "Separation failed");
    if (s.status === "not_found") throw new MvsepError("Job not found or expired");
    await deps.sleep(2500, deps.signal);
  }
}
