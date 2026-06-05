import * as path from "node:path";
import * as fsp from "node:fs/promises";
import {
  AudioClip,
  AudioTrack,
  ClipSlot,
  type ExtensionContext,
} from "@ableton-extensions/sdk";
import { checkToken, createSeparation, downloadFile, getStatus, MvsepError, type StatusFile } from "./mvsep/client";
import { loadCatalog, type CatalogCache } from "./mvsep/catalog";
import { readConfig, writeConfig } from "./config";
import { pollUntilDone, AbortError } from "./separate-core";
import { openPicker } from "./picker";
import { type PickerResult } from "./picker-template";
import { showError } from "./error-dialog";
import {
  type OriginalClipInfo,
} from "./placement-args";
import { placeStems } from "./placement";
import {
  resolveDir, ensureDir, readFileUtf8, writeFileUtf8, writeBuffer,
  parentAudioTrack, clipSlotRow,
} from "./live";

type Ctx = ExtensionContext<"1.0.0">;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(t); reject(new AbortError()); }, { once: true });
  });
}

function clipInfo(clip: AudioClip<"1.0.0">): OriginalClipInfo {
  return {
    startTime: clip.startTime, duration: clip.duration, warping: clip.warping,
    startMarker: clip.startMarker, endMarker: clip.endMarker,
    looping: clip.looping, loopStart: clip.loopStart, loopEnd: clip.loopEnd,
    color: clip.color, name: clip.name,
  };
}

async function configPaths(ctx: Ctx) {
  const storageDir = await ensureDir(resolveDir(ctx.environment.storageDirectory, "storage"));
  const tempDir = await ensureDir(resolveDir(ctx.environment.tempDirectory, "temp"));
  return {
    configPath: path.join(storageDir, "config.json"),
    catalogPath: path.join(storageDir, "catalog.json"),
    tempDir,
  };
}

/** Entry for both contexts. `kind` selects source acquisition + placement. */
export async function runSeparation(
  ctx: Ctx,
  target:
    | { kind: "arrangement"; clip: AudioClip<"1.0.0"> }
    | { kind: "session"; slot: ClipSlot<"1.0.0">; clip: AudioClip<"1.0.0"> },
): Promise<void> {
  const { configPath, catalogPath, tempDir } = await configPaths(ctx);
  const config = await readConfig(readFileUtf8, configPath);

  const algorithms = await loadCatalog({
    readCache: async () => {
      try { return JSON.parse(await readFileUtf8(catalogPath)) as CatalogCache; } catch { return null; }
    },
    writeCache: async (c) => writeFileUtf8(catalogPath, JSON.stringify(c)),
    now: () => Date.now(),
  });

  // Launch health check: validate any saved token so the picker can show its status.
  const tokenStatus = config.apiToken ? await checkToken(config.apiToken) : undefined;
  console.info(
    `[mvsep] launch: saved token ${config.apiToken ? "present" : "none"}; status ${JSON.stringify(tokenStatus ?? null)}`,
  );

  const choice: PickerResult | null = await openPicker(ctx, {
    algorithms,
    config: { apiToken: config.apiToken, lastModel: config.lastModel, outputFormat: config.outputFormat },
    tokenStatus,
  });
  if (!choice) return; // cancelled

  // The token (and last-used model/format) is auto-saved on every run, regardless.
  await writeConfig(writeFileUtf8, configPath, {
    apiToken: choice.apiToken,
    lastModel: { renderId: choice.renderId, options: choice.options as Record<string, string> },
    outputFormat: choice.outputFormat,
  });

  const orig = clipInfo(target.clip);

  try {
  await ctx.ui.withinProgressDialog("Separate with MVSEP", { progress: 0 }, async (update, signal) => {
    // Monotonic progress: the bar never drifts backwards (text still updates freely).
    let lastPercent = 0;
    const report = (text: string, percent: number) => {
      lastPercent = Math.max(lastPercent, percent);
      return update(text, lastPercent);
    };
    try {
      // 1. Acquire source audio.
      const preparingMsg = target.kind === "session" && target.clip.warping
        ? "Preparing audio… (warped clip — stems are best-effort)"
        : "Preparing audio…";
      await report(preparingMsg, 3);
      let sourcePath: string;
      let sourceName: string;
      if (target.kind === "arrangement") {
        const track = parentAudioTrack(target.clip);
        sourcePath = await ctx.resources.renderPreFxAudio(track, target.clip.startTime, target.clip.endTime);
        sourceName = "source.wav";
      } else {
        sourcePath = target.clip.filePath; // Session: separate the source file (best-effort).
        sourceName = path.basename(sourcePath) || "source.wav";
      }
      if (signal.aborted) return;

      // 2. Create the job.
      await report("Uploading…", 6);
      const fileBuf = await fsp.readFile(sourcePath);
      const hash = await createSeparation({
        apiToken: choice.apiToken,
        fileData: fileBuf,
        fileName: sourceName,
        sepType: choice.renderId,
        outputFormat: choice.outputFormat,
        options: choice.options,
      });
      console.info(`[mvsep] job created: ${hash} (model ${choice.renderId}, format ${choice.outputFormat})`);
      if (signal.aborted) return;

      // 3. Poll.
      const files: StatusFile[] = await pollUntilDone(hash, {
        getStatus: (h) => getStatus(h),
        sleep,
        signal,
        onProgress: (p) => void report(p.text, p.percent),
      });
      if (signal.aborted) return;

      // 4. Download stems.
      console.info(`[mvsep] done; ${files.length} file(s): ${files.map((f) => f.filename).join(", ")}`);
      const localStems: { name: string; importedPath: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        if (signal.aborted) return;
        await report(`Downloading stems… (${i + 1}/${files.length})`, 82 + Math.round((10 * i) / Math.max(files.length, 1)));
        console.info(`[mvsep] download ${i + 1}/${files.length}: ${files[i].filename}`);
        const buf = await downloadFile(files[i].downloadUrl);
        const dest = await writeBuffer(tempDir, `${Date.now()}-${i}-${files[i].filename}`, buf);
        const importedPath = await ctx.resources.importIntoProject(dest);
        console.info(`[mvsep] imported: ${importedPath}`);
        localStems.push({ name: files[i].stemName ?? files[i].filename, importedPath });
      }
      if (signal.aborted) return;

      // 5. Place.
      console.info(`[mvsep] placing ${localStems.length} stem track(s) (${target.kind})`);
      await report("Placing tracks…", 94);
      const row = target.kind === "session"
        ? clipSlotRow(target.slot.handle.id, parentAudioTrackFromSlot(target.slot))
        : undefined;
      await placeStems(ctx, {
        kind: target.kind,
        orig,
        stems: localStems,
        sessionRow: row,
        originalClip: target.clip,
      });
      await report("Done — select the new tracks and press ⌘G to group them.", 100);
    } catch (e) {
      if (e instanceof AbortError || signal.aborted) return; // user cancelled
      throw e;
    }
  });
  } catch (e) {
    if (e instanceof AbortError) return;
    console.error("[mvsep] separation failed:", e instanceof Error ? (e.stack ?? e.message) : e);
    const msg = e instanceof MvsepError && e.code === 401
      ? "Invalid mvsep API token. Check your token and run Separate with MVSEP again."
      : (e instanceof Error ? e.message : "Separation failed.");
    await showError(ctx, msg);
  }
}

function parentAudioTrackFromSlot(slot: ClipSlot<"1.0.0">) {
  const parent = slot.parent;
  if (parent instanceof AudioTrack) return parent;
  throw new Error("Clip slot's parent is not an AudioTrack");
}
