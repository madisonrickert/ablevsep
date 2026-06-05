import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  AudioTrack,
  DataModelObject,
  TakeLane,
} from "@ableton-extensions/sdk";

/** Resolve a stable directory, falling back to a per-user dir when the host omits one. */
export function resolveDir(preferred: string | undefined, fallbackName: string): string {
  return preferred ?? path.join(os.homedir(), ".mvsep-ableton", fallbackName);
}

export async function ensureDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export const readFileUtf8 = (p: string): Promise<string> => fs.readFile(p, "utf8");
export const writeFileUtf8 = (p: string, data: string): Promise<void> => fs.writeFile(p, data, "utf8");

export async function writeBuffer(dir: string, name: string, data: ArrayBuffer): Promise<string> {
  const dest = path.join(dir, name);
  await fs.writeFile(dest, Buffer.from(data));
  return dest;
}

/** Walk up from an arrangement clip to its parent AudioTrack (through a TakeLane if present). */
export function parentAudioTrack(clip: DataModelObject<"1.0.0">): AudioTrack<"1.0.0"> {
  let node: DataModelObject<"1.0.0"> | null = clip.parent;
  while (node) {
    if (node instanceof AudioTrack) return node;
    if (node instanceof TakeLane) {
      node = node.parent;
      continue;
    }
    node = node.parent;
  }
  throw new Error("Could not resolve the clip's parent audio track");
}

/** Index of a clip slot within its track, used to place stems in the same Session row. */
export function clipSlotRow(slotHandleId: bigint, track: AudioTrack<"1.0.0">): number {
  const idx = track.clipSlots.findIndex((s) => s.handle.id === slotHandleId);
  if (idx < 0) throw new Error("Could not locate the clip slot on its track");
  return idx;
}
