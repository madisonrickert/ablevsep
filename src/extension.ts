import {
  initialize,
  AudioClip,
  ClipSlot,
  type ActivationContext,
  type Handle,
} from "@ableton-extensions/sdk";
import { runSeparation } from "./separate";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("mvsep.separate.clip", (arg: unknown) => {
    void (async () => {
      try {
        const clip = context.getObjectFromHandle(arg as Handle, AudioClip);
        // The "AudioClip" context menu fires for clips in BOTH Arrangement and Session view.
        // A Session clip's parent is a ClipSlot; route it through the session flow so we
        // separate its source file (not an empty arrangement render → silence) and place the
        // stems back into Session slots rather than onto the Arrangement timeline.
        const parent = clip.parent;
        if (parent instanceof ClipSlot) {
          console.info("[ablevsep] AudioClip menu on a Session clip → session flow");
          await runSeparation(context, { kind: "session", slot: parent, clip });
        } else {
          console.info("[ablevsep] AudioClip menu on an Arrangement clip → arrangement flow");
          await runSeparation(context, { kind: "arrangement", clip });
        }
      } catch (e) {
        console.error("[ablevsep] separate.clip failed:", e instanceof Error ? (e.stack ?? e.message) : e);
      }
    })();
  });

  context.commands.registerCommand("mvsep.separate.slot", (arg: unknown) => {
    void (async () => {
      try {
        const slot = context.getObjectFromHandle(arg as Handle, ClipSlot);
        const clip = slot.clip;
        if (!(clip instanceof AudioClip)) {
          console.error("[ablevsep] selected slot has no audio clip");
          return;
        }
        await runSeparation(context, { kind: "session", slot, clip });
      } catch (e) {
        console.error("[ablevsep] separate.slot failed:", e instanceof Error ? (e.stack ?? e.message) : e);
      }
    })();
  });

  void context.ui.registerContextMenuAction("AudioClip", "Separate Stems with MVSEP", "mvsep.separate.clip");
  void context.ui.registerContextMenuAction("ClipSlot", "Separate Stems with MVSEP", "mvsep.separate.slot");
}
