import { describe, it, expect } from "vitest";
import { renderPickerHtml, pickerDataUrl, parsePickerResult, PICKER_DATA_MARKER, type PickerData } from "./picker-template";

const data: PickerData = {
  algorithms: [{ renderId: 40, name: "BS Roformer", description: "", orderId: 5, fields: [] }],
  config: { apiToken: "TOK", outputFormat: 1 },
};

describe("renderPickerHtml", () => {
  it("replaces the data marker with JSON", () => {
    const shell = `<script>const DATA = ${PICKER_DATA_MARKER};</script>`;
    const html = renderPickerHtml(shell, data);
    expect(html).not.toContain(PICKER_DATA_MARKER);
    const json = html.match(/const DATA = (.*);<\/script>/)![1];
    expect(JSON.parse(json)).toEqual(data);
  });

  it("neutralizes </script> sequences in injected data", () => {
    const shell = `<script>const DATA = ${PICKER_DATA_MARKER};</script>`;
    const evil = { algorithms: [{ renderId: 1, name: "x</script>y", description: "", orderId: 0, fields: [] }], config: { outputFormat: 1 } };
    const html = renderPickerHtml(shell, evil as any);
    expect(html).not.toContain("x</script>y");
    expect(html).toContain("x<\\/script>y");
  });
});

describe("pickerDataUrl", () => {
  it("produces an encoded data: URL", () => {
    expect(pickerDataUrl("<b>x y</b>")).toBe("data:text/html,%3Cb%3Ex%20y%3C%2Fb%3E");
  });
});

describe("parsePickerResult", () => {
  it("parses a valid result", () => {
    const raw = JSON.stringify({ renderId: 40, options: { add_opt1: "2" }, outputFormat: 1, apiToken: "T", remember: true });
    expect(parsePickerResult(raw)).toEqual({ renderId: 40, options: { add_opt1: "2" }, outputFormat: 1, apiToken: "T", remember: true });
  });

  it("returns null for a cancellation payload", () => {
    expect(parsePickerResult(JSON.stringify({ cancelled: true }))).toBeNull();
  });

  it("parses a token-save result", () => {
    const raw = JSON.stringify({
      saveToken: true,
      apiToken: "T",
      renderId: 40,
      options: { add_opt1: "2" },
      outputFormat: 1,
    });
    expect(parsePickerResult(raw)).toEqual({
      saveToken: true,
      apiToken: "T",
      renderId: 40,
      options: { add_opt1: "2" },
      outputFormat: 1,
    });
  });

  it("throws on a result missing required fields", () => {
    expect(() => parsePickerResult(JSON.stringify({ outputFormat: 1 }))).toThrow();
  });

  it("throws on a malformed token-save result", () => {
    expect(() => parsePickerResult(JSON.stringify({ saveToken: true, apiToken: "T" }))).toThrow();
  });
});
