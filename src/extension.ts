import {
  initialize,
  type ActivationContext,
  type Handle,
} from "@ableton-extensions/sdk";

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");

  context.commands.registerCommand("mvsep.separate", (arg: unknown) => {
    console.log("[mvsep] separate invoked", arg as Handle);
  });

  void context.ui.registerContextMenuAction("AudioClip", "Separate with MVSEP", "mvsep.separate");
  void context.ui.registerContextMenuAction("ClipSlot", "Separate with MVSEP", "mvsep.separate");
}
