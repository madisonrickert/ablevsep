// Vendors the Ableton Extensions SDK tarballs into ./vendor so `npm install` can
// resolve them. The SDK is a private beta distributed by Ableton and is not
// committed to this repo. Point ABLETON_SDK_PATH (in .env or your shell) at your
// unpacked SDK; this copies the SDK + CLI tarballs into ./vendor with stable names.
import { existsSync, mkdirSync, copyFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function fail(msg) {
  console.error(`\n  setup-sdk: ${msg}\n`);
  process.exit(1);
}

function readEnv(name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(".env", "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith(`${name}=`));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    // no .env file
  }
  return undefined;
}

const sdkPath = readEnv("ABLETON_SDK_PATH");
if (!sdkPath) {
  fail(
    "ABLETON_SDK_PATH is not set.\n" +
      "  Copy .env.example to .env and set it to your unpacked Ableton Extensions SDK, e.g.\n" +
      "    ABLETON_SDK_PATH=/path/to/extensions-sdk-1.0.0-beta.0\n" +
      "  then re-run `npm run setup`.",
  );
}

const archiveDir = [join(sdkPath, "package-archives"), sdkPath].find((d) => existsSync(d));
if (!archiveDir) fail(`ABLETON_SDK_PATH does not exist: ${sdkPath}`);

const files = readdirSync(archiveDir);
const sdkTgz = files.find((f) => /^ableton-extensions-sdk.*\.tgz$/.test(f));
const cliTgz = files.find((f) => /^ableton-extensions-cli.*\.tgz$/.test(f));
if (!sdkTgz || !cliTgz) {
  fail(
    `Could not find the SDK tarballs in ${archiveDir}.\n` +
      "  Expected ableton-extensions-sdk-*.tgz and ableton-extensions-cli-*.tgz.",
  );
}

mkdirSync("vendor", { recursive: true });
copyFileSync(join(archiveDir, sdkTgz), "vendor/ableton-extensions-sdk.tgz");
copyFileSync(join(archiveDir, cliTgz), "vendor/ableton-extensions-cli.tgz");
console.log(`  setup-sdk: vendored ${sdkTgz} + ${cliTgz} into ./vendor — installing dependencies...`);
