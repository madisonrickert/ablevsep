import { describe, it, expect } from "vitest";
import { stemNameFromFilename, stemTrackName, arrangementClipArgs, sessionClipArgs, type OriginalClipInfo } from "./placement-args";

const ORIG: OriginalClipInfo = {
  startTime: 16, duration: 8, warping: false,
  startMarker: 0, endMarker: 8, looping: false, loopStart: 0, loopEnd: 8,
  name: "Lead Vox",
};

describe("names", () => {
  it("strips the extension from a stem filename", () => {
    expect(stemNameFromFilename("vocals.wav")).toBe("vocals");
    expect(stemNameFromFilename("drums_other.flac")).toBe("drums_other");
    expect(stemNameFromFilename("noext")).toBe("noext");
  });

  it("builds a prefixed track name and handles blank clip names", () => {
    expect(stemTrackName("Lead Vox", "vocals")).toBe("Lead Vox - vocals");
    expect(stemTrackName("   ", "drums")).toBe("Clip - drums");
  });
});

describe("arrangementClipArgs", () => {
  it("places 1:1 at the original position, unwarped", () => {
    expect(arrangementClipArgs("/imp/v.wav", ORIG)).toEqual({
      filePath: "/imp/v.wav", startTime: 16, duration: 8, isWarped: false,
    });
  });
});

describe("sessionClipArgs", () => {
  it("mirrors region markers for an unwarped clip", () => {
    expect(sessionClipArgs("/imp/v.wav", ORIG)).toEqual({
      filePath: "/imp/v.wav", isWarped: false,
      loopSettings: { looping: false, startMarker: 0, endMarker: 8, loopStart: 0, loopEnd: 8 },
    });
  });

  it("omits loopSettings for a warped clip (best-effort full sample)", () => {
    expect(sessionClipArgs("/imp/v.wav", { ...ORIG, warping: true })).toEqual({
      filePath: "/imp/v.wav", isWarped: false,
    });
  });
});
