import { describe, it, expect } from "vitest";
import { parsePs, selectStaleDevProcs, selectGroupKill } from "./reconcile";

// Real-shaped `ps -axww -o pid=,pgid=,command=` lines from a dev session.
const REPO = "/Users/madison/Developer/ablevsep";
const DEV_KEY = `${REPO}/.dev/`;

const RUNNER = `43665 43665 node ./node_modules/.bin/extensions-cli run --storage-directory ${REPO}/.dev/storage --temp-directory ${REPO}/.dev/temp`;
// The host child is a *different* binary (Live's bundled node), but its -e payload
// carries the same storage/temp dirs, so it still matches the .dev discriminator.
const HOST_CHILD = `43667 43665 /Applications/Ableton Live 12 Beta.app/Contents/Helpers/ExtensionHost/node -e require('/Applications/Ableton Live 12 Beta.app/Contents/Helpers/ExtensionHost/ExtensionHostNodeModule.node').initialize({"extensions":[{"path":"${REPO}","storageDirectory":"${REPO}/.dev/storage","tempDirectory":"${REPO}/.dev/temp"}]});`;
const LIVE = `44004 44004 /Applications/Ableton Live 12 Beta.app/Contents/MacOS/Live`;
// The repo's TS language server references <repo>/node_modules — NOT <repo>/.dev.
const TSSERVER = `19519 19519 /opt/homebrew/Cellar/node/26.0.0/bin/node ${REPO}/node_modules/typescript/lib/tsserver.js --useInferredProjectPerProjectRoot`;

describe("parsePs", () => {
  it("splits pid, pgid, and the (space-containing) command", () => {
    const procs = parsePs([RUNNER, LIVE].join("\n"));
    expect(procs).toEqual([
      {
        pid: 43665,
        pgid: 43665,
        command: `node ./node_modules/.bin/extensions-cli run --storage-directory ${REPO}/.dev/storage --temp-directory ${REPO}/.dev/temp`,
      },
      {
        pid: 44004,
        pgid: 44004,
        command: "/Applications/Ableton Live 12 Beta.app/Contents/MacOS/Live",
      },
    ]);
  });

  it("keeps the full -e payload intact and ignores blank lines", () => {
    const procs = parsePs(`\n${HOST_CHILD}\n  \n`);
    expect(procs).toHaveLength(1);
    expect(procs[0].pid).toBe(43667);
    expect(procs[0].command).toContain(`"storageDirectory":"${REPO}/.dev/storage"`);
  });
});

describe("selectStaleDevProcs", () => {
  const all = () => parsePs([RUNNER, HOST_CHILD, LIVE, TSSERVER].join("\n"));
  const opts = { devKey: DEV_KEY, selfPid: 99999, selfPgid: 99999 };

  it("reaps this repo's extensions-cli runner and its host child", () => {
    const victims = selectStaleDevProcs(all(), opts).map((p) => p.pid).sort();
    expect(victims).toEqual([43665, 43667]);
  });

  it("never reaps Ableton Live itself (its command has no .dev path)", () => {
    const victims = selectStaleDevProcs(all(), opts);
    expect(victims.some((p) => p.pid === 44004)).toBe(false);
  });

  it("never reaps the repo's tsserver (matches <repo> but not <repo>/.dev/)", () => {
    const victims = selectStaleDevProcs(all(), opts);
    expect(victims.some((p) => p.pid === 19519)).toBe(false);
  });

  it("never reaps the running supervisor itself (by pid or its process group)", () => {
    // Our own supervisor, hypothetically holding a .dev path in argv, must be spared.
    const self = `99999 99999 node --import tsx scripts/dev.ts ${REPO}/.dev/`;
    const child = `99998 99999 some-child-in-our-group ${REPO}/.dev/storage`;
    const victims = selectStaleDevProcs(parsePs([self, child, RUNNER].join("\n")), opts);
    expect(victims.map((p) => p.pid)).toEqual([43665]);
  });

  it("excludes the Live binary even if its command somehow carried a .dev path", () => {
    const liveWithDev = `44004 44004 /Applications/Ableton Live 12 Beta.app/Contents/MacOS/Live --extension ${REPO}/.dev/storage`;
    const victims = selectStaleDevProcs(parsePs(liveWithDev), opts);
    expect(victims).toEqual([]);
  });

  it("returns nothing when no dev session is present", () => {
    expect(selectStaleDevProcs(parsePs([LIVE, TSSERVER].join("\n")), opts)).toEqual([]);
  });
});

describe("selectGroupKill", () => {
  const opts = { devKey: DEV_KEY, selfPgid: 99999 };

  it("returns the recorded pgid when that group still holds a dev-session member", () => {
    const procs = parsePs([RUNNER, HOST_CHILD].join("\n")); // both in group 43665
    expect(selectGroupKill(procs, { recordedPgid: 43665, ...opts })).toBe(43665);
  });

  it("refuses to group-kill when the recorded pgid was reused by unrelated procs", () => {
    // pgid 43665 now belongs to something with no .dev path (PID/PGID reuse).
    const reused = `43665 43665 /bin/zsh -l`;
    expect(selectGroupKill(parsePs(reused), { recordedPgid: 43665, ...opts })).toBeNull();
  });

  it("never group-kills our own process group", () => {
    const self = `99999 99999 node scripts/dev.ts ${REPO}/.dev/`;
    expect(selectGroupKill(parsePs(self), { recordedPgid: 99999, ...opts })).toBeNull();
  });

  it("returns null when there is no recorded pgid", () => {
    expect(selectGroupKill(parsePs(RUNNER), { recordedPgid: null, ...opts })).toBeNull();
  });
});
