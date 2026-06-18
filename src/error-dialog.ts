import type { ExtensionContext } from "@ableton-extensions/sdk";

const REPO = "madisonrickert/ablevsep";
/** Keep in sync with manifest.json / package.json. */
export const APP_VERSION = "1.0.1";

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

/** Pure: a self-contained error/info dialog. Escapes the message; the GitHub-issue link
 * (for repeated problems) is shown only when `showReportLink` is true — connectivity
 * states suppress it (being offline is not a bug to report). */
export function errorDialogHtml(
  message: string,
  opts?: { title?: string; showReportLink?: boolean },
): string {
  const title = escapeHtml(opts?.title ?? "Couldn't separate stems");
  const showReportLink = opts?.showReportLink ?? true;
  const safe = escapeHtml(message);
  const report = showReportLink
    ? `<div class="report">If this keeps happening, please <a href="${escapeHtml(issueUrl(message))}" target="_blank" rel="noreferrer">open a GitHub issue</a> and attach your log.</div>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{font:13px/1.45 -apple-system,"Segoe UI",system-ui,sans-serif;margin:0;padding:16px;background:#1b1b1b;color:#e7e7e7;-webkit-font-smoothing:antialiased}
h2{font-size:14px;font-weight:650;margin:0 0 10px;color:#f0c4be}
.msg{white-space:pre-wrap;margin:0;padding:10px 12px;background:#242424;border:1px solid #383838;border-left:3px solid #e8746b;border-radius:6px;color:#e9cbc6}
.report{font-size:11.5px;color:#7c7c7c;margin-top:12px;line-height:1.5}
a{color:#4a9eff;text-decoration:none}a:hover{text-decoration:underline}
.actions{display:flex;justify-content:flex-end;margin-top:14px}
button{padding:7px 16px;border-radius:6px;border:1px solid #4a9eff;background:#4a9eff;color:#06243f;font-weight:600;cursor:pointer}
button:hover{background:#63acff}
</style></head><body><h2>${title}</h2><p class="msg">${safe}</p>
${report}
<div class="actions"><button id="ok">OK</button></div>
<script>
function post(){var m={method:"close_and_send",params:["ok"]};
if(window.webkit&&window.webkit.messageHandlers&&window.webkit.messageHandlers.live){window.webkit.messageHandlers.live.postMessage(m);}
else if(window.chrome&&window.chrome.webview){window.chrome.webview.postMessage(m);}}
document.getElementById("ok").onclick=post;
</script></body></html>`;
}

/** Estimated dialog height (px) so the window hugs the message instead of leaving dead space. */
export function errorDialogHeight(message: string): number {
  const charsPerLine = 54; // ~440px content width at 13px
  const lines = message.split("\n").reduce((n, ln) => n + Math.max(1, Math.ceil(ln.length / charsPerLine)), 0);
  // Fixed chrome (title + message panel padding + report + button + body padding) ≈ 150px;
  // each wrapped message line ≈ 20px. Clamp so very short/long messages stay reasonable.
  return Math.min(440, Math.max(170, 150 + lines * 20));
}

/** Shows a modal error/info dialog. Swallows any dialog error so reporting never throws. */
export async function showError(
  ctx: ExtensionContext<"1.0.0">,
  message: string,
  opts?: { title?: string; showReportLink?: boolean },
): Promise<void> {
  const url = "data:text/html," + encodeURIComponent(errorDialogHtml(message, opts));
  try {
    await ctx.ui.showModalDialog(url, 440, errorDialogHeight(message));
  } catch (e) {
    console.error("[ablevsep] could not show error dialog. Original error:", message, "| dialog error:", e instanceof Error ? e.message : e);
  }
}

export const OFFLINE_TITLE = "Can't reach MVSEP";
export const OFFLINE_FIRST_RUN_BODY =
  "AbleVSEP separates stems using MVSEP's cloud service, so it needs an internet connection. " +
  "The first time you use AbleVSEP, it also downloads the list of separation models from MVSEP. " +
  "That hasn't happened yet, so there's nothing to show offline. " +
  "Reconnect, then right-click the clip and choose Separate Stems with MVSEP again.";
export const OFFLINE_MIDJOB_BODY =
  "AbleVSEP lost its connection to MVSEP, so this separation didn't finish. " +
  "Check your connection, then run it again.";
export const MODELS_NOT_LOADED_TITLE = "Models not loaded";
export const MODELS_NOT_LOADED_BODY =
  "AbleVSEP hasn't finished loading the model list from MVSEP, so there's nothing to show yet. " +
  "To try again, right-click the clip and choose Separate Stems with MVSEP. " +
  "If loading stays slow, your internet connection may be down.";
export const STALE_MODEL_MESSAGE =
  "That model is no longer available on MVSEP. Pick another model and try again.";

/** The connectivity dialog: offline title, no GitHub-issue link. */
export async function showOfflineDialog(ctx: ExtensionContext<"1.0.0">, body: string): Promise<void> {
  return showError(ctx, body, { title: OFFLINE_TITLE, showReportLink: false });
}

/** A neutral info dialog (custom title, no GitHub-issue link). */
export async function showInfoDialog(ctx: ExtensionContext<"1.0.0">, title: string, body: string): Promise<void> {
  return showError(ctx, body, { title, showReportLink: false });
}
