import pickerHtml from "./ui/picker.html";
import { renderPickerHtml, pickerDataUrl, parsePickerResult, type PickerData, type PickerResult } from "./picker-template";
import type { ExtensionContext } from "@ableton-extensions/sdk";

const PICKER_WIDTH = 420;
const PICKER_HEIGHT = 500;

/** Opens the model picker. Returns the user's choice, or null if they cancelled. */
export async function openPicker(ctx: ExtensionContext<"1.0.0">, data: PickerData): Promise<PickerResult | null> {
  const html = renderPickerHtml(pickerHtml, data);
  const raw = await ctx.ui.showModalDialog(pickerDataUrl(html), PICKER_WIDTH, PICKER_HEIGHT);
  return parsePickerResult(raw);
}
