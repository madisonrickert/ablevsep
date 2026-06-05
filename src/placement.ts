import {
  type AudioClip,
  type AudioTrack,
  type ExtensionContext,
} from "@ableton-extensions/sdk";
import {
  arrangementClipArgs, sessionClipArgs, stemNameFromFilename, stemTrackName,
  type OriginalClipInfo,
} from "./placement-args";

type Ctx = ExtensionContext<"1.0.0">;

export interface PlaceRequest {
  kind: "arrangement" | "session";
  orig: OriginalClipInfo;
  stems: { name: string; importedPath: string }[];
  sessionRow?: number;
  originalClip: AudioClip<"1.0.0">;
}

/**
 * Creates one audio track per stem (adjacent, shared color, prefixed name).
 *
 * `withinTransaction` is strictly synchronous (no `await` inside) and you cannot
 * create a track and then modify it in the same transaction — so per the SDK this
 * is done as three sequential, cleanly-grouped undo steps:
 *   1. create all tracks
 *   2. name them + create their clips
 *   3. color the clips + mute the original
 * A single combined undo step is not achievable with this API.
 */
export async function placeStems(ctx: Ctx, req: PlaceRequest): Promise<void> {
  const song = ctx.application.song;
  const color = req.orig.color;

  // 1. Create all tracks (grouped).
  const tracks: AudioTrack<"1.0.0">[] = await ctx.withinTransaction(() =>
    Promise.all(req.stems.map(() => song.createAudioTrack())),
  );

  // 2. Name each track and create its clip (grouped). All calls are synchronous
  //    within the transaction; the returned promises are awaited outside it.
  const clips: AudioClip<"1.0.0">[] = await ctx.withinTransaction(() =>
    Promise.all(
      req.stems.map((stem, i) => {
        const track = tracks[i]!;
        track.name = stemTrackName(req.orig.name, stemNameFromFilename(stem.name));
        if (req.kind === "arrangement") {
          return track.createAudioClip(arrangementClipArgs(stem.importedPath, req.orig));
        }
        const slot = track.clipSlots[req.sessionRow ?? 0]!;
        return slot.createAudioClip(sessionClipArgs(stem.importedPath, req.orig));
      }),
    ),
  );

  // 3. Color the stem clips and mute the original (grouped). Each write is guarded so a
  //    cosmetic coloring failure can't prevent the mute (or vice versa), and any failure is
  //    logged rather than silently swallowed (this is why a warped original once went unmuted).
  ctx.withinTransaction(() => {
    for (const clip of clips) {
      try {
        clip.color = color;
      } catch (e) {
        console.warn("[ablevsep] could not color a stem clip:", e instanceof Error ? e.message : e);
      }
    }
    try {
      req.originalClip.muted = true;
    } catch (e) {
      console.error("[ablevsep] could not mute the original clip:", e instanceof Error ? (e.stack ?? e.message) : e);
    }
  });
}
