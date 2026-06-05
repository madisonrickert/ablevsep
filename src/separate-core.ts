import { MvsepError, POLL_MS, type StatusResult, type StatusFile } from "./mvsep/client";

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

/**
 * Maps an mvsep status to a progress label. `processingTick` is the number of
 * consecutive `processing` polls so far: when mvsep reports no chunk counts (the
 * common case), the percent creeps asymptotically from 20 toward ~76 across polls
 * so the bar keeps moving instead of sitting flat.
 */
export function progressFor(s: StatusResult, processingTick = 0): Progress {
  switch (s.status) {
    case "waiting": {
      const pos =
        s.currentOrder != null && s.queueCount != null
          ? ` — position ${s.currentOrder} of ${s.queueCount}`
          : "…";
      return { text: `Queued${pos}`, percent: 10 };
    }
    case "distributing":
      return { text: "Distributing across GPUs…", percent: 16 };
    case "processing": {
      if (s.allChunks && s.finishedChunks != null) {
        const frac = s.finishedChunks / s.allChunks;
        return { text: `Processing… (${s.finishedChunks}/${s.allChunks})`, percent: 20 + Math.round(56 * frac) };
      }
      const creep = Math.round(56 * (1 - Math.exp(-processingTick / 6)));
      return { text: "Processing…", percent: 20 + creep };
    }
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
  let processingTick = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (deps.signal.aborted) throw new AbortError();
    const s = await deps.getStatus(hash);
    const tick = s.status === "processing" ? ++processingTick : 0;
    deps.onProgress(progressFor(s, tick));
    if (s.status === "done") return s.files;
    if (s.status === "failed") throw new MvsepError(s.message ?? "Separation failed");
    if (s.status === "not_found") throw new MvsepError("Job not found or expired");
    await deps.sleep(POLL_MS, deps.signal);
  }
}
