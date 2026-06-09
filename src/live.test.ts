import { describe, it, expect, vi } from "vitest";
import { resolveScratchDir, isAccessDenied } from "./live";

const accessDenied = () => Object.assign(new Error("denied"), { code: "ERR_ACCESS_DENIED" });

describe("resolveScratchDir", () => {
  it("returns the first candidate when it can be created", async () => {
    const mkdir = vi.fn(async () => {});
    const dir = await resolveScratchDir(["/temp", "/storage/work"], mkdir);
    expect(dir).toBe("/temp");
    expect(mkdir).toHaveBeenCalledTimes(1);
  });

  it("falls back to the next candidate when the first is permission-denied", async () => {
    // The Extension Host sandbox denies tempDirectory on the first launch after a
    // reboot; the persistent storage dir must take over.
    const mkdir = vi.fn(async (d: string) => { if (d === "/temp") throw accessDenied(); });
    const dir = await resolveScratchDir(["/temp", "/storage/work"], mkdir);
    expect(dir).toBe("/storage/work");
    expect(mkdir).toHaveBeenCalledTimes(2);
  });

  it("rethrows a non-permission error instead of falling back", async () => {
    const enospc = Object.assign(new Error("no space"), { code: "ENOSPC" });
    const mkdir = vi.fn(async () => { throw enospc; });
    await expect(resolveScratchDir(["/temp", "/storage/work"], mkdir)).rejects.toBe(enospc);
    expect(mkdir).toHaveBeenCalledTimes(1);
  });

  it("throws the last denial when every candidate is permission-denied", async () => {
    const mkdir = vi.fn(async () => { throw accessDenied(); });
    await expect(resolveScratchDir(["/temp", "/storage/work"], mkdir))
      .rejects.toMatchObject({ code: "ERR_ACCESS_DENIED" });
    expect(mkdir).toHaveBeenCalledTimes(2);
  });
});

describe("isAccessDenied", () => {
  it("is true only for ERR_ACCESS_DENIED", () => {
    expect(isAccessDenied(Object.assign(new Error(), { code: "ERR_ACCESS_DENIED" }))).toBe(true);
    expect(isAccessDenied(Object.assign(new Error(), { code: "ENOENT" }))).toBe(false);
    expect(isAccessDenied(null)).toBe(false);
  });
});
