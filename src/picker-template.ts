import type { Algorithm } from "./mvsep/catalog";
import type { AddOptKey } from "./mvsep/client";

export const PICKER_DATA_MARKER = "/*__PICKER_DATA__*/null";

export interface PickerData {
  algorithms: Algorithm[];
  config: {
    apiToken?: string;
    lastModel?: { renderId: number; options: Record<string, string> };
    outputFormat: number;
  };
  /** Result of the launch-time token health check, if a token was saved. */
  tokenStatus?: { valid: boolean; premiumEnabled?: boolean; premiumMinutes?: number; message?: string };
  /** Best estimate of the source audio length (seconds) — drives the live credit estimate. */
  sourceSeconds?: number;
  /** Precomputed plan-limit violations for this source + plan (over length/size); empty if OK. */
  limitWarnings?: string[];
}

export interface TokenStatusLike {
  valid?: boolean;
  premiumEnabled?: boolean;
  premiumMinutes?: number;
  networkError?: boolean;
}

/**
 * Separate is only permitted when a *validated* token is configured: a saved token whose
 * launch/save health-check returned valid. A typed-but-unsaved token (replacing/first run), a
 * server-rejected token, or a network-error status (couldn't confirm) all block Separate until
 * the user saves a token that checks out — so we never kick off a long upload that's doomed.
 */
export function hasUsableToken(opts: { savedToken?: string; replacing: boolean; tokenStatus?: TokenStatusLike }): boolean {
  return Boolean(opts.savedToken) && !opts.replacing && opts.tokenStatus?.valid === true;
}

/**
 * We KNOW the account can't spend premium credits right now: a valid token, but premium usage is
 * disabled OR no premium credits left. Unknown/invalid token → false, so we never false-block on
 * status we simply haven't fetched (the now-surfaced server error explains those cases instead).
 */
function premiumBlocked(tokenStatus?: TokenStatusLike): boolean {
  if (!tokenStatus || !tokenStatus.valid) return false;
  if (tokenStatus.premiumEnabled !== true) return true;
  if (typeof tokenStatus.premiumMinutes === "number" && tokenStatus.premiumMinutes <= 0) return true;
  return false;
}

/** A premium-only model, per mvsep's `orientation` field: 2 = "premium users". This is the gate
 * signal (NOT price_coefficient, which is cost) — a future premium model could be coefficient 1. */
export function isPremiumModel(orientation: number): boolean {
  return orientation === 2;
}

/** A premium-only model (orientation 2) is locked when the account can't spend premium right now. */
export function isPremiumLocked(orientation: number, tokenStatus?: TokenStatusLike): boolean {
  return isPremiumModel(orientation) && premiumBlocked(tokenStatus);
}

/** Premium-only output formats: WAV 32-bit (4) and FLAC 24-bit (5) — the premium "audio quality" tier
 * per mvsep.com/plans. The API's output_format enum carries no flag for this, so we encode it here. */
export const PREMIUM_OUTPUT_FORMATS = [4, 5];

export function isOutputFormatLocked(value: number, tokenStatus?: TokenStatusLike): boolean {
  return PREMIUM_OUTPUT_FORMATS.includes(value) && premiumBlocked(tokenStatus);
}

export interface PickerResult {
  renderId: number;
  options: Partial<Record<AddOptKey, string>>;
  outputFormat: number;
  apiToken: string;
  remember: boolean;
}

export interface PickerSaveTokenResult {
  saveToken: true;
  apiToken: string;
  renderId?: number;
  options: Partial<Record<AddOptKey, string>>;
  outputFormat: number;
}

export interface PickerSetPremiumResult {
  setPremium: boolean;
  apiToken: string;
  renderId?: number;
  options: Partial<Record<AddOptKey, string>>;
  outputFormat: number;
}

export type PickerAction = PickerResult | PickerSaveTokenResult | PickerSetPremiumResult;

export function renderPickerHtml(shell: string, data: PickerData): string {
  // Use a function replacer so `$` sequences in the JSON aren't treated as patterns.
  return shell.replace(PICKER_DATA_MARKER, () => JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>"));
}

export function pickerDataUrl(html: string): string {
  return "data:text/html," + encodeURIComponent(html);
}

export function parsePickerResult(raw: string): PickerAction | null {
  let obj: any;
  try {
    obj = JSON.parse(raw);
  } catch {
    // An empty / non-JSON payload arrives when Live's modal closes from external-link
    // navigation (e.g. opening mvsep.com in a browser) rather than a real action. Treat as cancel.
    return null;
  }
  if (obj && obj.cancelled === true) return null;
  if (obj?.saveToken === true) {
    if (typeof obj.apiToken !== "string" || typeof obj.outputFormat !== "number") {
      throw new Error("Invalid picker token-save result");
    }
    if (obj.renderId != null && typeof obj.renderId !== "number") {
      throw new Error("Invalid picker token-save result");
    }
    return {
      saveToken: true,
      apiToken: obj.apiToken,
      renderId: obj.renderId,
      options: obj.options ?? {},
      outputFormat: obj.outputFormat,
    };
  }
  if (typeof obj?.setPremium === "boolean") {
    if (typeof obj.apiToken !== "string" || typeof obj.outputFormat !== "number") {
      throw new Error("Invalid picker set-premium result");
    }
    return {
      setPremium: obj.setPremium,
      apiToken: obj.apiToken,
      renderId: typeof obj.renderId === "number" ? obj.renderId : undefined,
      options: obj.options ?? {},
      outputFormat: obj.outputFormat,
    };
  }
  if (typeof obj?.renderId !== "number" || typeof obj?.outputFormat !== "number" || typeof obj?.apiToken !== "string") {
    throw new Error("Invalid picker result");
  }
  return {
    renderId: obj.renderId,
    options: obj.options ?? {},
    outputFormat: obj.outputFormat,
    apiToken: obj.apiToken,
    remember: Boolean(obj.remember),
  };
}
