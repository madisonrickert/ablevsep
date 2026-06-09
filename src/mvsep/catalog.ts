import { BASE, MvsepError, type AddOptKey } from "./client";

export interface AlgorithmField {
  name: AddOptKey;
  text: string;
  options: Record<string, string>;
  defaultKey: string;
  required: boolean;
}

export interface Algorithm {
  renderId: number;
  name: string;
  description: string;
  orderId: number;
  /** mvsep's per-job credit-cost multiplier (`floor(seconds × coeff / 60)`). Currently the
   * Ensembles are the only models above 1 (2/4/6). Drives the "×N credits" cost display only —
   * the premium *gate* keys off `orientation`, not cost (see isPremiumModel in picker-template). */
  priceCoefficient: number;
  /** Intended audience for this separation type: 0 = all users, 1 = registered, 2 = premium-only.
   * The semantically-correct premium-only signal (a future premium model could be coeff 1). */
  orientation: number;
  fields: AlgorithmField[];
}

export interface CatalogCache {
  /** Parsed-shape schema version. Bump when the Algorithm shape changes so old caches
   * (which lack new fields like priceCoefficient) are discarded instead of served stale. */
  version?: number;
  fetchedAt: number;
  algorithms: Algorithm[];
}

export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;
/** Bump on any change to the parsed Algorithm shape. v2 added priceCoefficient; v3 added orientation. */
export const CATALOG_SCHEMA_VERSION = 3;

function safeParseOptions(s: unknown): Record<string, string> {
  if (typeof s !== "string") return {};
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch (e) {
    console.warn("[ablevsep] catalog: could not parse algorithm field options:", e instanceof Error ? e.message : e);
    return {};
  }
}

export function parseAlgorithms(raw: unknown[]): Algorithm[] {
  return (raw as any[])
    .filter((a) => a?.is_active === 1)
    .map((a) => {
      const fields: AlgorithmField[] = (a.algorithm_fields ?? [])
        .filter((f: any) => f?.input_type === "select")
        .map((f: any) => {
          const options = safeParseOptions(f.options);
          return {
            name: f.name as AddOptKey,
            text: String(f.text ?? f.name),
            options,
            defaultKey: String(f.default_key ?? Object.keys(options)[0] ?? ""),
            required: f.required === 1,
          };
        });
      const pc = Number(a.price_coefficient);
      const orient = Number(a.orientation);
      return {
        renderId: Number(a.render_id),
        name: String(a.name ?? `Model ${a.render_id}`),
        description: String(a.description ?? ""),
        orderId: Number(a.order_id ?? 0),
        priceCoefficient: Number.isFinite(pc) && pc > 0 ? pc : 1,
        orientation: Number.isFinite(orient) ? orient : 0,
        fields,
      };
    })
    .sort((x, y) => x.orderId - y.orderId);
}

export async function fetchAlgorithms(fetchImpl: typeof fetch = fetch): Promise<Algorithm[]> {
  const res = await fetchImpl(`${BASE}/api/app/algorithms?scopes=single_upload`);
  if (!res.ok) throw new MvsepError(`Catalog fetch failed: HTTP ${res.status}`, res.status);
  const arr = await res.json();
  if (!Array.isArray(arr)) throw new MvsepError("Catalog response was not an array");
  return parseAlgorithms(arr);
}

export async function loadCatalog(deps: {
  readCache: () => Promise<CatalogCache | null>;
  writeCache: (c: CatalogCache) => Promise<void>;
  now: () => number;
  fetchImpl?: typeof fetch;
}): Promise<Algorithm[]> {
  const cached = await deps.readCache();
  const schemaCurrent = cached?.version === CATALOG_SCHEMA_VERSION;
  if (cached && schemaCurrent && deps.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.algorithms;
  try {
    const algorithms = await fetchAlgorithms(deps.fetchImpl);
    await deps.writeCache({ version: CATALOG_SCHEMA_VERSION, fetchedAt: deps.now(), algorithms });
    return algorithms;
  } catch (e) {
    console.warn(
      `[ablevsep] catalog: fetch failed (${e instanceof Error ? e.message : e}); ` +
        (cached ? "falling back to cached catalog" : "no cache available"),
    );
    if (cached) return cached.algorithms;
    throw e;
  }
}
