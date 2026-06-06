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
  tokenStatus?: { valid: boolean; premiumMinutes?: number; message?: string };
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

export type PickerAction = PickerResult | PickerSaveTokenResult;

export function renderPickerHtml(shell: string, data: PickerData): string {
  // Use a function replacer so `$` sequences in the JSON aren't treated as patterns.
  return shell.replace(PICKER_DATA_MARKER, () => JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>"));
}

export function pickerDataUrl(html: string): string {
  return "data:text/html," + encodeURIComponent(html);
}

export function parsePickerResult(raw: string): PickerAction | null {
  const obj = JSON.parse(raw);
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
