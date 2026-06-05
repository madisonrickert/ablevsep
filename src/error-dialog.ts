import type { ExtensionContext } from "@ableton-extensions/sdk";

const REPO = "madisonrickert/ablevsep";
/** Keep in sync with manifest.json / package.json. */
export const APP_VERSION = "0.1.0";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

/** A prefilled GitHub "new issue" URL for AbleVSEP, including the error text. */
export function issueUrl(message: string): string {
  const title = `[bug] ${message}`.slice(0, 110);
  const body = [
    "**What happened?**",
    "",
    "AbleVSEP showed this error:",
    "",
    "```",
    message,
    "```",
    "",
    `- AbleVSEP version: ${APP_VERSION}`,
    "- Ableton Live version: ",
    "- OS: ",
    "",
    "**Log file:** please attach your Extension Host log (the issue template explains where to find it).",
  ].join("\n");
  return `https://github.com/${REPO}/issues/new?labels=bug&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

/** Pure: a self-contained error dialog. Escapes the message and offers a prefilled
 * GitHub issue link (for repeated problems) that reminds the user to attach their log. */
export function errorDialogHtml(message: string): string {
  const safe = escapeHtml(message);
  const issue = escapeHtml(issueUrl(message));
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:dark}body{font:13px -apple-system,"Segoe UI",sans-serif;margin:0;padding:16px;background:#1e1e1e;color:#ddd}
h2{font-size:14px;margin:0 0 8px}p.msg{white-space:pre-wrap;color:#e88}
.report{font-size:12px;color:#aaa;margin-top:12px;line-height:1.5}
.report a{color:#4ea1e0}
.actions{display:flex;justify-content:flex-end;margin-top:14px}
button{padding:6px 16px;border-radius:4px;border:1px solid #555;background:#333;color:#eee;cursor:pointer}
</style></head><body><h2>AbleVSEP</h2><p class="msg">${safe}</p>
<div class="report">If this keeps happening, please <a href="${issue}" target="_blank" rel="noreferrer">open a GitHub issue</a> and attach your log.<br>github.com/${REPO}/issues</div>
<div class="actions"><button id="ok">OK</button></div>
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
    await ctx.ui.showModalDialog(url, 440, 300);
  } catch {
    // ignore
  }
}
