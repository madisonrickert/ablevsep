import type { ExtensionContext } from "@ableton-extensions/sdk";

/** Pure: builds a self-contained error dialog HTML with the message safely escaped. */
export function errorDialogHtml(message: string): string {
  const safe = message.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:dark}body{font:13px -apple-system,"Segoe UI",sans-serif;margin:0;padding:16px;background:#1e1e1e;color:#ddd}
h2{font-size:14px;margin:0 0 8px}p{white-space:pre-wrap;color:#e88}
.actions{display:flex;justify-content:flex-end;margin-top:14px}
button{padding:6px 16px;border-radius:4px;border:1px solid #555;background:#333;color:#eee;cursor:pointer}
</style></head><body><h2>MVSEP</h2><p>${safe}</p><div class="actions"><button id="ok">OK</button></div>
<script>
function post(){var m={method:"close_and_send",params:["ok"]};
if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.live){window.webkit.messageHandlers.live.postMessage(m);}
else if(window.chrome&&window.chrome.webview){window.chrome.webview.postMessage(m);}}
document.getElementById("ok").onclick=post;
</script></body></html>`;
}

/** Shows the error modal. Swallows any dialog error so error reporting never throws. */
export async function showError(ctx: ExtensionContext<"1.0.0">, message: string): Promise<void> {
  const url = "data:text/html," + encodeURIComponent(errorDialogHtml(message));
  try {
    await ctx.ui.showModalDialog(url, 380, 220);
  } catch {
    // ignore
  }
}
