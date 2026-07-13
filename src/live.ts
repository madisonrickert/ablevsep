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

export const readFileUtf8 = (p: string): Promise<string> => fs.readFile(p, "utf8");
export const writeFileUtf8 = (p: string, data: string): Promise<void> => fs.writeFile(p, data, "utf8");

export async function writeBuffer(dir: string, name: string, data: ArrayBuffer): Promise<string> {
  const dest = path.join(dir, name);
  await fs.writeFile(dest, Buffer.from(data));
  return dest;
}
