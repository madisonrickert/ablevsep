import { describe, it, expect, vi } from "vitest";
import { parseAlgorithms, fetchAlgorithms, loadCatalog, CATALOG_SCHEMA_VERSION, type CatalogCache } from "./catalog";

const RAW = [
  {
    render_id: 26, name: "Ensemble (vocals, instrum)", description: "best vocals", order_id: 10, is_active: 1,
    algorithm_fields: [
      { name: "add_opt2", text: "Model Type", options: '{"1":"A","2":"B"}', default_key: "2", input_type: "select", required: 1 },
    ],
  },
  { render_id: 99, name: "Inactive", order_id: 1, is_active: 0, algorithm_fields: [] },
  { render_id: 40, name: "BS Roformer", order_id: 5, is_active: 1, algorithm_fields: [] },
];

describe("parseAlgorithms", () => {
  it("filters inactive, sorts by order_id, parses nested option strings", () => {
    const algos = parseAlgorithms(RAW);
    expect(algos.map((a) => a.renderId)).toEqual([40, 26]); // order_id 5 then 10; 99 dropped
    const ensemble = algos.find((a) => a.renderId === 26)!;
    expect(ensemble.fields[0]).toMatchObject({
      name: "add_opt2", text: "Model Type", options: { "1": "A", "2": "B" }, defaultKey: "2", required: true,
    });
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
