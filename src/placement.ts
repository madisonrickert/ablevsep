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
 * Creates one audio track per stem (adjacent, prefixed name). Each stem clip keeps
 * the color Live assigns its new track, so the stems return in distinct, track-matched
 * colors rather than one flat color. The SDK exposes no track-color API (only
 * `Clip.color`), so this relies on Live coloring a freshly created clip to match its
 * track — we simply don't override it.
 *
 * `withinTransaction` is strictly synchronous (no `await` inside) and you cannot
 * create a track and then modify it in the same transaction — so per the SDK this
 * is done as sequential, cleanly-grouped undo steps:
 *   1. create all tracks
 *   2. name them + create their clips
 *   3. mute the original
 * A single combined undo step is not achievable with this API.
 */
export async function placeStems(ctx: Ctx, req: PlaceRequest): Promise<void> {
  const song = ctx.application.song;

  // 1. Create all tracks (grouped).
  const tracks: AudioTrack<"1.0.0">[] = await ctx.withinTransaction(() =>
    Promise.all(req.stems.map(() => song.createAudioTrack())),
  );

  // 2. Name each track and create its clip (grouped). All calls are synchronous
  //    within the transaction; the returned promises are awaited outside it. We don't
  //    set a clip color — each clip inherits its track's color (see the header comment).
  await ctx.withinTransaction(() =>
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

  // 3. Mute the original clip (grouped, guarded). The write is guarded so a failure is
  //    logged rather than silently swallowed — an unguarded throw here once left a
  //    warped original unmuted.
  ctx.withinTransaction(() => {
    try {
      req.originalClip.muted = true;
    } catch (e) {
      console.error("[ablevsep] could not mute the original clip:", e instanceof Error ? (e.stack ?? e.message) : e);
    }
  });
}
