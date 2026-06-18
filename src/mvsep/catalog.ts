import { BASE, MvsepError, request, type AddOptKey } from "./client";

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
  /** mvsep's model grouping (e.g. "Vocals / Instrumental", "Ensembles"). Drives the in-row group
   * tag + search-token matching, and lets us scope the picker to audio-stem groups. */
  groupId: number;
  groupName: string;
  /** Lifetime separation count — a popularity signal. The picker sorts by this (desc). */
  usage: number;
  /** Star rating 0–5 (mvsep sends `average` as a STRING) and the number of votes behind it.
   * ratingAverage is null when unrated; the picker only shows it once ratingTotal clears a
   * confidence threshold, so a 5.0 off a handful of votes never masquerades as "best". */
  ratingAverage: number | null;
  ratingTotal: number;
  /** The model's upload UI on mvsep ("single_upload", "matchering_upload", "no_upload"). We only
   * support single_upload; the others (Matchering needs target+reference, no_upload takes no file)
   * are filtered out until we can drive them. */
  audioWidget: string;
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
/** Bump on any change to the parsed Algorithm shape. v2 added priceCoefficient; v3 added
 * orientation; v4 added group/usage/rating/audioWidget and switched the default sort to usage-desc. */
export const CATALOG_SCHEMA_VERSION = 4;

/** Groups hidden from the stem picker by DEFAULT. Only ASR and TTS qualifies: it outputs text
 * (Whisper/Parakeet) or cloned speech (VibeVoice/Qwen3), none of it placeable as stems. NOTE we
 * deliberately KEEP "Upscale and Restoration" (DeNoise, Reverb Removal, super-res) — those return
 * ordinary audio our placement handles, and DeNoise/noreverb are useful in a stem workflow.
 * Developer-controlled: edit this set to change what the picker shows (there is no end-user toggle). */
export const NON_STEM_GROUP_NAMES: ReadonlySet<string> = new Set([
  "ASR and TTS",
]);

/** True when a model's group isn't developer-hidden from the picker. */
export function isStemSeparationModel(a: { groupName: string }): boolean {
  return !NON_STEM_GROUP_NAMES.has(a.groupName);
}

/** Upload flows we can't drive yet: Matchering needs a target + reference, no_upload takes no file.
 * Models using these widgets are excluded until we support them. (Our algorithms fetch already
 * scopes to single_upload, so this is a defensive guard against that server-side contract changing.) */
export const UNSUPPORTED_AUDIO_WIDGETS: ReadonlySet<string> = new Set([
  "matchering_upload",
  "no_upload",
]);

/** True when a model's upload widget is one we can actually drive (anything but the unsupported set). */
export function isSupportedUpload(a: { audioWidget: string }): boolean {
  return !UNSUPPORTED_AUDIO_WIDGETS.has(a.audioWidget);
}

/** Output types we can't place as Live audio tracks yet (e.g. MIDI: Transkun, Basic Pitch, SOME).
 * These models are scattered across groups (the MIDI ones sit in "Experimental and Misc" beside
 * real separators), so we match by name. Hidden until given dedicated handling (non-stem outputs). */
const UNSUPPORTED_OUTPUT_NAME = /\bmidi\b/i;

/** True when a model's OUTPUT is something we can place in Live (audio). False for MIDI etc. */
export function isSupportedOutput(a: { name: string }): boolean {
  return !UNSUPPORTED_OUTPUT_NAME.test(a.name);
}

/** Specific render_ids to hide regardless — a developer escape hatch for one-off unsupported
 * models the group/widget/output rules don't catch. Empty today. */
export const HIDDEN_RENDER_IDS: ReadonlySet<number> = new Set<number>();

/** A model belongs in the picker only if it's a kept group, uses a supported upload flow, has a
 * placeable (audio) output, and isn't explicitly hidden. One predicate to filter the catalog. */
export function isPickableModel(a: { renderId: number; groupName: string; audioWidget: string; name: string }): boolean {
  return (
    !HIDDEN_RENDER_IDS.has(a.renderId) &&
    isStemSeparationModel(a) &&
    isSupportedUpload(a) &&
    isSupportedOutput(a)
  );
}

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
      const grp = a.algorithm_group && typeof a.algorithm_group === "object" ? a.algorithm_group : {};
      const gid = Number(grp.id);
      const usage = Number(a.usage);
      const rTotal = Number(a.rating?.total);
      const rAvg = parseFloat(a.rating?.average);
      const ratingTotal = Number.isFinite(rTotal) && rTotal > 0 ? rTotal : 0;
      return {
        renderId: Number(a.render_id),
        name: String(a.name ?? `Model ${a.render_id}`),
        description: String(a.description ?? ""),
        orderId: Number(a.order_id ?? 0),
        priceCoefficient: Number.isFinite(pc) && pc > 0 ? pc : 1,
        orientation: Number.isFinite(orient) ? orient : 0,
        groupId: Number.isFinite(gid) ? gid : 0,
        groupName: String(grp.name ?? ""),
        usage: Number.isFinite(usage) && usage > 0 ? usage : 0,
        ratingAverage: ratingTotal > 0 && Number.isFinite(rAvg) ? rAvg : null,
        ratingTotal,
        audioWidget: String(a.audio_widget ?? ""),
        fields,
      };
    })
    // Popularity-first: most-used models surface at the top (BS Roformer SW, the free default,
    // dominates usage). orderId breaks ties so the order stays stable for equal/zero usage.
    .sort((x, y) => y.usage - x.usage || x.orderId - y.orderId);
}

export async function fetchAlgorithms(fetchImpl: typeof fetch = fetch): Promise<Algorithm[]> {
  const res = await request(fetchImpl, `${BASE}/api/app/algorithms?scopes=single_upload`);
  if (!res.ok) throw new MvsepError(`Catalog fetch failed: HTTP ${res.status}`, res.status);
  const arr = await res.json();
  if (!Array.isArray(arr)) throw new MvsepError("Catalog response was not an array");
  return parseAlgorithms(arr);
}

/** Schema-current cache, any age: safe to display while a refresh runs in the background. */
export function isCatalogUsable(cache: CatalogCache | null): boolean {
  return Boolean(cache) && cache!.version === CATALOG_SCHEMA_VERSION;
}

/** Schema-current AND within the TTL: no refresh needed. */
export function isCatalogFresh(cache: CatalogCache | null, now: number): boolean {
  return isCatalogUsable(cache) && now - cache!.fetchedAt < CATALOG_TTL_MS;
}

/** Fetches the catalog, writes it to the cache, and returns it. Throws NetworkError
 * (transport) or MvsepError (bad response) on failure — callers classify and surface. */
export async function fetchAndCacheCatalog(deps: {
  writeCache: (c: CatalogCache) => Promise<void>;
  now: () => number;
  fetchImpl?: typeof fetch;
}): Promise<Algorithm[]> {
  const algorithms = await fetchAlgorithms(deps.fetchImpl);
  await deps.writeCache({ version: CATALOG_SCHEMA_VERSION, fetchedAt: deps.now(), algorithms });
  return algorithms;
}
