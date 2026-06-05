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
        await runSeparation(context, { kind: "arrangement", clip });
      } catch (e) {
        console.error("[mvsep]", e);
      }
    })();
  });

  context.commands.registerCommand("mvsep.separate.slot", (arg: unknown) => {
    void (async () => {
      try {
        const slot = context.getObjectFromHandle(arg as Handle, ClipSlot);
        const clip = slot.clip;
        if (!(clip instanceof AudioClip)) {
          console.error("[mvsep] selected slot has no audio clip");
          return;
        }
        await runSeparation(context, { kind: "session", slot, clip });
      } catch (e) {
        console.error("[mvsep]", e);
      }
    })();
  });

  void context.ui.registerContextMenuAction("AudioClip", "Separate with MVSEP", "mvsep.separate.clip");
  void context.ui.registerContextMenuAction("ClipSlot", "Separate with MVSEP", "mvsep.separate.slot");
}
