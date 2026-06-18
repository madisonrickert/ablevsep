import * as esbuild from "esbuild";
import * as fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");

await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  loader: { ".html": "text" },
  // Thread the manifest version into the bundle so error reports always show the
  // shipped version (single source of truth: manifest.json). vitest.config.ts mirrors
  // this define so APP_VERSION resolves under the test runner too.
  define: { __APP_VERSION__: JSON.stringify(manifest.version) },
});
