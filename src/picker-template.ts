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
}

export interface PickerResult {
  renderId: number;
  options: Partial<Record<AddOptKey, string>>;
  outputFormat: number;
  apiToken: string;
  remember: boolean;
}

export function renderPickerHtml(shell: string, data: PickerData): string {
  // Use a function replacer so `$` sequences in the JSON aren't treated as patterns.
  return shell.replace(PICKER_DATA_MARKER, () => JSON.stringify(data).replace(/<\/script>/gi, "<\\/script>"));
}

export function pickerDataUrl(html: string): string {
  return "data:text/html," + encodeURIComponent(html);
}

export function parsePickerResult(raw: string): PickerResult | null {
  const obj = JSON.parse(raw);
  if (obj && obj.cancelled === true) return null;
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
