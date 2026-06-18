import { MvsepError, POLL_MS, isConnectivityError, type StatusResult, type StatusFile } from "./mvsep/client";

/**
 * Shown when separation is invoked on a Session clip. Session support is gated: the
 * only way to obtain a Session clip's audio is to read its raw source file, which the
 * installed Host's permission sandbox denies (the file lives outside the granted dirs).
 * Until the SDK can render a Session clip's audio, the Arrangement path is the only one
 * that works. User-facing copy: keep it em-dash-free.
 */
export const SESSION_UNSUPPORTED_MESSAGE =
  "Stem separation isn't available for Session clips yet. Drag the clip into the " +
  "Arrangement view and separate it there.";

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

/** Max consecutive "done but no files yet" polls before giving up (~5 min at POLL_MS).
 * mvsep reports "done" before the stem files finish exporting; under free-tier load this
 * can take minutes (confirmed: such jobs do finish, just slowly). The progress dialog's
 * Cancel stays responsive throughout, so a long cap never traps the user, but a job that
 * is about to finish is not killed prematurely. */
export const DONE_EMPTY_MAX = 120;

/** Consecutive connectivity failures tolerated while polling before giving up (~15s at
 * POLL_MS). The MVSEP job keeps running server-side, so a brief blip should not abandon
 * it. This is NOT a re-upload retry; it only re-polls a job already in flight. */
export const POLL_CONN_FAILURE_MAX = 6;

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
  let connFailures = 0;
  let lastPercent = 0;
  const emit = (p: Progress) => { lastPercent = p.percent; deps.onProgress(p); };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (deps.signal.aborted) throw new AbortError();
    let s: StatusResult;
    try {
      s = await deps.getStatus(hash);
      connFailures = 0;
    } catch (e) {
      if (!isConnectivityError(e)) throw e; // real API error surfaces immediately
      connFailures += 1;
      if (connFailures > POLL_CONN_FAILURE_MAX) throw e; // give up -> offline dialog
      const secs = Math.round((connFailures * POLL_MS) / 1000);
      // Keep the bar where it was (report() on the consumer side is monotonic) but show life.
      deps.onProgress({ text: `Reconnecting to MVSEP… (${secs}s)`, percent: lastPercent });
      await deps.sleep(POLL_MS, deps.signal);
      continue;
    }
    if (s.status === "done" && s.files.length === 0) {
      // mvsep flips to "done" before the stem files finish exporting; the file records
      // appear with empty urls until each is uploaded to storage. This export step is
      // usually instant but can run for minutes under free-tier load, so we keep polling
      // and set an honest expectation rather than showing a misleading "Done".
      doneEmpty += 1;
      if (doneEmpty > DONE_EMPTY_MAX) {
        throw new MvsepError(
          "MVSEP finished separating but has not made the stem files available within 5 minutes. " +
            "On the free tier this export step can run long under load. The job is often still " +
            "finishing on MVSEP's side, so trying again in a few minutes usually works.",
        );
      }
      const secs = Math.round((doneEmpty * POLL_MS) / 1000);
      // After ~10s, set the up-to-5-minutes expectation so a long export does not read as a freeze.
      const text =
        doneEmpty * POLL_MS > 10_000
          ? `MVSEP is exporting stems, up to 5 min (${secs}s)`
          : `MVSEP is exporting stems… (${secs}s)`;
      // Gentle asymptotic creep 80 -> 84 so the bar stays visibly alive without overstating progress.
      const percent = Math.min(84, 80 + Math.round(8 * (1 - Math.exp(-doneEmpty / 20))));
      emit({ text, percent });
    } else {
      const tick = s.status === "processing" ? ++processingTick : 0;
      emit(progressFor(s, tick));
      if (s.status === "done") return s.files;
      if (s.status === "failed") throw new MvsepError(s.message ?? "Separation failed");
      if (s.status === "not_found") throw new MvsepError("Job not found or expired");
    }
    await deps.sleep(POLL_MS, deps.signal);
  }
}
