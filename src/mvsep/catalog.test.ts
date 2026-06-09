import { describe, it, expect, vi } from "vitest";
import { parseAlgorithms, fetchAlgorithms, loadCatalog, isStemSeparationModel, isSupportedUpload, isSupportedOutput, isPickableModel, CATALOG_SCHEMA_VERSION, type CatalogCache } from "./catalog";

const RAW = [
  {
    render_id: 26, name: "Ensemble (vocals, instrum)", description: "best vocals", order_id: 10, is_active: 1,
    usage: 500, algorithm_group: { id: 23, name: "Ensembles" }, rating: { average: "4.42", total: 31 },
    audio_widget: "single_upload",
    algorithm_fields: [
      { name: "add_opt2", text: "Model Type", options: '{"1":"A","2":"B"}', default_key: "2", input_type: "select", required: 1 },
    ],
  },
  { render_id: 99, name: "Inactive", order_id: 1, is_active: 0, algorithm_fields: [] },
  {
    render_id: 40, name: "BS Roformer", order_id: 5, is_active: 1,
    usage: 1200, algorithm_group: { id: 1, name: "Vocals / Instrumental" }, rating: { average: "4.5", total: 60 },
    algorithm_fields: [],
  },
];

describe("parseAlgorithms", () => {
  it("filters inactive, sorts by usage descending, parses nested option strings", () => {
    const algos = parseAlgorithms(RAW);
    expect(algos.map((a) => a.renderId)).toEqual([40, 26]); // usage 1200 then 500; inactive 99 dropped
    const ensemble = algos.find((a) => a.renderId === 26)!;
    expect(ensemble.fields[0]).toMatchObject({
      name: "add_opt2", text: "Model Type", options: { "1": "A", "2": "B" }, defaultKey: "2", required: true,
    });
  });

  it("parses algorithm_group, usage, rating (average is a STRING in the API), and audio_widget", () => {
    const algos = parseAlgorithms(RAW);
    const ens = algos.find((a) => a.renderId === 26)!;
    expect(ens).toMatchObject({ groupId: 23, groupName: "Ensembles", usage: 500, ratingTotal: 31, audioWidget: "single_upload" });
    expect(ens.ratingAverage).toBeCloseTo(4.42);
  });

  it("defaults metadata when group/usage/rating/audio_widget are absent (ratingAverage null when unrated)", () => {
    const algos = parseAlgorithms([
      { render_id: 1, name: "bare", order_id: 0, is_active: 1, algorithm_fields: [] },
    ]);
    expect(algos[0]).toMatchObject({ groupId: 0, groupName: "", usage: 0, ratingTotal: 0, audioWidget: "" });
    expect(algos[0].ratingAverage).toBeNull();
  });

  it("sorts by usage descending, with orderId ascending as the tiebreaker", () => {
    const algos = parseAlgorithms([
      { render_id: 1, name: "low", order_id: 1, is_active: 1, usage: 10, algorithm_fields: [] },
      { render_id: 2, name: "high", order_id: 9, is_active: 1, usage: 999, algorithm_fields: [] },
      { render_id: 3, name: "tie-later", order_id: 5, is_active: 1, usage: 50, algorithm_fields: [] },
      { render_id: 4, name: "tie-earlier", order_id: 2, is_active: 1, usage: 50, algorithm_fields: [] },
    ]);
    expect(algos.map((a) => a.renderId)).toEqual([2, 4, 3, 1]); // 999, then the 50s by orderId (2,5), then 10
  });

  it("tolerates malformed option strings", () => {
    const algos = parseAlgorithms([
      { render_id: 1, name: "x", order_id: 0, is_active: 1, algorithm_fields: [{ name: "add_opt1", text: "t", options: "not json", default_key: "", input_type: "select", required: 0 }] },
    ]);
    expect(algos[0].fields[0].options).toEqual({});
  });

  it("parses price_coefficient (premium cost multiplier), defaulting to 1 when absent or invalid", () => {
    const algos = parseAlgorithms([
      { render_id: 30, name: "Ensemble All-In", order_id: 1, is_active: 1, price_coefficient: 6, algorithm_fields: [] },
      { render_id: 63, name: "BS Roformer SW", order_id: 2, is_active: 1, algorithm_fields: [] },
      { render_id: 7, name: "Bad coef", order_id: 3, is_active: 1, price_coefficient: "nope", algorithm_fields: [] },
    ]);
    expect(algos.find((a) => a.renderId === 30)!.priceCoefficient).toBe(6);
    expect(algos.find((a) => a.renderId === 63)!.priceCoefficient).toBe(1); // absent → 1
    expect(algos.find((a) => a.renderId === 7)!.priceCoefficient).toBe(1); // unparseable → 1
  });

  it("parses orientation (intended audience: 2 = premium users), defaulting to 0 when absent or invalid", () => {
    const algos = parseAlgorithms([
      { render_id: 26, name: "Ensemble", order_id: 1, is_active: 1, orientation: 2, algorithm_fields: [] },
      { render_id: 41, name: "Registered-only", order_id: 2, is_active: 1, orientation: 1, algorithm_fields: [] },
      { render_id: 63, name: "BS Roformer SW", order_id: 3, is_active: 1, orientation: 0, algorithm_fields: [] },
      { render_id: 40, name: "No orientation", order_id: 4, is_active: 1, algorithm_fields: [] },
      { render_id: 7, name: "Bad orientation", order_id: 5, is_active: 1, orientation: "nope", algorithm_fields: [] },
    ]);
    expect(algos.find((a) => a.renderId === 26)!.orientation).toBe(2);
    expect(algos.find((a) => a.renderId === 41)!.orientation).toBe(1);
    expect(algos.find((a) => a.renderId === 63)!.orientation).toBe(0);
    expect(algos.find((a) => a.renderId === 40)!.orientation).toBe(0); // absent → 0
    expect(algos.find((a) => a.renderId === 7)!.orientation).toBe(0); // unparseable → 0
  });
});

describe("isStemSeparationModel", () => {
  it("hides the ASR and TTS group (text / voice-clone output, nothing placeable as stems)", () => {
    expect(isStemSeparationModel({ groupName: "ASR and TTS" })).toBe(false);
  });

  it("keeps audio-output groups, incl. Multistem, Upscale and Restoration, and unknown/blank", () => {
    // Upscale/Restoration (DeNoise, noreverb, super-res) return placeable AUDIO, so they stay.
    for (const g of ["Multistem", "Vocals / Instrumental", "Ensembles", "Experimental and Misc", "Upscale and Restoration", ""]) {
      expect(isStemSeparationModel({ groupName: g })).toBe(true);
    }
  });
});

describe("isSupportedUpload", () => {
  it("rejects upload flows we can't drive yet (matchering_upload, no_upload)", () => {
    expect(isSupportedUpload({ audioWidget: "matchering_upload" })).toBe(false);
    expect(isSupportedUpload({ audioWidget: "no_upload" })).toBe(false);
  });

  it("accepts single_upload, and tolerates an unknown/blank widget", () => {
    expect(isSupportedUpload({ audioWidget: "single_upload" })).toBe(true);
    expect(isSupportedUpload({ audioWidget: "" })).toBe(true);
  });
});

describe("isSupportedOutput", () => {
  it("hides MIDI models (we can't place .mid in Live yet), matched by name across groups", () => {
    expect(isSupportedOutput({ name: "Transkun (piano -> midi)" })).toBe(false);
    expect(isSupportedOutput({ name: "Basic Pitch (MIDI Extraction)" })).toBe(false);
    expect(isSupportedOutput({ name: "SOME (Singing-Oriented MIDI Extractor)" })).toBe(false);
  });

  it("keeps audio models, including lookalike substrings like 'harpsichord'", () => {
    expect(isSupportedOutput({ name: "MVSep Harpsichord (harpsichord, other)" })).toBe(true);
    expect(isSupportedOutput({ name: "BS Roformer SW (vocals, bass, drums)" })).toBe(true);
  });
});

describe("isPickableModel", () => {
  const base = { renderId: 1, groupName: "Vocals / Instrumental", audioWidget: "single_upload", name: "BS Roformer" };
  it("accepts a supported stem model", () => {
    expect(isPickableModel(base)).toBe(true);
  });
  it("hides a MIDI model even when its group is kept (Experimental and Misc)", () => {
    expect(isPickableModel({ ...base, groupName: "Experimental and Misc", name: "Transkun (piano -> midi)" })).toBe(false);
  });
  it("keeps a real separator in the mixed Experimental and Misc group", () => {
    expect(isPickableModel({ ...base, groupName: "Experimental and Misc", name: "Mega 53-stem Model" })).toBe(true);
  });
  it("keeps an upscaling/denoising model (audio output)", () => {
    expect(isPickableModel({ ...base, groupName: "Upscale and Restoration", name: "DeNoise by aufr33 and gabox" })).toBe(true);
  });
  it("hides the ASR/TTS group and unsupported upload widgets", () => {
    expect(isPickableModel({ ...base, groupName: "ASR and TTS", name: "Whisper (extract text from audio)" })).toBe(false);
    expect(isPickableModel({ ...base, audioWidget: "matchering_upload" })).toBe(false);
  });
});

describe("fetchAlgorithms", () => {
  it("requests the single_upload scope", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => RAW }) as unknown as Response);
    const algos = await fetchAlgorithms(fetchImpl as unknown as typeof fetch);
    expect(fetchImpl.mock.calls[0][0]).toBe("https://mvsep.com/api/app/algorithms?scopes=single_upload");
    expect(algos.length).toBe(2);
  });
});

describe("loadCatalog", () => {
  it("returns fresh cache without fetching", async () => {
    const cache: CatalogCache = { version: CATALOG_SCHEMA_VERSION, fetchedAt: 1000, algorithms: parseAlgorithms(RAW) };
    const fetchImpl = vi.fn();
    const algos = await loadCatalog({
      readCache: async () => cache, writeCache: async () => {}, now: () => 1000 + 1000, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(algos.length).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refetches when the cached schema version predates the current one, even within the TTL", async () => {
    // A pre-priceCoefficient cache: fresh by time, but written before the schema gained the field.
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => RAW }) as unknown as Response);
    const writeCache = vi.fn(async () => {});
    const algos = await loadCatalog({
      readCache: async () => ({ fetchedAt: 1000, algorithms: [] }),
      writeCache, now: () => 1000 + 1000, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(writeCache).toHaveBeenCalledOnce();
    expect(algos.length).toBe(2);
  });

  it("refetches + writes when cache is stale", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => RAW }) as unknown as Response);
    const writeCache = vi.fn(async () => {});
    const STALE = 1000;
    const algos = await loadCatalog({
      readCache: async () => ({ fetchedAt: 0, algorithms: [] }),
      writeCache, now: () => STALE + 25 * 60 * 60 * 1000, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(writeCache).toHaveBeenCalledOnce();
    expect(algos.length).toBe(2);
  });

  it("falls back to stale cache when fetch fails", async () => {
    const cache: CatalogCache = { fetchedAt: 0, algorithms: parseAlgorithms(RAW) };
    const fetchImpl = vi.fn(async () => { throw new Error("network"); });
    const algos = await loadCatalog({
      readCache: async () => cache, writeCache: async () => {}, now: () => 9e12, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(algos.length).toBe(2);
  });
});
