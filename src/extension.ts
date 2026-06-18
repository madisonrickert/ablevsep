import {
  initialize,
  AudioClip,
  ClipSlot,
  type ActivationContext,
  type Handle,
} from "@ableton-extensions/sdk";
import { runSeparation } from "./separate";
import { showError } from "./error-dialog";
import { SESSION_UNSUPPORTED_MESSAGE } from "./separate-core";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("mvsep.separate.clip", (arg: unknown) => {
    void (async () => {
      try {
        const clip = context.getObjectFromHandle(arg as Handle, AudioClip);
        // The "AudioClip" context menu fires for clips in BOTH Arrangement and Session view,
        // and the SDK has no Arrangement-only clip scope (nor a per-clip visibility hook), so
        // we can't hide this item from Session clips. Session separation is unsupported: a
        // Session clip's only audio source is its raw file, which the Host's read sandbox
        // denies. Reject it with guidance toward the Arrangement, where the pre-FX render works.
        if (clip.parent instanceof ClipSlot) {
          console.info("[ablevsep] AudioClip menu on a Session clip → unsupported");
          await showError(context, SESSION_UNSUPPORTED_MESSAGE);
          return;
        }
        console.info("[ablevsep] AudioClip menu on an Arrangement clip → arrangement flow");
        await runSeparation(context, { kind: "arrangement", clip });
      } catch (e) {
        console.error("[ablevsep] separate.clip failed:", e instanceof Error ? (e.stack ?? e.message) : e);
      }
    })();
  });

  // No "ClipSlot" action is registered: Session separation is unsupported for now (see the
  // Session-clip rejection above), so we don't add a clip-slot entry point. The "AudioClip"
  // item still appears on Session clips because the SDK can't scope it to Arrangement only.
  void context.ui.registerContextMenuAction("AudioClip", "Separate Stems with MVSEP", "mvsep.separate.clip");
}
