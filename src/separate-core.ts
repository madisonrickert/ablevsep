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
          ? `: Position ${s.currentOrder} of ${s.queueCount}`
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

/** Max consecutive "done but no files yet" polls before giving up (~1 min at POLL_MS).
 * mvsep reports "done" before it finishes exporting/publishing the stem files; for
 * many-stem models on a free account this can exceed the budget and time out. */
export const DONE_EMPTY_MAX = 24;

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
    if (s.status === "done" && s.files.length === 0) {
      // mvsep flips to "done" before the file list is written; show "Finalizing"
      // (not "Done", which is misleading) with elapsed time, and keep polling.
      doneEmpty += 1;
      if (doneEmpty > DONE_EMPTY_MAX) {
        throw new MvsepError(
          "mvsep finished the separation but did not publish the stem files within ~1 minute. " +
            "Big multi-stem models can be slow to export on a free account; please try again, " +
            "or use a model with fewer stems.",
        );
      }
      const secs = Math.round((doneEmpty * POLL_MS) / 1000);
      deps.onProgress({ text: `mvsep is exporting stems… (${secs}s)`, percent: Math.min(81, 79 + Math.floor(doneEmpty / 10)) });
    } else {
      const tick = s.status === "processing" ? ++processingTick : 0;
      deps.onProgress(progressFor(s, tick));
      if (s.status === "done") return s.files;
      if (s.status === "failed") throw new MvsepError(s.message ?? "Separation failed");
      if (s.status === "not_found") throw new MvsepError("Job not found or expired");
    }
    await deps.sleep(POLL_MS, deps.signal);
  }
}
