import { describe, it, expect, vi } from "vitest";
import { createSeparation, getStatus, downloadFile, checkToken, MvsepError } from "./client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, arrayBuffer: async () => new ArrayBuffer(0) } as unknown as Response;
}

describe("createSeparation", () => {
  it("posts a hand-built multipart body (no FormData/Blob) and returns the hash", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: { hash: "abc123" } }));
    const hash = await createSeparation(
      {
        apiToken: "TOK",
        fileData: new Uint8Array([1, 2, 3]),
        fileName: "audio.wav",
        sepType: 40,
        outputFormat: 1,
        options: { add_opt1: "2" },
      },
      fetchImpl as unknown as typeof fetch,
    );
    expect(hash).toBe("abc123");
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mvsep.com/api/separation/create");
    expect(init.method).toBe("POST");
    const contentType = (init.headers as Record<string, string>)["content-type"];
    expect(contentType).toMatch(/^multipart\/form-data; boundary=----mvsep/);
    const body = Buffer.from(init.body as Uint8Array).toString("utf8");
    expect(body).toContain('name="api_token"');
    expect(body).toContain("TOK");
    expect(body).toContain('name="sep_type"');
    expect(body).toContain("40");
    expect(body).toContain('name="output_format"');
    expect(body).toContain('name="add_opt1"');
    expect(body).toContain('name="audiofile"; filename="audio.wav"');
  });

  it("throws MvsepError with server message on success:false", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, data: { message: "bad token" } }, false, 401));
    await expect(
      createSeparation(
        { apiToken: "x", fileData: new Uint8Array(), fileName: "a.wav", sepType: 1, outputFormat: 1, options: {} },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ message: "bad token", code: 401 });
  });
});

describe("checkToken", () => {
  it("returns valid + premiumMinutes for a good token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: { premium_minutes: 42, premium_enabled: 1 } }));
    const status = await checkToken("TOK", fetchImpl as unknown as typeof fetch);
    expect(status).toMatchObject({ valid: true, premiumMinutes: 42, premiumEnabled: true });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://mvsep.com/api/app/user?api_token=TOK");
  });

  it("returns invalid (non-throwing) on success:false", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, data: { message: "Invalid API key" } }, false, 400));
    await expect(checkToken("bad", fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({
      valid: false,
      message: "Invalid API key",
    });
  });

  it("returns invalid (non-throwing) on network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("net down");
    });
    await expect(checkToken("x", fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({
      valid: false,
      message: "net down",
    });
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
