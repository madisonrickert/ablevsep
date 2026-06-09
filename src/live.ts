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
