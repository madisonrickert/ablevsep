import pickerHtml from "./ui/picker.html";
import { renderPickerHtml, pickerDataUrl, parsePickerResult, type PickerAction, type PickerData } from "./picker-template";
import type { ExtensionContext } from "@ableton-extensions/sdk";

const PICKER_WIDTH = 460;
const PICKER_HEIGHT = 640;

/** Opens the model picker. Returns the user's action, or null if they cancelled. */
export async function openPicker(ctx: ExtensionContext<"1.0.0">, data: PickerData): Promise<PickerAction | null> {
  const html = renderPickerHtml(pickerHtml, data);
  const raw = await ctx.ui.showModalDialog(pickerDataUrl(html), PICKER_WIDTH, PICKER_HEIGHT);
  return parsePickerResult(raw);
}
