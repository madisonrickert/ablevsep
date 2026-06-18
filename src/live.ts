import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

/** Resolve a stable directory, falling back to a per-user dir when the host omits one. */
export function resolveDir(preferred: string | undefined, fallbackName: string): string {
  return preferred ?? path.join(os.homedir(), ".mvsep-ableton", fallbackName);
}

export async function ensureDir(dir: string): Promise<string> {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/** True for Node's permission-model write denial (the sandbox refused the path). */
export function isAccessDenied(e: unknown): boolean {
  return !!e && typeof e === "object" && (e as { code?: string }).code === "ERR_ACCESS_DENIED";
}

/** Message shown when the temp read grant is lost (the remedy is to relaunch Live). */
export const TEMP_SANDBOX_RELAUNCH_MESSAGE =
  "AbleVSEP couldn't read Live's temporary audio folder. This is a known Ableton issue " +
  "that can happen the first time you open Live after restarting your Mac. Quitting and " +
  "relaunching Ableton Live fixes it. Please relaunch Live, then try again.";

/**
 * True when the Host's Node permission model is active but its read grant for `p` was
 * never registered. The Host's node canonicalizes its `--allow-fs-read` paths at
 * process start, so on the first Live launch after the OS purges `$TMPDIR` the
 * `Ableton Extensions` dir is born after node starts and the grant is silently
 * dropped (the read-side of Ableton bug L12-BUG-5145). `renderPreFxAudio`'s output
 * lands there, and (unlike our own writes) we
 * cannot redirect it or re-register the grant — only relaunching Live fixes it.
 * Returns false when there is no permission model (the dev host: reads aren't
 * sandboxed) so we never false-alarm there.
 */
export function tempReadGrantMissing(
  permission: { has(scope: string, ref: string): boolean } | undefined,
  p: string,
): boolean {
  return !!permission && !permission.has("fs.read", p);
}

/**
 * Return the first candidate dir we can actually create. The Extension Host's Node
 * sandbox denies writes to `tempDirectory` on the first Live launch after a macOS
 * reboot — the host resolves its `--allow-fs-write` grant before it creates that
 * dir, so the grant never registers. We fall back to a dir under the persistent
 * `storageDirectory`, whose grant always resolves. Non-permission errors propagate.
 */
export async function resolveScratchDir(
  candidates: string[],
  mkdir: (dir: string) => Promise<void> = (dir) => fs.mkdir(dir, { recursive: true }).then(() => {}),
): Promise<string> {
  let lastDenial: unknown;
  for (const dir of candidates) {
    try {
      await mkdir(dir);
      return dir;
    } catch (e) {
      if (!isAccessDenied(e)) throw e;
      lastDenial = e;
    }
  }
  throw lastDenial ?? new Error("resolveScratchDir: no candidates provided");
}

export const readFileUtf8 = (p: string): Promise<string> => fs.readFile(p, "utf8");
export const writeFileUtf8 = (p: string, data: string): Promise<void> => fs.writeFile(p, data, "utf8");

export async function writeBuffer(dir: string, name: string, data: ArrayBuffer): Promise<string> {
  const dest = path.join(dir, name);
  await fs.writeFile(dest, Buffer.from(data));
  return dest;
}
