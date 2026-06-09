import { describe, it, expect } from "vitest";
import { wavDurationSeconds } from "./wav";

/** A 44-byte canonical WAV header (no sample data needed — duration comes from the data-chunk size). */
function wavHeader(seconds: number, sampleRate = 44100, channels = 2, bits = 16): Uint8Array {
  const byteRate = sampleRate * channels * (bits / 8);
  const dataSize = Math.round(byteRate * seconds);
  const b = Buffer.alloc(44);
  b.write("RIFF", 0);
  b.writeUInt32LE(36 + dataSize, 4);
  b.write("WAVE", 8);
  b.write("fmt ", 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); // PCM
  b.writeUInt16LE(channels, 22);
  b.writeUInt32LE(sampleRate, 24);
  b.writeUInt32LE(byteRate, 28);
  b.writeUInt16LE((channels * bits) / 8, 32);
  b.writeUInt16LE(bits, 34);
  b.write("data", 36);
  b.writeUInt32LE(dataSize, 40);
  return new Uint8Array(b);
}

describe("wavDurationSeconds", () => {
  it("computes duration from the header alone (no sample data required)", () => {
    expect(wavDurationSeconds(wavHeader(6, 44100, 2, 16))).toBeCloseTo(6, 3);
    expect(wavDurationSeconds(wavHeader(123.5, 48000, 1, 24))).toBeCloseTo(123.5, 2);
  });

  it("returns null for a truncated header (data size unreadable)", () => {
    expect(wavDurationSeconds(wavHeader(6).subarray(0, 40))).toBeNull();
  });

  it("returns null for non-WAV bytes", () => {
    expect(wavDurationSeconds(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3, 4, 5, 6, 7, 8, 9]))).toBeNull();
  });
});
