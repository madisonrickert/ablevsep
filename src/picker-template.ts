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
}

export interface TokenStatusLike {
  valid?: boolean;
  premiumEnabled?: boolean;
  premiumMinutes?: number;
}

/**
 * We KNOW the account can't spend premium credits right now: a valid token, but premium usage is
 * disabled OR no premium minutes left. Unknown/invalid token → false, so we never false-block on
 * status we simply haven't fetched (the now-surfaced server error explains those cases instead).
 */
function premiumBlocked(tokenStatus?: TokenStatusLike): boolean {
  if (!tokenStatus || !tokenStatus.valid) return false;
  if (tokenStatus.premiumEnabled !== true) return true;
  if (typeof tokenStatus.premiumMinutes === "number" && tokenStatus.premiumMinutes <= 0) return true;
  return false;
}

/** A premium model (mvsep `price_coefficient` > 1 — the Ensembles) is locked when premium is blocked. */
export function isPremiumLocked(priceCoefficient: number, tokenStatus?: TokenStatusLike): boolean {
  return priceCoefficient > 1 && premiumBlocked(tokenStatus);
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
