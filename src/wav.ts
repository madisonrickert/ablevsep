/**
 * Duration (seconds) of a WAV from its header chunks, or null if `bytes` isn't a parseable WAV.
 * Reads only the `fmt ` byteRate and the `data` chunk's declared size — so a header-only slice
 * (the first ~64 KB) is enough; the sample data itself need not be present. Pure DataView/Uint8Array
 * (no Node APIs) so it also runs in Live's Extension Host runtime.
 */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number): string => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;

  let off = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    if (id === "fmt " && off + 8 + 16 <= bytes.length) {
      byteRate = dv.getUint32(off + 8 + 8, true); // bytes/sec, at offset 8 within the fmt chunk
    } else if (id === "data") {
      dataSize = size;
      break;
    }
    off += 8 + size + (size & 1); // chunks are word-aligned
  }
  return byteRate > 0 && dataSize > 0 ? dataSize / byteRate : null;
}
