import { describe, it, expect, vi } from "vitest";
import { createSeparation, getStatus, downloadFile, MvsepError } from "./client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
}

describe("createSeparation", () => {
  it("posts multipart fields and returns the hash", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: { hash: "abc123" } }));
    const hash = await createSeparation(
      {
        apiToken: "TOK",
        file: new Blob([new Uint8Array([1, 2, 3])]),
        fileName: "audio.wav",
        sepType: 40,
        outputFormat: 1,
        options: { add_opt1: "2" },
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(hash).toBe("abc123");
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://mvsep.com/api/separation/create");
    expect((init as RequestInit).method).toBe("POST");
    const fd = (init as RequestInit).body as FormData;
    expect(fd.get("api_token")).toBe("TOK");
    expect(fd.get("sep_type")).toBe("40");
    expect(fd.get("output_format")).toBe("1");
    expect(fd.get("add_opt1")).toBe("2");
    expect(fd.get("audiofile")).toBeInstanceOf(Blob);
  });

  it("throws MvsepError with server message on success:false", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, data: { message: "bad token" } }, false, 401));
    await expect(
      createSeparation(
        { apiToken: "x", file: new Blob([]), fileName: "a.wav", sepType: 1, outputFormat: 1, options: {} },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ message: "bad token", code: 401 });
  });
});

describe("getStatus", () => {
  it("maps snake_case status fields", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        status: "processing",
        data: { queue_count: 4, current_order: 2, finished_chunks: 1, all_chunks: 3, files: [] },
      }),
    );
    const s = await getStatus("h", fetchImpl as unknown as typeof fetch);
    expect(s).toMatchObject({ status: "processing", queueCount: 4, currentOrder: 2, finishedChunks: 1, allChunks: 3 });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://mvsep.com/api/separation/get?hash=h");
  });

  it("maps done files to {filename, downloadUrl}", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, status: "done", data: { files: [{ filename: "vocals.wav", download_url: "https://x/v.wav" }] } }),
    );
    const s = await getStatus("h", fetchImpl as unknown as typeof fetch);
    expect(s.files).toEqual([{ filename: "vocals.wav", downloadUrl: "https://x/v.wav" }]);
  });
});

describe("downloadFile", () => {
  it("returns the body as ArrayBuffer", async () => {
    const buf = new ArrayBuffer(8);
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buf }) as unknown as Response);
    await expect(downloadFile("https://x/f", fetchImpl as unknown as typeof fetch)).resolves.toBe(buf);
  });

  it("throws on non-ok", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, arrayBuffer: async () => new ArrayBuffer(0) }) as unknown as Response);
    await expect(downloadFile("https://x/f", fetchImpl as unknown as typeof fetch)).rejects.toBeInstanceOf(MvsepError);
  });
});
