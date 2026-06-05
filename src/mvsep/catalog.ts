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
  fields: AlgorithmField[];
}

export interface CatalogCache {
  fetchedAt: number;
  algorithms: Algorithm[];
}

export const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

function safeParseOptions(s: unknown): Record<string, string> {
  if (typeof s !== "string") return {};
  try {
    const o = JSON.parse(s);
    return o && typeof o === "object" ? (o as Record<string, string>) : {};
  } catch {
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
      return {
        renderId: Number(a.render_id),
        name: String(a.name ?? `Model ${a.render_id}`),
        description: String(a.description ?? ""),
        orderId: Number(a.order_id ?? 0),
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
  if (cached && deps.now() - cached.fetchedAt < CATALOG_TTL_MS) return cached.algorithms;
  try {
    const algorithms = await fetchAlgorithms(deps.fetchImpl);
    await deps.writeCache({ fetchedAt: deps.now(), algorithms });
    return algorithms;
  } catch (e) {
    if (cached) return cached.algorithms;
    throw e;
  }
}
