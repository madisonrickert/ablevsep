import { describe, it, expect, vi } from "vitest";
import { progressFor, pollUntilDone, AbortError } from "./separate-core";
import { MvsepError, type StatusResult } from "./mvsep/client";

const base: StatusResult = { status: "waiting", files: [] };

describe("progressFor", () => {
  it("shows queue position when waiting", () => {
    expect(progressFor({ ...base, status: "waiting", currentOrder: 2, queueCount: 5 })).toMatchObject({
      text: "Queued — position 2 of 5", percent: 20,
    });
  });

  it("interpolates processing percent from chunks", () => {
    const p = progressFor({ ...base, status: "processing", finishedChunks: 3, allChunks: 6 });
    expect(p.percent).toBe(50); // 20 + 0.5*60
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
