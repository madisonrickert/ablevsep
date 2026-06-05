import {
  AudioClip,
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

/** Creates one track per stem (adjacent, shared color, prefixed name) in a single undo step. */
export async function placeStems(ctx: Ctx, req: PlaceRequest): Promise<void> {
  const song = ctx.application.song;
  const color = req.orig.color;

  const promises = ctx.withinTransaction(() =>
    req.stems.map((stem) =>
      (async () => {
        const stemName = stemNameFromFilename(stem.name);
        const track: AudioTrack<"1.0.0"> = await song.createAudioTrack();
        track.name = stemTrackName(req.orig.name, stemName);

        let clip: AudioClip<"1.0.0">;
        if (req.kind === "arrangement") {
          clip = await track.createAudioClip(arrangementClipArgs(stem.importedPath, req.orig));
        } else {
          const slot = track.clipSlots[req.sessionRow ?? 0]!;
          clip = await slot.createAudioClip(sessionClipArgs(stem.importedPath, req.orig));
        }
        clip.color = color;
      })(),
    ),
  );

  await Promise.all(promises);

  // Mute the original so the user hears the stems.
  req.originalClip.muted = true;
}
