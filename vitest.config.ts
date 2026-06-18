import { defineConfig } from "vitest/config";
import { readFileSync } from "node:fs";

// Mirror build.ts's __APP_VERSION__ define so APP_VERSION resolves under the test runner
// (esbuild's define in build.ts only applies to the production bundle, not to tests).
const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  test: { include: ["src/**/*.test.ts"], environment: "node", passWithNoTests: true },
});
