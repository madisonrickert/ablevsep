import { describe, it, expect, vi } from "vitest";
import { progressFor, pollUntilDone, AbortError } from "./separate-core";
import { MvsepError, type StatusResult } from "./mvsep/client";

const base: StatusResult = { status: "waiting", files: [] };

describe("progressFor", () => {
  it("maps queue position into the reserved 8–20% band by position only", () => {
    expect(progressFor({ ...base, status: "waiting", currentOrder: 2, queueCount: 5 })).toMatchObject({
      text: "Queued: Position 2 of 5", percent: 14, // 8 + round(12/2)
    });
    // Denominator-independent: a larger queueCount must not change the percent.
    expect(progressFor({ ...base, status: "waiting", currentOrder: 2, queueCount: 999 }).percent).toBe(14);
    // Front of queue tops out at the band ceiling.
    expect(progressFor({ ...base, status: "waiting", currentOrder: 1, queueCount: 3 }).percent).toBe(20);
  });

  it("interpolates processing percent from chunks", () => {
    const p = progressFor({ ...base, status: "processing", finishedChunks: 3, allChunks: 6 });
    expect(p.percent).toBe(49); // 22 + round(0.5*54)
  });

  it("creeps processing percent over poll ticks when there are no chunk counts", () => {
    const p0 = progressFor({ ...base, status: "processing" }, 0).percent;
    const p1 = progressFor({ ...base, status: "processing" }, 1).percent;
    const p20 = progressFor({ ...base, status: "processing" }, 20).percent;
    expect(p0).toBe(22);
    expect(p1).toBeGreaterThan(p0);
    expect(p20).toBeGreaterThan(p1);
    expect(p20).toBeLessThanOrEqual(76); // asymptote stays below merging/done
  });

  it("maps terminal/other states", () => {
    expect(progressFor({ ...base, status: "merging" }).text).toMatch(/merg/i);
    expect(progressFor({ ...base, status: "done" }).percent).toBe(80);
    expect(progressFor({ ...base, status: "failed", message: "boom" }).text).toBe("boom");
  });
});

describe("pollUntilDone", () => {
  it("returns files when status becomes done", async () => {
    const seq: StatusResult[] = [
      { status: "waiting", files: [] },
      { status: "processing", files: [], finishedChunks: 1, allChunks: 2 },
      { status: "done", files: [{ filename: "vocals.wav", downloadUrl: "u" }] },
    ];
    let i = 0;
    const onProgress = vi.fn();
    const files = await pollUntilDone("h", {
      getStatus: async () => seq[i++],
      sleep: async () => {},
      signal: { aborted: false } as AbortSignal,
      onProgress,
    });
    expect(files).toEqual([{ filename: "vocals.wav", downloadUrl: "u" }]);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("keeps polling while status is done but files are still empty (mvsep race)", async () => {
    const seq: StatusResult[] = [
      { status: "processing", files: [] },
      { status: "done", files: [] }, // done flips before files populate
      { status: "done", files: [{ filename: "v.wav", downloadUrl: "u" }] },
    ];
    let i = 0;
    const files = await pollUntilDone("h", {
      getStatus: async () => seq[Math.min(i++, seq.length - 1)],
      sleep: async () => {},
      signal: { aborted: false } as AbortSignal,
      onProgress: () => {},
    });
    expect(files).toEqual([{ filename: "v.wav", downloadUrl: "u" }]);
  });

  it("gives up if done-but-empty never resolves", async () => {
    await expect(
      pollUntilDone("h", {
        getStatus: async () => ({ status: "done", files: [] }),
        sleep: async () => {},
        signal: { aborted: false } as AbortSignal,
        onProgress: () => {},
      }),
    ).rejects.toBeInstanceOf(MvsepError);
  });

  it("throws MvsepError on failed", async () => {
    await expect(
      pollUntilDone("h", {
        getStatus: async () => ({ status: "failed", message: "nope", files: [] }),
        sleep: async () => {}, signal: { aborted: false } as AbortSignal, onProgress: () => {},
      }),
    ).rejects.toBeInstanceOf(MvsepError);
  });

  it("throws AbortError when the signal is already aborted", async () => {
    await expect(
      pollUntilDone("h", {
        getStatus: async () => base, sleep: async () => {}, signal: { aborted: true } as AbortSignal, onProgress: () => {},
      }),
    ).rejects.toBeInstanceOf(AbortError);
  });
});
