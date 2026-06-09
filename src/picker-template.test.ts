import { describe, it, expect } from "vitest";
import { renderPickerHtml, pickerDataUrl, parsePickerResult, isPremiumModel, isPremiumLocked, isOutputFormatLocked, hasUsableToken, PICKER_DATA_MARKER, type PickerData } from "./picker-template";

const data: PickerData = {
  algorithms: [{ renderId: 40, name: "BS Roformer", description: "", orderId: 5, priceCoefficient: 1, orientation: 0, fields: [] }],
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

  it("returns null (not throw) for an empty or non-JSON payload (external-link modal close)", () => {
    expect(parsePickerResult("")).toBeNull();
    expect(parsePickerResult("not json")).toBeNull();
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

  it("parses a set-premium result", () => {
    const raw = JSON.stringify({ setPremium: true, apiToken: "T", renderId: 26, options: {}, outputFormat: 1 });
    expect(parsePickerResult(raw)).toEqual({ setPremium: true, apiToken: "T", renderId: 26, options: {}, outputFormat: 1 });
  });

  it("throws on a result missing required fields", () => {
    expect(() => parsePickerResult(JSON.stringify({ outputFormat: 1 }))).toThrow();
  });

  it("throws on a malformed token-save result", () => {
    expect(() => parsePickerResult(JSON.stringify({ saveToken: true, apiToken: "T" }))).toThrow();
  });
});

describe("isPremiumModel", () => {
  it("treats orientation 2 (premium users) as a premium-only model", () => {
    expect(isPremiumModel(2)).toBe(true);
  });

  it("treats orientation 0 (all) and 1 (registered) as non-premium", () => {
    expect(isPremiumModel(0)).toBe(false);
    expect(isPremiumModel(1)).toBe(false);
  });
});

describe("isPremiumLocked", () => {
  it("locks a premium model (orientation 2) when premium usage is disabled on a valid account", () => {
    expect(isPremiumLocked(2, { valid: true, premiumEnabled: false, premiumMinutes: 10000 })).toBe(true);
  });

  it("locks a premium model when there are no premium minutes left", () => {
    expect(isPremiumLocked(2, { valid: true, premiumEnabled: true, premiumMinutes: 0 })).toBe(true);
  });

  it("allows a premium model when premium is enabled and minutes remain", () => {
    expect(isPremiumLocked(2, { valid: true, premiumEnabled: true, premiumMinutes: 120 })).toBe(false);
  });

  it("never locks a non-premium model (orientation 0 or 1), even with premium blocked", () => {
    const blocked = { valid: true, premiumEnabled: false, premiumMinutes: 0 };
    expect(isPremiumLocked(0, blocked)).toBe(false);
    expect(isPremiumLocked(1, blocked)).toBe(false);
  });

  it("does not lock when token status is unknown or invalid (avoids false blocks)", () => {
    expect(isPremiumLocked(2, undefined)).toBe(false);
    expect(isPremiumLocked(2, { valid: false })).toBe(false);
  });
});

describe("hasUsableToken", () => {
  it("is true only for a saved token whose validation came back valid", () => {
    expect(hasUsableToken({ savedToken: "T", replacing: false, tokenStatus: { valid: true } })).toBe(true);
  });

  it("is false when the saved token is rejected, or could not be verified (network error)", () => {
    expect(hasUsableToken({ savedToken: "T", replacing: false, tokenStatus: { valid: false } })).toBe(false);
    expect(hasUsableToken({ savedToken: "T", replacing: false, tokenStatus: { valid: false, networkError: true } })).toBe(false);
  });

  it("is false while replacing (the typed token is unsaved and unvalidated)", () => {
    expect(hasUsableToken({ savedToken: "T", replacing: true, tokenStatus: { valid: true } })).toBe(false);
  });

  it("is false with no saved token and no validation yet (first-run entry mode)", () => {
    expect(hasUsableToken({ savedToken: "", replacing: false, tokenStatus: undefined })).toBe(false);
    expect(hasUsableToken({ replacing: false })).toBe(false);
  });
});

describe("isOutputFormatLocked", () => {
  it("locks WAV 32-bit (4) and FLAC 24-bit (5) when premium usage is off", () => {
    const off = { valid: true, premiumEnabled: false, premiumMinutes: 10000 };
    expect(isOutputFormatLocked(4, off)).toBe(true);
    expect(isOutputFormatLocked(5, off)).toBe(true);
  });

  it("never locks the free-tier formats (MP3 0, WAV16 1, FLAC16 2, M4A 3)", () => {
    const off = { valid: true, premiumEnabled: false, premiumMinutes: 0 };
    for (const v of [0, 1, 2, 3]) expect(isOutputFormatLocked(v, off)).toBe(false);
  });

  it("allows premium formats when premium is enabled with minutes left", () => {
    expect(isOutputFormatLocked(5, { valid: true, premiumEnabled: true, premiumMinutes: 50 })).toBe(false);
  });

  it("locks premium formats when premium is enabled but out of minutes", () => {
    expect(isOutputFormatLocked(4, { valid: true, premiumEnabled: true, premiumMinutes: 0 })).toBe(true);
  });

  it("does not lock on unknown or invalid token (avoids false blocks)", () => {
    expect(isOutputFormatLocked(4, undefined)).toBe(false);
    expect(isOutputFormatLocked(4, { valid: false })).toBe(false);
  });
});
