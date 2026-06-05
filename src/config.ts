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
  } catch {
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
