import { describe, it, expect, vi } from "vitest";
import { readConfig, writeConfig, DEFAULT_CONFIG, type Config } from "./config";

describe("readConfig", () => {
  it("returns defaults when the file is missing", async () => {
    const readFile = vi.fn(async () => { throw new Error("ENOENT"); });
    const cfg = await readConfig(readFile, "/x/config.json");
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });

  it("merges stored values over defaults", async () => {
    const stored = JSON.stringify({ apiToken: "TOK", lastModel: { renderId: 40, options: { add_opt1: "2" } } });
    const cfg = await readConfig(async () => stored, "/x/config.json");
    expect(cfg.apiToken).toBe("TOK");
    expect(cfg.outputFormat).toBe(1);
    expect(cfg.lastModel).toEqual({ renderId: 40, options: { add_opt1: "2" } });
  });

  it("returns defaults on malformed JSON", async () => {
    const cfg = await readConfig(async () => "{not json", "/x/config.json");
    expect(cfg).toEqual(DEFAULT_CONFIG);
  });
});

describe("writeConfig", () => {
  it("writes pretty JSON to the given path", async () => {
    const writeFile = vi.fn(async () => {});
    const cfg: Config = { apiToken: "T", outputFormat: 4 };
    await writeConfig(writeFile, "/x/config.json", cfg);
    expect(writeFile.mock.calls[0][0]).toBe("/x/config.json");
    expect(JSON.parse(writeFile.mock.calls[0][1] as string)).toEqual(cfg);
  });
});
