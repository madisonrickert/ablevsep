// Supervised dev launcher for `pnpm run start`.
//
// Wraps `extensions-cli run` so we can (1) reconcile away any stale dev host before
// launching — see src/dev/reconcile.ts for why startup reconciliation, not exit
// traps, is the reliable fix — and (2) own teardown of the host process group on
// Ctrl-C so we stop creating orphans in the first place.
//
//   pnpm run start                 reconcile → launch → supervise (Ctrl-C tears down)
//   tsx scripts/dev.ts --dry-run  show what reconcile would reap, then exit
//   pnpm run dev:clean             reconcile only (reap a stale session), then exit
//
// `--json` prints the reconcile result as JSON (for agent-driven inspection).
import { spawn } from "node:child_process";
import { reconcile, writePgid, clearPgid } from "../src/dev/reconcile";

const cwd = process.cwd();
const pgidFile = `${cwd}/.dev/host.pgid`;
const argv = new Set(process.argv.slice(2));
const dryRun = argv.has("--dry-run");
const reconcileOnly = dryRun || argv.has("--reconcile-only");
const json = argv.has("--json");

const log = json ? () => {} : (msg: string) => console.log(`  ${msg}`);

const result = await reconcile({ cwd, dryRun, log });
if (json) console.log(JSON.stringify(result, null, 2));
if (reconcileOnly) process.exit(0);

// Launch the dev server detached, in its own process group, so a future
// `kill -<pgid>` reaps the whole tree (runner + host child + grandchildren).
const child = spawn(
  "./node_modules/.bin/extensions-cli",
  ["run", "--storage-directory", `${cwd}/.dev/storage`, "--temp-directory", `${cwd}/.dev/temp`],
  { cwd, detached: true, stdio: "inherit" },
);
writePgid(pgidFile, child.pid!); // detached → child.pid is the group leader id

let tearingDown = false;
function teardown(exitCode: number): void {
  if (tearingDown) return;
  tearingDown = true;
  try {
    process.kill(-child.pid!, "SIGTERM");
  } catch {
    // group already gone
  }
  clearPgid(pgidFile);
  setTimeout(() => {
    try {
      process.kill(-child.pid!, "SIGKILL");
    } catch {
      // group already gone
    }
    process.exit(exitCode);
  }, 500);
}

process.on("SIGINT", () => teardown(0));
process.on("SIGTERM", () => teardown(0));
child.on("exit", (code) => {
  clearPgid(pgidFile);
  process.exit(code ?? 0);
});
