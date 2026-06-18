import { describe, it, expect, vi } from "vitest";
import { createSeparation, getStatus, downloadFile, checkToken, setPremiumUsage, MvsepError, NetworkError, isConnectivityError, isUnknownModelError, request } from "./client";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  const text = JSON.stringify(body);
  return {
    ok,
    status,
    json: async () => body,
    text: async () => text,
    headers: new Headers({ date: "Fri, 05 Jun 2026 22:00:00 GMT" }),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
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

  it("surfaces the errors[] reason when the 400 body has no data.message (premium gating)", async () => {
    // mvsep's real premium-gate 400 has the reason ONLY in errors[], with no `data` object.
    const fetchImpl = vi.fn(async () =>
      jsonResponse(
        { success: false, errors: ["Seperation type is unavailable until you purchase premium membership"] },
        false,
        400,
      ),
    );
    await expect(
      createSeparation(
        { apiToken: "x", fileData: new Uint8Array(), fileName: "a.wav", sepType: 26, outputFormat: 1, options: {} },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({
      message: "Seperation type is unavailable until you purchase premium membership",
      code: 400,
    });
  });

  it("surfaces a non-JSON error body instead of a bare HTTP code", async () => {
    const fetchImpl = vi.fn(async () =>
      ({
        ok: false,
        status: 503,
        json: async () => {
          throw new Error("Unexpected token S");
        },
        text: async () => "Service Temporarily Unavailable",
      }) as unknown as Response,
    );
    await expect(
      createSeparation(
        { apiToken: "x", fileData: new Uint8Array(), fileName: "a.wav", sepType: 1, outputFormat: 1, options: {} },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ message: "Service Temporarily Unavailable", code: 503 });
  });

  it("falls back to the HTTP code for an HTML error body (no markup leaks into the message)", async () => {
    const fetchImpl = vi.fn(async () =>
      ({
        ok: false,
        status: 502,
        json: async () => {
          throw new Error("Unexpected token <");
        },
        text: async () => "<html><body>502 Bad Gateway</body></html>",
      }) as unknown as Response,
    );
    await expect(
      createSeparation(
        { apiToken: "x", fileData: new Uint8Array(), fileName: "a.wav", sepType: 1, outputFormat: 1, options: {} },
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({ message: "HTTP 502", code: 502 });
  });
});

describe("checkToken", () => {
  it("returns valid + premiumMinutes for a good token", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true, data: { premium_minutes: 42, premium_enabled: 1 } }));
    const status = await checkToken("TOK", fetchImpl as unknown as typeof fetch);
    expect(status).toMatchObject({ valid: true, premiumMinutes: 42, premiumEnabled: true });
    expect(fetchImpl.mock.calls[0][0]).toBe("https://mvsep.com/api/app/user?api_token=TOK");
  });

  it("returns invalid (non-throwing) on success:false, and NOT flagged as a network error", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, data: { message: "Invalid API key" } }, false, 400));
    const status = await checkToken("bad", fetchImpl as unknown as typeof fetch);
    expect(status).toMatchObject({ valid: false, message: "Invalid API key" });
    // A server rejection is a genuinely bad token, not a connectivity problem.
    expect(status.networkError).toBeFalsy();
  });

  it("flags a thrown (connectivity) failure as networkError so the UI can distinguish it from a bad token", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });
    await expect(checkToken("x", fetchImpl as unknown as typeof fetch)).resolves.toMatchObject({
      valid: false,
      networkError: true,
      message: "fetch failed",
    });
  });
});

describe("setPremiumUsage", () => {
  it("POSTs urlencoded to enable_premium and returns refreshed token status", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/enable_premium")
        ? jsonResponse({ success: true, message: "successfully enabled" })
        : jsonResponse({ success: true, data: { premium_minutes: 10000, premium_enabled: 1 } }),
    );
    const status = await setPremiumUsage("TOK", true, fetchImpl as unknown as typeof fetch);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mvsep.com/api/app/enable_premium");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(init.body).toBe("api_token=TOK");
    expect(status).toMatchObject({ valid: true, premiumEnabled: true, premiumMinutes: 10000 });
    expect(fetchImpl.mock.calls[1][0]).toBe("https://mvsep.com/api/app/user?api_token=TOK");
  });

  it("POSTs to disable_premium when disabling", async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("/disable_premium")
        ? jsonResponse({ success: true, message: "successfully disabled" })
        : jsonResponse({ success: true, data: { premium_enabled: 0 } }),
    );
    await setPremiumUsage("TOK", false, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://mvsep.com/api/app/disable_premium");
  });

  it("throws MvsepError with the surfaced message on failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: false, errors: ["invalid token"] }, false, 400));
    await expect(setPremiumUsage("bad", true, fetchImpl as unknown as typeof fetch)).rejects.toMatchObject({
      message: "invalid token",
      code: 400,
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
    expect(fetchImpl.mock.calls[0][0]).toMatch(/^https:\/\/mvsep\.com\/api\/separation\/get\?hash=h&t=/);
  });

  it("maps done files from mvsep's real shape (url field, type label, download name)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: true,
        status: "done",
        data: { files: [{ type: "Bass", url: "https://mvsep.com/storage/x/song_bass.wav", download: "song_bass.wav", size: "1.3 MB" }] },
      }),
    );
    const s = await getStatus("h", fetchImpl as unknown as typeof fetch);
    expect(s.files).toEqual([
      { filename: "song_bass.wav", downloadUrl: "https://mvsep.com/storage/x/song_bass.wav", stemName: "Bass" },
    ]);
  });

  it("extracts absolute stem urls even when the runtime's URL constructor throws (Extension Host parity)", async () => {
    // Live's Extension Host runtime throws on `new URL()`; our parsing must not depend on it.
    const realURL = globalThis.URL;
    (globalThis as unknown as { URL: unknown }).URL = class {
      constructor() {
        throw new Error("URL is not supported in this runtime");
      }
    };
    try {
      const fetchImpl = vi.fn(async () =>
        jsonResponse({
          success: true,
          status: "done",
          data: { files: [{ type: "Bass", url: "https://mvsep.com/storage/processed/song_bass.wav", download: "song_bass.wav" }] },
        }),
      );
      const s = await getStatus("h", fetchImpl as unknown as typeof fetch);
      expect(s.files).toEqual([
        { filename: "song_bass.wav", downloadUrl: "https://mvsep.com/storage/processed/song_bass.wav", stemName: "Bass" },
      ]);
    } finally {
      (globalThis as unknown as { URL: unknown }).URL = realURL;
    }
  });

  it("forces an audio extension when the entry has no usable name", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ success: true, status: "done", data: { files: [{ type: "Vocals", url: "https://x/storage/abc?token=1" }] } }),
    );
    const s = await getStatus("h", fetchImpl as unknown as typeof fetch);
    expect(s.files[0].filename).toMatch(/\.wav$/);
    expect(s.files[0].downloadUrl).toBe("https://x/storage/abc?token=1");
    expect(s.files[0].stemName).toBe("Vocals");
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

describe("NetworkError / isConnectivityError", () => {
  it("flags a NetworkError as connectivity", () => {
    expect(isConnectivityError(new NetworkError("offline"))).toBe(true);
  });
  it("does NOT flag an MvsepError (server answered) as connectivity", () => {
    expect(isConnectivityError(new MvsepError("HTTP 400", 400))).toBe(false);
  });
  it("does NOT flag a plain Error as connectivity", () => {
    expect(isConnectivityError(new Error("boom"))).toBe(false);
  });
});

describe("request()", () => {
  it("maps a thrown fetch to a NetworkError", async () => {
    const throwingFetch = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;
    await expect(request(throwingFetch, "https://x")).rejects.toBeInstanceOf(NetworkError);
  });
  it("returns the Response when fetch resolves (even non-ok)", async () => {
    const res = new Response("nope", { status: 500 });
    const okFetch = (async () => res) as unknown as typeof fetch;
    await expect(request(okFetch, "https://x")).resolves.toBe(res);
  });
});

const throwingFetch = (async () => { throw new TypeError("Failed to fetch"); }) as unknown as typeof fetch;

describe("client network functions classify connectivity", () => {
  it("createSeparation throws NetworkError when fetch throws", async () => {
    await expect(createSeparation(
      { apiToken: "t", fileData: new Uint8Array(), fileName: "a.wav", sepType: 1, outputFormat: 1, options: {} },
      throwingFetch,
    )).rejects.toBeInstanceOf(NetworkError);
  });
  it("getStatus throws NetworkError when fetch throws", async () => {
    await expect(getStatus("hash", throwingFetch)).rejects.toBeInstanceOf(NetworkError);
  });
  it("downloadFile throws NetworkError when fetch throws", async () => {
    await expect(downloadFile("https://x/f.wav", throwingFetch)).rejects.toBeInstanceOf(NetworkError);
  });
  it("checkToken flags networkError on a transport failure", async () => {
    const s = await checkToken("t", throwingFetch);
    expect(s).toMatchObject({ valid: false, networkError: true });
  });
  it("checkToken does NOT flag networkError when the server answers non-ok", async () => {
    const res = new Response(JSON.stringify({ success: false, message: "bad token" }), { status: 401 });
    const okFetch = (async () => res) as unknown as typeof fetch;
    const s = await checkToken("t", okFetch);
    expect(s.valid).toBe(false);
    expect(s.networkError).toBeUndefined();
  });
});

describe("isUnknownModelError", () => {
  it("matches MVSEP's actual invalid-model wording (their misspelling)", () => {
    expect(isUnknownModelError("Seperation type is not set")).toBe(true);
  });
  it("also matches the corrected spelling and the raw field name", () => {
    expect(isUnknownModelError("Separation type is invalid")).toBe(true);
    expect(isUnknownModelError("sep_type is required")).toBe(true);
  });
  it("does not match unrelated MVSEP errors", () => {
    expect(isUnknownModelError("Invalid MVSEP API token.")).toBe(false);
    expect(isUnknownModelError("This is a premium-only model.")).toBe(false);
    expect(isUnknownModelError("Download failed: HTTP 500")).toBe(false);
  });
});
