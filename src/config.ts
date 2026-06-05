import { DEFAULT_OUTPUT_FORMAT } from "./mvsep/client";

export interface Config {
  apiToken?: string;
  lastModel?: { renderId: number; options: Record<string, string> };
  outputFormat: number;
}

export const DEFAULT_CONFIG: Config = { outputFormat: DEFAULT_OUTPUT_FORMAT };

export async function readConfig(
  readFile: (path: string) => Promise<string>,
  path: string,
): Promise<Config> {
  try {
    const parsed = JSON.parse(await readFile(path));
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch (e) {
    // A missing file on first run is expected; a parse error means a corrupt config
    // (which would silently drop the saved token), so surface that case.
    const msg = e instanceof Error ? e.message : String(e);
    if (!/ENOENT|no such file/i.test(msg)) {
      console.warn("[ablevsep] config: could not read/parse config, using defaults:", msg);
    }
    return { ...DEFAULT_CONFIG };
  }
}

export async function writeConfig(
  writeFile: (path: string, data: string) => Promise<void>,
  path: string,
  config: Config,
): Promise<void> {
  await writeFile(path, JSON.stringify(config, null, 2));
}
