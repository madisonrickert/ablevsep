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
      // Reserved 8–20% band for queue position. Mapped by YOUR position only
      // (1/currentOrder), so it never lurches if queueCount (the denominator) changes.
      const percent = s.currentOrder != null ? Math.min(20, Math.max(8, 8 + Math.round(12 / Math.max(s.currentOrder, 1)))) : 10;
      return { text: `Queued${pos}`, percent };
    }
    case "distributing":
      return { text: "Distributing across GPUs…", percent: 21 };
    case "processing": {
      if (s.allChunks && s.finishedChunks != null) {
        const frac = s.finishedChunks / s.allChunks;
        return { text: `Processing… (${s.finishedChunks}/${s.allChunks})`, percent: 22 + Math.round(54 * frac) };
      }
      const creep = Math.round(54 * (1 - Math.exp(-processingTick / 6)));
      return { text: "Processing…", percent: 22 + creep };
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
  let doneEmpty = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (deps.signal.aborted) throw new AbortError();
    const s = await deps.getStatus(hash);
    const tick = s.status === "processing" ? ++processingTick : 0;
    deps.onProgress(progressFor(s, tick));
    if (s.status === "done") {
      if (s.files.length > 0) return s.files;
      // mvsep reports "done" a beat before the file list is populated — keep polling.
      if (++doneEmpty > 6) throw new MvsepError("Separation finished but returned no output files.");
    } else if (s.status === "failed") {
      throw new MvsepError(s.message ?? "Separation failed");
    } else if (s.status === "not_found") {
      throw new MvsepError("Job not found or expired");
    }
    await deps.sleep(POLL_MS, deps.signal);
  }
}
