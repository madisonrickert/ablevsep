// Builds the installable .ablx into ./release/ — kept out of the repo root and
// git-ignored. The .ablx is the *shippable* artifact (a ZIP of manifest.json +
// the built dist/extension.js) that users drag into Live's Extensions prefs;
// dist/ holds the intermediate bundle that this packages. Run via
// `npm run package` (which builds first). Pass `--reveal` to open the file in
// Finder, ready to drag in: `npm run package -- --reveal`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT_DIR = "release";

function fail(msg) {
  console.error(`\n  package: ${msg}\n`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
if (!existsSync(manifest.entry)) {
  fail(`${manifest.entry} not found — run \`npm run build\` first (or just \`npm run package\`).`);
}

// Match extensions-cli's own naming so the file is identical to its default,
// only relocated: "<name with spaces → dashes>-<version>.ablx".
const ablxName = `${(manifest.name || "extension").replace(/\s+/gu, "-")}-${manifest.version || "0.0.0"}.ablx`;
const outPath = join(OUT_DIR, ablxName);

// One artifact per build: clear stale .ablx files so we never ship the wrong one.
mkdirSync(OUT_DIR, { recursive: true });
for (const f of readdirSync(OUT_DIR)) {
  if (f.endsWith(".ablx")) rmSync(join(OUT_DIR, f));
}

const cliBin = join("node_modules", ".bin", process.platform === "win32" ? "extensions-cli.cmd" : "extensions-cli");
// Suppress the CLI's bare path print (stdout); surface its errors (stderr).
execFileSync(cliBin, ["package", "-o", outPath], { stdio: ["ignore", "ignore", "inherit"] });

const sizeMB = (statSync(outPath).size / 1024 / 1024).toFixed(2);
console.log(`\n  package: ${manifest.name} ${manifest.version} → ${outPath} (${sizeMB} MB)`);
console.log(`  install: drag it onto Live → Preferences → Extensions (Developer Mode off).\n`);

if (process.argv.includes("--reveal")) {
  if (process.platform === "darwin") execFileSync("open", ["-R", outPath]);
  else console.log("  package: --reveal is macOS-only; skipped.");
}
