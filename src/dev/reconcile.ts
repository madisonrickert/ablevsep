import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// Startup reconciliation for the dev launcher (`npm run start`).
//
// The Ableton `extensions-cli run` dev server spawns an Extension Host child and,
// on any non-graceful exit (closed terminal, SIGKILL, sleep), leaves it orphaned.
// A stale host holds the IPC channel, so the *next* host can't complete its
// handshake with Live ("live didn't ack in time") and hangs. Exit traps can't fix
// this — the failures that orphan the child are exactly the ones that skip exit
// handlers. So we don't rely on graceful shutdown: we reconcile at startup, the one
// moment guaranteed to run on every launch, and enforce "one clean dev host per repo".
//
// The discriminator is the repo's `.dev/` path, which `extensions-cli` and its host
// child both carry (via --storage-directory/--temp-directory and the host's init
// payload) and which nothing we must spare carries: Live's own command has no .dev
// path, and the repo's tsserver references <repo>/node_modules, not <repo>/.dev.

export interface Proc {
  pid: number;
  pgid: number;
  command: string;
}

/** Parse `ps -axww -o pid=,pgid=,command=` output. Blank/garbage lines are skipped. */
export function parsePs(stdout: string): Proc[] {
  const procs: Proc[] = [];
  for (const line of stdout.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*\S)\s*$/u.exec(line);
    if (!m) continue;
    procs.push({ pid: Number(m[1]), pgid: Number(m[2]), command: m[3] });
  }
  return procs;
}

export interface SelectOpts {
  /** Absolute repo `.dev/` path (with trailing slash), e.g. `/Users/x/repo/.dev/`. */
  devKey: string;
  /** This supervisor's own pid — never reap it. */
  selfPid: number;
  /** This supervisor's own process group — never reap a sibling in it. */
  selfPgid: number;
}

// Live's actual binary, so we never signal Live even in the (unobserved) case its
// command line carried a .dev path. Belt-and-suspenders on top of the devKey filter.
const LIVE_BINARY = /\/Contents\/MacOS\/Live(?:\s|$)/u;

/** Pick the stale dev-session processes (this repo's runner + host child) to reap. */
export function selectStaleDevProcs(procs: Proc[], opts: SelectOpts): Proc[] {
  return procs.filter(
    (p) =>
      p.command.includes(opts.devKey) &&
      p.pid !== opts.selfPid &&
      p.pgid !== opts.selfPgid &&
      !LIVE_BINARY.test(p.command),
  );
}

/**
 * Decide whether the recorded host process group is safe to group-kill (`kill -pgid`),
 * which sweeps the host child plus any grandchildren in one signal. We only ever record
 * a *detached* leader's pgid (its own group), but PID/PGID get reused, so we kill the
 * group only if it still holds a member carrying this repo's `.dev/` path. Returns the
 * pgid to sweep, or null when there's nothing safe to do.
 */
export function selectGroupKill(
  procs: Proc[],
  opts: { recordedPgid: number | null; devKey: string; selfPgid: number },
): number | null {
  const { recordedPgid, devKey, selfPgid } = opts;
  if (recordedPgid == null || Number.isNaN(recordedPgid) || recordedPgid === selfPgid) {
    return null;
  }
  const members = procs.filter((p) => p.pgid === recordedPgid);
  return members.some((p) => p.command.includes(devKey)) ? recordedPgid : null;
}

// ─── Effectful glue (process listing, signalling, pidfile). Verified live via
// `--dry-run`, not unit-tested: mocking exec/kill would test the mock, not the OS. ───

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Snapshot every process with full (untruncated) command lines. */
export function listProcs(): Proc[] {
  const out = execFileSync("ps", ["-axww", "-o", "pid=,pgid=,command="], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
  return parsePs(out);
}

function signal(pid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(pid, sig);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ESRCH") throw e;
  }
}

/** Signal a whole process group (`kill -<sig> -pgid`). */
function signalGroup(pgid: number, sig: NodeJS.Signals): void {
  try {
    process.kill(-pgid, sig);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== "ESRCH" && code !== "EPERM") throw e;
  }
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"; // exists but not ours
  }
}

export function readPgid(file: string): number | null {
  try {
    const n = Number.parseInt(readFileSync(file, "utf8").trim(), 10);
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}

export function writePgid(file: string, pgid: number): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${pgid}\n`);
}

export function clearPgid(file: string): void {
  if (existsSync(file)) rmSync(file);
}

export interface ReconcileResult {
  dryRun: boolean;
  reaped: Proc[];
  groupKilled: number | null;
}

/**
 * Reap any stale dev session for `cwd` before launching a fresh one. Idempotent:
 * a no-op (and silent but for the log) when nothing stale is running.
 */
export async function reconcile(opts: {
  cwd: string;
  dryRun?: boolean;
  log?: (msg: string) => void;
}): Promise<ReconcileResult> {
  const { cwd, dryRun = false, log = () => {} } = opts;
  const devKey = `${cwd}/.dev/`;
  const pgidFile = `${cwd}/.dev/host.pgid`;

  const procs = listProcs();
  const selfPid = process.pid;
  const selfPgid = procs.find((p) => p.pid === selfPid)?.pgid ?? selfPid;
  const recordedPgid = readPgid(pgidFile);

  const reaped = selectStaleDevProcs(procs, { devKey, selfPid, selfPgid });
  const groupKilled = selectGroupKill(procs, { recordedPgid, devKey, selfPgid });

  if (!reaped.length && groupKilled == null) {
    log("predev: no stale dev session — clean ✓");
    return { dryRun, reaped, groupKilled: null };
  }

  const pids = reaped.map((p) => p.pid).join(", ");
  const groupNote = groupKilled != null ? ` + process group ${groupKilled}` : "";
  if (dryRun) {
    log(`predev: would reap pid(s) ${pids || "(none)"}${groupNote}`);
    return { dryRun, reaped, groupKilled };
  }

  log(`predev: reaping stale dev session — pid(s) ${pids || "(none)"}${groupNote}`);
  for (const p of reaped) signal(p.pid, "SIGTERM");
  if (groupKilled != null) signalGroup(groupKilled, "SIGTERM");

  await delay(700);

  for (const p of reaped) if (alive(p.pid)) signal(p.pid, "SIGKILL");
  if (groupKilled != null) signalGroup(groupKilled, "SIGKILL");

  clearPgid(pgidFile);
  return { dryRun, reaped, groupKilled };
}
