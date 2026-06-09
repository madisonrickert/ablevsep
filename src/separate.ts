import * as path from "node:path";
import * as fsp from "node:fs/promises";
import {
  AudioClip,
  AudioTrack,
  ClipSlot,
  type ExtensionContext,
} from "@ableton-extensions/sdk";
import { checkToken, createSeparation, downloadFile, getStatus, setPremiumUsage, MvsepError, type StatusFile } from "./mvsep/client";
import { planLimitViolations } from "./credits";
import { wavDurationSeconds } from "./wav";
import { loadCatalog, isPickableModel, type CatalogCache } from "./mvsep/catalog";
import { readConfig, writeConfig } from "./config";
import { pollUntilDone, AbortError } from "./separate-core";
import { openPicker } from "./picker";
import { type PickerAction, type PickerResult } from "./picker-template";
import { showError } from "./error-dialog";
import {
  type OriginalClipInfo,
} from "./placement-args";
import { placeStems } from "./placement";
import {
  resolveDir, ensureDir, resolveScratchDir, readFileUtf8, writeFileUtf8, writeBuffer,
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
    name: clip.name,
  };
}

async function configPaths(ctx: Ctx) {
  const storageDir = await ensureDir(resolveDir(ctx.environment.storageDirectory, "storage"));
  // tempDirectory's sandbox write-grant is unreliable on the first launch after a
  // reboot (see Ableton SDK feedback #10); fall back to a persistent work/ dir under
  // storageDirectory, whose grant always resolves.
  const tempDir = await resolveScratchDir([
    resolveDir(ctx.environment.tempDirectory, "temp"),
    path.join(storageDir, "work"),
  ]);
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
  let config = await readConfig(readFileUtf8, configPath);

  const algorithms = await loadCatalog({
    readCache: async () => {
      try { return JSON.parse(await readFileUtf8(catalogPath)) as CatalogCache; } catch { return null; }
    },
    writeCache: async (c) => writeFileUtf8(catalogPath, JSON.stringify(c)),
    now: () => Date.now(),
  });

  // The picker shows only models it can actually drive: a kept group (ASR/TTS is developer-hidden),
  // a supported upload flow (single_upload), and a placeable audio output (MIDI models are hidden).
  // The hidden ones stay in the catalog for a future dedicated entry point.
  const pickerAlgorithms = algorithms.filter(isPickableModel);

  // Launch health check: validate any saved token so the picker can show its status.
  let tokenStatus = config.apiToken ? await checkToken(config.apiToken) : undefined;
  console.info(
    `[ablevsep] launch: saved token ${config.apiToken ? "present" : "none"}; status ${JSON.stringify(tokenStatus ?? null)}`,
  );

  // Measure the source audio up front so the picker can show a credit estimate and pre-flight the
  // plan limits. Arrangement: the rendered region is (endTime-startTime) beats → seconds via tempo.
  // Session: we upload the whole source file, so read its real duration (WAV header) + size.
  let sourceSeconds: number | undefined;
  let sourceBytes: number | undefined;
  try {
    if (target.kind === "arrangement") {
      const tempo = ctx.application.song.tempo;
      const beats = target.clip.endTime - target.clip.startTime;
      if (tempo > 0 && beats > 0) sourceSeconds = (beats * 60) / tempo;
    } else {
      const fh = await fsp.open(target.clip.filePath, "r");
      try {
        const head = Buffer.alloc(65536);
        const { bytesRead } = await fh.read(head, 0, head.length, 0);
        const secs = wavDurationSeconds(head.subarray(0, bytesRead));
        if (secs != null) sourceSeconds = secs;
        sourceBytes = (await fh.stat()).size;
      } finally {
        await fh.close();
      }
    }
  } catch (e) {
    console.warn(`[ablevsep] could not measure source audio: ${e instanceof Error ? e.message : e}`);
  }

  let choice: PickerResult | null = null;
  while (!choice) {
    // Recompute per iteration: the applicable plan caps depend on premium, which the toggle can flip.
    const limitWarnings = planLimitViolations({
      seconds: sourceSeconds,
      bytes: sourceBytes,
      premium: tokenStatus?.premiumEnabled === true,
    });
    const action: PickerAction | null = await openPicker(ctx, {
      algorithms: pickerAlgorithms,
      config: { apiToken: config.apiToken, lastModel: config.lastModel, outputFormat: config.outputFormat },
      tokenStatus,
      sourceSeconds,
      limitWarnings,
    });
    if (!action) return; // cancelled
    if ("saveToken" in action) {
      config = {
        apiToken: action.apiToken,
        lastModel: action.renderId != null
          ? { renderId: action.renderId, options: action.options as Record<string, string> }
          : config.lastModel,
        outputFormat: action.outputFormat,
      };
      await writeConfig(writeFileUtf8, configPath, config);
      tokenStatus = await checkToken(action.apiToken);
      console.info(`[ablevsep] token save: status ${JSON.stringify(tokenStatus)}`);
      continue;
    }
    if ("setPremium" in action) {
      try {
        tokenStatus = await setPremiumUsage(action.apiToken, action.setPremium);
      } catch (e) {
        console.warn(`[ablevsep] premium toggle failed: ${e instanceof Error ? e.message : e}`);
        tokenStatus = await checkToken(action.apiToken);
      }
      config = {
        apiToken: action.apiToken,
        lastModel: action.renderId != null
          ? { renderId: action.renderId, options: action.options as Record<string, string> }
          : config.lastModel,
        outputFormat: action.outputFormat,
      };
      await writeConfig(writeFileUtf8, configPath, config);
      console.info(`[ablevsep] premium usage ${action.setPremium ? "enabled" : "disabled"}: ${JSON.stringify(tokenStatus)}`);
      continue;
    }
    choice = action;
  }

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
        ? "Preparing audio… (warped clip, stems are best-effort)"
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
      // Exact pre-upload check against the file we're about to send (catches an oversized
      // arrangement render, whose size we couldn't know at picker time). Plain Error → the
      // catch shows the message verbatim (not the MvsepError premium-mapping path).
      const limitViolations = planLimitViolations({
        seconds: wavDurationSeconds(fileBuf) ?? sourceSeconds,
        bytes: fileBuf.length,
        premium: tokenStatus?.premiumEnabled === true,
      });
      if (limitViolations.length) throw new Error(limitViolations.join(" "));
      const hash = await createSeparation({
        apiToken: choice.apiToken,
        fileData: fileBuf,
        fileName: sourceName,
        sepType: choice.renderId,
        outputFormat: choice.outputFormat,
        options: choice.options,
      });
      console.info(`[ablevsep] job created: ${hash} (model ${choice.renderId}, format ${choice.outputFormat})`);
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
      console.info(`[ablevsep] ${files.length} stem(s) ready, downloading`);
      const localStems: { name: string; importedPath: string }[] = [];
      for (let i = 0; i < files.length; i++) {
        if (signal.aborted) return;
        await report(`Downloading stems… (${i + 1}/${files.length})`, 85 + Math.round((7 * i) / Math.max(files.length, 1)));
        const buf = await downloadFile(files[i].downloadUrl);
        const dest = await writeBuffer(tempDir, `${Date.now()}-${i}-${files[i].filename}`, buf);
        const importedPath = await ctx.resources.importIntoProject(dest);
        // The project now holds its own copy; drop the scratch file so a storageDir
        // fallback doesn't accumulate stems. Best-effort — never fail the run on this,
        // but log so a persistent cleanup failure (and slow disk leak) is visible.
        await fsp.rm(dest, { force: true }).catch((e) =>
          console.warn(`[ablevsep] could not remove scratch file ${dest}:`, e instanceof Error ? e.message : e),
        );
        console.info(`[ablevsep] stem ${i + 1}/${files.length} imported: ${files[i].filename}`);
        localStems.push({ name: files[i].stemName ?? files[i].filename, importedPath });
      }
      if (signal.aborted) return;

      // 5. Place.
      console.info(`[ablevsep] placing ${localStems.length} stem track(s) (${target.kind})`);
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
      await report("Done. Select the new tracks and press ⌘G to group them.", 100);
    } catch (e) {
      if (e instanceof AbortError || signal.aborted) return; // user cancelled
      throw e;
    }
  });
  } catch (e) {
    if (e instanceof AbortError) return;
    console.error("[ablevsep] separation failed:", e instanceof Error ? (e.stack ?? e.message) : e);
    const msg = e instanceof MvsepError && e.code === 401
      ? "Invalid MVSEP API token. Replace it in the picker and try again."
      : e instanceof MvsepError && /premium/i.test(e.message)
      ? "This is a premium-only model. Enable premium usage in your MVSEP account settings (or pick a free model like BS Roformer SW), then try again."
      : (e instanceof Error ? e.message : "The separation failed for an unknown reason.");
    await showError(ctx, msg);
  }
}

function parentAudioTrackFromSlot(slot: ClipSlot<"1.0.0">) {
  const parent = slot.parent;
  if (parent instanceof AudioTrack) return parent;
  throw new Error("Clip slot's parent is not an AudioTrack");
}
